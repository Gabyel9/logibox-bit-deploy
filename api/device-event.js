import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Event -> vault update + activity log text
// Each entry: an object of fields merged into the vault doc (or null for
// log-only) plus an { action, details } used for the activity log.
const EVENT_HANDLERS = {
  session_start: {
    update: { deliveryInProgress: true, parcelConfirmed: false },
    action: 'Delivery Session Started',
  },
  door_opened: {
    update: null,
    action: 'Vault Door Opened',
  },
  parcel_placed: {
    update: { parcelConfirmed: true },
    action: 'Parcel Placed',
  },
  parcel_removed: {
    // Session stays active (deliveryInProgress untouched) so the rider can
    // re-place the parcel and complete the delivery.
    update: { parcelConfirmed: false },
    action: 'Parcel Removed Before Lock',
  },
  door_closed_locked: {
    update: {
      status: 'occupied',
      deliveryInProgress: false,
      parcelConfirmed: true,
      lockedAt: () => new Date().toISOString(),
    },
    action: 'Delivery Locked In',
  },
  no_parcel: {
    update: { deliveryInProgress: false, parcelConfirmed: false },
    action: 'Delivery Aborted - No Parcel Detected',
  },
  auto_locked: {
    // Also clears the remote-open markers: if a dashboard-initiated session
    // hit the 30s failsafe (or any other forced re-lock), the website's
    // "collecting" badge must come down and a new unlock must be allowed.
    update: { deliveryInProgress: false, remoteOpenStatus: null, remoteOpenRequestedAt: null },
    action: 'Vault Auto-Locked',
  },
  // --- Remote open (dashboard "Confirm & Open Vault") ---
  remote_opened: {
    // The keypad picked up the open_vault command and released the solenoid.
    // The website watches this field to confirm the door actually opened.
    update: { remoteOpenStatus: 'active' },
    action: 'Vault Opened Remotely',
  },
  remote_collection_done: {
    // Door re-closed after a remote session (or the failsafe fired with the
    // IR beam already empty). Parcel collected -> the vault is finished;
    // 'completed' hands off to the dashboard's existing auto-reset watchdog,
    // which clears the document back to a clean 'empty' vault.
    update: {
      status: 'completed',
      completedAt: () => new Date().toISOString(),
      deliveryInProgress: false,
      remoteOpenStatus: null,
      remoteOpenRequestedAt: null,
    },
    action: 'Collection Complete',
  },
};

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

  // 2. Check individual env vars (legacy format)
  if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PRIVATE_KEY) {
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

/**
 * Resolve the vault a device event refers to, re-validating the device doc
 * and the allowed vault list on every call (same trust boundary as
 * device-verify-otp).
 */
async function resolveVault(deviceId, vaultId) {
  const db = getDb();

  const deviceRef = db.doc(`devices/${deviceId}`);
  const deviceDoc = await deviceRef.get();
  if (!deviceDoc.exists) return { error: { code: 404, message: 'Device not registered' } };

  const device = deviceDoc.data();
  if (device.status !== 'active') return { error: { code: 403, message: 'Device is not active' } };

  const { ownerUid, allowedVaultIds } = device;
  if (!ownerUid || !allowedVaultIds || !Array.isArray(allowedVaultIds) || allowedVaultIds.length === 0) {
    return { error: { code: 500, message: 'Device configuration error' } };
  }

  if (!allowedVaultIds.includes(vaultId)) {
    return { error: { code: 403, message: 'Device not authorized for this vault' } };
  }

  const vaultRef = db.doc(`users/${ownerUid}/vaults/${vaultId}`);
  const vaultDoc = await vaultRef.get();
  if (!vaultDoc.exists) return { error: { code: 404, message: 'Vault not found' } };

  return { ownerUid, vaultRef };
}

export default async (req, res) => {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const { deviceId, vaultId, event } = req.body;
  const db = getDb();

  // Input validation
  if (!deviceId || typeof deviceId !== 'string' || deviceId.length === 0) {
    return res.status(400).json({ success: false, message: 'Device ID is required' });
  }
  if (!vaultId || typeof vaultId !== 'string' || vaultId.length === 0) {
    return res.status(400).json({ success: false, message: 'Vault ID is required' });
  }
  if (!event || typeof event !== 'string' || !Object.prototype.hasOwnProperty.call(EVENT_HANDLERS, event)) {
    return res.status(400).json({ success: false, message: 'Unknown event' });
  }

  try {
    const resolved = await resolveVault(deviceId, vaultId);
    if (resolved.error) {
      return res.status(resolved.error.code).json({ success: false, message: resolved.error.message });
    }

    const { ownerUid, vaultRef } = resolved;
    const handler = EVENT_HANDLERS[event];

    // Apply any vault field updates (fields with function values are computed)
    if (handler.update) {
      const fields = {};
      for (const [key, value] of Object.entries(handler.update)) {
        fields[key] = typeof value === 'function' ? value() : value;
      }
      await vaultRef.update(fields);
    }

    // Log the event in the owner's activity log
    await db.collection(`users/${ownerUid}/activityLogs`).add({
      action: handler.action,
      details: `Vault ${vaultId} event '${event}' reported by device ${deviceId}`,
      vaultId: parseInt(vaultId),
      timestamp: new Date(),
    });

    return res.status(200).json({ success: true, event });
  } catch (error) {
    console.error('deviceEvent error:', error);
    let debugInfo = 'Unknown error';
    if (error.code) {
      debugInfo = `code:${error.code}`;
    } else if (error.message) {
      debugInfo = error.message.substring(0, 100);
    } else {
      debugInfo = String(error).substring(0, 100);
    }
    return res.status(500).json({ success: false, message: 'Internal server error', debugInfo });
  }
};