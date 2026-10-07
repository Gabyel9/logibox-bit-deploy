import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';

// Load service account key - try multiple sources
function loadServiceAccount() {
  // 1. Check environment variable (for Vercel production)
  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    try {
      return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    } catch (e) {
      console.error('Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY:', e.message);
    }
  }

  // 2. Check GOOGLE_APPLICATION_CREDENTIALS env
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    try {
      return JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS);
    } catch (e) {
      console.error('Failed to parse GOOGLE_APPLICATION_CREDENTIALS:', e.message);
    }
  }

  // 3. Check individual env vars (legacy format)
  if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PRIVATE_KEY) {
    return {
      type: 'service_account',
      project_id: process.env.FIREBASE_PROJECT_ID,
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
      private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    };
  }

  // 4. Try to read from service-account-key.json (local dev)
  const serviceAccountPath = path.join(process.cwd(), 'service-account-key.json');
  if (fs.existsSync(serviceAccountPath)) {
    try {
      return JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
    } catch (e) {
      console.error('Failed to read service-account-key.json:', e.message);
    }
  }

  console.log('loadServiceAccount: returning null - no credentials found!');
  return null;
}

// Firebase Admin SDK - initialized once per cold start
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
        // App may already be initialized
        console.warn('Firebase initialization warning:', e.message);
      }
    }
    adminInitialized = true;
    db = getFirestore();
  }
  return db;
}

function toMillis(value) {
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

/**
 * POST /api/device-poll - called by the keypad firmware every few seconds.
 * Hands out pending commands (e.g. open_vault from the dashboard's
 * "Confirm & Open Vault") and refreshes the device's lastSeenAt so the
 * website can tell an online keypad from an offline one.
 *
 * Trust model matches the other device endpoints: authentication is the
 * registered deviceId document; all authorization (vault ownership, TTL,
 * rate limits) was already enforced when the command was enqueued.
 */
export default async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const { deviceId, rssi, firmwareVersion } = req.body || {};

  if (!deviceId || typeof deviceId !== 'string' || deviceId.length === 0) {
    return res.status(400).json({ success: false, message: 'Device ID is required' });
  }

  try {
    const db = getDb();
    const deviceRef = db.doc(`devices/${deviceId}`);
    const deviceDoc = await deviceRef.get();

    if (!deviceDoc.exists) {
      return res.status(404).json({ success: false, message: 'Device not registered' });
    }
    if (deviceDoc.data().status !== 'active') {
      return res.status(403).json({ success: false, message: 'Device is not active' });
    }

    const now = Date.now();
    const commands = [];

    // Consume pending commands in a transaction: a command is handed out
    // exactly once even if two polls race, and anything past its 30s TTL is
    // marked expired instead of delivered (a stale open must never fire).
    await db.runTransaction(async (tx) => {
      const pendingSnap = await tx.get(
        db.collection(`devices/${deviceId}/commands`).where('status', '==', 'pending')
      );

      pendingSnap.forEach((cmdDoc) => {
        const data = cmdDoc.data();
        const expiresAt = toMillis(data.expiresAt);

        if (!Number.isFinite(expiresAt) || now >= expiresAt) {
          tx.update(cmdDoc.ref, { status: 'expired', expiredAt: new Date() });
          return;
        }

        tx.update(cmdDoc.ref, { status: 'consumed', consumedAt: new Date() });
        commands.push({
          id: cmdDoc.id,
          type: data.type,
          vaultId: data.vaultId,
        });
      });

      // Heartbeat: every poll keeps lastSeenAt fresh (free online/offline
      // telemetry for the website).
      const deviceUpdate = { lastSeenAt: new Date() };
      if (typeof rssi === 'number' && Number.isFinite(rssi)) {
        deviceUpdate.rssi = Math.round(rssi);
      }
      if (typeof firmwareVersion === 'string' && firmwareVersion.length <= 40) {
        deviceUpdate.firmwareVersion = firmwareVersion;
      }
      tx.update(deviceRef, deviceUpdate);
    });

    return res.status(200).json({ success: true, commands });
  } catch (error) {
    console.error('device-poll error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
