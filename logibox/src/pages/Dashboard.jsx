import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { collection, doc, setDoc, onSnapshot, writeBatch, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../config/firebase';

const navItems = [
  { label: 'Dashboard', path: '/dashboard', icon: 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V13h-8v8zm0-18v6h8V3h-8z' },
  { label: 'Camera Feed', path: '/camera', icon: 'M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z' },
  { label: 'Activity Logs', path: '/logs', icon: 'M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42C8.27 19.99 10.51 21 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z' },
  { label: 'Settings', path: '/settings', icon: 'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.04.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.57 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z' },
  { label: 'Help', path: '/help', icon: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z' },
];

function Dashboard() {
  const { logout, user } = useAuth();
  const { settings } = useSettings();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [cashLoaded, setCashLoaded] = useState(0);
  const [activeFilter, setActiveFilter] = useState('all');
  const [showSetDeliveryModal, setShowSetDeliveryModal] = useState(false);
  const [showWarningModal, setShowWarningModal] = useState(false);
  const [showOTPModal, setShowOTPModal] = useState(false);
  const [selectedVault, setSelectedVault] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [currentOTP, setCurrentOTP] = useState(null);
  const [otpTimeRemaining, setOtpTimeRemaining] = useState(0);
  const [deliveryForm, setDeliveryForm] = useState({
    receiverName: '',
    contactNumber: '',
    parcelInfo: '',
    deliveryFee: '',
  });
  const [vaults, setVaults] = useState([]);
  const [vaultsLoading, setVaultsLoading] = useState(true);

  const OTP_DURATION_MS = (settings.otpDuration ?? 5) * 60 * 1000;

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    const anyModalOpen = showSetDeliveryModal || showWarningModal || showOTPModal;
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
  }, [isMobile, showSetDeliveryModal, showWarningModal, showOTPModal]);

  const generateOTP = useCallback(() => {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }, []);

  const checkOTPExpiry = useCallback((vault) => {
    if (!vault.otpExpiresAt || !vault.otp) return { isExpired: false, isActive: false };
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
    const otp = generateOTP();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + OTP_DURATION_MS);

    const updatedVault = {
      ...vault,
      otp,
      otpStatus: 'active',
      otpCreatedAt: now.toISOString(),
      otpExpiresAt: expiresAt.toISOString(),
    };

    await setDoc(doc(db, 'users', user.uid, 'vaults', vault.id.toString()), updatedVault);
    await logActivity('OTP Generated', `OTP generated for vault ${vault.id}`, vault.id);

    setCurrentOTP({
      code: otp,
      expiresAt: expiresAt.toISOString(),
      vaultId: vault.id,
    });
    setOtpTimeRemaining(OTP_DURATION_MS);
    setShowOTPModal(true);
  }, [generateOTP, user, OTP_DURATION_MS, logActivity]);

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
      otpStatus: null,
      otpCreatedAt: null,
      otpExpiresAt: null,
      completedAt: null,
    };
    await setDoc(doc(db, 'users', user.uid, 'vaults', vaultId.toString()), emptyVault);
    await logActivity('Vault Reset', `Vault ${vaultId} was reset to empty`, vaultId);
  }, [user, logActivity]);

  useEffect(() => {
    const interval = setInterval(() => {
      setVaults(prev => prev.map(v => {
        if (v.otpStatus === 'active' && v.otpExpiresAt) {
          const now = Date.now();
          const expiresAt = new Date(v.otpExpiresAt).getTime();
          if (now >= expiresAt) return { ...v, otpStatus: 'expired' };
        }
        return v;
      }));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    let timerInterval;
    if (showOTPModal && otpTimeRemaining > 0) {
      timerInterval = setInterval(() => {
        setOtpTimeRemaining(prev => {
          const newTime = prev - 1000;
          if (newTime <= 0) {
            clearInterval(timerInterval);
            setShowOTPModal(false);
            return 0;
          }
          return newTime;
        });
      }, 1000);
    }
    return () => clearInterval(timerInterval);
  }, [showOTPModal, otpTimeRemaining]);

  useEffect(() => {
    const total = vaults
      .filter(v => v.status === 'assigned' || v.status === 'otp_active' || v.status === 'otp_expired')
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

  const handleLogout = () => {
    logout();
    navigate('/signin');
  };

  const openSetDeliveryModal = (vault) => {
    setSelectedVault(vault);
    setDeliveryForm({ receiverName: '', contactNumber: '', parcelInfo: '', deliveryFee: '' });
    setShowSetDeliveryModal(true);
  };

  const handleSaveDelivery = async () => {
    if (!deliveryForm.receiverName || !deliveryForm.contactNumber || !deliveryForm.parcelInfo || !deliveryForm.deliveryFee) return;

    const updatedVault = {
      ...selectedVault,
      status: 'assigned',
      receiverName: deliveryForm.receiverName,
      contactNumber: deliveryForm.contactNumber,
      parcelInfo: deliveryForm.parcelInfo,
      deliveryFee: parseFloat(deliveryForm.deliveryFee),
      createdAt: new Date().toISOString(),
    };

    await setDoc(doc(db, 'users', user.uid, 'vaults', selectedVault.id.toString()), updatedVault);
    await logActivity('Vault Assigned', `Delivery assigned to ${deliveryForm.receiverName} for vault ${selectedVault.id}`, selectedVault.id);
    setShowSetDeliveryModal(false);
  };

  const handleModalReset = () => {
    setDeliveryForm({ receiverName: '', contactNumber: '', parcelInfo: '', deliveryFee: '' });
  };

  const openConfirmWarningModal = (vault) => {
    setSelectedVault(vault);
    setShowWarningModal(true);
  };

  const handleConfirmWithWarning = async () => {
    setShowWarningModal(false);
    const updatedVault = {
      ...selectedVault,
      status: 'completed',
      completedAt: new Date().toISOString(),
    };
    await setDoc(doc(db, 'users', user.uid, 'vaults', selectedVault.id.toString()), updatedVault);
    await logActivity('Delivery Confirmed', `Delivery confirmed for vault ${selectedVault.id}`, selectedVault.id);
    setTimeout(() => handleResetVault(selectedVault.id), 1500);
  };

  const handleCopyOTP = () => {
    if (!currentOTP || otpTimeRemaining <= 0) return;
    navigator.clipboard.writeText(currentOTP.code);
    setCopiedId(currentOTP.vaultId);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const closeOTPModal = () => {
    setShowOTPModal(false);
    setCurrentOTP(null);
    setOtpTimeRemaining(0);
  };

  const closeSidebar = () => setSidebarOpen(false);

  const filteredVaults = vaults.filter(v => {
    const isEnabled = v.enabled !== false;
    if (!isEnabled) return false;
    if (activeFilter === 'all') return true;
    if (activeFilter === 'empty') return v.status === 'empty';
    if (activeFilter === 'occupied') return ['assigned', 'otp_active', 'otp_expired'].includes(v.status);
    return v.status === activeFilter;
  });

  const enabledVaults = vaults.filter(v => v.enabled !== false);
  const assignedCount = enabledVaults.filter(v => v.status !== 'empty').length;
  const occupiedCount = enabledVaults.filter(v => ['assigned', 'otp_active', 'otp_expired'].includes(v.status)).length;
  const activeOTPCount = enabledVaults.filter(v => v.otpStatus === 'active').length;

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
      gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit, minmax(220px, 1fr))',
      gap: isMobile ? '1rem' : '1.5rem',
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
    backgroundColor: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 300,
    padding: '1rem',
  };

  return (
    <div style={styles.layout}>

      {/* DESKTOP NAVBAR */}
      {!isMobile && (
        <header style={styles.desktopNavbar}>
          <span style={styles.desktopNavbarLogo}>LogiBox</span>
          <nav style={styles.desktopNavLinks}>
            {navItems.map((item) => (
              <button
                key={item.path}
                className="nav-link-animate"
                style={{
                  ...styles.desktopNavLink,
                  ...(item.path === '/dashboard' ? styles.desktopNavLinkActive : {}),
                }}
                onClick={() => navigate(item.path)}
              >
                {item.label}
              </button>
            ))}
          </nav>
          <button className="btn-animate" style={styles.desktopSignOutBtn} onClick={handleLogout}>
            Sign Out
          </button>
        </header>
      )}

      {/* MOBILE HEADER */}
      {isMobile && (
        <header style={styles.mobileHeader}>
          <button style={styles.menuBtn} onClick={() => setSidebarOpen(true)} aria-label="Open menu">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="#fff">
              <path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/>
            </svg>
          </button>
          <h1 style={styles.mobileTitle}>LogiBox</h1>
          <div style={{ width: 40 }} />
        </header>
      )}

      {/* MOBILE SIDEBAR */}
      {isMobile && (
        <>
          <div
            style={{
              ...styles.overlay,
              opacity: sidebarOpen ? 1 : 0,
              pointerEvents: sidebarOpen ? 'auto' : 'none',
            }}
            onClick={closeSidebar}
          />
          <aside style={{
            ...styles.sidebar,
            transform: sidebarOpen ? 'translateX(0)' : 'translateX(-100%)',
          }}>
            <div style={styles.sidebarHeader}>
              <h2 style={styles.sidebarLogo}>LogiBox</h2>
              <button style={styles.closeSidebarBtn} onClick={closeSidebar} aria-label="Close menu">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                </svg>
              </button>
            </div>
            <nav style={styles.sidebarNav}>
              {navItems.map((item) => (
                <button
                  key={item.path}
                  className="nav-link-animate"
                  style={{
                    ...styles.navItem,
                    ...(item.path === '/dashboard' ? styles.navItemActive : {}),
                  }}
                  onClick={() => { navigate(item.path); closeSidebar(); }}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d={item.icon}/>
                  </svg>
                  {item.label}
                </button>
              ))}
              <button
                className="btn-animate"
                style={{ ...styles.navItem, ...styles.navItemLogout }}
                onClick={() => { handleLogout(); closeSidebar(); }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/>
                </svg>
                Logout
              </button>
            </nav>
          </aside>
        </>
      )}

      {/* MAIN CONTENT */}
      <main className="page-enter" style={styles.main}>
        <div style={{ ...styles.content, padding: isMobile ? '1rem' : '2rem' }}>
          <h1 style={{
            ...styles.pageTitle,
            fontSize: isMobile ? '1.5rem' : '1.75rem',
            marginBottom: isMobile ? '1rem' : '1.5rem',
          }}>
            Dashboard
          </h1>

          {/* Stats Grid */}
          <div style={r.statsGrid}>
            {[
              { label: 'Assigned Vaults', value: assignedCount, icon: 'M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z', color: '#9B0000' },
              { label: 'Occupied Vaults', value: occupiedCount, icon: 'M20 4H4c-1.11 0-2 .89-2 2v12c0 1.1.89 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.89-2-2-2zm0 14H4V6h16v12z', color: '#9B0000' },
              { label: 'Cash Loaded', value: `₱${cashLoaded.toFixed(2)}`, icon: 'M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z', color: '#2ecc71', valueStyle: { color: '#2ecc71' } },
              { label: 'Active OTPs', value: activeOTPCount, icon: 'M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6h2c0-1.66-1.34-3-3-3S3 4.34 3 6v2H1v14h22V8h-5zm-6-2c1.1 0 2 .9 2 2s-.9 2-2 2-2-.9-2-2 .9-2 2-2zm6 16H6V10h12v12zm-6-8c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z', color: '#f39c12' },
            ].map((stat, i) => (
              <div
                key={i}
                className="card-enter stat-card-animate"
                style={{
                  ...styles.statCard,
                  flexDirection: isMobile ? 'row' : 'column',
                  padding: isMobile ? '1rem' : '1.5rem',
                }}
              >
                <div style={{
                  ...styles.statIcon,
                  width: isMobile ? 40 : 48,
                  height: isMobile ? 40 : 48,
                }}>
                  <svg width={isMobile ? 20 : 24} height={isMobile ? 20 : 24} viewBox="0 0 24 24" fill={stat.color}>
                    <path d={stat.icon}/>
                  </svg>
                </div>
                <div style={styles.statInfo}>
                  <div style={{ ...styles.statValue, fontSize: isMobile ? '1.25rem' : '1.75rem', ...stat.valueStyle }}>
                    {stat.value}
                  </div>
                  <div style={styles.statLabel}>{stat.label}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Vault Section */}
          <div style={styles.vaultSection}>
            <div style={styles.vaultSectionHeader}>
              <h2 style={styles.sectionTitle}>Vaults</h2>
              <div style={{ display: 'flex', gap: '0.5rem', overflowX: 'auto', flexWrap: 'nowrap' }}>
                {['all', 'empty', 'occupied'].map(filter => (
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
                        <span style={styles.vaultNumber}>Vault {vault.id}</span>
                        <span style={{
                          ...styles.vaultBadge,
                          backgroundColor: vault.status === 'empty' ? '#e5e7eb' : vault.status === 'completed' ? '#d1fae5' : '#fee2e2',
                          color: vault.status === 'empty' ? '#6b7280' : vault.status === 'completed' ? '#059669' : '#9B0000',
                        }}>
                          {vault.status === 'empty' ? 'Empty' : vault.status === 'completed' ? 'Completed' : 'Occupied'}
                        </span>
                      </div>

                      {vault.status === 'empty' && (
                        <div style={styles.vaultContent}>
                          <div style={styles.emptyState}>
                            <svg width={isMobile ? 40 : 48} height={isMobile ? 40 : 48} viewBox="0 0 24 24" fill="#d1d5db">
                              <path d="M20 4H4c-1.11 0-2 .89-2 2v12c0 1.1.89 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.89-2-2-2zm0 14H4V6h16v12zM6 10h2v2H6zm0 4h8v2H6z"/>
                            </svg>
                            <p style={styles.emptyText}>No delivery assigned</p>
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

                      {(vault.status === 'assigned' || vault.status === 'otp_active' || vault.status === 'otp_expired') && (
                        <div style={styles.vaultContent}>
                          <div style={styles.vaultDetails}>
                            {[
                              { label: 'Delivery Rider', value: vault.receiverName },
                              { label: 'Contact', value: vault.contactNumber },
                              { label: 'Parcel', value: vault.parcelInfo },
                              { label: 'Fee', value: `₱${vault.deliveryFee}` },
                            ].map((item, i) => (
                              <div key={i} style={{
                                ...styles.detailRow,
                                flexDirection: isMobile ? 'column' : 'row',
                                alignItems: isMobile ? 'flex-start' : 'center',
                              }}>
                                <span style={styles.detailLabel}>{item.label}</span>
                                <span style={{ ...styles.detailValue, wordBreak: 'break-word' }}>{item.value}</span>
                              </div>
                            ))}

                            {!vault.otp && (
                              <button
                                className="btn-animate"
                                style={{ ...styles.generateOtpBtn, minHeight: 44 }}
                                onClick={() => handleOpenOTPModal(vault)}
                              >
                                Generate OTP
                              </button>
                            )}

                            {vault.otp && isActive && (
                              <>
                                <div style={styles.otpBox}>
                                  <span style={styles.otpLabel}>OTP</span>
                                  <span
                                    className="otp-active-pulse"
                                    style={{ ...styles.otpValue, fontSize: isMobile ? '1.1rem' : '1.25rem' }}
                                  >
                                    {vault.otp}
                                  </span>
                                </div>
                                <div style={styles.timerBox}>
                                  <span style={styles.timerLabel}>Expires in</span>
                                  <span style={styles.timerValue}>{formatTime(timeRemaining)}</span>
                                </div>
                                <button
                                  className="btn-animate"
                                  style={{ ...(copiedId === vault.id ? styles.copiedBtn : styles.copyOtpBtn), minHeight: 44 }}
                                  onClick={() => {
                                    navigator.clipboard.writeText(vault.otp);
                                    setCopiedId(vault.id);
                                    setTimeout(() => setCopiedId(null), 2000);
                                  }}
                                >
                                  {copiedId === vault.id ? 'Copied!' : 'Copy OTP'}
                                </button>
                              </>
                            )}

                            {vault.otp && isExpired && (
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
                          </div>

                          <div style={r.vaultActions}>
                            {vault.otpStatus !== 'active' && (
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
              <button className="btn-animate" style={styles.closeBtn} onClick={() => setShowSetDeliveryModal(false)}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                </svg>
              </button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '1rem', WebkitOverflowScrolling: 'touch' }}>
              {[
                { label: 'Delivery Rider', key: 'receiverName', placeholder: 'Enter delivery rider name' },
                { label: 'Contact Number', key: 'contactNumber', placeholder: 'Enter contact number' },
                { label: 'Parcel Info', key: 'parcelInfo', placeholder: 'Enter parcel description' },
                { label: 'Delivery Fee (₱)', key: 'deliveryFee', placeholder: '0.00', type: 'number' },
              ].map((field, i) => (
                <div key={i} style={styles.formGroup}>
                  <label style={styles.formLabel}>{field.label}</label>
                  <input
                    className="input-animate"
                    type={field.type || 'text'}
                    style={styles.formInput}
                    value={deliveryForm[field.key]}
                    onChange={e => setDeliveryForm(prev => ({ ...prev, [field.key]: e.target.value }))}
                    placeholder={field.placeholder}
                  />
                </div>
              ))}
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
              <button className="btn-animate" style={{ ...styles.saveBtn, minHeight: 48, fontSize: '1rem' }} onClick={handleSaveDelivery}>
                Save Delivery
              </button>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button className="btn-animate" style={{ ...styles.resetBtn, minHeight: 44, flex: 1 }} onClick={handleModalReset}>
                  Reset
                </button>
                <button className="btn-animate" style={{ ...styles.cancelBtn, minHeight: 44, flex: 1 }} onClick={() => setShowSetDeliveryModal(false)}>
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
                <button className="btn-animate" style={styles.closeBtn} onClick={() => setShowSetDeliveryModal(false)}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                  </svg>
                </button>
              </div>
              <div style={{ ...styles.modalBody, maxHeight: '60vh', overflowY: 'auto' }}>
                {[
                  { label: 'Delivery Rider', key: 'receiverName', placeholder: 'Enter delivery rider name' },
                  { label: 'Contact Number', key: 'contactNumber', placeholder: 'Enter contact number' },
                  { label: 'Parcel Info', key: 'parcelInfo', placeholder: 'Enter parcel description' },
                  { label: 'Delivery Fee (₱)', key: 'deliveryFee', placeholder: '0.00', type: 'number' },
                ].map((field, i) => (
                  <div key={i} style={styles.formGroup}>
                    <label style={styles.formLabel}>{field.label}</label>
                    <input
                      className="input-animate"
                      type={field.type || 'text'}
                      style={styles.formInput}
                      value={deliveryForm[field.key]}
                      onChange={e => setDeliveryForm(prev => ({ ...prev, [field.key]: e.target.value }))}
                      placeholder={field.placeholder}
                    />
                  </div>
                ))}
              </div>
              <div style={r.modalFooter}>
                <button className="btn-animate" style={{ ...styles.cancelBtn, minHeight: 44 }} onClick={() => setShowSetDeliveryModal(false)}>
                  Cancel
                </button>
                <button className="btn-animate" style={{ ...styles.resetBtn, minHeight: 44 }} onClick={handleModalReset}>
                  Reset
                </button>
                <button className="btn-animate" style={{ ...styles.saveBtn, minHeight: 44 }} onClick={handleSaveDelivery}>
                  Save Delivery
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
            backgroundColor: 'rgba(0,0,0,0.5)',
          }}>
            <div style={{
              backgroundColor: '#fff',
              borderRadius: '16px 16px 0 0',
              padding: '1.5rem 1rem 2rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem',
            }}>
              <div style={{ width: 40, height: 4, backgroundColor: '#d1d5db', borderRadius: 2, alignSelf: 'center', marginBottom: 8 }} />
              <h3 style={{ ...styles.modalTitle, textAlign: 'center' }}>Warning</h3>
              <p style={{ ...styles.warningText, marginBottom: '0.5rem' }}>
                The vault will open automatically after confirmation.
              </p>
              <button className="btn-animate" style={{ ...styles.confirmBtn, minHeight: 48, fontSize: '1rem' }} onClick={handleConfirmWithWarning}>
                Confirm
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
                <p style={styles.warningText}>The vault will open automatically after confirmation</p>
              </div>
              <div style={{ ...r.modalFooter, flexDirection: 'column' }}>
                <button className="btn-animate" style={{ ...styles.cancelBtn, minHeight: 44 }} onClick={() => setShowWarningModal(false)}>
                  Cancel
                </button>
                <button className="btn-animate" style={{ ...styles.confirmBtn, minHeight: 44 }} onClick={handleConfirmWithWarning}>
                  Confirm
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

const NAVBAR_HEIGHT = 56;

const styles = {
  layout: { display: 'flex', flexDirection: 'column', minHeight: '100vh', backgroundColor: '#f5f6fa' },
  desktopNavbar: { position: 'sticky', top: 0, zIndex: 100, height: NAVBAR_HEIGHT, backgroundColor: '#9B0000', display: 'flex', alignItems: 'center', padding: '0 2rem', gap: '1.5rem', boxShadow: '0 2px 8px rgba(0,0,0,0.15)' },
  desktopNavbarLogo: { fontSize: '1.35rem', fontWeight: 'bold', color: '#fff', letterSpacing: '0.5px', marginRight: 'auto' },
  desktopNavLinks: { display: 'flex', alignItems: 'center', gap: '0.25rem' },
  desktopNavLink: { display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 0.875rem', backgroundColor: 'transparent', border: 'none', borderRadius: '6px', fontSize: '0.9rem', color: 'rgba(255,255,255,0.85)', cursor: 'pointer' },
  desktopNavLinkActive: { backgroundColor: 'rgba(255,255,255,0.15)', color: '#fff', fontWeight: '600' },
  desktopSignOutBtn: { padding: '0.5rem 1.125rem', backgroundColor: 'rgba(255,255,255,0.15)', color: '#fff', border: '1px solid rgba(255,255,255,0.3)', borderRadius: '6px', fontSize: '0.9rem', fontWeight: '500', cursor: 'pointer' },
  mobileHeader: { position: 'sticky', top: 0, zIndex: 100, display: 'flex', padding: '0 1rem', height: NAVBAR_HEIGHT, backgroundColor: '#9B0000', boxShadow: '0 2px 8px rgba(0,0,0,0.15)', justifyContent: 'space-between', alignItems: 'center' },
  menuBtn: { background: 'none', border: 'none', cursor: 'pointer', padding: 8, minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6 },
  mobileTitle: { fontSize: '1.25rem', fontWeight: 'bold', color: '#fff', margin: 0 },
  sidebar: { position: 'fixed', left: 0, top: 0, bottom: 0, width: 280, backgroundColor: '#fff', boxShadow: '2px 0 12px rgba(0,0,0,0.12)', zIndex: 200, transition: 'transform 0.3s ease', display: 'flex', flexDirection: 'column' },
  sidebarHeader: { padding: '1.25rem 1.5rem', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  sidebarLogo: { fontSize: '1.4rem', fontWeight: 'bold', color: '#9B0000', margin: 0 },
  closeSidebarBtn: { background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: '#6b7280' },
  sidebarNav: { padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.25rem', flex: 1 },
  navItem: { display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.875rem 1rem', backgroundColor: 'transparent', border: 'none', borderRadius: '8px', fontSize: '0.95rem', color: '#374151', cursor: 'pointer', transition: 'all 0.2s ease', textAlign: 'left', width: '100%' },
  navItemActive: { backgroundColor: '#fef2f2', color: '#9B0000', fontWeight: '600' },
  navItemLogout: { marginTop: 'auto', color: '#dc2626' },
  overlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 199, transition: 'opacity 0.3s ease' },
  main: { flex: 1, minWidth: 0 },
  content: { padding: '2rem', maxWidth: 1200, margin: '0 auto' },
  pageTitle: { fontSize: '1.75rem', fontWeight: 'bold', color: '#1f2937', marginBottom: '1.5rem', marginTop: 0 },
  statCard: { backgroundColor: '#fff', borderRadius: '12px', padding: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
  statIcon: { borderRadius: '12px', backgroundColor: '#fef2f2', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  statInfo: { flex: 1 },
  statValue: { fontSize: '1.75rem', fontWeight: 'bold', color: '#1f2937' },
  statLabel: { fontSize: '0.875rem', color: '#6b7280', marginTop: 2 },
  vaultSection: { backgroundColor: '#fff', borderRadius: '12px', padding: '1.5rem', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
  vaultSectionHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' },
  sectionTitle: { fontSize: '1.25rem', fontWeight: 'bold', color: '#1f2937', margin: 0 },
  filterBtn: { padding: '0.5rem 1rem', backgroundColor: '#fff', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.85rem', color: '#6b7280', cursor: 'pointer', transition: 'all 0.2s ease' },
  filterBtnActive: { backgroundColor: '#9B0000', borderColor: '#9B0000', color: '#fff' },
  vaultCard: { backgroundColor: '#fff', borderRadius: '12px', border: '1px solid #e5e7eb', overflow: 'hidden' },
  vaultHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.25rem', borderBottom: '1px solid #e5e7eb' },
  vaultNumber: { fontSize: '1rem', fontWeight: 'bold', color: '#1f2937' },
  vaultBadge: { padding: '0.25rem 0.75rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: '600', textTransform: 'uppercase' },
  vaultContent: { padding: '1.25rem' },
  emptyState: { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '1.5rem 0' },
  emptyText: { marginTop: '0.75rem', color: '#9ca3af', fontSize: '0.9rem' },
  setDeliveryBtn: { width: '100%', padding: '0.75rem', backgroundColor: '#9B0000', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '0.95rem', fontWeight: '600', cursor: 'pointer' },
  vaultDetails: { display: 'flex', flexDirection: 'column', gap: '0.75rem' },
  detailRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  detailLabel: { fontSize: '0.85rem', color: '#6b7280' },
  detailValue: { fontSize: '0.95rem', fontWeight: '500', color: '#1f2937' },
  generateOtpBtn: { width: '100%', padding: '0.75rem', backgroundColor: '#9B0000', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '0.95rem', fontWeight: '600', cursor: 'pointer' },
  otpBox: { padding: '0.75rem', backgroundColor: '#fef2f2', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  otpLabel: { fontSize: '0.85rem', color: '#9B0000', fontWeight: '600' },
  otpValue: { fontSize: '1.25rem', fontWeight: 'bold', color: '#9B0000', letterSpacing: '2px' },
  timerBox: { padding: '0.5rem 0.75rem', backgroundColor: '#fff', border: '1px solid #d1d5db', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  timerLabel: { fontSize: '0.8rem', color: '#6b7280' },
  timerValue: { fontSize: '1rem', fontWeight: 'bold', color: '#f39c12' },
  copyOtpBtn: { width: '100%', padding: '0.625rem', backgroundColor: '#fff', color: '#374151', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '0.9rem', fontWeight: '500', cursor: 'pointer' },
  copiedBtn: { width: '100%', padding: '0.625rem', backgroundColor: '#059669', color: '#fff', border: '1px solid #059669', borderRadius: '8px', fontSize: '0.9rem', fontWeight: '500', cursor: 'pointer' },
  expiredBox: { padding: '0.75rem', backgroundColor: '#fee2e2', borderRadius: '8px', display: 'flex', justifyContent: 'center', alignItems: 'center' },
  expiredText: { fontSize: '0.9rem', fontWeight: 'bold', color: '#dc2626' },
  regenerateOtpBtn: { width: '100%', padding: '0.75rem', backgroundColor: '#9B0000', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '0.95rem', fontWeight: '600', cursor: 'pointer' },
  resetVaultBtn: { padding: '0.75rem', backgroundColor: '#fff', color: '#6b7280', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '0.95rem', fontWeight: '500', cursor: 'pointer' },
  confirmBtn: { flex: 1, padding: '0.75rem', backgroundColor: '#9B0000', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '0.95rem', fontWeight: '600', cursor: 'pointer' },
  completedState: { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '1.5rem 0' },
  completedText: { marginTop: '0.75rem', color: '#059669', fontSize: '0.9rem', fontWeight: '600' },
  timestamp: { marginTop: '0.75rem', fontSize: '0.75rem', color: '#9ca3af', textAlign: 'right' },
  modal: { backgroundColor: '#fff', borderRadius: '16px', width: '100%', maxWidth: 450, overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: '90vh' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.25rem 1.5rem', borderBottom: '1px solid #e5e7eb', flexShrink: 0, backgroundColor: '#fff' },
  modalTitle: { fontSize: '1.1rem', fontWeight: 'bold', color: '#1f2937', margin: 0 },
  closeBtn: { background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: '#6b7280' },
  modalBody: { padding: '1.5rem', overflowY: 'auto' },
  formGroup: { marginBottom: '1rem' },
  formLabel: { display: 'block', fontSize: '0.875rem', fontWeight: '600', color: '#374151', marginBottom: '0.5rem' },
  formInput: { width: '100%', padding: '0.75rem', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '1rem', boxSizing: 'border-box' },
  cancelBtn: { padding: '0.75rem 1.25rem', backgroundColor: '#fff', color: '#6b7280', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '0.95rem', fontWeight: '500', cursor: 'pointer' },
  resetBtn: { padding: '0.75rem 1.25rem', backgroundColor: '#fff', color: '#374151', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '0.95rem', fontWeight: '500', cursor: 'pointer' },
  saveBtn: { padding: '0.75rem 1.25rem', backgroundColor: '#9B0000', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '0.95rem', fontWeight: '600', cursor: 'pointer' },
  warningText: { fontSize: '1rem', color: '#1f2937', textAlign: 'center' },
  otpModal: { backgroundColor: '#fff', borderRadius: '16px', width: '100%', maxWidth: 380, overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: '90vh' },
  otpModalHeader: { padding: '1.25rem 1.5rem', borderBottom: '1px solid #e5e7eb', textAlign: 'center', flexShrink: 0 },
  otpModalTitle: { fontSize: '1.1rem', fontWeight: 'bold', color: '#1f2937', margin: 0 },
  otpModalBody: { padding: '1.5rem', overflowY: 'auto', flex: 1 },
  otpCodeBox: { backgroundColor: '#fef2f2', borderRadius: '12px', padding: '1.5rem', textAlign: 'center', marginBottom: '1rem' },
  otpCodeLabel: { display: 'block', fontSize: '0.85rem', color: '#9B0000', fontWeight: '600', marginBottom: '0.5rem' },
  otpCodeValue: { display: 'block', fontSize: '2.5rem', fontWeight: 'bold', color: '#9B0000', letterSpacing: '4px' },
  timerSection: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' },
  timerSectionLabel: { fontSize: '0.9rem', color: '#6b7280' },
  timerSectionValue: { fontSize: '1.25rem', fontWeight: 'bold', color: '#f39c12' },
  progressBarContainer: { height: '8px', backgroundColor: '#e5e7eb', borderRadius: '4px', overflow: 'hidden', marginBottom: '1rem' },
  progressBar: { height: '100%', backgroundColor: '#9B0000', borderRadius: '4px', transition: 'width 1s linear' },
  otpCopyBtn: { width: '100%', padding: '0.875rem', backgroundColor: '#9B0000', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '1rem', fontWeight: '600', cursor: 'pointer' },
  otpCopiedBtn: { width: '100%', padding: '0.875rem', backgroundColor: '#059669', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '1rem', fontWeight: '600', cursor: 'pointer' },
  otpModalFooter: { padding: '1rem 1.5rem', borderTop: '1px solid #e5e7eb', display: 'flex', justifyContent: 'center', flexShrink: 0 },
  otpCloseBtn: { padding: '0.75rem 2rem', backgroundColor: '#fff', color: '#6b7280', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '0.95rem', fontWeight: '500', cursor: 'pointer' },
};

export default Dashboard;