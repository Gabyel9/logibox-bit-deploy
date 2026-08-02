import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Max accepted payload: ~300KB base64 (a VGA JPEG). Keeps the Firestore doc
// comfortably under the 1MB limit while rejecting abuse.
const MAX_BASE64_LENGTH = 300 * 1024;

// Load service account key - try multiple sources (same as device-verify-otp.js)
function loadServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    try {
      return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    } catch (e) {
      console.error('Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY:', e.message);
    }
  }

  if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PRIVATE_KEY) {
    return {
      type: 'service_account',
      project_id: process.env.FIREBASE_PROJECT_ID,
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
      private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    };
  }

  const serviceAccountPath = path.join(process.cwd(), 'service-account-key.json');
  if (fs.existsSync(serviceAccountPath)) {
    try {
      return JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
    } catch (e) {
      console.error('Failed to read service-account-key.json:', e);
    }
  }

  return null;
}

let db;
let adminInitialized = false;

function getDb() {
  if (!adminInitialized) {
    const serviceAccount = loadServiceAccount();
    if (serviceAccount) {
      initializeApp({ credential: cert(serviceAccount) });
    } else {
      try {
        initializeApp();
      } catch (e) {
        console.warn('Firebase initialization warning:', e.message);
      }
    }
    adminInitialized = true;
    db = getFirestore();
  }
  return db;
}

// Returns true if the decoded payload looks like a JPEG (starts with FF D8)
function isJpeg(buffer) {
  return buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8;
}

export default async (req, res) => {
  // Handle CORS (the ESP32 is not a browser, but keep it consistent with the other endpoints)
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  // Support two transports:
  //   1. JSON  -> { deviceId, imageBase64 }
  //   2. Binary-> raw JPEG body + deviceId query param (used by the ESP32-CAM)
  const deviceId = req.query?.deviceId || req.body?.deviceId;

  // Optional session metadata sent by the camera (used to group frames into a
  // delivery session and label it with the vault being opened).
  const sessionId = typeof req.query?.sessionId === 'string' ? req.query.sessionId.slice(0, 64) : null;
  const vaultId = typeof req.query?.vaultId === 'string' ? req.query.vaultId.slice(0, 16) : null;

  let buffer;
  if (Buffer.isBuffer(req.body)) {
    buffer = req.body;
  } else if (typeof req.body?.imageBase64 === 'string') {
    buffer = Buffer.from(req.body.imageBase64, 'base64');
  }

  if (!deviceId || typeof deviceId !== 'string' || deviceId.length === 0) {
    return res.status(400).json({ success: false, message: 'Device ID is required' });
  }

  if (!buffer || buffer.length === 0) {
    return res.status(400).json({ success: false, message: 'Image is required' });
  }

  if (buffer.length > MAX_BASE64_LENGTH) {
    return res.status(413).json({ success: false, message: 'Image payload too large' });
  }

  // Validate it is actually a JPEG
  if (!isJpeg(buffer)) {
    return res.status(400).json({ success: false, message: 'Payload is not a valid JPEG' });
  }

  const imageBase64 = buffer.toString('base64');

  const dbInstance = getDb();

  try {
    // Look up the camera device
    const deviceRef = dbInstance.doc(`devices/${deviceId}`);
    const deviceDoc = await deviceRef.get();

    if (!deviceDoc.exists) {
      return res.status(404).json({ success: false, message: 'Device not registered' });
    }

    const device = deviceDoc.data();

    if (device.status !== 'active') {
      return res.status(403).json({ success: false, message: 'Device is not active' });
    }

    if (!device.ownerUid) {
      return res.status(500).json({ success: false, message: 'Device configuration error' });
    }

    const hash = crypto.createHash('sha256').update(buffer).digest('hex');

    // Store latest snapshot under the owner's user doc.
    // The Firestore doc lives at users/{ownerUid}/camera and the web app
    // subscribes to it with onSnapshot.
    const cameraRef = dbInstance.doc(`users/${device.ownerUid}/camera/current`);

    const now = new Date();

    // Dedupe: skip the write if the frame hasn't changed since the last upload.
    const cameraDoc = await cameraRef.get();
    if (cameraDoc.exists && cameraDoc.data().lastHash === hash) {
      // Device is still alive and uploading; just refresh its health stamp.
      await deviceRef.set({ lastSeenAt: now }, { merge: true });
      return res.status(200).json({ success: true, deduped: true });
    }

    const frameIndex = (device.lastFrameIndex || 0) + 1;

    await cameraRef.set({
      imageBase64,
      lastHash: hash,
      updatedAt: now,
      sessionId,
      vaultId,
    });

    // Append the frame to the session history so the owner can review and
    // download evidence of the delivery transaction afterwards.
    await dbInstance.collection(`users/${device.ownerUid}/cameraSnapshots`).add({
      imageBase64,
      deviceId,
      sessionId,
      vaultId,
      frameIndex,
      createdAt: now,
    });

    // Track device health and the per-session frame counter
    await deviceRef.set({ lastSeenAt: now, lastFrameIndex: frameIndex }, { merge: true });

    return res.status(200).json({ success: true, message: 'Snapshot stored' });
  } catch (error) {
    console.error('cameraUpload error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
