import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { cleanError } from '../utils/cleanError';

function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const { resetPassword } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess(false);
    try {
      await resetPassword(email);
      setSuccess(true);
    } catch (err) {
      setError(cleanError(err.message));
    } finally {
      setLoading(false);
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

        {success ? (
          <>
            <h1 style={styles.title}>Check Your Email</h1>
            <p style={styles.subtitle}>
              We've sent a password reset link to<br />
              <span style={styles.emailHighlight}>{email}</span>
            </p>

            <div style={styles.successBox}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" style={styles.successIcon}>
                <circle cx="12" cy="12" r="10" stroke="#16a34a" strokeWidth="2"/>
                <path d="M8 12l2.5 2.5L16 9" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <p style={styles.successText}>
                If an account exists for this email, you will receive a password reset link shortly.
              </p>
            </div>

            <Link to="/signin" style={styles.backLink}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 12H5M12 19l-7-7 7-7"/>
              </svg>
              Back to Sign In
            </Link>
          </>
        ) : (
          <>
            <h1 style={styles.title}>Forgot Password?</h1>
            <p style={styles.subtitle}>Enter your email and we'll send you a reset link</p>

            <form onSubmit={handleSubmit} style={styles.form}>
              <div style={styles.formGroup}>
                <label style={styles.label}>Email</label>
                <input
                  id="email"
                  name="email"
                  className="input-animate"
                  type="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setError(''); }}
                  style={{
                    ...styles.input,
                    border: error ? '1.5px solid #ef4444' : '1.5px solid #d1d5db',
                  }}
                  placeholder="Enter your email"
                  required
                />
              </div>

              {error && (
                <div style={styles.errorMsg}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="#dc2626" style={{ flexShrink: 0, marginTop: 1 }}>
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
                  </svg>
                  {error}
                </div>
              )}

              <button
                className="btn-animate"
                type="submit"
                style={styles.submitBtn}
                disabled={loading}
              >
                {loading ? 'Sending...' : 'Send Reset Link'}
              </button>
            </form>

            <p style={styles.footer}>
              Remember your password?{' '}
              <Link to="/signin" style={styles.link}>Sign In</Link>
            </p>
          </>
        )}

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
    lineHeight: 1.5,
  },
  emailHighlight: {
    color: '#0f172a',
    fontWeight: 600,
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
  input: {
    width: '100%',
    padding: '0.7rem 0.875rem',
    border: '1.5px solid #e8eaed',
    backgroundColor: '#fafafa',
    fontFamily: 'var(--font)',
    borderRadius: '10px',
    fontSize: '1rem',
    boxSizing: 'border-box',
    transition: 'border-color 0.2s ease',
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
  successBox: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '1rem',
    padding: '1.5rem 1rem',
    marginTop: '0.5rem',
  },
  successIcon: {
    flexShrink: 0,
  },
  successText: {
    textAlign: 'center',
    color: '#6b7280',
    fontSize: '0.9rem',
    lineHeight: 1.5,
    margin: 0,
  },
  backLink: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem',
    marginTop: '1.5rem',
    color: '#8B0000',
    textDecoration: 'none',
    fontWeight: '600',
    fontSize: '0.9rem',
  },
};

export default ForgotPassword;