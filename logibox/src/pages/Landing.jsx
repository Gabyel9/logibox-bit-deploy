import { Link } from 'react-router-dom';

function Landing() {
  return (
    <div style={styles.container}>
      <div className="page-enter" style={styles.heroWrapper}>

        <div style={styles.logoContainer}>
          <img
            src="/LOGO LOGIBOX.png"
            alt="LogiBox"
            style={styles.logo}
          />
        </div>

        <h1 style={styles.title}>
          LogiBox
        </h1>

        <p style={styles.tagline}>
          Smart Logistics Management
        </p>

        <p style={styles.description}>
          Streamline your delivery operations with intelligent tracking,
          secure locker management, and real-time analytics.
        </p>

        <div style={styles.buttons}>
          <Link to="/signin" className="btn-animate" style={styles.signInBtn}>
            Sign In
          </Link>
          <Link to="/signup" className="btn-animate" style={styles.getStartedBtn}>
            Get Started
          </Link>
        </div>

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
    padding: '2rem',
  },
  heroWrapper: {
    textAlign: 'center',
    maxWidth: '640px',
    padding: '3rem 2rem',
  },
  logoContainer: {
    marginBottom: '1.5rem',
  },
  logo: {
    height: '80px',
    width: 'auto',
    objectFit: 'contain',
    display: 'block',
    margin: '0 auto',
  },
  title: {
    fontSize: '3.5rem',
    fontWeight: 'bold',
    color: '#1f2937',
    marginBottom: '0.5rem',
    letterSpacing: '-1px',
  },
  tagline: {
    fontSize: '1.5rem',
    color: '#374151',
    marginBottom: '1.5rem',
    fontWeight: '400',
  },
  description: {
    fontSize: '1.1rem',
    color: '#6b7280',
    lineHeight: '1.7',
    maxWidth: '480px',
    margin: '0 auto 2.5rem',
  },
  buttons: {
    display: 'flex',
    gap: '1rem',
    justifyContent: 'center',
    flexWrap: 'wrap',
  },
  signInBtn: {
    padding: '0.875rem 2rem',
    backgroundColor: '#fff',
    color: '#9B0000',
    border: '2px solid #9B0000',
    borderRadius: '12px',
    fontSize: '1rem',
    fontWeight: '600',
    textDecoration: 'none',
    boxShadow: '0 2px 8px rgba(155,0,0,0.1)',
  },
  getStartedBtn: {
    padding: '0.875rem 2rem',
    backgroundColor: '#9B0000',
    color: '#fff',
    border: '2px solid #9B0000',
    borderRadius: '12px',
    fontSize: '1rem',
    fontWeight: '600',
    textDecoration: 'none',
    boxShadow: '0 2px 8px rgba(155,0,0,0.2)',
  },
};

export default Landing;