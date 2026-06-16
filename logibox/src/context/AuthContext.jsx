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
        const firstName = nameParts[0] || '';
        const lastName = nameParts.slice(1).join(' ') || '';

        try {
          await setDoc(doc(db, 'users', firebaseUser.uid), {
            email: firebaseUser.email,
            firstName,
            lastName,
            photoURL: firebaseUser.photoURL ?? null,
            provider: 'google',
            createdAt: serverTimestamp(),
            otpDuration: 5,
            otpAutoExpire: true,
          }, { merge: true });
        } catch (e) {
          console.error('User profile create error:', e);
        }
      } else {
        try {
          await setDoc(doc(db, 'users', firebaseUser.uid), {
            email: firebaseUser.email,
            photoURL: firebaseUser.photoURL ?? null,
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
      try {
        await setDoc(doc(db, 'users', result.user.uid), {
          firstName,
          lastName,
          email,
          createdAt: serverTimestamp(),
          otpDuration: 5,
          otpAutoExpire: true,
        });
      } catch (e) {
        console.error('User profile save error:', e);
      }
      try {
        await logActivity(result.user.uid, 'Login', 'User created account');
      } catch (e) {
        console.error('Activity log error:', e);
      }
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