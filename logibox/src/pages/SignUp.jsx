import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

function EyeIcon({ visible }) {
  return visible ? (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  ) : (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  );
}

function PasswordInput({ value, onChange, placeholder, name, error }) {
  const [visible, setVisible] = useState(false);
  return (
    <div>
      <div style={styles.passwordWrapper}>
        <input
          className="input-animate"
          type={visible ? 'text' : 'password'}
          name={name}
          value={value}
          onChange={onChange}
          style={{
            ...styles.input,
            borderColor: error ? '#ef4444' : '#d1d5db',
          }}
          placeholder={placeholder}
          required
        />
        <button
          type="button"
          style={styles.eyeBtn}
          onClick={() => setVisible(v => !v)}
          tabIndex={-1}
          aria-label={visible ? 'Hide password' : 'Show password'}
        >
          <EyeIcon visible={visible} />
        </button>
      </div>
      {error && (
        <div style={styles.fieldError}>{error}</div>
      )}
    </div>
  );
}

const getPasswordStrength = (password) => {
  if (!password) return { width: 0, color: '#e5e7eb', label: '' };
  const metCount = [
    password.length >= 8,
    /[A-Z]/.test(password),
    /[a-z]/.test(password),
    /[0-9]/.test(password),
    /[!@#$%^&*]/.test(password),
  ].filter(Boolean).length;
  if (metCount <= 1) return { width: 20, color: '#ef4444', label: 'Very Weak' };
  if (metCount === 2) return { width: 40, color: '#f97316', label: 'Weak' };
  if (metCount === 3) return { width: 60, color: '#eab308', label: 'Fair' };
  if (metCount === 4) return { width: 80, color: '#3b82f6', label: 'Good' };
  return { width: 100, color: '#22c55e', label: 'Strong' };
};

function SignUp() {
  const [isMobile, setIsMobile] = useState(false);
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  const [loading, setLoading] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [generalError, setGeneralError] = useState('');
  const { signup } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const handleChange = (e) => {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
    setPasswordError('');
    setGeneralError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setPasswordError('');
    setGeneralError('');

    if (formData.password.length < 8) {
      setPasswordError('Password must be at least 8 characters');
      setLoading(false);
      return;
    }

    if (formData.password !== formData.confirmPassword) {
      setPasswordError('Passwords do not match');
      setLoading(false);
      return;
    }

    try {
      await signup(
        formData.email,
        formData.password,
        formData.firstName,
        formData.lastName
      );
      navigate('/dashboard');
    } catch (err) {
      setGeneralError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const requirements = [
    { label: 'At least 8 characters', met: formData.password.length >= 8 },
    { label: 'At least 1 uppercase letter (A–Z)', met: /[A-Z]/.test(formData.password) },
    { label: 'At least 1 lowercase letter (a–z)', met: /[a-z]/.test(formData.password) },
    { label: 'At least 1 number (0–9)', met: /[0-9]/.test(formData.password) },
    { label: 'At least 1 special character (!@#$%^&*)', met: /[!@#$%^&*]/.test(formData.password) },
  ];

  const passwordStrength = getPasswordStrength(formData.password);

  return (
    <div style={styles.container}>
      <div
        className="page-enter"
        style={{
          ...styles.card,
          padding: isMobile ? '1.75rem 1.25rem' : '2.5rem',
        }}
      >
        <div style={styles.logoContainer}>
          <img src="/LOGO LOGIBOX.png" alt="LogiBox" style={styles.logo} />
        </div>

        <h1 style={styles.title}>Create Account</h1>
        <p style={styles.subtitle}>Get started with LogiBox</p>

        {generalError && (
          <div style={styles.error}>{generalError}</div>
        )}

        <form onSubmit={handleSubmit} style={styles.form}>

          {/* First Name + Last Name */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
            gap: isMobile ? '1.25rem' : '1rem',
          }}>
            <div style={styles.formGroup}>
              <label style={styles.label}>First Name</label>
              <input
                className="input-animate"
                type="text"
                name="firstName"
                value={formData.firstName}
                onChange={handleChange}
                style={styles.input}
                placeholder="First name"
                required
              />
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Last Name</label>
              <input
                className="input-animate"
                type="text"
                name="lastName"
                value={formData.lastName}
                onChange={handleChange}
                style={styles.input}
                placeholder="Last name"
                required
              />
            </div>
          </div>

          {/* Email */}
          <div style={styles.formGroup}>
            <label style={styles.label}>Email</label>
            <input
              className="input-animate"
              type="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              style={styles.input}
              placeholder="Enter your email"
              required
            />
          </div>

          {/* Password */}
          <div style={styles.formGroup}>
            <label style={styles.label}>Password</label>
            <PasswordInput
              name="password"
              value={formData.password}
              onChange={handleChange}
              placeholder="Create a password"
              error={passwordError && !formData.confirmPassword ? passwordError : ''}
            />

            {/* Strength bar */}
            {formData.password.length > 0 && (
              <div style={{ marginTop: '0.4rem' }}>
                <div style={styles.strengthBarContainer}>
                  <div style={{ ...styles.strengthBar, width: `${passwordStrength.width}%`, backgroundColor: passwordStrength.color }} />
                </div>
                <span style={{ ...styles.strengthLabel, color: passwordStrength.color }}>{passwordStrength.label}</span>
              </div>
            )}

            {/* Requirements checklist */}
            {formData.password.length > 0 && (
              <div style={styles.requirementsBox}>
                <p style={styles.requirementsTitle}>Password must contain:</p>
                {requirements.map((req, i) => (
                  <div key={i} style={styles.requirementRow}>
                    {req.met
                      ? <svg width="16" height="16" viewBox="0 0 24 24" fill="#22c55e"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
                      : <svg width="16" height="16" viewBox="0 0 24 24" fill="#d1d5db"><path d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 17 15.59z"/></svg>
                    }
                    <span style={{ ...styles.requirementText, color: req.met ? '#16a34a' : '#6b7280' }}>{req.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Confirm Password */}
          <div style={styles.formGroup}>
            <label style={styles.label}>Confirm Password</label>
            <PasswordInput
              name="confirmPassword"
              value={formData.confirmPassword}
              onChange={handleChange}
              placeholder="Confirm your password"
              error={passwordError && formData.confirmPassword ? passwordError : ''}
            />
          </div>

          <button
            className="btn-animate"
            type="submit"
            style={styles.submitBtn}
            disabled={loading}
          >
            {loading ? 'Creating account...' : 'Create Account'}
          </button>
        </form>

        <p style={styles.footer}>
          Already have an account?{' '}
          <Link to="/signin" style={styles.link}>Sign In</Link>
        </p>
      </div>
    </div>
  );
}

const styles = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%)',
    padding: '1rem',
    boxSizing: 'border-box',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: '16px',
    boxShadow: '0 8px 32px rgba(0,0,0,0.08)',
    width: '100%',
    maxWidth: '450px',
    boxSizing: 'border-box',
  },
  logoContainer: {
    marginBottom: '1rem',
    display: 'flex',
    justifyContent: 'center',
  },
  logo: {
    height: '48px',
    width: 'auto',
    objectFit: 'contain',
  },
  title: {
    textAlign: 'center',
    color: '#1f2937',
    marginBottom: '0.5rem',
    fontSize: '1.75rem',
    fontWeight: 'bold',
    marginTop: 0,
  },
  subtitle: {
    textAlign: 'center',
    color: '#6b7280',
    marginBottom: '1.5rem',
    fontSize: '1rem',
    marginTop: 0,
  },
  error: {
    padding: '0.75rem',
    backgroundColor: '#fee2e2',
    border: '1px solid #ef4444',
    borderRadius: '8px',
    color: '#dc2626',
    marginBottom: '1rem',
    fontSize: '0.9rem',
  },
  fieldError: {
    color: '#dc2626',
    fontSize: '0.8rem',
    marginTop: '0.4rem',
    paddingLeft: '0.25rem',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1.25rem',
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  },
  label: {
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#374151',
  },
  input: {
    width: '100%',
    padding: '0.75rem 2.75rem 0.75rem 0.75rem',
    border: '1px solid #d1d5db',
    borderRadius: '12px',
    fontSize: '1rem',
    boxSizing: 'border-box',
  },
  passwordWrapper: {
    position: 'relative',
    width: '100%',
  },
  eyeBtn: {
    position: 'absolute',
    right: '0.75rem',
    top: '50%',
    transform: 'translateY(-50%)',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '0.25rem',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#6b7280',
  },
  strengthBarContainer: {
    height: '6px',
    backgroundColor: '#e5e7eb',
    borderRadius: '3px',
    overflow: 'hidden',
  },
  strengthBar: {
    height: '100%',
    transition: 'width 0.2s, background-color 0.2s',
  },
  strengthLabel: {
    fontSize: '0.75rem',
    marginTop: '0.25rem',
    display: 'block',
    fontWeight: '500',
  },
  requirementsBox: {
    backgroundColor: '#f9fafb',
    borderRadius: '8px',
    padding: '0.875rem 1rem',
    marginTop: '0.5rem',
  },
  requirementsTitle: {
    fontSize: '0.8rem',
    fontWeight: '600',
    color: '#374151',
    margin: '0 0 0.5rem 0',
  },
  requirementRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    marginBottom: '0.35rem',
  },
  requirementText: {
    fontSize: '0.8rem',
  },
  submitBtn: {
    width: '100%',
    padding: '0.875rem',
    backgroundColor: '#9B0000',
    color: '#fff',
    border: 'none',
    borderRadius: '12px',
    fontSize: '1rem',
    fontWeight: '600',
    cursor: 'pointer',
    marginTop: '0.5rem',
    boxSizing: 'border-box',
  },
  footer: {
    textAlign: 'center',
    marginTop: '1.5rem',
    color: '#6b7280',
    fontSize: '0.9rem',
  },
  link: {
    color: '#9B0000',
    textDecoration: 'none',
    fontWeight: '600',
  },
};

export default SignUp;