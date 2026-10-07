import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import cors from 'cors';
import fs from 'fs';
import path from 'path';

// Rate limiting: remote opens are a physical action - keep them scarce.
const MAX_REMOTE_UNLOCKS = 5;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

// A command only lives this long. If the keypad doesn't pick it up in time
// it can never open the door - the user must be physically present AND
// watching when they confirm, so a stale command must not fire later.
const COMMAND_TTL_MS = 30 * 1000;

// A pending request older than this is considered lost (the website clears
// its own marker at 20s; this buffer covers a page that was closed mid-wait).
const PENDING_GUARD_MS = COMMAND_TTL_MS + 5000;

// A remote-open session longer than this means the device's completion event
// was lost (e.g. WiFi dropped right at the 30s failsafe). The firmware
// session itself can never last more than ~35s, so after this the vault's
// remoteOpenStatus is stale and a new unlock must be allowed through.
const STALE_ACTIVE_MS = 60 * 1000;

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

/**
 * Rate limiter for remote unlocks, per vault (mirrors the OTP generation
 * limiter in generate-otp.js: a rolling window of timestamps).
 */
async function checkRemoteUnlockRateLimit(uid, vaultId) {
  const db = getDb();
  const rateLimitDoc = await db.doc(`users/${uid}/rateLimits/remoteUnlock_${vaultId}`).get();

  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;

  if (!rateLimitDoc.exists) {
    return { allowed: true, resetAt: null };
  }

  const data = rateLimitDoc.data();
  const timestamps = data.timestamps || [];
  const recent = timestamps.filter(t => {
    const time = t?.toDate ? t.toDate().getTime() : new Date(t).getTime();
    return Number.isFinite(time) && time > windowStart;
  });

  if (recent.length >= MAX_REMOTE_UNLOCKS) {
    const oldest = recent[0]?.toDate ? recent[0].toDate().getTime() : new Date(recent[0]).getTime();
    return { allowed: false, resetAt: new Date(oldest + RATE_LIMIT_WINDOW_MS) };
  }

  return { allowed: true, resetAt: null };
}

export default async function handler(req, res) {
  const corsHandler = cors({ origin: true });

  return corsHandler(req, res, async () => {
    if (req.method !== 'POST') {
      return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    try {
      const { vaultId, idToken } = req.body;

      if (!vaultId || typeof vaultId !== 'string' || !/^\d{1,2}$/.test(vaultId)) {
        return res.status(400).json({ success: false, message: 'Invalid vault ID' });
      }
      if (!idToken || typeof idToken !== 'string') {
        return res.status(401).json({ success: false, message: 'Authentication required' });
      }

      // Verify the website session
      const { getAuth } = await import('firebase-admin/auth');
      const db = getDb();
      const auth = getAuth();

      let decodedToken;
      try {
        decodedToken = await auth.verifyIdToken(idToken);
      } catch (verifyError) {
        console.error('vault-unlock token verification failed:', verifyError.message);
        return res.status(401).json({ success: false, message: 'Invalid or expired session' });
      }

      const uid = decodedToken.uid;

      // Find the owner's active device that controls this vault. The
      // `devices` collection is Admin-only (clients cannot read it), so this
      // lookup only ever happens server-side.
      const devicesSnap = await db
        .collection('devices')
        .where('ownerUid', '==', uid)
        .where('status', '==', 'active')
        .get();

      const deviceDoc = devicesSnap.docs.find(d => {
        const allowed = d.data().allowedVaultIds;
        return Array.isArray(allowed) && allowed.includes(vaultId);
      });

      if (!deviceDoc) {
        return res.status(404).json({
          success: false,
          message: 'No active device is registered for this vault.',
        });
      }

      const vaultRef = db.doc(`users/${uid}/vaults/${vaultId}`);
      const vaultSnap = await vaultRef.get();
      if (!vaultSnap.exists) {
        return res.status(404).json({ success: false, message: 'Vault not found' });
      }
      const vault = vaultSnap.data();

      // Physical-open guards. The button is only rendered for Occupied
      // vaults in the UI; these checks make the rule hold for direct API
      // calls too.
      if (vault.enabled === false) {
        return res.status(403).json({ success: false, message: 'This vault is disabled.' });
      }
      if (vault.deliveryInProgress === true) {
        return res.status(409).json({
          success: false,
          message: 'A delivery session is already in progress on this vault.',
        });
      }
      if (vault.status !== 'occupied') {
        return res.status(409).json({
          success: false,
          message: 'There is no parcel inside this vault to collect.',
        });
      }

      const requestedAt = vault.remoteOpenRequestedAt
        ? Date.parse(vault.remoteOpenRequestedAt)
        : NaN;
      const requestAge = Number.isFinite(requestedAt) ? Date.now() - requestedAt : Infinity;

      if (requestAge < PENDING_GUARD_MS) {
        return res.status(409).json({
          success: false,
          message: 'A remote unlock is already pending for this vault.',
        });
      }
      // remoteOpenStatus = 'active' means the door is out for collection.
      // Only treat it as blocking while it could still be a live session;
      // older than STALE_ACTIVE_MS the completion event was lost and the
      // firmware session is long over - let a fresh command through.
      if (vault.remoteOpenStatus === 'active' && requestAge < STALE_ACTIVE_MS) {
        return res.status(409).json({
          success: false,
          message: 'This vault is already open for collection.',
        });
      }

      const rateLimit = await checkRemoteUnlockRateLimit(uid, vaultId);
      if (!rateLimit.allowed) {
        const minutesRemaining = Math.ceil((rateLimit.resetAt.getTime() - Date.now()) / 60000);
        return res.status(429).json({
          success: false,
          message: `Too many unlock requests. Please wait ${minutesRemaining} minute(s) before trying again.`,
        });
      }

      // Enqueue the command, stamp the vault, and record the rate-limit hit
      // atomically so a partial failure can't leave a command nobody knows
      // about. The keypad picks it up on its next /api/device-poll (<=3s).
      const now = new Date();
      const commandRef = db.collection(`devices/${deviceDoc.id}/commands`).doc();
      const rateLimitRef = db.doc(`users/${uid}/rateLimits/remoteUnlock_${vaultId}`);

      const batch = db.batch();
      batch.set(commandRef, {
        type: 'open_vault',
        vaultId,
        requestedBy: uid,
        createdAt: now,
        expiresAt: new Date(now.getTime() + COMMAND_TTL_MS),
        status: 'pending',
      });
      batch.update(vaultRef, { remoteOpenRequestedAt: now.toISOString() });
      batch.set(rateLimitRef, { timestamps: FieldValue.arrayUnion(now) }, { merge: true });
      await batch.commit();

      // Audit trail - written after the commit so a logging failure can
      // never fail an open that is already queued.
      try {
        await db.collection(`users/${uid}/activityLogs`).add({
          action: 'Remote Unlock Requested',
          details: `Remote unlock requested for vault ${vaultId} (device ${deviceDoc.id})`,
          vaultId: parseInt(vaultId, 10),
          timestamp: new Date(),
        });
      } catch (logError) {
        console.error('vault-unlock activity log failed:', logError.message);
      }

      return res.status(200).json({
        success: true,
        commandId: commandRef.id,
        vaultId,
        expiresAt: new Date(now.getTime() + COMMAND_TTL_MS).toISOString(),
        message: 'Unlock command queued',
      });
    } catch (error) {
      console.error('vault-unlock error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });
}
