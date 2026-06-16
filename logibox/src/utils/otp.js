import { getFunctions, httpsCallable } from 'firebase/functions';

export function generateSecureOTP() {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return String(100000 + (array[0] % 900000));
}

export async function hashOTP(otp) {
  const encoder = new TextEncoder();
  const data = encoder.encode(otp);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function verifyOTP(enteredOTP, storedHash) {
  const enteredHash = await hashOTP(enteredOTP);
  return enteredHash === storedHash;
}

export async function verifyOTPWithServer(vaultId, enteredOTP, uid) {
  const functions = getFunctions();
  const verifyFn = httpsCallable(functions, 'verifyOTPAndOpenVault');
  try {
    const result = await verifyFn({ uid, vaultId, enteredOTP });
    return { success: true, data: result.data };
  } catch (err) {
    // Handle rate limiting error
    if (err.code === 'resource-exhausted') {
      return {
        success: false,
        error: err.message,
        code: 'resource-exhausted',
        retryAfter: extractRetryTime(err.message)
      };
    }
    return { success: false, error: err.message, code: err.code };
  }
}

/**
 * Extracts retry time from error message
 * @param {string} message - Error message containing minutes
 * @returns {number|null} - Minutes to wait, or null if not found
 */
function extractRetryTime(message) {
  const match = message.match(/(\d+)\s*minutes?/i);
  return match ? parseInt(match[1], 10) : null;
}