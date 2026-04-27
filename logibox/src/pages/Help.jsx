import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const navItems = [
  { label: 'Dashboard', path: '/dashboard', icon: 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V13h-8v8zm0-18v6h8V3h-8z' },
  { label: 'Camera Feed', path: '/camera', icon: 'M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z' },
  { label: 'Activity Logs', path: '/logs', icon: 'M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42C8.27 19.99 10.51 21 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z' },
  { label: 'Settings', path: '/settings', icon: 'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.04.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.57 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z' },
  { label: 'Help', path: '/help', icon: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z' },
];

const faqItems = [
  {
    question: 'How do I assign a delivery to a vault?',
    answer: 'Go to Dashboard, find an empty vault, click Set Delivery, fill in the rider name, contact, parcel info and fee, then click Save.',
  },
  {
    question: 'How does the OTP work?',
    answer: 'After assigning a delivery, click Generate OTP. Share the 6-digit code with the rider. The rider uses this code to open the vault.',
  },
  {
    question: 'What happens when OTP expires?',
    answer: 'The OTP becomes invalid. You can regenerate a new one by clicking Regenerate OTP on the vault card.',
  },
  {
    question: 'Can I disable a vault?',
    answer: 'Yes. Go to Settings, find Vault Configuration, and toggle off the vault you want to disable.',
  },
  {
    question: 'How do I view past deliveries?',
    answer: 'Go to Activity Logs to see a full history of all actions including completed deliveries.',
  },
];

function Help() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [openFaq, setOpenFaq] = useState(null);
  const [copied, setCopied] = useState(false);

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

  const closeSidebar = () => setSidebarOpen(false);

  const toggleFaq = (index) => {
    setOpenFaq(openFaq === index ? null : index);
  };

  const copyEmail = () => {
    navigator.clipboard.writeText('support@logibox.app');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={styles.layout}>
      {/* DESKTOP NAVBAR */}
      {!isMobile && (
        <header style={styles.desktopNavbar}>
          <span style={styles.desktopNavbarLogo}>LogiBox</span>
          <nav style={styles.desktopNavLinks}>
            {navItems.map((item) => (
              <button
                key={item.path}
                style={{
                  ...styles.desktopNavLink,
                  ...(item.path === '/help' ? styles.desktopNavLinkActive : {}),
                }}
                onClick={() => navigate(item.path)}
              >
                {item.label}
              </button>
            ))}
          </nav>
          <button style={styles.desktopSignOutBtn} onClick={handleLogout}>
            Sign Out
          </button>
        </header>
      )}

      {/* MOBILE HEADER */}
      {isMobile && (
        <header style={styles.mobileHeader}>
          <button style={styles.menuBtn} onClick={() => setSidebarOpen(true)} aria-label="Open menu">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="#fff">
              <path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/>
            </svg>
          </button>
          <h1 style={styles.mobileTitle}>LogiBox</h1>
          <div style={{ width: 40 }} />
        </header>
      )}

      {/* MOBILE SIDEBAR DRAWER */}
      {isMobile && (
        <>
          <div
            style={{
              ...styles.overlay,
              opacity: sidebarOpen ? 1 : 0,
              pointerEvents: sidebarOpen ? 'auto' : 'none',
            }}
            onClick={closeSidebar}
          />
          <aside style={{
            ...styles.sidebar,
            transform: sidebarOpen ? 'translateX(0)' : 'translateX(-100%)',
          }}>
            <div style={styles.sidebarHeader}>
              <h2 style={styles.sidebarLogo}>LogiBox</h2>
              <button style={styles.closeSidebarBtn} onClick={closeSidebar} aria-label="Close menu">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                </svg>
              </button>
            </div>
            <nav style={styles.sidebarNav}>
              {navItems.map((item) => (
                <button
                  key={item.path}
                  style={{
                    ...styles.navItem,
                    ...(item.path === '/help' ? styles.navItemActive : {}),
                  }}
                  onClick={() => {
                    navigate(item.path);
                    closeSidebar();
                  }}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d={item.icon}/>
                  </svg>
                  {item.label}
                </button>
              ))}
              <button
                style={{ ...styles.navItem, ...styles.navItemLogout }}
                onClick={() => { handleLogout(); closeSidebar(); }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/>
                </svg>
                Logout
              </button>
            </nav>
          </aside>
        </>
      )}

      {/* MAIN CONTENT — page-enter */}
      <main style={styles.main}>
        <div className="page-enter" style={{ ...styles.content, padding: isMobile ? '1rem' : '2rem' }}>
          <h1 style={{
            ...styles.pageTitle,
            fontSize: isMobile ? '1.5rem' : '1.75rem',
            marginBottom: isMobile ? '1rem' : '1.5rem',
          }}>
            Help
          </h1>

          {/* SECTION 1 - FAQ — card-enter */}
          <div style={styles.section}>
            <h2 style={styles.sectionTitle}>FAQ</h2>
            <div className="card-enter" style={styles.card}>
              {faqItems.map((item, index) => (
                <div key={index} style={styles.faqItem}>
                  <button
                    style={styles.faqQuestion}
                    onClick={() => toggleFaq(index)}
                  >
                    <span>{item.question}</span>
                    <svg
                      width="24"
                      height="24"
                      viewBox="0 0 24 24"
                      fill="#6b7280"
                      style={{
                        transform: openFaq === index ? 'rotate(180deg)' : 'rotate(0deg)',
                        transition: 'transform 0.2s',
                      }}
                    >
                      <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/>
                    </svg>
                  </button>
                  {/* faq-answer open/closed — replaces conditional render */}
                  <div className={`faq-answer ${openFaq === index ? 'open' : 'closed'}`} style={styles.faqAnswer}>
                    {item.answer}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* SECTION 2 - Contact Support — card-enter */}
          <div style={styles.section}>
            <h2 style={styles.sectionTitle}>Contact Support</h2>
            <div className="card-enter" style={styles.card}>
              <p style={styles.contactText}>Need more help? Reach out to us.</p>
              <div style={styles.emailRow}>
                <a href="mailto:support@logibox.app" style={styles.emailLink}>
                  support@logibox.app
                </a>
                <button className="btn-animate" style={styles.copyBtn} onClick={copyEmail}>
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>
          </div>

          {/* SECTION 3 - App Info — card-enter */}
          <div style={styles.section}>
            <h2 style={styles.sectionTitle}>App Info</h2>
            <div className="card-enter" style={styles.card}>
              <div style={styles.infoRow}>
                <span style={styles.infoLabel}>App Name:</span>
                <span style={styles.infoValue}>LogiBox</span>
              </div>
              <div style={styles.infoRow}>
                <span style={styles.infoLabel}>Version:</span>
                <span style={styles.infoValue}>1.0.0</span>
              </div>
              <div style={styles.infoRow}>
                <span style={styles.infoLabel}>Built with:</span>
                <span style={styles.infoValue}>React and Firebase</span>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

const NAVBAR_HEIGHT = 56;

const styles = {
  layout: {
    display: 'flex',
    flexDirection: 'column',
    minHeight: '100vh',
    backgroundColor: '#f5f6fa',
  },
  main: {
    flex: 1,
    minWidth: 0,
  },
  content: {
    padding: '2rem',
    maxWidth: 800,
    margin: '0 auto',
  },
  pageTitle: {
    fontSize: '1.75rem',
    fontWeight: 'bold',
    color: '#1f2937',
    marginBottom: '1.5rem',
    marginTop: 0,
  },
  section: {
    marginBottom: '2rem',
  },
  sectionTitle: {
    fontSize: '1.1rem',
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: '1rem',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: '12px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
    padding: '1.5rem',
  },
  faqItem: {
    borderBottom: '1px solid #e5e7eb',
  },
  faqQuestion: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    padding: '1rem 0',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    textAlign: 'left',
    fontSize: '0.95rem',
    fontWeight: '500',
    color: '#1f2937',
  },
  faqAnswer: {
    fontSize: '0.9rem',
    color: '#6b7280',
    lineHeight: 1.5,
    // height/opacity controlled by .faq-answer.open / .faq-answer.closed in animations.css
  },
  contactText: {
    margin: '0 0 1rem 0',
    color: '#374151',
  },
  emailRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
  },
  emailLink: {
    color: '#9B0000',
    textDecoration: 'none',
    fontWeight: '500',
  },
  copyBtn: {
    padding: '0.5rem 1rem',
    backgroundColor: '#f3f4f6',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '0.85rem',
    cursor: 'pointer',
    color: '#374151',
  },
  infoRow: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '0.5rem 0',
    borderBottom: '1px solid #e5e7eb',
  },
  infoLabel: {
    color: '#6b7280',
  },
  infoValue: {
    color: '#1f2937',
    fontWeight: '500',
  },
  desktopNavbar: {
    position: 'sticky',
    top: 0,
    zIndex: 100,
    height: NAVBAR_HEIGHT,
    backgroundColor: '#9B0000',
    display: 'flex',
    alignItems: 'center',
    padding: '0 2rem',
    gap: '1.5rem',
    boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
  },
  desktopNavbarLogo: {
    fontSize: '1.35rem',
    fontWeight: 'bold',
    color: '#fff',
    letterSpacing: '0.5px',
    marginRight: 'auto',
  },
  desktopNavLinks: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.25rem',
  },
  desktopNavLink: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem',
    padding: '0.5rem 0.875rem',
    backgroundColor: 'transparent',
    border: 'none',
    borderRadius: '6px',
    fontSize: '0.9rem',
    color: 'rgba(255,255,255,0.85)',
    cursor: 'pointer',
  },
  desktopNavLinkActive: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    color: '#fff',
    fontWeight: '600',
  },
  desktopSignOutBtn: {
    padding: '0.5rem 1.125rem',
    backgroundColor: 'rgba(255,255,255,0.15)',
    color: '#fff',
    border: '1px solid rgba(255,255,255,0.3)',
    borderRadius: '6px',
    fontSize: '0.9rem',
    fontWeight: '500',
    cursor: 'pointer',
  },
  mobileHeader: {
    position: 'sticky',
    top: 0,
    zIndex: 100,
    display: 'flex',
    padding: '0 1rem',
    height: NAVBAR_HEIGHT,
    backgroundColor: '#9B0000',
    boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  menuBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: 8,
    minWidth: 44,
    minHeight: 44,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mobileTitle: {
    fontSize: '1.25rem',
    fontWeight: 'bold',
    color: '#fff',
    margin: 0,
  },
  sidebar: {
    position: 'fixed',
    left: 0,
    top: 0,
    bottom: 0,
    width: 280,
    backgroundColor: '#fff',
    boxShadow: '2px 0 12px rgba(0,0,0,0.12)',
    zIndex: 200,
    transition: 'transform 0.3s ease',
    display: 'flex',
    flexDirection: 'column',
  },
  sidebarHeader: {
    padding: '1.25rem 1.5rem',
    borderBottom: '1px solid #e5e7eb',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sidebarLogo: {
    fontSize: '1.4rem',
    fontWeight: 'bold',
    color: '#9B0000',
    margin: 0,
  },
  closeSidebarBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: 4,
    color: '#6b7280',
  },
  sidebarNav: {
    padding: '1rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
    flex: 1,
  },
  navItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    padding: '0.875rem 1rem',
    backgroundColor: 'transparent',
    border: 'none',
    borderRadius: '8px',
    fontSize: '0.95rem',
    color: '#374151',
    cursor: 'pointer',
    width: '100%',
  },
  navItemActive: {
    backgroundColor: '#fef2f2',
    color: '#9B0000',
    fontWeight: '600',
  },
  navItemLogout: {
    marginTop: 'auto',
    color: '#dc2626',
  },
  overlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    zIndex: 199,
    transition: 'opacity 0.3s ease',
  },
};

export default Help;