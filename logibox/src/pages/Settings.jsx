import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { updatePassword, reauthenticateWithCredential, EmailAuthProvider } from 'firebase/auth';
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import Navbar from '../components/Navbar';
import { LayoutDashboard, Camera, ClipboardList, Settings as SettingsIcon, HelpCircle } from 'lucide-react';

function EyeIcon({ visible }) {
  return visible ? (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  );
}

function PasswordField({ label, value, onChange, placeholder }) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ marginBottom: '1rem' }}>
      <label style={styles.formLabel}>{label} <span style={{ color: '#9B0000' }}>*</span></label>
      <div style={styles.passwordWrapper}>
        <input
          className="input-animate"
          type={show ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          style={styles.formInput}
          required
        />
        <button
          type="button"
          style={styles.eyeBtn}
          onClick={() => setShow(v => !v)}
          tabIndex={-1}
        >
          <EyeIcon visible={show} />
        </button>
      </div>
    </div>
  );
}

function CheckItem({ passed, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
      {passed ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="#22c55e">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="#d1d5db">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11H7v-2h10v2z"/>
        </svg>
      )}
      <span style={{ fontSize: '0.8rem', color: passed ? '#22c55e' : '#6b7280' }}>{label}</span>
    </div>
  );
}

function getPasswordStrength(password) {
  if (!password) return { width: 0, color: '#e5e7eb', label: '' };
  if (password.length < 6) return { width: 25, color: '#ef4444', label: 'Too Short' };
  const hasUpper = /[A-Z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecial = /[!@#$%^&*]/.test(password);
  const isLong = password.length >= 8;
  if (isLong && hasUpper && hasNumber && hasSpecial) return { width: 100, color: '#22c55e', label: 'Strong' };
  if (isLong && hasUpper && hasNumber) return { width: 75, color: '#eab308', label: 'Fair' };
  return { width: 50, color: '#f97316', label: 'Weak' };
}

function Settings() {
  const { logout, user } = useAuth();
  const { settings } = useSettings();
  const navigate = useNavigate();
  const [isMobile, setIsMobile] = useState(false);

  // Profile
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');

  // OTP
  const [otpDuration, setOtpDuration] = useState(5);

  // Vaults
  const [vaults, setVaults] = useState([
    { id: 1, enabled: true },
    { id: 2, enabled: true },
    { id: 3, enabled: true },
  ]);

  // Success messages
  const [profileSuccess, setProfileSuccess] = useState(false);
  const [otpSuccess, setOtpSuccess] = useState(false);
  const [vaultSuccess, setVaultSuccess] = useState(false);

  // Password
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [isGoogleUser, setIsGoogleUser] = useState(false);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    if (!user) return;
    const loadUserData = async () => {
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      if (userDoc.exists()) {
        const data = userDoc.data();
        setFirstName(data.firstName || '');
        setLastName(data.lastName || '');
        setEmail(user.email || '');
        setOtpDuration(data.otpDuration || 5);
      } else {
        setEmail(user.email || '');
      }
    };
    loadUserData();
    const unsubscribe = onSnapshot(doc(db, 'users', user.uid), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setOtpDuration(data.otpDuration || 5);
      }
    });
    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const loadVaults = async () => {
      const vaultData = [];
      for (let i = 1; i <= 3; i++) {
        const vaultDoc = await getDoc(doc(db, 'users', user.uid, 'vaults', i.toString()));
        vaultData.push({ id: i, enabled: vaultDoc.exists() ? vaultDoc.data().enabled !== false : true });
      }
      setVaults(vaultData);
    };
    loadVaults();
    const unsubscribes = [];
    for (let i = 1; i <= 3; i++) {
      const unsub = onSnapshot(doc(db, 'users', user.uid, 'vaults', i.toString()), (docSnap) => {
        if (docSnap.exists()) {
          setVaults(prev => prev.map(v => v.id === i ? { ...v, enabled: docSnap.data().enabled !== false } : v));
        }
      });
      unsubscribes.push(unsub);
    }
    return () => unsubscribes.forEach(u => u());
  }, [user]);

  useEffect(() => {
    if (auth.currentUser) {
      setIsGoogleUser(auth.currentUser.providerData.some(p => p.providerId === 'google.com'));
    }
  }, []);

  const handleLogout = () => { logout(); navigate('/signin'); };

  const showSuccess = (setter) => {
    setter(true);
    setTimeout(() => setter(false), 2000);
  };

  const saveProfile = async () => {
    if (!user) return;
    await setDoc(doc(db, 'users', user.uid), { firstName, lastName, email }, { merge: true });
    showSuccess(setProfileSuccess);
  };

  const saveOtpSettings = async () => {
    if (!user) return;
    await setDoc(doc(db, 'users', user.uid), { otpDuration }, { merge: true });
    showSuccess(setOtpSuccess);
  };

  const saveVaultSettings = async () => {
    if (!user) return;
    for (const vault of vaults) {
      await setDoc(doc(db, 'users', user.uid, 'vaults', vault.id.toString()), { enabled: vault.enabled }, { merge: true });
    }
    showSuccess(setVaultSuccess);
  };

  const toggleVault = (id) => {
    setVaults(prev => prev.map(v => v.id === id ? { ...v, enabled: !v.enabled } : v));
  };

  const handleChangePassword = async () => {
    setPasswordError('');
    setPasswordSuccess('');
    if (newPassword.length < 6) { setPasswordError('Password must be at least 6 characters'); return; }
    if (newPassword !== confirmPassword) { setPasswordError('Passwords do not match'); return; }
    if (isGoogleUser) { setPasswordError('Google accounts cannot change password here'); return; }
    try {
      const credential = EmailAuthProvider.credential(auth.currentUser.email, currentPassword);
      await reauthenticateWithCredential(auth.currentUser, credential);
      await updatePassword(auth.currentUser, newPassword);
      setPasswordSuccess('Password changed successfully');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setPasswordError(err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential'
        ? 'Current password is incorrect'
        : err.message);
    }
  };

  const strength = getPasswordStrength(newPassword);
  const hasUpper = /[A-Z]/.test(newPassword);
  const hasNumber = /[0-9]/.test(newPassword);
  const isLong = newPassword.length >= 8;

  return (
    <div style={styles.layout}>
      <Navbar currentPath="/settings" onNavigate={navigate} onLogout={handleLogout} />

      {/* MAIN */}
      <main className="page-enter" style={styles.main}>
        <div style={{ ...styles.content, padding: isMobile ? '1rem' : '2rem' }}>
          <h1 style={{ ...styles.pageTitle, fontSize: isMobile ? '1.5rem' : '1.75rem' }}>Settings</h1>

          {/* SECTION 1 - Profile */}
          <div style={styles.section}>
            <h2 style={styles.sectionTitle}>Profile Settings</h2>
            <div className="card-enter" style={styles.card}>
              <div style={styles.formGroup}>
                <label style={styles.formLabel}>First Name</label>
                <input className="input-animate" type="text" style={styles.formInput} value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Enter first name" />
              </div>
              <div style={styles.formGroup}>
                <label style={styles.formLabel}>Last Name</label>
                <input className="input-animate" type="text" style={styles.formInput} value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Enter last name" />
              </div>
              <div style={styles.formGroup}>
                <label style={styles.formLabel}>Email</label>
                <input type="email" style={{ ...styles.formInput, backgroundColor: '#f3f4f6', cursor: 'not-allowed' }} value={email} disabled />
              </div>
              <button className="btn-animate" style={styles.saveBtn} onClick={saveProfile}>Save Profile</button>
              {profileSuccess && <span className="success-enter" style={styles.successMsg}>✓ Saved successfully</span>}
            </div>
          </div>

          {/* SECTION 2 - OTP (no auto-expire toggle) */}
          <div style={styles.section}>
            <h2 style={styles.sectionTitle}>OTP Configuration</h2>
            <div className="card-enter" style={styles.card}>
              <div style={styles.formGroup}>
                <label style={styles.formLabel}>OTP Duration</label>
                <p style={styles.formHint}>How long the OTP stays valid after it is generated.</p>
                <div style={styles.sliderContainer}>
                  <input
                    type="range"
                    min="1"
                    max="10"
                    value={otpDuration}
                    onChange={(e) => setOtpDuration(Number(e.target.value))}
                    style={styles.slider}
                  />
                  <span style={styles.sliderValue}>{otpDuration} min</span>
                </div>
              </div>
              <button className="btn-animate" style={styles.saveBtn} onClick={saveOtpSettings}>Save OTP Settings</button>
              {otpSuccess && <span className="success-enter" style={styles.successMsg}>✓ Saved successfully</span>}
            </div>
          </div>

          {/* SECTION 3 - Vault Configuration */}
          <div style={styles.section}>
            <h2 style={styles.sectionTitle}>Vault Configuration</h2>
            <p style={styles.sectionHint}>Turn a vault ON to allow deliveries. Turn it OFF to disable it and hide it from the dashboard.</p>
            <div className="card-enter" style={styles.card}>
              {vaults.map((vault) => (
                <div key={vault.id} style={styles.vaultRow}>
                  <div>
                    <div style={styles.vaultLabel}>Vault {vault.id}</div>
                    <div style={{ fontSize: '0.78rem', color: vault.enabled ? '#22c55e' : '#9ca3af', marginTop: 2 }}>
                      {vault.enabled ? 'Active — accepting deliveries' : 'Disabled — hidden from dashboard'}
                    </div>
                  </div>
                  <button
                    className="toggle-animate"
                    style={{ ...styles.toggle, backgroundColor: vault.enabled ? '#9B0000' : '#d1d5db' }}
                    onClick={() => toggleVault(vault.id)}
                  >
                    <span className="toggle-thumb" style={{ ...styles.toggleKnob, transform: vault.enabled ? 'translateX(20px)' : 'translateX(0px)' }} />
                  </button>
                </div>
              ))}
              <button className="btn-animate" style={{ ...styles.saveBtn, marginTop: '1rem' }} onClick={saveVaultSettings}>Save Vault Settings</button>
              {vaultSuccess && <span className="success-enter" style={styles.successMsg}>✓ Saved successfully</span>}
            </div>
          </div>

          {/* SECTION 4 - Change Password */}
          <div style={styles.section}>
            <h2 style={styles.sectionTitle}>Change Password</h2>
            <div className="card-enter" style={styles.card}>
              {isGoogleUser ? (
                <div style={styles.googleMsg}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="#9ca3af" style={{ flexShrink: 0 }}>
                    <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
                  </svg>
                  Password change is not available for Google accounts.
                </div>
              ) : (
                <>
                  {/* Header inside card */}
                  <div style={styles.passwordCardHeader}>
                    <div style={styles.passwordLockIcon}>
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="#6b7280">
                        <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
                      </svg>
                    </div>
                    <div>
                      <div style={{ fontWeight: '600', color: '#1f2937', fontSize: '0.95rem' }}>Change Password</div>
                      <div style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: 2 }}>Update password for enhanced account security.</div>
                    </div>
                  </div>

                  <div style={styles.passwordDivider} />

                  <PasswordField
                    label="Current Password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Enter current password"
                  />

                  <PasswordField
                    label="New Password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter new password"
                  />

                  <PasswordField
                    label="Confirm New Password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm new password"
                  />

                  {/* Strength bar */}
                  {newPassword.length > 0 && (
                    <div style={{ marginBottom: '1rem' }}>
                      <div style={styles.strengthBarContainer}>
                        <div style={{ ...styles.strengthBar, width: `${strength.width}%`, backgroundColor: strength.color }} />
                      </div>
                      <div style={{ fontSize: '0.78rem', color: strength.color, marginTop: '0.25rem', fontWeight: '500' }}>
                        {strength.label} password. Must contain;
                      </div>
                      <div style={{ marginTop: '0.5rem' }}>
                        <CheckItem passed={hasUpper} label="At least 1 uppercase" />
                        <CheckItem passed={hasNumber} label="At least 1 number" />
                        <CheckItem passed={isLong} label="At least 8 characters" />
                      </div>
                    </div>
                  )}

                  {passwordError && (
                    <div style={styles.errorMsg}>{passwordError}</div>
                  )}
                  {passwordSuccess && (
                    <div className="success-enter" style={styles.successMsg}>✓ {passwordSuccess}</div>
                  )}

                  <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
                    <button
                      className="btn-animate"
                      style={styles.discardBtn}
                      onClick={() => { setCurrentPassword(''); setNewPassword(''); setConfirmPassword(''); setPasswordError(''); setPasswordSuccess(''); }}
                    >
                      Discard
                    </button>
                    <button className="btn-animate" style={styles.applyBtn} onClick={handleChangePassword}>
                      Apply Changes
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}

const styles = {
  layout: { display: 'flex', flexDirection: 'column', minHeight: '100vh', backgroundColor: '#f5f6fa' },
  main: { flex: 1, minWidth: 0 },
  content: { padding: '2rem', maxWidth: 800, margin: '0 auto' },
  pageTitle: { fontSize: '1.75rem', fontWeight: 'bold', color: '#1f2937', marginBottom: '1.5rem', marginTop: 0 },
  section: { marginBottom: '2rem' },
  sectionTitle: { fontSize: '1.1rem', fontWeight: '600', color: '#1f2937', marginBottom: '0.4rem' },
  sectionHint: { fontSize: '0.82rem', color: '#6b7280', marginBottom: '0.75rem', marginTop: 0 },
  card: { backgroundColor: '#fff', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', padding: '1.5rem' },
  formGroup: { marginBottom: '1rem' },
  formLabel: { display: 'block', fontSize: '0.875rem', fontWeight: '600', color: '#374151', marginBottom: '0.5rem' },
  formHint: { fontSize: '0.78rem', color: '#6b7280', marginTop: '-0.25rem', marginBottom: '0.5rem' },
  formInput: { width: '100%', padding: '0.75rem', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '1rem', boxSizing: 'border-box' },
  passwordWrapper: { position: 'relative', width: '100%' },
  eyeBtn: { position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', padding: '0.25rem', display: 'flex', alignItems: 'center' },
  saveBtn: { padding: '0.75rem 1.25rem', backgroundColor: '#9B0000', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '0.95rem', fontWeight: '600', cursor: 'pointer', marginTop: '0.5rem' },
  discardBtn: { flex: 1, padding: '0.75rem', backgroundColor: '#fff', color: '#374151', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '0.95rem', fontWeight: '500', cursor: 'pointer' },
  applyBtn: { flex: 1, padding: '0.75rem', backgroundColor: '#9B0000', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '0.95rem', fontWeight: '600', cursor: 'pointer' },
  successMsg: { display: 'block', color: '#22c55e', fontSize: '0.85rem', marginTop: '0.5rem', fontWeight: '500' },
  errorMsg: { display: 'block', color: '#ef4444', fontSize: '0.85rem', marginTop: '0.25rem', marginBottom: '0.5rem' },
  sliderContainer: { display: 'flex', alignItems: 'center', gap: '1rem' },
  slider: { flex: 1, height: '6px', appearance: 'none', background: '#d1d5db', borderRadius: '3px', outline: 'none' },
  sliderValue: { fontSize: '0.9rem', color: '#374151', minWidth: '50px', fontWeight: '600' },
  vaultRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.85rem 0', borderBottom: '1px solid #e5e7eb' },
  vaultLabel: { fontSize: '0.95rem', fontWeight: '600', color: '#1f2937' },
  toggle: { width: 48, height: 28, borderRadius: 14, border: 'none', cursor: 'pointer', position: 'relative', padding: 0, flexShrink: 0 },
  toggleKnob: { position: 'absolute', top: 2, left: 2, width: 24, height: 24, backgroundColor: '#fff', borderRadius: '50%', display: 'block' },
  strengthBarContainer: { height: '6px', backgroundColor: '#e5e7eb', borderRadius: '3px', overflow: 'hidden' },
  strengthBar: { height: '100%', transition: 'width 0.3s ease, background-color 0.3s ease', borderRadius: '3px' },
  passwordCardHeader: { display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' },
  passwordLockIcon: { width: 44, height: 44, borderRadius: '50%', backgroundColor: '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  passwordDivider: { height: '1px', backgroundColor: '#e5e7eb', marginBottom: '1.25rem' },
  googleMsg: { display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#6b7280', fontSize: '0.9rem' },
};

export default Settings;