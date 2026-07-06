import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { collection, doc, setDoc, onSnapshot, writeBatch, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../config/firebase';
import { generateSecureOTP, hashOTP } from '../utils/otp';
import { encryptOTP, decryptOTP } from '../utils/crypto';
import { sanitizeUserInput } from '../utils/sanitize';
import { useVaultTimer } from '../hooks/useVaultTimer';
import Navbar from '../components/Navbar';

const getSessionStorageKey = (vaultId) => `otp_vault_${vaultId}`;

const saveToSessionStorage = (vaultId, code, expiresAt) => {
  try {
    sessionStorage.setItem(getSessionStorageKey(vaultId), JSON.stringify({ code, expiresAt }));
  } catch (e) { console.error('sessionStorage save failed', e); }
};

const getFromSessionStorage = (vaultId) => {
  try {
    const item = sessionStorage.getItem(getSessionStorageKey(vaultId));
    return item ? JSON.parse(item) : null;
  } catch (e) { return null; }
};

const clearSessionStorage = (vaultId) => {
  try {
    sessionStorage.removeItem(getSessionStorageKey(vaultId));
  } catch (e) { }
};

// Allowed vault fields per firestore.rules isValidVaultData()
// Used to strip extra fields before setDoc (full document replace)
const ALLOWED_VAULT_FIELDS = [
  'id', 'status', 'enabled',
  'receiverName', 'contactNumber', 'parcelInfo', 'deliveryFee', 'createdAt',
  'otp', 'otpHash', 'otpEncrypted', 'otpStatus', 'otpCreatedAt', 'otpExpiresAt',
  'lastOtpGeneratedAt', 'completedAt'
];

// Clean vault object to only include allowed fields for Firestore security rules
const cleanVaultForFirestore = (vault) => {
  const cleaned = {};
  ALLOWED_VAULT_FIELDS.forEach(field => {
    if (field in vault) {
      let value = vault[field];
      // deliveryFee must be an integer per firestore.rules
      if (field === 'deliveryFee' && value != null) {
        value = Math.floor(Number(value));
      }
      // Ensure id is a number (consistent with vault creation)
      if (field === 'id') {
        value = Number(value);
      }
      cleaned[field] = value;
    }
  });
  return cleaned;
};

function useTick(intervalMs = 1000) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
}

function Dashboard() {
  const { logout, user } = useAuth();
  const { settings } = useSettings();
  const navigate = useNavigate();
  const [isMobile, setIsMobile] = useState(false);
  const [cashLoaded, setCashLoaded] = useState(0);
  const [activeFilter, setActiveFilter] = useState('all');
  const [showSetDeliveryModal, setShowSetDeliveryModal] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showWarningModal, setShowWarningModal] = useState(false);
  const [showOTPModal, setShowOTPModal] = useState(false);
  const [selectedVault, setSelectedVault] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [currentOTP, setCurrentOTP] = useState(null);
  const [otpCooldowns, setOtpCooldowns] = useState({});

  const closeAndClearOTP = useCallback(() => {
    setShowOTPModal(false);
    setCurrentOTP(null);
  }, []);

  const { msRemaining: otpTimeRemaining } = useVaultTimer(
    currentOTP?.expiresAt ?? null,
    () => { closeAndClearOTP(); }
  );

  const OTP_COOLDOWN_MS = 60 * 1000;
  const [deliveryForm, setDeliveryForm] = useState({
    receiverName: '',
    contactNumber: '',
    parcelInfo: '',
    deliveryFee: '',
  });
  const [formErrors, setFormErrors] = useState({});
  const [vaults, setVaults] = useState([]);
  const [vaultsLoading, setVaultsLoading] = useState(true);
  const [vaultOTPs, setVaultOTPs] = useState({});
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [confirmError, setConfirmError] = useState(null);

  useTick();

  const OTP_DURATION_MS = (settings.otpDuration ?? 5) * 60 * 1000;

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    const anyModalOpen = showSetDeliveryModal || showConfirmModal || showWarningModal || showOTPModal;
    if (isMobile && anyModalOpen) {
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.width = '100%';
    } else {
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.width = '';
    }
    return () => {
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.width = '';
    };
  }, [isMobile, showSetDeliveryModal, showConfirmModal, showWarningModal, showOTPModal]);

  const isOtpOnCooldown = useCallback((vaultId) => {
    const last = otpCooldowns[vaultId];
    if (!last) return false;
    return Date.now() - last < OTP_COOLDOWN_MS;
  }, [otpCooldowns]);

  const getCooldownRemaining = useCallback((vaultId) => {
    const last = otpCooldowns[vaultId];
    if (!last) return 0;
    return Math.max(0, OTP_COOLDOWN_MS - (Date.now() - last));
  }, [otpCooldowns]);

  const generateOTP = useCallback(() => generateSecureOTP(), []);

  const checkOTPExpiry = useCallback((vault) => {
    if (!vault.otpExpiresAt || !vault.otpHash) return { isExpired: false, isActive: false };
    const now = Date.now();
    const expiresAt = new Date(vault.otpExpiresAt).getTime();
    if (now >= expiresAt) return { isExpired: true, isActive: false };
    return { isExpired: false, isActive: true };
  }, []);

  const getOTPTimeRemaining = useCallback((vault) => {
    if (!vault.otpExpiresAt) return 0;
    const now = Date.now();
    const expiresAt = new Date(vault.otpExpiresAt).getTime();
    return Math.max(0, expiresAt - now);
  }, []);

  const logActivity = useCallback(async (action, details, vaultId = null) => {
    if (!user) return;
    await addDoc(collection(db, 'users', user.uid, 'activityLogs'), {
      action,
      details,
      vaultId,
      timestamp: serverTimestamp(),
    });
  }, [user]);

  const handleOpenOTPModal = useCallback(async (vault) => {
    if (isOtpOnCooldown(vault.id)) return;

    const otp = generateOTP();
    const otpHash = await hashOTP(otp);
    const otpEncrypted = await encryptOTP(otp, user.uid);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + OTP_DURATION_MS);
    const nowTimestamp = now.toISOString();

    const updatedVault = cleanVaultForFirestore({
      ...vault,
      otp: null,
      otpHash,
      otpEncrypted,
      otpStatus: 'active',
      otpCreatedAt: nowTimestamp,
      otpExpiresAt: expiresAt.toISOString(),
      lastOtpGeneratedAt: nowTimestamp,
    });

    await setDoc(doc(db, 'users', user.uid, 'vaults', vault.id.toString()), updatedVault);
    const cooldownTime = Date.now();
    setOtpCooldowns(prev => ({ ...prev, [vault.id]: cooldownTime }));
    await setDoc(doc(db, 'users', user.uid), { [`lastOtpGeneratedAt_${vault.id}`]: cooldownTime }, { merge: true });
    setVaultOTPs(prev => ({ ...prev, [vault.id]: otp }));
    saveToSessionStorage(vault.id, otp, expiresAt.toISOString());
    await logActivity('OTP Generated', `OTP generated for vault ${vault.id}`, vault.id);

    setCurrentOTP({
      code: otp,
      expiresAt: expiresAt.toISOString(),
      vaultId: vault.id,
    });
    setShowOTPModal(true);
  }, [generateOTP, user, OTP_DURATION_MS, logActivity, isOtpOnCooldown]);

  const handleResetVault = useCallback(async (vaultId) => {
    const emptyVault = {
      id: vaultId,
      status: 'empty',
      receiverName: null,
      contactNumber: null,
      parcelInfo: null,
      deliveryFee: null,
      createdAt: null,
      otp: null,
      otpHash: null,
      otpEncrypted: null,
      otpStatus: null,
      otpCreatedAt: null,
      otpExpiresAt: null,
      completedAt: null,
    };
    await setDoc(doc(db, 'users', user.uid, 'vaults', vaultId.toString()), cleanVaultForFirestore(emptyVault));
    setVaultOTPs(prev => {
      const updated = { ...prev };
      delete updated[vaultId];
      return updated;
    });
    clearSessionStorage(vaultId);
    await logActivity('Vault Reset', `Vault ${vaultId} was reset to empty`, vaultId);
  }, [user, logActivity]);

  useEffect(() => {
    if (!user) return;
    const activeVaults = vaults.filter(v => v.otpStatus === 'active' && v.otpExpiresAt);
    activeVaults.forEach(v => {
      const now = Date.now();
      const expiresAt = new Date(v.otpExpiresAt).getTime();
      if (now >= expiresAt) {
        setVaultOTPs(prev => {
          const updated = { ...prev };
          delete updated[v.id];
          return updated;
        });
        clearSessionStorage(v.id);
        setDoc(doc(db, 'users', user.uid, 'vaults', v.id.toString()), { otpStatus: 'expired' }, { merge: true });
        logActivity('OTP Expired', `OTP expired for Vault ${v.id}`, v.id);
      }
    });
  }, [user, vaults, logActivity]);

  useEffect(() => {
    if (!user || vaults.length === 0) return;

    const interval = setInterval(() => {
      const now = Date.now();
      vaults.forEach(v => {
        if (v.otpStatus === 'active' && v.otpExpiresAt) {
          const expiresAt = new Date(v.otpExpiresAt).getTime();
          if (now >= expiresAt) {
            setVaultOTPs(prev => {
              const updated = { ...prev };
              delete updated[v.id];
              return updated;
            });
            clearSessionStorage(v.id);
            setDoc(
              doc(db, 'users', user.uid, 'vaults', v.id.toString()),
              { otpStatus: 'expired' },
              { merge: true }
            );
            logActivity('OTP Expired', `OTP expired for Vault ${v.id}`, v.id);
          }
        }
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [user, vaults, logActivity]);

  useEffect(() => {
    if (!user || vaults.length === 0) return;
    const activeVaults = vaults.filter(v => v.otpStatus === 'active' && v.otpExpiresAt);
    if (activeVaults.length === 0) return;

    const now = Date.now();
    const toDecrypt = [];

    activeVaults.forEach(v => {
      const expiresAt = new Date(v.otpExpiresAt).getTime();
      if (now >= expiresAt) return;

      const sessionData = getFromSessionStorage(v.id);
      if (sessionData && sessionData.code) {
        const sessionExpires = new Date(sessionData.expiresAt).getTime();
        if (sessionExpires > now) {
          setVaultOTPs(prev => ({ ...prev, [v.id]: sessionData.code }));
        } else {
          clearSessionStorage(v.id);
          if (v.otpEncrypted) toDecrypt.push(v);
        }
      } else if (v.otpEncrypted) {
        toDecrypt.push(v);
      }
    });

    if (toDecrypt.length > 0) {
      Promise.all(toDecrypt.map(async (v) => {
        try {
          const decrypted = await decryptOTP(v.otpEncrypted, user.uid);
          setVaultOTPs(prev => ({ ...prev, [v.id]: decrypted }));
        } catch (e) {
          console.error('Decrypt failed for vault', v.id, e);
        }
      }));
    }
  }, [user, vaults]);

  useEffect(() => {
    const total = vaults
      .filter(v => ['assigned', 'otp_active', 'otp_expired', 'occupied'].includes(v.status))
      .reduce((sum, v) => sum + (parseFloat(v.deliveryFee) || 0), 0);
    setCashLoaded(total);
  }, [vaults]);

  useEffect(() => {
    if (!user) return;
    const vaultsRef = collection(db, 'users', user.uid, 'vaults');
    const unsubscribe = onSnapshot(vaultsRef, (snapshot) => {
      if (snapshot.empty) {
        const batch = writeBatch(db);
        for (let i = 1; i <= 3; i++) {
          const vaultDoc = doc(vaultsRef, i.toString());
          batch.set(vaultDoc, { id: i, status: 'empty', enabled: true });
        }
        batch.commit().then(() => setVaultsLoading(false));
      } else {
        const vaultData = snapshot.docs.map(d => d.data());
        const sortedVaults = vaultData.sort((a, b) => a.id - b.id);
        setVaults(sortedVaults);
        setVaultsLoading(false);
      }
    });
    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const userRef = doc(db, 'users', user.uid);
    const unsubscribe = onSnapshot(userRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        const cooldowns = {};
        for (let i = 1; i <= 3; i++) {
          const cooldownKey = `lastOtpGeneratedAt_${i}`;
          if (data[cooldownKey]) {
            cooldowns[i] = data[cooldownKey];
          }
        }
        if (Object.keys(cooldowns).length > 0) {
          setOtpCooldowns(prev => ({ ...prev, ...cooldowns }));
        }
      }
    });
    return () => unsubscribe();
  }, [user]);

  const handleLogout = () => { logout(); navigate('/signin'); };

  const openSetDeliveryModal = (vault) => {
    setSelectedVault(vault);
    setDeliveryForm({ receiverName: '', contactNumber: '', parcelInfo: '', deliveryFee: '' });
    setFormErrors({});
    setShowSetDeliveryModal(true);
  };

  const handleSaveDelivery = async () => {
    const errors = {};

    if (!deliveryForm.receiverName || !deliveryForm.receiverName.trim()) {
      errors.receiverName = 'Receiver name is required';
    }

    if (!deliveryForm.contactNumber) {
      errors.contactNumber = 'Contact number is required';
    } else if (!/^\d+$/.test(deliveryForm.contactNumber)) {
      errors.contactNumber = 'Numbers only';
    } else if (deliveryForm.contactNumber.length !== 11) {
      errors.contactNumber = 'Must be exactly 11 digits';
    } else if (!deliveryForm.contactNumber.startsWith('09')) {
      errors.contactNumber = 'Must start with 09';
    }

    if (!deliveryForm.parcelInfo || !deliveryForm.parcelInfo.trim()) {
      errors.parcelInfo = 'Parcel info is required';
    }

    if (!deliveryForm.deliveryFee) {
      errors.deliveryFee = 'Delivery fee is required';
    } else if (!/^\d+$/.test(deliveryForm.deliveryFee)) {
      errors.deliveryFee = 'Numbers only';
    } else if (parseFloat(deliveryForm.deliveryFee) <= 0) {
      errors.deliveryFee = 'Must be greater than 0';
    }

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return false;
    }

    return true;
  };

  const handleContinueToConfirm = async () => {
    const isValid = await handleSaveDelivery();
    if (isValid) {
      setShowSetDeliveryModal(false);
      setShowConfirmModal(true);
    }
  };

  const handleAssignParcel = async () => {
    const updatedVault = cleanVaultForFirestore({
      ...selectedVault,
      status: 'assigned',
      receiverName: deliveryForm.receiverName.trim(),
      contactNumber: deliveryForm.contactNumber,
      parcelInfo: deliveryForm.parcelInfo.trim(),
      deliveryFee: parseFloat(deliveryForm.deliveryFee),
      createdAt: new Date().toISOString(),
    });

    await setDoc(doc(db, 'users', user.uid, 'vaults', selectedVault.id.toString()), updatedVault);
    await logActivity('Vault Assigned', `Delivery assigned to ${deliveryForm.receiverName} for vault ${selectedVault.id}`, selectedVault.id);
    setFormErrors({});
    setShowConfirmModal(false);
    setDeliveryForm({ receiverName: '', contactNumber: '', parcelInfo: '', deliveryFee: '' });
  };

  const handleModalReset = () => {
    setDeliveryForm({ receiverName: '', contactNumber: '', parcelInfo: '', deliveryFee: '' });
    setFormErrors({});
  };

  const openConfirmWarningModal = (vault) => {
    setSelectedVault(vault);
    setShowWarningModal(true);
  };

  const handleConfirmWithWarning = async () => {
    setShowWarningModal(false);
    setConfirmLoading(true);
    setConfirmError(null);

    const updatedVault = cleanVaultForFirestore({
      ...selectedVault,
      status: 'completed',
      completedAt: new Date().toISOString(),
    });

    try {
      await setDoc(
        doc(db, 'users', user.uid, 'vaults', selectedVault.id.toString()),
        updatedVault
      );

      await logActivity(
        'Delivery Confirmed',
        `Delivery confirmed for vault ${selectedVault.id}`,
        selectedVault.id
      );

      setTimeout(() => handleResetVault(selectedVault.id), 1500);
    } catch (error) {
      console.error('Confirm delivery failed:', error);
      setConfirmError('Failed to confirm delivery. Please try again.');
    } finally {
      setConfirmLoading(false);
    }
  };

  const handleCopyOTP = () => {
    if (!currentOTP || otpTimeRemaining <= 0) return;
    navigator.clipboard.writeText(currentOTP.code);
    setCopiedId(currentOTP.vaultId);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const closeOTPModal = () => {
    closeAndClearOTP();
  };

  const filteredVaults = vaults.filter(v => {
    const isEnabled = v.enabled !== false;
    if (!isEnabled) return false;
    if (activeFilter === 'all') return true;
    if (activeFilter === 'empty') return v.status === 'empty';
    if (activeFilter === 'assigned') return v.status === 'assigned';
    if (activeFilter === 'occupied') return v.status === 'occupied';
    return v.status === activeFilter;
  });

  const enabledVaults = vaults.filter(v => v.enabled !== false);
  const assignedCount = enabledVaults.filter(v => v.status === 'assigned').length;
  const occupiedCount = enabledVaults.filter(v => v.status === 'occupied').length;
  const activeOTPCount = enabledVaults.filter(v => {
    if (v.otpStatus !== 'active') return false;
    if (!v.otpExpiresAt) return false;
    return new Date(v.otpExpiresAt).getTime() > Date.now();
  }).length;

  const formatTime = (ms) => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  };

  const progressPercent = otpTimeRemaining > 0 ? (otpTimeRemaining / OTP_DURATION_MS) * 100 : 0;

  const r = {
    statsGrid: {
      display: 'grid',
      gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)',
      gap: isMobile ? '0.75rem' : '1.25rem',
      marginBottom: '2rem',
    },
    vaultGrid: {
      display: 'grid',
      gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(300px, 1fr))',
      gap: isMobile ? '1rem' : '1.5rem',
    },
    modalFooter: {
      display: 'flex',
      flexDirection: isMobile ? 'column' : 'row',
      gap: '0.75rem',
      padding: isMobile ? '1rem' : '1.25rem 1.5rem',
      borderTop: '1px solid #e5e7eb',
      justifyContent: 'flex-end',
      flexShrink: 0,
    },
    vaultActions: {
      marginTop: '1rem',
      display: 'flex',
      flexDirection: isMobile ? 'column' : 'row',
      gap: '0.5rem',
    },
  };

  const mobileModalShell = {
    position: 'fixed',
    inset: 0,
    zIndex: 300,
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: '#fff',
    overflowY: 'auto',
    WebkitOverflowScrolling: 'touch',
  };

  const desktopOverlay = {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(0,0,0,0.45)',
    backdropFilter: 'blur(3px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 300,
    padding: '1rem',
  };

  return (
    <div style={styles.layout}>
      <Navbar currentPath="/dashboard" onNavigate={navigate} onLogout={handleLogout} />

      {/* MAIN CONTENT */}
      <main className="page-enter" style={styles.main}>
        <div style={{ ...styles.content, padding: isMobile ? '1rem' : '2rem' }}>
          <h1 style={{
            ...styles.pageTitle,
            fontSize: isMobile ? '1.5rem' : '1.75rem',
            marginBottom: '0.4rem',
          }}>
            Dashboard
          </h1>
          <p style={styles.pageSubtitle}>Manage your delivery vaults and track activity</p>

          {/* Stats Grid */}
          <div style={r.statsGrid}>
            {[
              { label: 'Assigned Vaults', value: assignedCount, icon: 'M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z', iconColor: '#8B0000', iconBg: 'rgba(139,0,0,0.08)' },
              { label: 'Occupied Vaults', value: occupiedCount, icon: 'M20 4H4c-1.11 0-2 .89-2 2v12c0 1.1.89 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.89-2-2-2zm0 14H4V6h16v12z', iconColor: '#d97706', iconBg: 'rgba(217,119,6,0.08)' },
              { label: 'Cash Loaded', value: `₱${cashLoaded.toFixed(2)}`, icon: 'M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z', iconColor: '#16a34a', iconBg: 'rgba(22,163,74,0.08)', valueStyle: { color: '#16a34a' } },
              { label: 'Active OTPs', value: activeOTPCount, icon: 'M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6h2c0-1.66-1.34-3-3-3S3 4.34 3 6v2H1v14h22V8h-5zm-6-2c1.1 0 2 .9 2 2s-.9 2-2 2-2-.9-2-2 .9-2 2-2zm6 16H6V10h12v12zm-6-8c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z', iconColor: '#7c3aed', iconBg: 'rgba(124,58,237,0.08)' },
            ].map((stat, i) => (
              <div
                key={i}
                className="card-enter stat-card-animate"
                style={{
                  ...styles.statCard,
                  padding: isMobile ? '0.95rem' : '1.25rem',
                }}
              >
                <div style={{ ...styles.statIconWrap, backgroundColor: stat.iconBg }}>
                  <svg width={isMobile ? 18 : 20} height={isMobile ? 18 : 20} viewBox="0 0 24 24" fill={stat.iconColor}>
                    <path d={stat.icon}/>
                  </svg>
                </div>
                <div style={styles.statInfo}>
                  <div style={{ ...styles.statValue, fontSize: isMobile ? '1.375rem' : '1.75rem', ...stat.valueStyle }}>
                    {stat.value}
                  </div>
                  <div style={styles.statLabel}>{stat.label}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Reminder Banner */}
          <div style={{
            display: 'flex',
            gap: '0.75rem',
            alignItems: 'flex-start',
            backgroundColor: '#fffbeb',
            border: '1px solid #fde68a',
            borderRadius: '10px',
            padding: '0.875rem 1rem',
            marginBottom: '1.5rem',
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            <p style={{ fontSize: '0.8125rem', color: '#92400e', lineHeight: 1.6, margin: 0 }}>
              Please make sure you have <span style={{ color: '#8B0000', fontWeight: 700 }}>deposited the payment</span> and <span style={{ color: '#8B0000', fontWeight: 700 }}>send the proof</span> to the delivery riders!
            </p>
          </div>

          {/* Vault Section */}
          <div style={styles.vaultSection}>
            <div style={styles.vaultSectionHeader}>
              <h2 style={styles.sectionTitle}>Vaults</h2>
              <div style={{ display: 'flex', gap: '0.5rem', overflowX: 'auto', flexWrap: 'nowrap' }}>
                {['all', 'empty', 'assigned', 'occupied'].map(filter => (
                  <button
                    key={filter}
                    className="filter-btn-animate"
                    style={{
                      ...styles.filterBtn,
                      ...(activeFilter === filter ? styles.filterBtnActive : {}),
                      whiteSpace: 'nowrap',
                      minHeight: 44,
                    }}
                    onClick={() => setActiveFilter(filter)}
                  >
                    {filter.charAt(0).toUpperCase() + filter.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {vaultsLoading ? (
              <div style={{ padding: '3rem', textAlign: 'center', color: '#9ca3af' }}>
                Loading vaults...
              </div>
            ) : (
              <div style={r.vaultGrid}>
                {filteredVaults.map(vault => {
                  const { isExpired, isActive } = checkOTPExpiry(vault);
                  const timeRemaining = getOTPTimeRemaining(vault);

                  return (
                    <div key={vault.id} className="vault-card-enter vault-card-animate" style={styles.vaultCard}>
                      <div style={styles.vaultHeader}>
                        <div style={styles.vaultNumberWrap}>
                          <span style={styles.vaultDot} />
                          <span style={styles.vaultNumber}>Vault {vault.id}</span>
                        </div>
                        <span style={{
                          ...styles.vaultBadge,
                          backgroundColor: vault.status === 'empty' ? '#e5e7eb' : vault.status === 'completed' ? '#d1fae5' : vault.status === 'assigned' ? '#fee2e2' : vault.status === 'occupied' ? '#ede9fe' : '#e5e7eb',
                          color: vault.status === 'empty' ? '#6b7280' : vault.status === 'completed' ? '#059669' : vault.status === 'assigned' ? '#8B0000' : vault.status === 'occupied' ? '#7c3aed' : '#6b7280',
                        }}>
                          {vault.status === 'empty' ? 'Empty' : vault.status === 'completed' ? 'Completed' : vault.status === 'assigned' ? 'Assigned' : vault.status === 'occupied' ? 'Occupied' : 'Unknown'}
                        </span>
                      </div>

                      {vault.status === 'empty' && (
                        <div style={styles.vaultContent}>
                          <div style={styles.emptyState}>
                            <div style={styles.emptyIconWrap}>
                              <svg width={22} height={22} viewBox="0 0 24 24" fill="#9ca3af">
                                <path d="M20 4H4c-1.11 0-2 .89-2 2v12c0 1.1.89 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.89-2-2-2zm0 14H4V6h16v12zM6 10h2v2H6zm0 4h8v2H6z"/>
                              </svg>
                            </div>
                            <p style={styles.emptyText}>No delivery assigned</p>
                            <p style={styles.emptySubtitle}>This vault is ready to accept a delivery</p>
                          </div>
                          <button
                            className="btn-animate"
                            style={{ ...styles.setDeliveryBtn, minHeight: 44 }}
                            onClick={() => openSetDeliveryModal(vault)}
                          >
                            Set Delivery
                          </button>
                        </div>
                      )}

                      {(vault.status === 'assigned' || vault.status === 'occupied') && (
                        <div style={styles.vaultContent}>
                          <div style={styles.vaultDetails}>
                            <div style={styles.detailGrid}>
                              {[
                                { label: 'Delivery Rider', value: sanitizeUserInput(vault.receiverName) },
                                { label: 'Contact', value: sanitizeUserInput(vault.contactNumber) },
                                { label: 'Parcel', value: sanitizeUserInput(vault.parcelInfo) },
                                { label: 'Fee', value: `₱${vault.deliveryFee}` },
                              ].map((item, i) => (
                                <div key={i} style={styles.detailItem}>
                                  <div style={styles.detailItemLabel}>{item.label}</div>
                                  <div style={styles.detailItemValue}>{item.value}</div>
                                </div>
                              ))}
                            </div>

                            {!vault.otpHash && vault.status !== 'occupied' && (
                              <button
                                className="btn-animate"
                                style={{
                                  ...styles.generateOtpBtn,
                                  minHeight: 44,
                                  opacity: isOtpOnCooldown(vault.id) ? 0.5 : 1,
                                  cursor: isOtpOnCooldown(vault.id) ? 'not-allowed' : 'pointer',
                                }}
                                disabled={isOtpOnCooldown(vault.id)}
                                onClick={() => handleOpenOTPModal(vault)}
                              >
                                {isOtpOnCooldown(vault.id)
                                  ? `Wait ${Math.ceil(getCooldownRemaining(vault.id) / 1000)}s`
                                  : 'Generate OTP'}
                              </button>
                            )}

                            {vault.otpHash && isActive && currentOTP && (
                              <>
                                <div style={{ ...styles.otpWrap, cursor: 'pointer' }} onClick={() => setShowOTPModal(true)}>
                                  <div>
                                    <div style={styles.otpLabel}>OTP</div>
                                    <div className="otp-active-pulse" style={{ ...styles.otpValue, fontSize: isMobile ? '1.25rem' : '1.5rem' }}>
                                      {currentOTP.code}
                                    </div>
                                  </div>
                                  <div style={styles.otpTimer}>
                                    <div style={styles.timerLabel}>Expires in</div>
                                    <div style={styles.timerValue}>{formatTime(timeRemaining)}</div>
                                  </div>
                                </div>
                                <button
                                  className="btn-animate"
                                  style={{ ...(copiedId === vault.id ? styles.copiedBtn : styles.copyOtpBtn), minHeight: 44 }}
                                  onClick={() => {
                                    navigator.clipboard.writeText(currentOTP.code);
                                    setCopiedId(vault.id);
                                    setTimeout(() => setCopiedId(null), 2000);
                                  }}
                                >
                                  {copiedId === vault.id ? 'Copied!' : 'Copy OTP'}
                                </button>
                              </>
                            )}

                            {vault.otpHash && isActive && !currentOTP && (
                              <>
                                <div
                                  style={{ ...styles.otpWrap, cursor: 'pointer' }}
                                  onClick={() => {
                                    if (!vaultOTPs[vault.id]) return;
                                    setCurrentOTP({
                                      code: vaultOTPs[vault.id],
                                      expiresAt: vault.otpExpiresAt,
                                      vaultId: vault.id,
                                    });
                                    setShowOTPModal(true);
                                  }}
                                >
                                  <div>
                                    <div style={styles.otpLabel}>OTP</div>
                                    <div className="otp-active-pulse" style={{
                                      ...styles.otpValue,
                                      fontSize: isMobile ? '1.25rem' : '1.5rem'
                                    }}>
                                      {vaultOTPs[vault.id] ?? '••••••'}
                                    </div>
                                  </div>
                                  <div style={styles.otpTimer}>
                                    <div style={styles.timerLabel}>Expires in</div>
                                    <div style={styles.timerValue}>{formatTime(timeRemaining)}</div>
                                  </div>
                                </div>
                                <button
                                  className="btn-animate"
                                  style={{ ...styles.regenerateOtpBtn, minHeight: 44 }}
                                  onClick={() => handleOpenOTPModal(vault)}
                                >
                                  Regenerate OTP
                                </button>
                              </>
                            )}

                            {vault.otpHash && isExpired && (
                              <>
                                <div style={styles.expiredBox}>
                                  <span style={styles.expiredText}>OTP EXPIRED</span>
                                </div>
                                <button
                                  className="btn-animate"
                                  style={{ ...styles.regenerateOtpBtn, minHeight: 44 }}
                                  onClick={() => handleOpenOTPModal(vault)}
                                >
                                  Regenerate OTP
                                </button>
                              </>
                            )}

                            {vault.status === 'occupied' && (
                              <div style={{
                                backgroundColor: '#ede9fe',
                                borderRadius: 10,
                                padding: '0.875rem',
                                textAlign: 'center',
                                color: '#7c3aed',
                                fontWeight: 700,
                                fontSize: '0.875rem',
                              }}>
                                Parcel inside — waiting for recipient to collect
                              </div>
                            )}
                          </div>

                          <div style={r.vaultActions}>
                            {vault.otpStatus !== 'active' && vault.status !== 'occupied' && (
                              <button
                                className="btn-animate"
                                style={{ ...styles.resetVaultBtn, minHeight: 44, width: isMobile ? '100%' : 'auto' }}
                                onClick={() => handleResetVault(vault.id)}
                              >
                                Reset
                              </button>
                            )}
                            <button
                              className="btn-animate"
                              style={{ ...styles.confirmBtn, minHeight: 44 }}
                              onClick={() => openConfirmWarningModal(vault)}
                            >
                              Confirm Delivery
                            </button>
                          </div>

                          {vault.createdAt && (
                            <div style={styles.timestamp}>
                              {new Date(vault.createdAt).toLocaleString()}
                            </div>
                          )}
                        </div>
                      )}

                      {vault.status === 'completed' && (
                        <div style={styles.vaultContent}>
                          <div style={styles.completedState}>
                            <svg width={isMobile ? 40 : 48} height={isMobile ? 40 : 48} viewBox="0 0 24 24" fill="#059669">
                              <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                            </svg>
                            <p style={styles.completedText}>Delivery completed</p>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* SET DELIVERY MODAL */}
      {showSetDeliveryModal && (
        isMobile ? (
          <div className="mobile-sheet-enter" style={mobileModalShell}>
            <div style={styles.modalHeader}>
              <h3 style={styles.modalTitle}>Set Delivery — Vault {selectedVault?.id}</h3>
              <button className="btn-animate" style={styles.closeBtn} onClick={() => { setFormErrors({}); setShowSetDeliveryModal(false); }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                </svg>
              </button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '1rem', WebkitOverflowScrolling: 'touch' }}>
              {[
                { label: 'Receiver Name', key: 'receiverName', placeholder: 'Enter receiver name' },
                { label: 'Contact Number', key: 'contactNumber', placeholder: 'Enter contact number', numeric: true },
                { label: 'Parcel Info', key: 'parcelInfo', placeholder: 'Enter parcel description' },
                { label: 'Delivery Fee (₱)', key: 'deliveryFee', placeholder: '0.00', numeric: true },
              ].map((field, i) => (
                <div key={i} style={styles.formGroup}>
                  <label style={styles.formLabel}>{field.label}</label>
                  <input
                    id={field.key}
                    name={field.key}
                    className="input-animate"
                    type="text"
                    style={{ ...styles.formInput, ...(formErrors[field.key] ? { border: '1.5px solid #dc2626' } : {}) }}
                    value={deliveryForm[field.key]}
                    onChange={e => setDeliveryForm(prev => ({ ...prev, [field.key]: e.target.value }))}
                    onKeyDown={field.numeric ? (e) => { if (!/[\d\b]/.test(e.key) && e.key !== 'Backspace' && e.key !== 'Delete' && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Tab') { e.preventDefault(); } } : undefined}
                    placeholder={field.placeholder}
                  />
                  {formErrors[field.key] && (
                    <div style={styles.formError}>{formErrors[field.key]}</div>
                  )}
                </div>
              ))}
              <div style={{
                backgroundColor: '#fffbeb',
                border: '1px solid #fde68a',
                borderRadius: '10px',
                padding: '0.875rem',
                display: 'flex',
                gap: '0.625rem',
                alignItems: 'flex-start',
                marginTop: '0.5rem',
              }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/>
                  <line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
                <span style={{ fontSize: '0.8125rem', color: '#92400e', lineHeight: 1.5 }}>
                  Please don't forget to <span style={{ color: '#8B0000', fontWeight: 700 }}>deposit the payment</span> in the cash pod compartment of the selected vault.
                </span>
              </div>
            </div>
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem',
              padding: '1rem',
              borderTop: '1px solid #e5e7eb',
              backgroundColor: '#fff',
              flexShrink: 0,
            }}>
              <button className="btn-animate" style={{ ...styles.saveBtn, minHeight: 48, fontSize: '1rem' }} onClick={handleContinueToConfirm}>
                Continue
              </button>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button className="btn-animate" style={{ ...styles.resetBtn, minHeight: 44, flex: 1 }} onClick={handleModalReset}>
                  Reset
                </button>
                <button className="btn-animate" style={{ ...styles.cancelBtn, minHeight: 44, flex: 1 }} onClick={() => { setFormErrors({}); setShowSetDeliveryModal(false); }}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="modal-overlay-enter" style={desktopOverlay}>
            <div className="modal-content-enter" style={{ ...styles.modal, maxWidth: 450 }}>
              <div style={styles.modalHeader}>
                <h3 style={styles.modalTitle}>Set Delivery - Vault {selectedVault?.id}</h3>
                <button className="btn-animate" style={styles.closeBtn} onClick={() => { setFormErrors({}); setShowSetDeliveryModal(false); }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                  </svg>
                </button>
              </div>
              <div style={{ ...styles.modalBody, maxHeight: '60vh', overflowY: 'auto' }}>
                {[
                  { label: 'Receiver Name', key: 'receiverName', placeholder: 'Enter receiver name' },
                  { label: 'Contact Number', key: 'contactNumber', placeholder: 'Enter contact number', numeric: true },
                  { label: 'Parcel Info', key: 'parcelInfo', placeholder: 'Enter parcel description' },
                  { label: 'Delivery Fee (₱)', key: 'deliveryFee', placeholder: '0.00', numeric: true },
                ].map((field, i) => (
                  <div key={i} style={styles.formGroup}>
                    <label style={styles.formLabel}>{field.label}</label>
                    <input
                      id={field.key}
                      name={field.key}
                      className="input-animate"
                      type="text"
                      style={{ ...styles.formInput, ...(formErrors[field.key] ? { border: '1.5px solid #dc2626' } : {}) }}
                      value={deliveryForm[field.key]}
                      onChange={e => setDeliveryForm(prev => ({ ...prev, [field.key]: e.target.value }))}
                      onKeyDown={field.numeric ? (e) => { if (!/[\d\b]/.test(e.key) && e.key !== 'Backspace' && e.key !== 'Delete' && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Tab') { e.preventDefault(); } } : undefined}
                      placeholder={field.placeholder}
                    />
                    {formErrors[field.key] && (
                      <div style={styles.formError}>{formErrors[field.key]}</div>
                    )}
                  </div>
                ))}
                <div style={{
                  backgroundColor: '#fffbeb',
                  border: '1px solid #fde68a',
                  borderRadius: '10px',
                  padding: '0.875rem',
                  display: 'flex',
                  gap: '0.625rem',
                  alignItems: 'flex-start',
                  marginTop: '0.5rem',
                }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                    <line x1="12" y1="9" x2="12" y2="13"/>
                    <line x1="12" y1="17" x2="12.01" y2="17"/>
                  </svg>
                  <span style={{ fontSize: '0.8125rem', color: '#92400e', lineHeight: 1.5 }}>
                    Please don't forget to <span style={{ color: '#8B0000', fontWeight: 700 }}>deposit the payment</span> in the cash pod compartment of the selected vault.
                  </span>
                </div>
              </div>
              <div style={r.modalFooter}>
                <button className="btn-animate" style={{ ...styles.cancelBtn, minHeight: 44 }} onClick={() => { setFormErrors({}); setShowSetDeliveryModal(false); }}>
                  Cancel
                </button>
                <button className="btn-animate" style={{ ...styles.resetBtn, minHeight: 44 }} onClick={handleModalReset}>
                  Reset
                </button>
                <button className="btn-animate" style={{ ...styles.saveBtn, minHeight: 44 }} onClick={handleContinueToConfirm}>
                  Continue
                </button>
              </div>
            </div>
          </div>
        )
      )}

      {/* CONFIRM PARCEL ASSIGNMENT MODAL */}
      {showConfirmModal && (
        isMobile ? (
          <div className="mobile-sheet-enter" style={mobileModalShell}>
            <div style={styles.modalHeader}>
              <h3 style={styles.modalTitle}>Confirm Parcel Assignment</h3>
              <button className="btn-animate" style={styles.closeBtn} onClick={() => { setShowConfirmModal(false); setShowSetDeliveryModal(true); }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                </svg>
              </button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '1rem', WebkitOverflowScrolling: 'touch' }}>
              <div style={{
                backgroundColor: '#f9fafb',
                border: '1px solid #f0f1f3',
                borderRadius: '10px',
                padding: '1rem',
                marginBottom: '1rem',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <span style={{ fontSize: '0.75rem', color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Selected Vault</span>
                  <span style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0f172a' }}>Vault {selectedVault?.id}</span>
                </div>
                <div style={{ borderTop: '1px solid #f0f1f3', margin: '0.5rem 0' }} />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                  <div>
                    <div style={{ fontSize: '0.75rem', color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Delivery Rider</div>
                    <div style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0f172a' }}>{deliveryForm.receiverName}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.75rem', color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Contact</div>
                    <div style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0f172a' }}>{deliveryForm.contactNumber}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.75rem', color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Parcel Info</div>
                    <div style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0f172a' }}>{deliveryForm.parcelInfo}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.75rem', color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Delivery Fee</div>
                    <div style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0f172a' }}>₱{deliveryForm.deliveryFee}</div>
                  </div>
                </div>
              </div>
              <div style={{
                backgroundColor: '#f0fdf4',
                border: '1px solid #bbf7d0',
                borderRadius: '10px',
                padding: '0.875rem',
                display: 'flex',
                gap: '0.625rem',
                alignItems: 'flex-start',
                marginBottom: '0.75rem',
              }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="#16a34a">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                </svg>
                <span style={{ fontSize: '0.8125rem', color: '#166534', lineHeight: 1.5 }}>
                  Vault will be set to <span style={{ color: '#8B0000', fontWeight: 700 }}>Assigned</span> after assignment. <span style={{ color: '#8B0000', fontWeight: 700 }}>OTP</span> can then be generated for the delivery rider.
                </span>
              </div>
              <div style={{
                backgroundColor: '#fffbeb',
                border: '1px solid #fde68a',
                borderRadius: '10px',
                padding: '0.875rem',
                display: 'flex',
                gap: '0.625rem',
                alignItems: 'flex-start',
              }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/>
                  <line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
                <span style={{ fontSize: '0.8125rem', color: '#92400e', lineHeight: 1.5 }}>
                  Please don't forget to <span style={{ color: '#8B0000', fontWeight: 700 }}>take a photo of the cash</span> placed inside the cash pod and <span style={{ color: '#8B0000', fontWeight: 700 }}>send the proof</span> to the designated delivery rider.
                </span>
              </div>
            </div>
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem',
              padding: '1rem',
              borderTop: '1px solid #e5e7eb',
              backgroundColor: '#fff',
              flexShrink: 0,
            }}>
              <button className="btn-animate" style={{ ...styles.saveBtn, minHeight: 48, fontSize: '1rem' }} onClick={handleAssignParcel}>
                Assign Parcel
              </button>
              <button className="btn-animate" style={{ ...styles.cancelBtn, minHeight: 44, width: '100%' }} onClick={() => { setShowConfirmModal(false); setShowSetDeliveryModal(true); }}>
                Back
              </button>
            </div>
          </div>
        ) : (
          <div className="modal-overlay-enter" style={desktopOverlay}>
            <div className="modal-content-enter" style={{ ...styles.modal, maxWidth: 450 }}>
              <div style={styles.modalHeader}>
                <h3 style={styles.modalTitle}>Confirm Parcel Assignment</h3>
                <button className="btn-animate" style={styles.closeBtn} onClick={() => { setShowConfirmModal(false); setShowSetDeliveryModal(true); }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                  </svg>
                </button>
              </div>
              <div style={{ ...styles.modalBody, maxHeight: '60vh', overflowY: 'auto' }}>
                <div style={{
                  backgroundColor: '#f9fafb',
                  border: '1px solid #f0f1f3',
                  borderRadius: '10px',
                  padding: '1rem',
                  marginBottom: '1rem',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <span style={{ fontSize: '0.75rem', color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Selected Vault</span>
                    <span style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0f172a' }}>Vault {selectedVault?.id}</span>
                  </div>
                  <div style={{ borderTop: '1px solid #f0f1f3', margin: '0.5rem 0' }} />
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                    <div>
                      <div style={{ fontSize: '0.75rem', color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Delivery Rider</div>
                      <div style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0f172a' }}>{deliveryForm.receiverName}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.75rem', color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Contact</div>
                      <div style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0f172a' }}>{deliveryForm.contactNumber}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.75rem', color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Parcel Info</div>
                      <div style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0f172a' }}>{deliveryForm.parcelInfo}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.75rem', color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Delivery Fee</div>
                      <div style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0f172a' }}>₱{deliveryForm.deliveryFee}</div>
                    </div>
                  </div>
                </div>
                <div style={{
                  backgroundColor: '#f0fdf4',
                  border: '1px solid #bbf7d0',
                  borderRadius: '10px',
                  padding: '0.875rem',
                  display: 'flex',
                  gap: '0.625rem',
                  alignItems: 'flex-start',
                  marginBottom: '0.75rem',
                }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="#16a34a">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                  </svg>
                  <span style={{ fontSize: '0.8125rem', color: '#166534', lineHeight: 1.5 }}>
                    Vault will be set to <span style={{ color: '#8B0000', fontWeight: 700 }}>Assigned</span> after assignment. <span style={{ color: '#8B0000', fontWeight: 700 }}>OTP</span> can then be generated for the delivery rider.
                  </span>
                </div>
                <div style={{
                  backgroundColor: '#fffbeb',
                  border: '1px solid #fde68a',
                  borderRadius: '10px',
                  padding: '0.875rem',
                  display: 'flex',
                  gap: '0.625rem',
                  alignItems: 'flex-start',
                }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                    <line x1="12" y1="9" x2="12" y2="13"/>
                    <line x1="12" y1="17" x2="12.01" y2="17"/>
                  </svg>
                  <span style={{ fontSize: '0.8125rem', color: '#92400e', lineHeight: 1.5 }}>
                    Please don't forget to <span style={{ color: '#8B0000', fontWeight: 700 }}>take a photo of the cash</span> placed inside the cash pod and <span style={{ color: '#8B0000', fontWeight: 700 }}>send the proof</span> to the designated delivery rider.
                  </span>
                </div>
              </div>
              <div style={r.modalFooter}>
                <button className="btn-animate" style={{ ...styles.cancelBtn, minHeight: 44 }} onClick={() => { setShowConfirmModal(false); setShowSetDeliveryModal(true); }}>
                  Back
                </button>
                <button className="btn-animate" style={{ ...styles.saveBtn, minHeight: 44 }} onClick={handleAssignParcel}>
                  Assign Parcel
                </button>
              </div>
            </div>
          </div>
        )
      )}

      {/* WARNING MODAL */}
      {showWarningModal && (
        isMobile ? (
          <div style={{
            position: 'fixed',
            inset: 0,
            zIndex: 300,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
            backgroundColor: 'rgba(0,0,0,0.45)',
            backdropFilter: 'blur(3px)',
          }}>
            <div style={{
              backgroundColor: '#fff',
              borderRadius: '20px 20px 0 0',
              padding: '1.5rem 1rem 2rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem',
            }}>
              <div style={{ width: 40, height: 4, backgroundColor: '#d1d5db', borderRadius: 2, alignSelf: 'center', marginBottom: 8 }} />
              <div style={styles.warningIconCircle}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/>
                  <line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
              </div>
              <h3 style={{ ...styles.modalTitle, textAlign: 'center' }}>Warning</h3>
              <p style={{ ...styles.warningText, marginBottom: '0.5rem' }}>
                The vault will open automatically. Please confirm that <span style={{ color: '#8B0000', fontWeight: 700 }}>you are physically present</span> at the vault — do not confirm on behalf of the rider.
              </p>
              {confirmError && (
                <div style={{ backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '0.75rem', color: '#dc2626', fontSize: '0.875rem', textAlign: 'center' }}>
                  {confirmError}
                </div>
              )}
              <button
                className="btn-animate"
                style={{ ...styles.confirmBtn, minHeight: 48, fontSize: '1rem', opacity: confirmLoading ? 0.6 : 1, pointerEvents: confirmLoading ? 'none' : 'auto' }}
                onClick={handleConfirmWithWarning}
                disabled={confirmLoading}
              >
                {confirmLoading ? 'Processing...' : 'Confirm & Open Vault'}
              </button>
              <button className="btn-animate" style={{ ...styles.cancelBtn, minHeight: 44, width: '100%' }} onClick={() => setShowWarningModal(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="modal-overlay-enter" style={desktopOverlay}>
            <div className="modal-content-enter" style={{ ...styles.modal, maxWidth: 400 }}>
              <div style={styles.modalHeader}>
                <h3 style={styles.modalTitle}>Warning</h3>
                <button className="btn-animate" style={styles.closeBtn} onClick={() => setShowWarningModal(false)}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                  </svg>
                </button>
              </div>
              <div style={styles.modalBody}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem', paddingTop: '0.25rem' }}>
                  <div style={styles.warningIconCircle}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                      <line x1="12" y1="9" x2="12" y2="13"/>
                      <line x1="12" y1="17" x2="12.01" y2="17"/>
                    </svg>
                  </div>
                  <p style={styles.warningText}>The vault will open automatically. Please confirm that <span style={{ color: '#8B0000', fontWeight: 700 }}>you are physically present</span> at the vault.</p>
                  {confirmError && (
                    <div style={{ backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '0.75rem', color: '#dc2626', fontSize: '0.875rem', textAlign: 'center', marginTop: '0.5rem' }}>
                      {confirmError}
                    </div>
                  )}
                </div>
              </div>
              <div style={{ ...r.modalFooter, flexDirection: 'column' }}>
                <button className="btn-animate" style={{ ...styles.cancelBtn, minHeight: 44 }} onClick={() => setShowWarningModal(false)}>
                  Cancel
                </button>
                <button
                  className="btn-animate"
                  style={{ ...styles.confirmBtn, minHeight: 44, opacity: confirmLoading ? 0.6 : 1, pointerEvents: confirmLoading ? 'none' : 'auto' }}
                  onClick={handleConfirmWithWarning}
                  disabled={confirmLoading}
                >
                  {confirmLoading ? 'Processing...' : 'Confirm & Open Vault'}
                </button>
              </div>
            </div>
          </div>
        )
      )}

      {/* OTP MODAL */}
      {showOTPModal && currentOTP && (
        isMobile ? (
          <div className="mobile-sheet-enter" style={mobileModalShell}>
            <div style={{ ...styles.modalHeader, justifyContent: 'center' }}>
              <h3 style={styles.otpModalTitle}>OTP Generated</h3>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem 1rem', WebkitOverflowScrolling: 'touch' }}>
              <div style={styles.otpCodeBox}>
                <span style={styles.otpCodeLabel}>Your OTP</span>
                <span style={{ ...styles.otpCodeValue, fontSize: '2.5rem' }}>
                  {currentOTP.code}
                </span>
              </div>
              <div style={styles.timerSection}>
                <span style={styles.timerSectionLabel}>Expires in</span>
                <span style={styles.timerSectionValue}>{formatTime(otpTimeRemaining)}</span>
              </div>
              <div style={styles.progressBarContainer}>
                <div style={{ ...styles.progressBar, width: `${progressPercent}%` }} />
              </div>
              <button
                className="btn-animate"
                style={{ ...(copiedId === currentOTP.vaultId ? styles.otpCopiedBtn : styles.otpCopyBtn), minHeight: 48, fontSize: '1rem' }}
                onClick={handleCopyOTP}
                disabled={otpTimeRemaining <= 0}
              >
                {copiedId === currentOTP.vaultId ? 'Copied!' : 'Copy OTP'}
              </button>
            </div>
            <div style={{ padding: '1rem', borderTop: '1px solid #e5e7eb', backgroundColor: '#fff', flexShrink: 0 }}>
              <button className="btn-animate" style={{ ...styles.otpCloseBtn, minHeight: 44, width: '100%' }} onClick={closeOTPModal}>
                Close
              </button>
            </div>
          </div>
        ) : (
          <div className="modal-overlay-enter" style={desktopOverlay}>
            <div className="modal-content-enter" style={{ ...styles.otpModal, maxWidth: 380 }}>
              <div style={styles.otpModalHeader}>
                <h3 style={styles.otpModalTitle}>OTP Generated</h3>
              </div>
              <div style={styles.otpModalBody}>
                <div style={styles.otpCodeBox}>
                  <span style={styles.otpCodeLabel}>Your OTP</span>
                  <span style={styles.otpCodeValue}>{currentOTP.code}</span>
                </div>
                <div style={styles.timerSection}>
                  <span style={styles.timerSectionLabel}>Expires in</span>
                  <span style={styles.timerSectionValue}>{formatTime(otpTimeRemaining)}</span>
                </div>
                <div style={styles.progressBarContainer}>
                  <div style={{ ...styles.progressBar, width: `${progressPercent}%` }} />
                </div>
                <button
                  className="btn-animate"
                  style={{ ...(copiedId === currentOTP.vaultId ? styles.otpCopiedBtn : styles.otpCopyBtn), minHeight: 44 }}
                  onClick={handleCopyOTP}
                  disabled={otpTimeRemaining <= 0}
                >
                  {copiedId === currentOTP.vaultId ? 'Copied!' : 'Copy OTP'}
                </button>
              </div>
              <div style={styles.otpModalFooter}>
                <button className="btn-animate" style={{ ...styles.otpCloseBtn, minHeight: 44, width: '100%' }} onClick={closeOTPModal}>
                  Close
                </button>
              </div>
            </div>
          </div>
        )
      )}
    </div>
  );
}

const styles = {
  layout: { display: 'flex', flexDirection: 'column', minHeight: '100vh', backgroundColor: '#f4f5f7', fontFamily: 'var(--font)' },
  main: { flex: 1, minWidth: 0 },
  content: { padding: '2rem', maxWidth: 1200, margin: '0 auto' },
  pageTitle: { fontSize: '1.75rem', fontWeight: 800, color: '#0f172a', marginBottom: '1.5rem', marginTop: 0, letterSpacing: '-0.4px' },
  pageSubtitle: { fontSize: '0.875rem', color: '#6b7280', margin: 0, fontWeight: 400, marginBottom: '1.25rem' },
  statCard: { backgroundColor: '#fff', borderRadius: '14px', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', border: '1px solid #f0f1f3' },
  statIconWrap: { width: 36, height: 36, borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  statInfo: { flex: 1 },
  statValue: { fontSize: '1.75rem', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.5px' },
  statLabel: { fontSize: '0.775rem', color: '#6b7280', marginTop: 2 },
  vaultSection: { backgroundColor: '#fff', borderRadius: '14px', padding: '1.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', border: '1px solid #f0f1f3' },
  vaultSectionHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' },
  sectionTitle: { fontSize: '1.25rem', fontWeight: 'bold', color: '#1f2937', margin: 0 },
  filterBtn: { padding: '0.5rem 0.875rem', backgroundColor: '#f4f5f7', border: '1px solid transparent', borderRadius: '8px', fontSize: '0.8125rem', color: '#6b7280', cursor: 'pointer', transition: 'all 0.2s ease' },
  filterBtnActive: { backgroundColor: '#8B0000', border: '1px solid #8B0000', color: '#fff' },
  vaultCard: { backgroundColor: '#fff', borderRadius: '12px', border: '1px solid #f0f1f3', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' },
  vaultHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.25rem', borderBottom: '1px solid #f4f5f7' },
  vaultNumberWrap: { display: 'flex', alignItems: 'center', gap: '0.5rem' },
  vaultDot: { width: 8, height: 8, borderRadius: '50%', backgroundColor: '#8B0000' },
  vaultNumber: { fontSize: '1rem', fontWeight: 'bold', color: '#1f2937' },
  vaultBadge: { padding: '0.25rem 0.75rem', borderRadius: 99, fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' },
  vaultContent: { padding: '1.25rem' },
  emptyState: { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '1.5rem 0' },
  emptyIconWrap: { width: 52, height: 52, borderRadius: '14px', backgroundColor: '#f4f5f7', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  emptyText: { marginTop: '0.75rem', color: '#0f172a', fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.25rem' },
  emptySubtitle: { color: '#9ca3af', fontSize: '0.775rem', margin: 0 },
  setDeliveryBtn: { width: '100%', padding: '0.75rem', backgroundColor: '#8B0000', color: '#fff', border: 'none', borderRadius: '10px', fontSize: '0.875rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font)' },
  vaultDetails: { display: 'flex', flexDirection: 'column', gap: '0.75rem' },
  detailGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' },
  detailItem: { backgroundColor: '#f9fafb', borderRadius: '8px', padding: '0.5rem 0.625rem' },
  detailItemLabel: { fontSize: '0.7rem', color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' },
  detailItemValue: { fontSize: '0.875rem', fontWeight: 600, color: '#0f172a', wordBreak: 'break-word', marginTop: 2 },
  generateOtpBtn: { width: '100%', padding: '0.75rem', backgroundColor: '#8B0000', color: '#fff', border: 'none', borderRadius: '10px', fontSize: '0.875rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font)' },
  otpWrap: { backgroundColor: '#fdf2f2', borderRadius: '10px', padding: '0.875rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' },
  otpLabel: { fontSize: '0.7rem', color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' },
  otpValue: { fontSize: '1.5rem', fontWeight: 800, color: '#8B0000', letterSpacing: '4px' },
  otpTimer: { textAlign: 'right' },
  timerLabel: { fontSize: '0.7rem', color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' },
  timerValue: { fontSize: '0.95rem', fontWeight: 800, color: '#0f172a' },
  copyOtpBtn: { width: '100%', padding: '0.625rem', backgroundColor: 'transparent', color: '#8B0000', border: '1.5px solid #8B0000', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer' },
  copiedBtn: { width: '100%', padding: '0.625rem', backgroundColor: '#059669', color: '#fff', border: '1px solid #059669', borderRadius: '8px', fontSize: '0.9rem', fontWeight: '500', cursor: 'pointer' },
  expiredBox: { padding: '0.75rem', backgroundColor: '#fee2e2', borderRadius: '8px', display: 'flex', justifyContent: 'center', alignItems: 'center' },
  expiredText: { fontSize: '0.7rem', fontWeight: 700, color: '#dc2626', textTransform: 'uppercase', letterSpacing: '0.04em' },
  regenerateOtpBtn: { width: '100%', padding: '0.75rem', backgroundColor: '#8B0000', color: '#fff', border: 'none', borderRadius: '10px', fontSize: '0.875rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font)' },
  resetVaultBtn: { padding: '0.75rem', backgroundColor: '#f4f5f7', color: '#374151', border: '1px solid #e8eaed', borderRadius: '10px', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer' },
  confirmBtn: { flex: 1, padding: '0.75rem', backgroundColor: '#8B0000', color: '#fff', border: 'none', borderRadius: '10px', fontSize: '0.875rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font)' },
  completedState: { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '1.5rem 0' },
  completedText: { marginTop: '0.75rem', color: '#059669', fontSize: '0.9rem', fontWeight: '600' },
  timestamp: { marginTop: '0.75rem', fontSize: '0.75rem', color: '#9ca3af', textAlign: 'right' },
  modal: { backgroundColor: '#fff', borderRadius: '20px', width: '100%', maxWidth: 450, overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: '90vh', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.25rem 1.5rem', borderBottom: '1px solid #f0f1f3', flexShrink: 0, backgroundColor: '#fff' },
  modalTitle: { fontSize: '1.0625rem', fontWeight: 800, color: '#0f172a', margin: 0, letterSpacing: '-0.2px' },
  closeBtn: { background: '#f4f5f7', border: 'none', cursor: 'pointer', padding: '0.375rem', color: '#6b7280', borderRadius: '8px' },
  modalBody: { padding: '1.5rem', overflowY: 'auto' },
  formGroup: { marginBottom: '1rem' },
  formLabel: { display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#374151', marginBottom: '0.5rem', letterSpacing: '0.01em' },
  formInput: { width: '100%', padding: '0.75rem', border: '1.5px solid #e8eaed', borderRadius: '10px', fontSize: '1rem', boxSizing: 'border-box', backgroundColor: '#fafafa', fontFamily: 'var(--font)' },
  formError: { color: '#dc2626', fontSize: '0.75rem', marginTop: '0.25rem', fontWeight: 500 },
  cancelBtn: { padding: '0.75rem 1.25rem', backgroundColor: '#f4f5f7', color: '#374151', border: '1px solid #e8eaed', borderRadius: '10px', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer' },
  resetBtn: { padding: '0.75rem 1.25rem', backgroundColor: '#f4f5f7', color: '#374151', border: '1px solid #e8eaed', borderRadius: '10px', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer' },
  saveBtn: { padding: '0.75rem 1.25rem', backgroundColor: '#8B0000', color: '#fff', border: 'none', borderRadius: '10px', fontSize: '0.875rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font)' },
  warningText: { fontSize: '1rem', color: '#1f2937', textAlign: 'center' },
  warningIconCircle: { width: 52, height: 52, borderRadius: '50%', backgroundColor: '#fffbeb', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  otpModal: { backgroundColor: '#fff', borderRadius: '20px', width: '100%', maxWidth: 380, overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: '90vh', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' },
  otpModalHeader: { padding: '1.25rem 1.5rem', borderBottom: '1px solid #e5e7eb', textAlign: 'center', flexShrink: 0 },
  otpModalTitle: { fontSize: '1.1rem', fontWeight: 'bold', color: '#1f2937', margin: 0 },
  otpModalBody: { padding: '1.5rem', overflowY: 'auto', flex: 1 },
  otpCodeBox: { backgroundColor: '#fdf2f2', borderRadius: '14px', padding: '1.5rem', textAlign: 'center', marginBottom: '1rem', border: '1px solid rgba(139,0,0,0.08)' },
  otpCodeLabel: { display: 'block', fontSize: '0.85rem', color: '#8B0000', fontWeight: 700, marginBottom: '0.5rem' },
  otpCodeValue: { display: 'block', fontSize: '2.75rem', fontWeight: 800, color: '#8B0000', letterSpacing: '8px' },
  timerSection: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' },
  timerSectionLabel: { fontSize: '0.9rem', color: '#6b7280' },
  timerSectionValue: { fontSize: '1.25rem', fontWeight: 'bold', color: '#f39c12' },
  progressBarContainer: { height: '8px', backgroundColor: '#e5e7eb', borderRadius: '4px', overflow: 'hidden', marginBottom: '1rem' },
  progressBar: { height: '100%', backgroundColor: '#8B0000', borderRadius: '4px', transition: 'width 1s linear' },
  otpCopyBtn: { width: '100%', padding: '0.875rem', backgroundColor: 'transparent', color: '#8B0000', border: '1.5px solid #8B0000', borderRadius: '8px', fontSize: '1rem', fontWeight: 600, cursor: 'pointer' },
  otpCopiedBtn: { width: '100%', padding: '0.875rem', backgroundColor: '#059669', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '1rem', fontWeight: '600', cursor: 'pointer' },
  otpModalFooter: { padding: '1rem 1.5rem', borderTop: '1px solid #e5e7eb', display: 'flex', justifyContent: 'center', flexShrink: 0 },
  otpCloseBtn: { padding: '0.75rem 2rem', backgroundColor: '#f4f5f7', color: '#374151', border: '1px solid #e8eaed', borderRadius: '10px', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer' },
};

export default Dashboard;