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

export async function verifyOTPWithServer(vaultId, enteredOTP) {
  const functions = getFunctions();
  const verifyFn = httpsCallable(functions, 'verifyOTPAndOpenVault');
  try {
    const result = await verifyFn({ vaultId, enteredOTP });
    return { success: true, data: result.data };
  } catch (err) {
    return { success: false, error: err.message, code: err.code };
  }
}