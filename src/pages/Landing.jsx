import { Link } from 'react-router-dom';

function Landing() {
  return (
    <div style={s.page}>
      <div style={s.blobTopRight} />
      <div style={s.blobBottomLeft} />

      <main style={s.hero}>
        <div className="page-enter" style={s.heroInner}>
          <div style={s.brandRow}>
            <img src="/LOGO LOGIBOX.png" alt="LogiBox" style={s.logo} />
            <span style={s.brandName}>LogiBox</span>
          </div>

          <h1 style={s.headline}>
            Manage deliveries with confidence.
          </h1>

          <p style={s.sub}>
            Assign vaults, generate OTP access, and confirm deliveries with a clean,
            real-time workflow built for modern logistics teams.
          </p>

          <div style={s.ctaRow}>
            <Link to="/signup" className="btn-animate" style={s.ctaPrimary}>
              Get Started
            </Link>
            <Link to="/signin" className="btn-animate" style={s.ctaSecondary}>
              Sign In
            </Link>
          </div>
        </div>
      </main>

      <footer style={s.footer}>
        <span style={s.footerText}>© 2026 LogiBox</span>
      </footer>
    </div>
  );
}

const s = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    position: 'relative',
    overflow: 'hidden',
    fontFamily: 'var(--font)',
    background: 'linear-gradient(145deg, #fff8f8 0%, #f4f5f7 60%, #fff 100%)',
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
  blobBottomLeft: {
    position: 'absolute',
    bottom: '-120px',
    left: '-120px',
    width: '440px',
    height: '440px',
    borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(139,0,0,0.05) 0%, transparent 70%)',
    pointerEvents: 'none',
  },

  hero: {
    position: 'relative',
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '3rem 1.5rem 2rem',
  },
  heroInner: {
    maxWidth: '720px',
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    backgroundColor: 'rgba(255,255,255,0.82)',
    border: '1px solid rgba(232,234,237,0.9)',
    borderRadius: '20px',
    padding: '2.5rem 2rem',
    boxShadow: '0 20px 60px rgba(0,0,0,0.08), 0 4px 16px rgba(0,0,0,0.06)',
    backdropFilter: 'blur(8px)',
  },

  brandRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.6rem',
    marginBottom: '1rem',
  },
  logo: {
    height: '56px',
    width: 'auto',
    filter: 'drop-shadow(0 4px 12px rgba(139,0,0,0.18))',
  },
  brandName: {
    fontSize: '1.5rem',
    fontWeight: 800,
    color: '#0f172a',
    letterSpacing: '-0.4px',
  },

  headline: {
    fontSize: 'clamp(2.25rem, 6vw, 3.5rem)',
    fontWeight: 800,
    color: '#0f172a',
    margin: '0 0 1rem 0',
    lineHeight: 1.1,
    letterSpacing: '-1.2px',
  },

  sub: {
    fontSize: 'clamp(1.05rem, 2.5vw, 1.2rem)',
    color: '#4b5563',
    lineHeight: '1.7',
    maxWidth: '560px',
    margin: '0 0 2rem 0',
    fontWeight: 500,
  },

  ctaRow: {
    display: 'flex',
    gap: '0.75rem',
    justifyContent: 'center',
    flexWrap: 'wrap',
    marginBottom: 0,
  },
  ctaPrimary: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0.85rem 1.75rem',
    backgroundColor: '#8B0000',
    color: '#fff',
    textDecoration: 'none',
    borderRadius: '10px',
    fontSize: '0.9375rem',
    fontWeight: '700',
    boxShadow: '0 4px 14px rgba(139,0,0,0.28)',
    letterSpacing: '-0.1px',
  },
  ctaSecondary: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0.85rem 1.75rem',
    backgroundColor: '#fff',
    color: '#374151',
    textDecoration: 'none',
    borderRadius: '10px',
    fontSize: '0.9375rem',
    fontWeight: '600',
    border: '1.5px solid #e5e7eb',
    letterSpacing: '-0.1px',
  },

  footer: {
    position: 'relative',
    padding: '1.25rem 1.5rem 1.5rem',
    textAlign: 'center',
  },
  footerText: {
    fontSize: '0.775rem',
    color: '#9ca3af',
    fontWeight: 500,
  },
};

export default Landing;