import { createContext, useContext, useEffect, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  GoogleAuthProvider,
  signInWithPopup,
} from 'firebase/auth';
import { doc, setDoc, addDoc, collection } from 'firebase/firestore';
import { serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../config/firebase';

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
      setError(err.message);
      throw err;
    }
  };

  const googleSignIn = async () => {
    setError(null);
    try {
      const result = await signInWithPopup(auth, new GoogleAuthProvider());
      await logActivity(result.user.uid, 'Login', 'User signed in with Google');
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const signup = async (email, password, firstName, lastName) => {
    setError(null);
    try {
      const result = await createUserWithEmailAndPassword(auth, email, password);
      await setDoc(doc(db, 'users', result.user.uid), {
        firstName,
        lastName,
        email,
        createdAt: new Date(),
      });
      await logActivity(result.user.uid, 'Login', 'User created account');
    } catch (err) {
      setError(err.message);
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
      setError(err.message);
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
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
}