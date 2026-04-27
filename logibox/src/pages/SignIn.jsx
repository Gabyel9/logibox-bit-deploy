import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
      setError(err.message);
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
      setError(err.message);
    } finally {
      setGoogleLoading(false);
    }
  };

  return (
    <div style={styles.container}>
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

        {error && <div style={styles.error}>{error}</div>}

        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.formGroup}>
            <label style={styles.label}>Email</label>
            <input
              className="input-animate"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={styles.input}
              placeholder="Enter your email"
              required
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Password</label>
            <input
              className="input-animate"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={styles.input}
              placeholder="Enter your password"
              required
            />
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
    background: 'linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%)',
    padding: '1rem',
  },
  card: {
    backgroundColor: '#fff',
    padding: '2.5rem',
    borderRadius: '16px',
    boxShadow: '0 8px 32px rgba(0,0,0,0.08)',
    width: '100%',
    maxWidth: '400px',
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
  },
  subtitle: {
    textAlign: 'center',
    color: '#6b7280',
    marginBottom: '1.5rem',
    fontSize: '1rem',
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
    padding: '0.75rem',
    border: '1px solid #d1d5db',
    borderRadius: '12px',
    fontSize: '1rem',
  },
  submitBtn: {
    padding: '0.875rem',
    backgroundColor: '#9B0000',
    color: '#fff',
    border: 'none',
    borderRadius: '12px',
    fontSize: '1rem',
    fontWeight: '600',
    cursor: 'pointer',
    marginTop: '0.5rem',
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
    backgroundColor: '#e5e7eb',
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
    backgroundColor: '#fff',
    color: '#374151',
    border: '1px solid #d1d5db',
    borderRadius: '12px',
    fontSize: '0.95rem',
    fontWeight: '500',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.75rem',
  },
  googleIcon: {
    flexShrink: 0,
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

export default SignIn;