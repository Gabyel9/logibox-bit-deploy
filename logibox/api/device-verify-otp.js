import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Rate limiting constants
const MAX_OTP_ATTEMPTS = 5;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

// Load service account key - try multiple sources
function loadServiceAccount() {
  console.log('loadServiceAccount: FIREBASE_SERVICE_ACCOUNT_KEY exists:', !!process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
  console.log('loadServiceAccount: FIREBASE_PROJECT_ID exists:', !!process.env.FIREBASE_PROJECT_ID);
  console.log('loadServiceAccount: FIREBASE_PRIVATE_KEY exists:', !!process.env.FIREBASE_PRIVATE_KEY);

  // 1. Check environment variable (for Vercel production)
  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    try {
      const parsed = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
      console.log('loadServiceAccount: parsed service account key, has private_key:', !!parsed.private_key);
      return parsed;
    } catch (e) {
      console.error('Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY:', e.message);
    }
  }

  // 2. Check individual env vars (legacy format)
  if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PRIVATE_KEY) {
    console.log('loadServiceAccount: using legacy env vars');
    return {
      type: 'service_account',
      project_id: process.env.FIREBASE_PROJECT_ID,
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
      private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    };
  }

  // 3. Try to read from service-account-key.json (local dev)
  const serviceAccountPath = path.join(process.cwd(), 'service-account-key.json');
  if (fs.existsSync(serviceAccountPath)) {
    try {
      return JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
    } catch (e) {
      console.error('Failed to read service-account-key.json:', e);
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
    console.log('Initializing Firebase Admin...');
    const serviceAccount = loadServiceAccount();

    if (serviceAccount) {
      console.log('Using service account from env');
      initializeApp({ credential: cert(serviceAccount) });
    } else {
      console.log('No service account found, trying fallback');
      // Fallback: Initialize with default credentials (same as generate-otp.js)
      try {
        initializeApp();
      } catch (e) {
        // App may already be initialized
        console.warn('Firebase initialization warning:', e.message);
      }
    }
    adminInitialized = true;
    db = getFirestore();
    console.log('Firebase Admin initialized');
  }
  return db;
}

/**
 * Device rate limiter using Firestore to track OTP failed attempts
 */
async function checkDeviceRateLimit(deviceId) {
  const db = getDb();
  const rateLimitDocRef = db.doc(`devices/${deviceId}/rateLimits/otp`);
  const rateLimitDoc = await rateLimitDocRef.get();

  const now = Date.now();
  const windowStart = new Date(now - RATE_LIMIT_WINDOW_MS);

  if (!rateLimitDoc.exists) {
    return { allowed: true, remaining: MAX_OTP_ATTEMPTS, resetAt: new Date(now + RATE_LIMIT_WINDOW_MS) };
  }

  const data = rateLimitDoc.data();
  const attempts = data.attempts || [];

  const recentAttempts = attempts.filter(t => t.timestamp && t.timestamp.toDate && t.timestamp.toDate() > windowStart);

  if (recentAttempts.length >= MAX_OTP_ATTEMPTS) {
    const oldestAttempt = recentAttempts[0];
    const resetAt = oldestAttempt.timestamp ? new Date(oldestAttempt.timestamp.toDate().getTime() + RATE_LIMIT_WINDOW_MS) : new Date(now + RATE_LIMIT_WINDOW_MS);
    return { allowed: false, remaining: 0, resetAt };
  }

  return {
    allowed: true,
    remaining: MAX_OTP_ATTEMPTS - recentAttempts.length,
    resetAt: new Date(now + RATE_LIMIT_WINDOW_MS)
  };
}

/**
 * Records a failed OTP attempt for device rate limiting
 */
async function recordDeviceFailedAttempt(deviceId) {
  const db = getDb();
  const rateLimitDocRef = db.doc(`devices/${deviceId}/rateLimits/otp`);
  const rateLimitDoc = await rateLimitDocRef.get();

  const now = Date.now();
  const newAttempt = { timestamp: new Date(), type: 'otp_failed' };

  if (!rateLimitDoc.exists) {
    await rateLimitDocRef.set({
      attempts: [newAttempt],
      createdAt: new Date(),
    });
  } else {
    const data = rateLimitDoc.data();
    const attempts = data.attempts || [];
    const windowStart = new Date(now - RATE_LIMIT_WINDOW_MS);

    const recentAttempts = attempts.filter(t => t.timestamp && t.timestamp.toDate && t.timestamp.toDate() > windowStart);
    recentAttempts.push(newAttempt);

    await rateLimitDocRef.update({
      attempts: recentAttempts,
      updatedAt: new Date(),
    });
  }
}

/**
 * Clears device rate limit after successful verification
 */
async function clearDeviceRateLimit(deviceId) {
  const db = getDb();
  const rateLimitDocRef = db.doc(`devices/${deviceId}/rateLimits/otp`);
  await rateLimitDocRef.delete().catch(() => {
    // Ignore if doc doesn't exist
  });
}

export default async (req, res) => {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const { deviceId, otp, vaultId } = req.body;
  const db = getDb();

  // STEP 1 — Input validation
  if (!deviceId || typeof deviceId !== 'string' || deviceId.length === 0) {
    return res.status(400).json({ success: false, message: 'Device ID is required' });
  }

  if (!otp || typeof otp !== 'string' || otp.length === 0) {
    return res.status(400).json({ success: false, message: 'OTP is required' });
  }

  // Validate otp is numeric and within expected range (4-6 digits)
  if (!/^\d{4,6}$/.test(otp)) {
    return res.status(400).json({ success: false, message: 'OTP must be 4-6 digits' });
  }

  // Validate vaultId from request body
  if (!vaultId || typeof vaultId !== 'string' || vaultId.length === 0) {
    return res.status(400).json({ success: false, message: 'Vault ID is required' });
  }

  try {
    // STEP 1b — Device rate limiting check
    const rateLimit = await checkDeviceRateLimit(deviceId);
    if (!rateLimit.allowed) {
      const minutesRemaining = Math.ceil((rateLimit.resetAt.getTime() - Date.now()) / 60000);
      return res.status(429).json({
        success: false,
        message: `Too many attempts. Please try again in ${minutesRemaining} minutes.`
      });
    }

    // STEP 2 — Look up device in devices collection
    const deviceRef = db.doc(`devices/${deviceId}`);
    const deviceDoc = await deviceRef.get();

    if (!deviceDoc.exists) {
      return res.status(404).json({ success: false, message: 'Device not registered' });
    }

    const device = deviceDoc.data();

    if (device.status !== 'active') {
      return res.status(403).json({ success: false, message: 'Device is not active' });
    }

    const { ownerUid, allowedVaultIds } = device;

    if (!ownerUid || !allowedVaultIds || !Array.isArray(allowedVaultIds) || allowedVaultIds.length === 0) {
      return res.status(500).json({ success: false, message: 'Device configuration error' });
    }

    // Validate vaultId from request against device's allowed list
    // This is the security-critical check: we ONLY trust vaultId AFTER validating it against allowedVaultIds
    if (!allowedVaultIds.includes(vaultId)) {
      return res.status(403).json({ success: false, message: 'Device not authorized for this vault' });
    }

    // STEP 3 — Fetch vault doc using ownerUid from device and validated vaultId from request
    const vaultRef = db.doc(`users/${ownerUid}/vaults/${vaultId}`);
    const vaultDoc = await vaultRef.get();

    if (!vaultDoc.exists) {
      return res.status(404).json({ success: false, message: 'Vault not found' });
    }

    const vault = vaultDoc.data();

    // STEP 4 — Check OTP status is active
    if (vault.otpStatus !== 'active') {
      return res.status(400).json({ success: false, message: 'OTP is not active' });
    }

    // STEP 5 — Check expiry (otpExpiresAt stored as ISO string)
    const now = Date.now();
    const expiresAt = new Date(vault.otpExpiresAt).getTime();

    if (now >= expiresAt) {
      await vaultRef.update({ otpStatus: 'expired' });
      return res.status(400).json({ success: false, message: 'OTP has expired' });
    }

    // STEP 6 — Verify OTP hash (SHA-256, same method as Cloud Function)
    const hash = crypto.createHash('sha256').update(otp).digest('hex');

    if (hash !== vault.otpHash) {
      // Record failed attempt for device rate limiting
      await recordDeviceFailedAttempt(deviceId);

      // Log failed attempt
      await db.collection(`users/${ownerUid}/activityLogs`).add({
        action: 'Device OTP Verification Failed',
        details: `Invalid OTP entered by device ${deviceId} for vault ${vaultId}`,
        vaultId: parseInt(vaultId),
        timestamp: new Date(),
      });
      return res.status(403).json({ success: false, message: 'Invalid OTP' });
    }

    // STEP 7 — Success: mark OTP as used and update vault status
    // Clear device rate limit on successful verification
    await clearDeviceRateLimit(deviceId);

    await vaultRef.update({
      otpStatus: 'used',
      otpHash: null,
      otpEncrypted: null,
      status: 'occupied', // Mark vault as occupied when OTP is used
    });

    // Log successful verification
    await db.collection(`users/${ownerUid}/activityLogs`).add({
      action: 'Delivery Confirmed',
      details: `Vault ${vaultId} opened via device ${deviceId}`,
      vaultId: parseInt(vaultId),
      timestamp: new Date(),
    });

    return res.status(200).json({
      success: true,
      message: 'Vault opened successfully'
    });

  } catch (error) {
    console.error('deviceVerifyOtp error:', error);

    // Try to extract useful info from the error
    let debugInfo = 'Unknown error';
    if (error.code) {
      debugInfo = `code:${error.code}`;
    } else if (error.message) {
      debugInfo = error.message.substring(0, 100);
    } else {
      debugInfo = String(error).substring(0, 100);
    }

    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      debug: debugInfo
    });
  }
};