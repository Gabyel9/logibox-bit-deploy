import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Navbar from '../components/Navbar';

function CameraFeed() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const handleLogout = () => {
    logout();
    navigate('/signin');
  };

  const cameras = [1, 2, 3];

  return (
    <div style={styles.layout}>
      <Navbar currentPath="/camera" onNavigate={navigate} onLogout={handleLogout} />

      {/* MAIN CONTENT — page-enter */}
      <main style={styles.main}>
        <div className="page-enter" style={{ ...styles.content, padding: isMobile ? '1rem' : '2rem' }}>
          <h1 style={{
            ...styles.pageTitle,
            fontSize: isMobile ? '1.5rem' : '1.75rem',
            marginBottom: isMobile ? '1rem' : '1.5rem',
          }}>
            Camera Feed
          </h1>

          {/* Info Banner */}
          <div style={styles.infoBanner}>
            <span style={styles.infoIcon} aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#92400e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
            </span>
            Camera integration coming soon. This is a preview layout.
          </div>

          {/* Camera Grid — card-enter vault-card-animate on each card */}
          <div style={styles.cameraGrid}>
            {cameras.map((vaultId) => (
              <div key={vaultId} className="card-enter vault-card-animate" style={styles.cameraCard}>
                <div style={styles.cameraHeader}>
                  <span style={styles.cameraTitle}>Vault {vaultId} Camera</span>
                  <span style={styles.offlineBadge}>Offline</span>
                </div>
                <div style={styles.cameraPlaceholder}>
                  <div style={styles.cameraIconCircle}>
                    <svg width={28} height={28} viewBox="0 0 24 24" fill="#9ca3af">
                      <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/>
                    </svg>
                  </div>
                  <span style={styles.noFeedText}>No Feed Available</span>
                </div>
                <div style={styles.lastUpdated}>
                  Last updated: Never
                </div>
              </div>
            ))}
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
    marginBottom: '1.5rem',
    marginTop: 0,
  },
  infoBanner: {
    backgroundColor: '#fffbeb',
    border: '1px solid rgba(217,119,6,0.2)',
    borderRadius: '10px',
    color: '#92400e',
    padding: '1rem',
    marginBottom: '1.5rem',
    fontSize: '0.875rem',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
  },
  infoIcon: {
    flexShrink: 0,
    display: 'inline-flex',
    alignItems: 'center',
  },
  cameraGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
    gap: '1.5rem',
  },
  cameraCard: {
    backgroundColor: '#fff',
    borderRadius: '14px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
    border: '1px solid #f0f1f3',
    overflow: 'hidden',
  },
  cameraHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '1rem 1.25rem',
    borderBottom: '1px solid #f4f5f7',
  },
  cameraTitle: {
    fontSize: '1rem',
    fontWeight: 700,
    color: '#1f2937',
  },
  offlineBadge: {
    padding: '0.25rem 0.75rem',
    borderRadius: '9999px',
    fontSize: '0.7rem',
    fontWeight: 700,
    backgroundColor: '#f4f5f7',
    color: '#6b7280',
    textTransform: 'uppercase',
  },
  cameraPlaceholder: {
    aspectRatio: '16/9',
    backgroundColor: '#1e293b',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem',
  },
  cameraIconCircle: {
    width: 64,
    height: 64,
    borderRadius: '50%',
    backgroundColor: 'rgba(255,255,255,0.06)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  noFeedText: {
    color: '#9ca3af',
    fontSize: '0.9rem',
  },
  lastUpdated: {
    padding: '0.75rem 1.25rem',
    fontSize: '0.8rem',
    color: '#9ca3af',
    borderTop: '1px solid #e5e7eb',
  },
};

export default CameraFeed;