// ⚠️ MUST be before all Firebase imports - only set debug token if valid
if (import.meta.env.DEV && import.meta.env.VITE_APPCHECK_DEBUG_TOKEN) {
  self.FIREBASE_APPCHECK_DEBUG_TOKEN = import.meta.env.VITE_APPCHECK_DEBUG_TOKEN;
}

import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";

/*
 * Firebase Configuration Note:
 * The VITE_ prefixed environment variables are intentionally public.
 * These are project identifiers, not secrets - Firebase API keys are designed
 * to be exposed in client-side code. Security is enforced at the database
 * level via Firestore Security Rules and App Check verification, not key secrecy.
 */
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

const app = initializeApp(firebaseConfig);

// Enable App Check only in production or when explicitly enabled
let appCheck = null;
const isProduction = import.meta.env.MODE === 'production';
if (isProduction || import.meta.env.VITE_ENABLE_APPCHECK === 'true') {
  try {
    appCheck = initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(import.meta.env.VITE_RECAPTCHA_SITE_KEY),
      isTokenAutoRefreshEnabled: true,
    });
  } catch (e) {
    console.warn('App Check initialization failed:', e);
  }
}

export const db = getFirestore(app);
export const auth = getAuth(app);
export { appCheck };