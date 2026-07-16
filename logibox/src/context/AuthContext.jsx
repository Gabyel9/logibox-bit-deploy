import { createContext, useContext, useEffect, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  GoogleAuthProvider,
  signInWithPopup,
  sendEmailVerification,
  sendPasswordResetEmail,
} from 'firebase/auth';
import { doc, setDoc, addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import { cleanError, getSafeErrorMessage } from '../utils/cleanError';

const AuthContext = createContext();

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const logActivity = async (uid, action, details) => {
    if (!uid) return;
    try {
      await addDoc(collection(db, 'users', uid, 'activityLogs'), {
        action,
        details,
        vaultId: null,
        timestamp: serverTimestamp(),
      });
    } catch (e) {
      console.error('Log error:', e);
    }
  };

  const signin = async (email, password) => {
    setError(null);
    try {
      const result = await signInWithEmailAndPassword(auth, email, password);
      await logActivity(result.user.uid, 'Login', 'User signed in with email');
    } catch (err) {
      setError(cleanError(err.message));
      throw err;
    }
  };

  const googleSignIn = async () => {
    setError(null);
    try {
      const result = await signInWithPopup(auth, new GoogleAuthProvider());
      const firebaseUser = result.user;
      const isFirstTime =
        firebaseUser.metadata.creationTime === firebaseUser.metadata.lastSignInTime;

      if (isFirstTime) {
        const displayName = firebaseUser.displayName || '';
        const nameParts = displayName.split(' ');
        const firstName = nameParts[0] || 'User';  // Fallback for edge case
        const lastName = nameParts.slice(1).join(' ') || '';

        try {
          // Only include fields with actual values (not empty strings)
          const userData = {
            email: firebaseUser.email,
            provider: 'google',
            createdAt: serverTimestamp(),
            otpDuration: 5,
            otpAutoExpire: true,
          };
          if (firstName) userData.firstName = firstName;
          if (lastName) userData.lastName = lastName;
          if (firebaseUser.photoURL) userData.photoURL = firebaseUser.photoURL;

          await setDoc(doc(db, 'users', firebaseUser.uid), userData, { merge: true });
        } catch (e) {
          console.error('User profile create error:', e);
        }
      } else {
        try {
          await setDoc(doc(db, 'users', firebaseUser.uid), {
            lastLoginAt: serverTimestamp(),
          }, { merge: true });
        } catch (e) {
          console.error('User profile update error:', e);
        }
      }

      await logActivity(firebaseUser.uid, 'Login', 'User signed in with Google');
    } catch (err) {
      setError(cleanError(err.message));
      throw err;
    }
  };

  const signup = async (email, password, firstName, lastName) => {
    setError(null);
    try {
      const result = await createUserWithEmailAndPassword(auth, email, password);
      await sendEmailVerification(result.user);

      // Save user profile - ensure names are trimmed and non-empty
      const userData = {
        email,
        createdAt: serverTimestamp(),
        otpDuration: 5,
        otpAutoExpire: true,
      };
      // Only add names if they have actual content after trimming
      const trimmedFirstName = firstName?.trim();
      const trimmedLastName = lastName?.trim();
      if (trimmedFirstName) userData.firstName = trimmedFirstName;
      if (trimmedLastName) userData.lastName = trimmedLastName;

      await setDoc(doc(db, 'users', result.user.uid), userData);

      await logActivity(result.user.uid, 'Login', 'User created account');
    } catch (err) {
      setError(cleanError(err.message));
      throw err;
    }
  };

  const logout = async () => {
    try {
      const currentUid = auth.currentUser?.uid;
      if (currentUid) {
        await logActivity(currentUid, 'Logout', 'User signed out');
      }
      await signOut(auth);
    } catch (err) {
      setError(cleanError(err.message));
    }
  };

  const resetPassword = async (email) => {
    setError(null);
    try {
      await sendPasswordResetEmail(auth, email);
    } catch (err) {
      setError(cleanError(err.message));
      throw err;
    }
  };

  const value = {
    user,
    loading,
    error,
    signin,
    signup,
    logout,
    googleSignIn,
    resetPassword,
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
}