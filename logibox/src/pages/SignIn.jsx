import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

function cleanError(message) {
  if (!message) return 'Something went wrong. Please try again.';
  if (message.includes('invalid-credential') || message.includes('wrong-password') || message.includes('user-not-found')) {
    return 'Incorrect email or password. Please try again.';
  }
  if (message.includes('invalid-email')) {
    return 'Please enter a valid email address.';
  }
  if (message.includes('too-many-requests')) {
    return 'Too many failed attempts. Please wait a few minutes and try again.';
  }
  if (message.includes('network-request-failed')) {
    return 'No internet connection. Please check your network.';
  }
  if (message.includes('popup-closed-by-user')) {
    return 'Google sign-in was cancelled.';
  }
  if (message.includes('popup-blocked')) {
    return 'Popup was blocked. Please allow popups and try again.';
  }
  return 'Something went wrong. Please try again.';
}

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

function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState('');
  const { signin, googleSignIn } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await signin(email, password);
      navigate('/dashboard');
    } catch (err) {
      setError(cleanError(err.message));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setGoogleLoading(true);
    setError('');
    try {
      await googleSignIn();
      navigate('/dashboard');
    } catch (err) {
      setError(cleanError(err.message));
    } finally {
      setGoogleLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.blobTopRight} />
      <div className="page-enter" style={styles.card}>

        <div style={styles.logoContainer}>
          <img
            src="/LOGO LOGIBOX.png"
            alt="LogiBox"
            style={styles.logo}
          />
        </div>

        <h1 style={styles.title}>Welcome Back</h1>
        <p style={styles.subtitle}>Sign in to your account</p>

        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.formGroup}>
            <label style={styles.label}>Email</label>
            <input
              className="input-animate"
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError(''); }}
              style={{
                ...styles.input,
                borderColor: error ? '#ef4444' : '#d1d5db',
              }}
              placeholder="Enter your email"
              required
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Password</label>
            <div style={styles.passwordWrapper}>
              <input
                className="input-animate"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(''); }}
                style={{
                  ...styles.input,
                  borderColor: error ? '#ef4444' : '#d1d5db',
                }}
                placeholder="Enter your password"
                required
              />
              <button
                type="button"
                style={styles.eyeBtn}
                onClick={() => setShowPassword(v => !v)}
                tabIndex={-1}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                <EyeIcon visible={showPassword} />
              </button>
            </div>

            {/* Error shows here — right below password */}
            {error && (
              <div style={styles.errorMsg}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="#dc2626" style={{ flexShrink: 0, marginTop: 1 }}>
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
                </svg>
                {error}
              </div>
            )}
          </div>

          <button
            className="btn-animate"
            type="submit"
            style={styles.submitBtn}
            disabled={loading}
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <div style={styles.divider}>
          <div style={styles.dividerLine} />
          <span style={styles.dividerText}>or</span>
          <div style={styles.dividerLine} />
        </div>

        <button
          className="btn-animate"
          type="button"
          onClick={handleGoogleSignIn}
          disabled={googleLoading}
          style={styles.googleBtn}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" style={styles.googleIcon}>
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          {googleLoading ? 'Signing in...' : 'Continue with Google'}
        </button>

        <p style={styles.footer}>
          Don't have an account?{' '}
          <Link to="/signup" style={styles.link}>Sign Up</Link>
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
    background: 'linear-gradient(145deg, #fff8f8 0%, #f4f5f7 60%, #fff 100%)',
    position: 'relative',
    overflow: 'hidden',
    padding: '1rem',
    boxSizing: 'border-box',
    fontFamily: 'var(--font)',
  },
  blobTopRight: {
    position: 'absolute',
    top: '-120px',
    right: '-120px',
    width: '400px',
    height: '400px',
    borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(139,0,0,0.06) 0%, transparent 70%)',
    pointerEvents: 'none',
  },
  card: {
    backgroundColor: '#fff',
    padding: '2.5rem',
    borderRadius: '20px',
    boxShadow: '0 4px 24px rgba(0,0,0,0.07), 0 1px 4px rgba(0,0,0,0.05)',
    border: '1px solid #f0f1f3',
    width: '100%',
    maxWidth: '400px',
    boxSizing: 'border-box',
    position: 'relative',
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
    color: '#0f172a',
    marginBottom: '0.5rem',
    fontSize: '1.625rem',
    fontWeight: 800,
    marginTop: 0,
    letterSpacing: '-0.5px',
    fontFamily: 'var(--font)',
  },
  subtitle: {
    textAlign: 'center',
    color: '#6b7280',
    marginBottom: '1.5rem',
    fontSize: '0.9rem',
    marginTop: 0,
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
    fontSize: '0.8125rem',
    fontWeight: 600,
    color: '#374151',
    letterSpacing: '0.01em',
  },
  passwordWrapper: {
    position: 'relative',
    width: '100%',
  },
  input: {
    width: '100%',
    padding: '0.7rem 2.75rem 0.7rem 0.875rem',
    border: '1.5px solid #e8eaed',
    backgroundColor: '#fafafa',
    fontFamily: 'var(--font)',
    borderRadius: '10px',
    fontSize: '1rem',
    boxSizing: 'border-box',
    transition: 'border-color 0.2s ease',
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
  },
  errorMsg: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '0.4rem',
    color: '#dc2626',
    fontSize: '0.8rem',
    marginTop: '0.25rem',
    lineHeight: '1.4',
  },
  submitBtn: {
    width: '100%',
    padding: '0.875rem',
    backgroundColor: '#8B0000',
    color: '#fff',
    border: 'none',
    borderRadius: '10px',
    fontSize: '1rem',
    fontWeight: 700,
    cursor: 'pointer',
    marginTop: '0.25rem',
    boxSizing: 'border-box',
    fontFamily: 'var(--font)',
    letterSpacing: '-0.1px',
  },
  divider: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    margin: '1.5rem 0',
  },
  dividerLine: {
    flex: 1,
    height: '1px',
    backgroundColor: '#f0f1f3',
  },
  dividerText: {
    color: '#9ca3af',
    fontSize: '0.85rem',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    flexShrink: 0,
  },
  googleBtn: {
    width: '100%',
    padding: '0.75rem 1rem',
    backgroundColor: '#fafafa',
    color: '#374151',
    border: '1.5px solid #e8eaed',
    borderRadius: '10px',
    fontSize: '0.95rem',
    fontWeight: 600,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.75rem',
    boxSizing: 'border-box',
  },
  googleIcon: {
    flexShrink: 0,
  },
  footer: {
    textAlign: 'center',
    marginTop: '1.5rem',
    color: '#9ca3af',
    fontSize: '0.9rem',
  },
  link: {
    color: '#8B0000',
    textDecoration: 'none',
    fontWeight: '600',
  },
};

export default SignIn;