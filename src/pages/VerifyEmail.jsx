import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { sendEmailVerification } from 'firebase/auth';
import { auth } from '../config/firebase';

function VerifyEmail() {
  const navigate = useNavigate();
  const [resent, setResent] = useState(false);
  const [checking, setChecking] = useState(false);

  const handleResend = async () => {
    try {
      await sendEmailVerification(auth.currentUser);
      setResent(true);
      setTimeout(() => setResent(false), 3000);
    } catch (err) {
      console.error(err);
    }
  };

  const handleContinue = async () => {
    setChecking(true);
    await auth.currentUser.reload();
    if (auth.currentUser.emailVerified) {
      navigate('/dashboard');
    } else {
      alert('Email not verified yet. Please check your inbox.');
    }
    setChecking(false);
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>

        {/* Icon */}
        <div style={styles.iconWrap}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="#8B0000">
            <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/>
          </svg>
        </div>

        <h1 style={styles.title}>Check your email</h1>
        <p style={styles.subtitle}>
          We sent a verification link to{' '}
          <strong>{auth.currentUser?.email}</strong>.
          Click the link in the email then come back here.
        </p>

        {/* Continue button */}
        <button
          className="btn-animate"
          style={styles.continueBtn}
          onClick={handleContinue}
          disabled={checking}
        >
          {checking ? 'Checking...' : "I've verified my email"}
        </button>

        {/* Resend */}
        <button
          className="btn-animate"
          style={styles.resendBtn}
          onClick={handleResend}
        >
          {resent ? '✓ Email sent!' : 'Resend verification email'}
        </button>

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
    padding: '1rem',
    fontFamily: 'var(--font)',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: '20px',
    padding: '2.5rem',
    maxWidth: '420px',
    width: '100%',
    boxShadow: '0 4px 24px rgba(0,0,0,0.07)',
    border: '1px solid #f0f1f3',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    gap: '1rem',
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: '50%',
    backgroundColor: '#fdf2f2',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: '1.5rem',
    fontWeight: 800,
    color: '#0f172a',
    margin: 0,
  },
  subtitle: {
    fontSize: '0.9rem',
    color: '#6b7280',
    lineHeight: 1.6,
    margin: 0,
  },
  continueBtn: {
    width: '100%',
    padding: '0.875rem',
    backgroundColor: '#8B0000',
    color: '#fff',
    border: 'none',
    borderRadius: '10px',
    fontSize: '1rem',
    fontWeight: 700,
    cursor: 'pointer',
    fontFamily: 'var(--font)',
  },
  resendBtn: {
    width: '100%',
    padding: '0.75rem',
    backgroundColor: '#f4f5f7',
    color: '#374151',
    border: '1px solid #e8eaed',
    borderRadius: '10px',
    fontSize: '0.875rem',
    fontWeight: 600,
    cursor: 'pointer',
  },
};

export default VerifyEmail;