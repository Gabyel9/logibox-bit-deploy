import { createContext, useContext, useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useAuth } from './AuthContext';

const SettingsContext = createContext();

export function useSettings() {
  return useContext(SettingsContext);
}

export function SettingsProvider({ children }) {
  const { user } = useAuth();
  const [settings, setSettings] = useState({
    otpDuration: 5,
    otpAutoExpire: true,
    firstName: '',
    lastName: '',
    email: '',
    vaults: {
      1: { enabled: true },
      2: { enabled: true },
      3: { enabled: true },
    },
  });
  const [settingsLoading, setSettingsLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    const userRef = doc(db, 'users', user.uid);
    const unsubscribe = onSnapshot(userRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setSettings({
          otpDuration: data.otpDuration ?? 5,
          otpAutoExpire: data.otpAutoExpire ?? true,
          firstName: data.firstName ?? '',
          lastName: data.lastName ?? '',
          email: data.email ?? '',
        });
      }
      setSettingsLoading(false);
    });

    return () => unsubscribe();
  }, [user]);

  const value = {
    settings,
    settingsLoading,
  };

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}