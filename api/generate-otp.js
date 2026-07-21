const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const cors = require('cors')({ origin: true });
const fs = require('fs');
const path = require('path');

// Rate limiting constants for OTP generation
const MAX_OTP_GENERATIONS = 3;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

// Load service account key - try multiple sources
function loadServiceAccount() {
  // 1. Check environment variable (for Vercel production)
  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    try {
      return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    } catch (e) {
      console.error('Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY:', e);
    }
  }

  // 2. Check GOOGLE_APPLICATION_CREDENTIALS env
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    try {
      return JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS);
    } catch (e) {
      console.error('Failed to parse GOOGLE_APPLICATION_CREDENTIALS:', e);
    }
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

  return null;
}

// Initialize Firebase Admin (singleton)
let adminDb;
let adminInitialized = false;

function getAdminDb() {
  if (!adminDb) {
    const serviceAccount = loadServiceAccount();

    if (serviceAccount) {
      initializeApp({ credential: cert(serviceAccount) });
    } else {
      // Fallback: Initialize with default credentials
      try {
        initializeApp();
      } catch (e) {
        // App may already be initialized
        console.warn('Firebase initialization:', e.message);
      }
    }
    adminInitialized = true;
    adminDb = getFirestore();
  }
  return adminDb;
}

/**
 * Check OTP generation rate limit per vault
 * @returns {Promise<{allowed: boolean, remaining: number, resetAt: Date|null}>}
 */
async function checkOtpGenerationRateLimit(uid, vaultId) {
  const db = getAdminDb();
  const rateLimitDocRef = db.doc(`users/${uid}/rateLimits/otpGen_${vaultId}`);
  const rateLimitDoc = await rateLimitDocRef.get();

  const now = Date.now();
  const windowStart = new Date(now - RATE_LIMIT_WINDOW_MS);

  if (!rateLimitDoc.exists) {
    return { allowed: true, remaining: MAX_OTP_GENERATIONS, resetAt: null };
  }

  const data = rateLimitDoc.data();
  const generations = data.generations || [];

  // Filter to only generations within the window (using server timestamp)
  const recentGenerations = generations.filter(g => {
    if (!g.timestamp) return false;
    const timestamp = g.timestamp.toDate ? g.timestamp.toDate().getTime() : new Date(g.timestamp).getTime();
    return timestamp > windowStart.getTime();
  });

  if (recentGenerations.length >= MAX_OTP_GENERATIONS) {
    // Find oldest generation to calculate reset time
    const oldestGeneration = recentGenerations[0];
    const oldestTimestamp = oldestGeneration.timestamp.toDate
      ? oldestGeneration.timestamp.toDate().getTime()
      : new Date(oldestGeneration.timestamp).getTime();
    const resetAt = new Date(oldestTimestamp + RATE_LIMIT_WINDOW_MS);
    return { allowed: false, remaining: 0, resetAt };
  }

  return {
    allowed: true,
    remaining: MAX_OTP_GENERATIONS - recentGenerations.length,
    resetAt: new Date(now + RATE_LIMIT_WINDOW_MS)
  };
}

/**
 * Record OTP generation in rate limit collection
 */
async function recordOtpGeneration(uid, vaultId) {
  const db = getAdminDb();
  const rateLimitDocRef = db.doc(`users/${uid}/rateLimits/otpGen_${vaultId}`);
  const rateLimitDoc = await rateLimitDocRef.get();

  const now = Date.now();
  const newGeneration = { timestamp: FieldValue.serverTimestamp() };

  if (!rateLimitDoc.exists) {
    await rateLimitDocRef.set({
      generations: [newGeneration],
      createdAt: FieldValue.serverTimestamp(),
    });
  } else {
    const data = rateLimitDoc.data();
    const generations = data.generations || [];
    const windowStart = new Date(now - RATE_LIMIT_WINDOW_MS);

    // Filter to only generations within the window and add new one
    const recentGenerations = generations.filter(g => {
      if (!g.timestamp) return false;
      const timestamp = g.timestamp.toDate ? g.timestamp.toDate().getTime() : new Date(g.timestamp).getTime();
      return timestamp > windowStart.getTime();
    });
    recentGenerations.push(newGeneration);

    await rateLimitDocRef.update({
      generations: recentGenerations,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
}

module.exports = async function handler(req, res) {
  return cors(req, res, async () => {
    // Only allow POST
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
      const { vaultId, idToken } = req.body;

      if (!vaultId) {
        return res.status(400).json({ error: 'Missing vaultId' });
      }

      if (!idToken) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      // Verify the ID token and get user info
      const { getAuth } = require('firebase-admin/auth');

      // Ensure admin is initialized (this also initializes auth)
      getAdminDb();
      const auth = getAuth();

      let decodedToken;
      try {
        decodedToken = await auth.verifyIdToken(idToken);
      } catch (verifyError) {
        console.error('Token verification failed:', verifyError);
        return res.status(401).json({ error: 'Invalid or expired token' });
      }

      const uid = decodedToken.uid;

      // Check rate limit
      const rateLimit = await checkOtpGenerationRateLimit(uid, vaultId);

      if (!rateLimit.allowed) {
        const minutesRemaining = Math.ceil((rateLimit.resetAt.getTime() - Date.now()) / 60000);
        return res.status(429).json({
          error: 'rate_limit_exceeded',
          message: `Too many OTP generations. Please wait ${minutesRemaining} minute(s) before generating another OTP for this vault.`,
          resetAt: rateLimit.resetAt.toISOString(),
          remaining: 0
        });
      }

      // Record this generation
      await recordOtpGeneration(uid, vaultId);

      // Generate OTP on server side (not returned to client for security)
      // Return success - client will generate the actual OTP locally after server approval
      return res.status(200).json({
        success: true,
        vaultId,
        remaining: rateLimit.remaining,
        message: 'OTP generation approved'
      });

    } catch (error) {
      console.error('generate-otp API error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });
};