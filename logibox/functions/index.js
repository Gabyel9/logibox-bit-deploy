const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const crypto = require('crypto');

// Initialize Firebase Admin
initializeApp();
const db = getFirestore();

exports.verifyOTPAndOpenVault = onCall(async (request) => {
  const { uid, vaultId, enteredOTP } = request.data;

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
    // Log failed attempt
    await db.collection(`users/${uid}/activityLogs`).add({
      action: 'OTP Verification Failed',
      details: `Invalid OTP entered for vault ${vaultId}`,
      vaultId: parseInt(vaultId),
      timestamp: new Date(),
    });
    throw new HttpsError('permission-denied', 'Invalid OTP');
  }

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