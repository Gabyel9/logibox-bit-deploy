const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const crypto = require('crypto');

// Initialize Firebase Admin
initializeApp();
const db = getFirestore();

// Rate limiting constants
const MAX_OTP_ATTEMPTS = 5;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Rate limiter using Firestore to track OTP failed attempts
 * @returns {Promise<{allowed: boolean, remaining: number, resetAt: Date}>}
 */
async function checkRateLimit(uid, vaultId) {
  const rateLimitDocRef = db.doc(`users/${uid}/rateLimits/otp_${vaultId}`);
  const rateLimitDoc = await rateLimitDocRef.get();

  const now = Date.now();
  const windowStart = new Date(now - RATE_LIMIT_WINDOW_MS);

  if (!rateLimitDoc.exists) {
    // No attempts yet, allow
    return { allowed: true, remaining: MAX_OTP_ATTEMPTS, resetAt: new Date(now + RATE_LIMIT_WINDOW_MS) };
  }

  const data = rateLimitDoc.data();
  const attempts = data.attempts || [];

  // Filter to only attempts within the window
  const recentAttempts = attempts.filter(t => t.timestamp && t.timestamp.toDate && t.timestamp.toDate() > windowStart);

  if (recentAttempts.length >= MAX_OTP_ATTEMPTS) {
    // Find oldest attempt to calculate reset time
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
 * Records a failed OTP attempt for rate limiting
 */
async function recordFailedAttempt(uid, vaultId) {
  const rateLimitDocRef = db.doc(`users/${uid}/rateLimits/otp_${vaultId}`);
  const rateLimitDoc = await rateLimitDocRef.get();

  const now = Date.now();
  const newAttempt = { timestamp: new Date(), type: 'otp_failed' };

  if (!rateLimitDoc.exists) {
    // Create new doc with first attempt
    await rateLimitDocRef.set({
      attempts: [newAttempt],
      createdAt: new Date(),
    });
  } else {
    const data = rateLimitDoc.data();
    const attempts = data.attempts || [];
    const windowStart = new Date(now - RATE_LIMIT_WINDOW_MS);

    // Filter to only attempts within the window and add new one
    const recentAttempts = attempts.filter(t => t.timestamp && t.timestamp.toDate && t.timestamp.toDate() > windowStart);
    recentAttempts.push(newAttempt);

    await rateLimitDocRef.update({
      attempts: recentAttempts,
      updatedAt: new Date(),
    });
  }
}

/**
 * Clears rate limit after successful OTP verification
 */
async function clearRateLimit(uid, vaultId) {
  const rateLimitDocRef = db.doc(`users/${uid}/rateLimits/otp_${vaultId}`);
  await rateLimitDocRef.delete().catch(() => {
    // Ignore if doc doesn't exist
  });
}

exports.verifyOTPAndOpenVault = onCall(async (request) => {
  const { uid, vaultId, enteredOTP } = request.data;

  // STEP 0 — Input validation
  if (!uid || typeof uid !== 'string' || uid.length === 0) {
    throw new HttpsError('invalid-argument', 'User ID is required');
  }

  if (!vaultId || typeof vaultId !== 'string' || vaultId.length === 0) {
    throw new HttpsError('invalid-argument', 'Vault ID is required');
  }

  // Validate vaultId is a valid vault (1, 2, or 3)
  const validVaultIds = ['1', '2', '3'];
  if (!validVaultIds.includes(vaultId)) {
    throw new HttpsError('invalid-argument', 'Invalid vault ID');
  }

  if (!enteredOTP || typeof enteredOTP !== 'string' || enteredOTP.length === 0) {
    throw new HttpsError('invalid-argument', 'OTP is required');
  }

  // Validate enteredOTP is numeric and within expected range (4-6 digits)
  if (!/^\d{4,6}$/.test(enteredOTP)) {
    throw new HttpsError('invalid-argument', 'OTP must be 4-6 digits');
  }

  // STEP 0b — Rate limiting check
  const rateLimit = await checkRateLimit(uid, vaultId);
  if (!rateLimit.allowed) {
    const minutesRemaining = Math.ceil((rateLimit.resetAt.getTime() - Date.now()) / 60000);

    // Log rate limit exceeded event
    await db.collection(`users/${uid}/activityLogs`).add({
      action: 'Rate Limit Exceeded',
      details: `OTP verification rate limit exceeded for vault ${vaultId}. Try again in ${minutesRemaining} minutes.`,
      vaultId: parseInt(vaultId),
      timestamp: new Date(),
    });

    throw new HttpsError('resource-exhausted', `Too many attempts. Please try again in ${minutesRemaining} minutes.`);
  }

  // STEP 1 — Auth check
  if (!request.auth || request.auth.uid !== uid) {
    throw new HttpsError('unauthenticated', 'Not authorized');
  }

  // STEP 2 — Fetch vault doc
  const vaultRef = db.doc(`users/${uid}/vaults/${vaultId}`);
  const vaultDoc = await vaultRef.get();

  if (!vaultDoc.exists) {
    throw new HttpsError('not-found', 'Vault not found');
  }

  const vault = vaultDoc.data();

  if (vault.otpStatus !== 'active') {
    throw new HttpsError('failed-precondition', 'OTP is not active');
  }

  // STEP 3 — Check expiry
  const now = Date.now();
  const expiresAt = new Date(vault.otpExpiresAt).getTime();

  if (now >= expiresAt) {
    await vaultRef.update({ otpStatus: 'expired' });
    throw new HttpsError('deadline-exceeded', 'OTP has expired');
  }

  // STEP 4 — Verify OTP hash
  const hash = crypto.createHash('sha256').update(enteredOTP).digest('hex');

  if (hash !== vault.otpHash) {
    // Record failed attempt for rate limiting
    await recordFailedAttempt(uid, vaultId);

    // Log failed attempt
    await db.collection(`users/${uid}/activityLogs`).add({
      action: 'OTP Verification Failed',
      details: `Invalid OTP entered for vault ${vaultId}`,
      vaultId: parseInt(vaultId),
      timestamp: new Date(),
    });
    throw new HttpsError('permission-denied', 'Invalid OTP');
  }

  // Clear rate limit on successful verification
  await clearRateLimit(uid, vaultId);

  // STEP 5 — Success
  await vaultRef.update({
    otpStatus: 'used',
    otpHash: null,
    otpEncrypted: null,
  });

  // Log successful verification
  await db.collection(`users/${uid}/activityLogs`).add({
    action: 'OTP Verified',
    details: `Vault ${vaultId} opened`,
    vaultId: parseInt(vaultId),
    timestamp: new Date(),
  });

  // TODO: Trigger physical vault open (e.g., call IoT endpoint, MQTT message, etc.)

  return { success: true, vaultId };
});