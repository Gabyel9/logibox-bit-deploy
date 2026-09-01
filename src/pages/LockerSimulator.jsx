import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { doc, getDoc, setDoc, addDoc, collection, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { db } from '../config/firebase';
import { hashOTP } from '../utils/otp';
import Navbar from '../components/Navbar';

function LockerSimulator() {
  const { logout, user } = useAuth();
  const navigate = useNavigate();
  const [isMobile, setIsMobile] = useState(false);
  const [vaults, setVaults] = useState([]);
  const [selectedVault, setSelectedVault] = useState(1);
  const [otpInput, setOtpInput] = useState('');
  const [result, setResult] = useState(null);
  const [vaultAnimations, setVaultAnimations] = useState({ 1: null, 2: null, 3: null });
  const [cashDispensing, setCashDispensing] = useState({ 1: false, 2: false, 3: false });
  const [doorState, setDoorState] = useState({ 1: 'closed', 2: 'closed', 3: 'closed' });

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    if (!user) return;
    const vaultsRef = collection(db, 'users', user.uid, 'vaults');
    const unsubscribe = onSnapshot(vaultsRef, (snapshot) => {
      if (snapshot.empty) {
        setVaults([
          { id: 1, status: 'empty', enabled: true },
          { id: 2, status: 'empty', enabled: true },
          { id: 3, status: 'empty', enabled: true },
        ]);
      } else {
        const vaultData = snapshot.docs.map(d => d.data());
        const sortedVaults = vaultData.sort((a, b) => a.id - b.id);
        setVaults(sortedVaults);
      }
    });
    return () => unsubscribe();
  }, [user]);

  const handleLogout = () => {
    logout();
    navigate('/signin');
  };

  const getVaultState = (vault) => {
    if (vaultAnimations[vault.id] === 'opening') return 'opening';
    if (vaultAnimations[vault.id] === 'shake') return 'shake';
    if (vaultAnimations[vault.id] === 'open') return 'open';
    if (vault.otpStatus === 'expired') return 'expired';
    if (vault.otpStatus === 'active') return 'active';
    if (vault.status === 'occupied') return 'occupied';
    if (vault.status === 'assigned') return 'assigned';
    return 'empty';
  };

  const getVaultStyle = (vault) => {
    const state = getVaultState(vault);
    const isSelected = selectedVault === vault.id;

    const stateColors = {
      empty: { door: '#e5e7eb', light: '#9ca3af', label: 'Empty', doorTint: '#f9fafb' },
      assigned: { door: '#fef3c7', light: '#f59e0b', label: 'Assigned', doorTint: '#fffbeb' },
      active: { door: '#dcfce7', light: '#22c55e', label: 'OTP Active', doorTint: '#f0fdf4' },
      expired: { door: '#fee2e2', light: '#ef4444', label: 'OTP Expired', doorTint: '#fef2f2' },
      occupied: { door: '#ede9fe', light: '#7c3aed', label: 'Occupied', doorTint: '#f5f3ff' },
      opening: { door: '#d1fae5', light: '#059669', label: 'Opening...', doorTint: '#ecfdf5' },
      open: { door: '#d1fae5', light: '#059669', label: 'Opening...', doorTint: '#ecfdf5' },
      shake: { door: '#fee2e2', light: '#ef4444', label: 'Try Again', doorTint: '#fef2f2' },
    };

    const colors = stateColors[state] || stateColors.empty;

    return {
      isSelected,
      colors,
      state,
    };
  };

  const triggerAnimation = (vaultId, animationType, duration) => {
    setVaultAnimations(prev => ({ ...prev, [vaultId]: animationType }));
    setTimeout(() => {
      setVaultAnimations(prev => ({ ...prev, [vaultId]: null }));
    }, duration);
  };

  const selectedVaultData = vaults.find(v => v.id === selectedVault);
  const isVaultOccupied = selectedVaultData?.status === 'occupied';

  const handleVerifyOTP = async () => {
    if (!otpInput || otpInput.length !== 6) {
      setResult({ type: 'error', message: 'Please enter a 6-digit OTP' });
      return;
    }

    if (!user) return;

    setResult(null);
    const vaultDocRef = doc(db, 'users', user.uid, 'vaults', selectedVault.toString());

    try {
      const vaultDoc = await getDoc(vaultDocRef);
      if (!vaultDoc.exists()) {
        setResult({ type: 'error', message: 'Vault not found' });
        return;
      }

      const vault = vaultDoc.data();

      if (vault.otpStatus !== 'active') {
        setResult({ type: 'error', message: 'No active OTP for this vault' });
        return;
      }

      if (vault.otpExpiresAt) {
        const expiresAt = new Date(vault.otpExpiresAt).getTime();
        if (Date.now() >= expiresAt) {
          await setDoc(vaultDocRef, { otpStatus: 'expired' }, { merge: true });
          triggerAnimation(selectedVault, 'shake', 500);
          setResult({ type: 'error', message: 'OTP has expired' });
          return;
        }
      }

      const enteredHash = await hashOTP(otpInput);

      if (enteredHash !== vault.otpHash) {
        triggerAnimation(selectedVault, 'shake', 500);
        setResult({ type: 'error', message: 'Incorrect OTP, please try again' });
        return;
      }

      // Animation sequence: door open -> door close -> cash dispense -> write occupied
      // 0ms: door open
      setDoorState(prev => ({ ...prev, [selectedVault]: 'opening' }));
      triggerAnimation(selectedVault, 'opening', 600);

      // 1200ms: door close
      setTimeout(() => {
        setDoorState(prev => ({ ...prev, [selectedVault]: 'closing' }));
      }, 1200);

      // 2000ms: cash dispense
      setTimeout(() => {
        setCashDispensing(prev => ({ ...prev, [selectedVault]: true }));
      }, 2000);

      // 3000ms: write occupied status
      setTimeout(async () => {
        await setDoc(vaultDocRef, {
          status: 'occupied',
          otpHash: null,
          otpEncrypted: null,
          otpStatus: null,
          otpCreatedAt: null,
          otpExpiresAt: null,
          lastOtpGeneratedAt: null,
        }, { merge: true });

        await addDoc(collection(db, 'users', user.uid, 'activityLogs'), {
          action: 'OTP Verified (Simulator)',
          details: `Vault ${selectedVault} opened by rider — parcel deposited`,
          vaultId: selectedVault,
          timestamp: serverTimestamp(),
        });

        setResult({ type: 'success', message: `Parcel deposited — Vault ${selectedVault} is now occupied` });
        setDoorState(prev => ({ ...prev, [selectedVault]: 'closed' }));
      }, 3000);

      // 3500ms: clear OTP input
      setTimeout(() => {
        setOtpInput('');
      }, 3500);

      // 3500ms: stop cash dispensing
      setTimeout(() => {
        setCashDispensing(prev => ({ ...prev, [selectedVault]: false }));
      }, 3500);

    } catch (err) {
      console.error('Verification error:', err);
      setResult({ type: 'error', message: 'Verification failed: ' + err.message });
    }
  };

  const renderLockerUnit = (vault) => {
    const { isSelected, colors, state } = getVaultStyle(vault);
    const isOpening = state === 'opening' || doorState[vault.id] === 'opening';
    const isClosing = doorState[vault.id] === 'closing';
    const isShake = state === 'shake';
    const isDispensing = cashDispensing[vault.id];

    let doorTransform = 'perspective(400px) rotateY(0deg)';
    if (isOpening) doorTransform = 'perspective(400px) rotateY(-110deg)';
    else if (isClosing) doorTransform = 'perspective(400px) rotateY(0deg)';

    return (
      <div
        key={vault.id}
        style={{
          ...styles.lockerUnit,
          border: isSelected ? '3px solid #8B0000' : '1px solid #d1d5db',
          boxShadow: isSelected ? '0 0 20px rgba(139, 0, 0, 0.4)' : '0 2px 8px rgba(0,0,0,0.1)',
          animation: isShake ? 'lockerShake 0.5s ease' : 'none',
        }}
      >
        <div style={styles.lockerBody}>
          <div
            style={{
              ...styles.vaultDoor,
              backgroundColor: colors.door,
              transform: doorTransform,
              transition: isOpening || isClosing ? 'transform 600ms ease-in-out' : 'none',
            }}
          >
            <div style={styles.vaultDoorInner}>
              <div
                style={{
                  ...styles.statusLight,
                  backgroundColor: colors.light,
                  boxShadow: isOpening ? '0 0 12px ' + colors.light : 'none',
                  animation: isOpening ? 'lightPulse 0.5s ease infinite' : 'none',
                }}
              />
            </div>
          </div>
          {/* Cash Slot */}
          <div style={styles.cashSlot}>
            <div
              style={{
                ...styles.cashDispense,
                transform: isDispensing ? 'translateY(100%)' : 'translateY(0)',
                transition: isDispensing ? 'transform 800ms ease-out' : 'transform 600ms ease-in',
              }}
            >
              <div style={styles.cashAmount}>
                ₱{vault.deliveryFee || '0'}
              </div>
            </div>
          </div>
        </div>
        <div style={styles.lockerLabel}>Vault {vault.id}</div>
        <div style={{ ...styles.statusLabel, color: colors.light }}>{colors.label}</div>
      </div>
    );
  };

  return (
    <div style={styles.layout}>
      <style>
        {`
          @keyframes lockerShake {
            0%, 100% { transform: translateX(0); }
            15% { transform: translateX(-8px); }
            30% { transform: translateX(8px); }
            45% { transform: translateX(-6px); }
            60% { transform: translateX(6px); }
            75% { transform: translateX(-3px); }
            90% { transform: translateX(3px); }
          }
          @keyframes lightPulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.3; }
          }
        `}
      </style>

      <Navbar currentPath="/simulator" onNavigate={navigate} onLogout={handleLogout} />

      <main style={styles.main}>
        <div style={{ ...styles.content, padding: isMobile ? '1rem' : '2rem' }}>
          <h1 style={{
            ...styles.pageTitle,
            fontSize: isMobile ? '1.5rem' : '1.75rem',
            marginBottom: '0.4rem',
          }}>
            Hardware Simulator
          </h1>
          <p style={styles.pageSubtitle}>Simulated locker hardware interface for OTP testing</p>

          {/* Section 1: Visual Locker Bank */}
          <div style={styles.section}>
            <h2 style={styles.sectionHeader}>Visual Locker Bank</h2>
            <div style={styles.lockerBank}>
              {vaults.map(vault => renderLockerUnit(vault))}
            </div>
          </div>

          {/* Section 2: Live Vault Status Cards */}
          <div style={styles.section}>
            <h2 style={styles.sectionHeader}>Live Vault Status</h2>
            <div style={{
              ...styles.vaultCardsGrid,
              gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)',
            }}>
              {vaults.map(vault => (
                <div key={vault.id} style={styles.vaultCard}>
                  <div style={styles.vaultCardHeader}>
                    <span style={styles.vaultCardNumber}>Vault {vault.id}</span>
                    <span style={{
                      ...styles.vaultCardBadge,
                      backgroundColor: vault.status === 'empty' ? '#e5e7eb' : vault.status === 'completed' ? '#d1fae5' : vault.status === 'occupied' ? '#ede9fe' : '#fef3c7',
                      color: vault.status === 'empty' ? '#6b7280' : vault.status === 'completed' ? '#059669' : vault.status === 'occupied' ? '#7c3aed' : '#92400e',
                    }}>
                      {vault.status === 'empty' ? 'Empty' : vault.status === 'completed' ? 'Completed' : vault.status === 'occupied' ? 'Occupied' : vault.status}
                    </span>
                  </div>
                  <div style={styles.vaultCardDetails}>
                    {vault.receiverName && (
                      <div style={styles.vaultCardRow}>
                        <span style={styles.vaultCardLabel}>Receiver:</span>
                        <span style={styles.vaultCardValue}>{vault.receiverName}</span>
                      </div>
                    )}
                    <div style={styles.vaultCardRow}>
                      <span style={styles.vaultCardLabel}>OTP Status:</span>
                      <span style={{
                        ...styles.vaultCardValue,
                        color: vault.otpStatus === 'active' ? '#22c55e' : vault.otpStatus === 'expired' ? '#ef4444' : '#9ca3af',
                      }}>
                        {vault.otpStatus || 'None'}
                      </span>
                    </div>
                    {vault.otpStatus === 'active' && (
                      <div style={styles.vaultCardRow}>
                        <span style={styles.vaultCardLabel}>OTP Active:</span>
                        <span style={{ ...styles.vaultCardValue, color: '#22c55e' }}>Yes</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Section 3: Keypad Panel */}
          <div style={styles.section}>
            <h2 style={styles.sectionHeader}>Keypad Panel</h2>

            <div style={styles.simulatorBanner}>
              ⚙ Hardware Simulator — This page simulates the physical locker keypad. OTP verification runs client-side. In production this is replaced by the hardware SDK.
            </div>

            <div style={styles.keypadPanel}>
              <div style={styles.formGroup}>
                <label style={styles.formLabel}>Select Vault</label>
                <select
                  style={styles.selectInput}
                  value={selectedVault}
                  onChange={(e) => setSelectedVault(Number(e.target.value))}
                >
                  <option value={1}>Vault 1</option>
                  <option value={2}>Vault 2</option>
                  <option value={3}>Vault 3</option>
                </select>
              </div>

              {isVaultOccupied ? (
                <div style={{
                  backgroundColor: '#ede9fe',
                  borderRadius: '10px',
                  padding: '1rem',
                  textAlign: 'center',
                  color: '#7c3aed',
                  fontWeight: 700,
                  fontSize: '0.875rem',
                }}>
                  Vault {selectedVault} is occupied — waiting for admin to confirm delivery
                </div>
              ) : (
                <>
                  <div style={styles.formGroup}>
                    <label style={styles.formLabel}>Enter OTP</label>
                    <input
                      type="text"
                      style={styles.otpInput}
                      placeholder="000000"
                      value={otpInput}
                      onChange={(e) => {
                        const val = e.target.value.replace(/\D/g, '').slice(0, 6);
                        setOtpInput(val);
                      }}
                      maxLength={6}
                    />
                  </div>

                  <button
                    style={styles.verifyBtn}
                    onClick={handleVerifyOTP}
                  >
                    Verify OTP
                  </button>
                </>
              )}

              {result && (
                <div style={{
                  ...styles.resultBox,
                  backgroundColor: result.type === 'success' ? '#d1fae5' : '#fee2e2',
                  color: result.type === 'success' ? '#059669' : '#dc2626',
                }}>
                  {result.message}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

const styles = {
  layout: {
    display: 'flex',
    flexDirection: 'column',
    minHeight: '100vh',
    backgroundColor: '#f4f5f7',
    fontFamily: 'var(--font)',
  },
  main: {
    flex: 1,
    minWidth: 0,
  },
  content: {
    padding: '2rem',
    maxWidth: 1200,
    margin: '0 auto',
  },
  pageTitle: {
    fontSize: '1.75rem',
    fontWeight: 800,
    color: '#0f172a',
    marginBottom: '0.5rem',
    marginTop: 0,
  },
  pageSubtitle: {
    fontSize: '0.875rem',
    color: '#6b7280',
    margin: 0,
    marginBottom: '2rem',
  },
  section: {
    marginBottom: '2rem',
  },
  sectionHeader: {
    fontSize: '1rem',
    fontWeight: 700,
    color: '#1f2937',
    marginBottom: '1rem',
  },
  lockerBank: {
    display: 'flex',
    justifyContent: 'center',
    gap: '2rem',
    flexWrap: 'wrap',
    padding: '1.5rem',
    backgroundColor: '#fff',
    borderRadius: '14px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
    border: '1px solid #f0f1f3',
  },
  lockerUnit: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '1rem',
    borderRadius: '12px',
    backgroundColor: '#fff',
    minWidth: 120,
    transition: 'all 0.2s ease',
  },
  lockerBody: {
    width: 80,
    height: 100,
    position: 'relative',
    perspective: '400px',
  },
  vaultDoor: {
    width: '100%',
    height: '100%',
    borderRadius: '8px',
    position: 'absolute',
    top: 0,
    left: 0,
    transformOrigin: 'left center',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  vaultDoorInner: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '0.5rem',
  },
  cashSlot: {
    position: 'absolute',
    bottom: 10,
    left: '50%',
    transform: 'translateX(-50%)',
    width: 40,
    height: 12,
    backgroundColor: '#374151',
    borderRadius: 2,
    overflow: 'hidden',
    zIndex: 10,
  },
  cashDispense: {
    width: '100%',
    height: '100%',
    backgroundColor: '#22c55e',
    borderRadius: 2,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cashAmount: {
    fontSize: '0.5rem',
    fontWeight: 700,
    color: '#fff',
  },
  statusLight: {
    width: 16,
    height: 16,
    borderRadius: '50%',
    transition: 'all 0.2s ease',
  },
  lockerLabel: {
    marginTop: '0.75rem',
    fontSize: '0.875rem',
    fontWeight: 700,
    color: '#1f2937',
  },
  statusLabel: {
    fontSize: '0.75rem',
    fontWeight: 600,
    marginTop: '0.25rem',
  },
  vaultCardsGrid: {
    display: 'grid',
    gap: '1rem',
  },
  vaultCard: {
    backgroundColor: '#fff',
    borderRadius: '14px',
    border: '1px solid #f0f1f3',
    boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
    padding: '1.25rem',
  },
  vaultCardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '0.75rem',
  },
  vaultCardNumber: {
    fontSize: '1rem',
    fontWeight: 700,
    color: '#1f2937',
  },
  vaultCardBadge: {
    padding: '0.25rem 0.75rem',
    borderRadius: '99px',
    fontSize: '0.7rem',
    fontWeight: 700,
    textTransform: 'uppercase',
  },
  vaultCardDetails: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  },
  vaultCardRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '0.875rem',
  },
  vaultCardLabel: {
    color: '#6b7280',
  },
  vaultCardValue: {
    color: '#1f2937',
    fontWeight: 600,
  },
  simulatorBanner: {
    backgroundColor: '#fffbeb',
    border: '1px solid #fcd34d',
    borderRadius: '10px',
    padding: '0.75rem 1rem',
    fontSize: '0.8rem',
    color: '#92400e',
    marginBottom: '1.5rem',
  },
  keypadPanel: {
    backgroundColor: '#fff',
    borderRadius: '14px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
    border: '1px solid #f0f1f3',
    padding: '1.5rem',
  },
  formGroup: {
    marginBottom: '1rem',
  },
  formLabel: {
    display: 'block',
    fontSize: '0.8125rem',
    fontWeight: 600,
    color: '#374151',
    marginBottom: '0.5rem',
  },
  selectInput: {
    width: '100%',
    padding: '0.75rem',
    border: '1.5px solid #e8eaed',
    borderRadius: '10px',
    fontSize: '1rem',
    boxSizing: 'border-box',
    backgroundColor: '#fafafa',
    fontFamily: 'var(--font)',
  },
  otpInput: {
    width: '100%',
    padding: '0.75rem',
    border: '1.5px solid #e8eaed',
    borderRadius: '10px',
    fontSize: '1.5rem',
    textAlign: 'center',
    letterSpacing: '8px',
    boxSizing: 'border-box',
    fontFamily: 'var(--font)',
  },
  verifyBtn: {
    width: '100%',
    padding: '0.75rem',
    backgroundColor: '#8B0000',
    color: '#fff',
    border: 'none',
    borderRadius: '10px',
    fontSize: '1rem',
    fontWeight: 700,
    cursor: 'pointer',
    minHeight: '44px',
    fontFamily: 'var(--font)',
    marginTop: '0.5rem',
  },
  resultBox: {
    borderRadius: '10px',
    padding: '1rem',
    textAlign: 'center',
    fontWeight: 700,
    marginTop: '1rem',
  },
};

export default LockerSimulator;