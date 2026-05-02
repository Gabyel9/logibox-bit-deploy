import { useState, useEffect } from 'react';
import {
  LayoutDashboard, Camera, ClipboardList,
  Settings, HelpCircle, LogOut, Menu, X
} from 'lucide-react';

const navItems = [
  { label: 'Dashboard',     path: '/dashboard', Icon: LayoutDashboard },
  { label: 'Camera Feed',   path: '/camera',    Icon: Camera },
  { label: 'Activity Logs', path: '/logs',      Icon: ClipboardList },
  { label: 'Settings',      path: '/settings',  Icon: Settings },
  { label: 'Help',          path: '/help',      Icon: HelpCircle },
];

const NAVBAR_HEIGHT = 60;

function Navbar({ currentPath, onNavigate, onLogout }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Lock body scroll when sidebar is open on mobile
  useEffect(() => {
    if (isMobile && sidebarOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [isMobile, sidebarOpen]);

  const closeSidebar = () => setSidebarOpen(false);

  return (
    <>
      {/* ── DESKTOP NAVBAR ── */}
      {!isMobile && (
        <header style={styles.desktopNavbar}>

          {/* LEFT: Logo lockup */}
          <button style={styles.logoBtn} onClick={() => onNavigate('/dashboard')}>
            <img
              src="/LOGO LOGIBOX.png"
              alt="LogiBox"
              style={styles.logoImg}
            />
            <span style={styles.logoText}>LogiBox</span>
          </button>

          {/* CENTER: Nav links — flex:1 + justify-content:center */}
          <nav style={styles.desktopNavLinks}>
            {navItems.map(({ label, path, Icon }) => (
              <button
                key={path}
                className="nav-link-animate"
                style={{
                  ...styles.navLink,
                  ...(currentPath === path ? styles.navLinkActive : {}),
                }}
                onClick={() => onNavigate(path)}
              >
                <Icon size={16} strokeWidth={2} />
                <span>{label}</span>
                {currentPath === path && <span style={styles.activePill} />}
              </button>
            ))}
          </nav>

          {/* RIGHT: Sign out */}
          <button
            className="btn-animate"
            style={styles.signOutBtn}
            onClick={onLogout}
          >
            <LogOut size={16} strokeWidth={2} />
            <span>Sign Out</span>
          </button>

        </header>
      )}

      {/* ── MOBILE HEADER ── */}
      {isMobile && (
        <header style={styles.mobileHeader}>

          {/* Hamburger */}
          <button
            style={styles.menuBtn}
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
          >
            <Menu size={22} color="#fff" />
          </button>

          {/* Center: logo + name */}
          <div style={styles.mobileLogo}>
            <img
              src="/LOGO LOGIBOX.png"
              alt="LogiBox"
              style={styles.mobileLogoImg}
            />
            <span style={styles.mobileLogoText}>LogiBox</span>
          </div>

          {/* Spacer to balance hamburger */}
          <div style={{ width: 40 }} />

        </header>
      )}

      {/* ── MOBILE SIDEBAR OVERLAY ── */}
      {isMobile && (
        <>
          {/* Backdrop */}
          <div
            style={{
              ...styles.backdrop,
              opacity: sidebarOpen ? 1 : 0,
              pointerEvents: sidebarOpen ? 'auto' : 'none',
            }}
            onClick={closeSidebar}
          />

          {/* Drawer */}
          <aside
            style={{
              ...styles.sidebar,
              transform: sidebarOpen ? 'translateX(0)' : 'translateX(-100%)',
            }}
          >
            {/* Sidebar header */}
            <div style={styles.sidebarTop}>
              <div style={styles.sidebarLogo}>
                <img
                  src="/LOGO LOGIBOX.png"
                  alt="LogiBox"
                  style={styles.sidebarLogoImg}
                />
                <span style={styles.sidebarLogoText}>LogiBox</span>
              </div>
              <button
                style={styles.closeBtn}
                onClick={closeSidebar}
                aria-label="Close menu"
              >
                <X size={22} color="#6b7280" />
              </button>
            </div>

            {/* Nav items */}
            <nav style={styles.sidebarNav}>
              {navItems.map(({ label, path, Icon }) => (
                <button
                  key={path}
                  className="nav-link-animate"
                  style={{
                    ...styles.sidebarItem,
                    ...(currentPath === path ? styles.sidebarItemActive : {}),
                  }}
                  onClick={() => { onNavigate(path); closeSidebar(); }}
                >
                  <Icon
                    size={20}
                    strokeWidth={2}
                    color={currentPath === path ? '#8B0000' : '#6b7280'}
                  />
                  <span>{label}</span>
                </button>
              ))}
            </nav>

            {/* Logout at bottom */}
            <div style={styles.sidebarFooter}>
              <button
                className="btn-animate"
                style={styles.sidebarLogout}
                onClick={() => { onLogout(); closeSidebar(); }}
              >
                <LogOut size={20} strokeWidth={2} color="#dc2626" />
                <span>Logout</span>
              </button>
            </div>

          </aside>
        </>
      )}
    </>
  );
}

const BRAND = '#8B0000';

const styles = {

  /* ── Desktop ── */
  desktopNavbar: {
    position: 'sticky',
    top: 0,
    zIndex: 100,
    height: NAVBAR_HEIGHT,
    backgroundColor: BRAND,
    display: 'flex',
    alignItems: 'center',
    padding: '0 1.5rem',
    boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
    gap: '1rem',
  },

  logoBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '0.25rem 0.5rem',
    borderRadius: '6px',
    flexShrink: 0,
  },
  logoImg: {
    height: 30,
    width: 'auto',
    display: 'block',
  },
  logoText: {
    fontFamily: 'var(--font)',
    fontSize: '1.2rem',
    fontWeight: '800',
    color: '#fff',
    letterSpacing: '-0.2px',
    whiteSpace: 'nowrap',
  },

  /* CENTER nav — flex:1 centers the group */
  desktopNavLinks: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.125rem',
  },

  navLink: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    gap: '0.375rem',
    padding: '0.45rem 0.85rem',
    background: 'none',
    border: 'none',
    borderRadius: '6px',
    fontFamily: 'var(--font)',
    fontSize: '0.8375rem',
    color: 'rgba(255,255,255,0.8)',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    fontWeight: '500',
    transition: 'background 0.2s, color 0.2s',
  },
  navLinkActive: {
    backgroundColor: 'rgba(255,255,255,0.18)',
    color: '#fff',
    fontWeight: '700',
  },
  activePill: {
    position: 'absolute',
    bottom: 2,
    left: '50%',
    transform: 'translateX(-50%)',
    width: 20,
    height: 3,
    backgroundColor: '#fff',
    borderRadius: 99,
  },

  signOutBtn: {
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem',
    padding: '0.45rem 1rem',
    backgroundColor: 'rgba(255,255,255,0.15)',
    color: '#fff',
    border: '1px solid rgba(255,255,255,0.35)',
    borderRadius: '6px',
    fontFamily: 'var(--font)',
    fontSize: '0.8375rem',
    fontWeight: '600',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },

  /* ── Mobile header ── */
  mobileHeader: {
    position: 'sticky',
    top: 0,
    zIndex: 100,
    height: NAVBAR_HEIGHT,
    backgroundColor: BRAND,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 0.75rem',
    boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
  },
  menuBtn: {
    width: 40,
    height: 40,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(255,255,255,0.1)',
    border: 'none',
    cursor: 'pointer',
    borderRadius: '8px',
    flexShrink: 0,
  },
  mobileLogo: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem',
  },
  mobileLogoImg: {
    height: 26,
    width: 'auto',
  },
  mobileLogoText: {
    fontFamily: 'var(--font)',
    fontSize: '1.1rem',
    fontWeight: '800',
    color: '#fff',
    letterSpacing: '-0.2px',
  },

  /* ── Sidebar ── */
  backdrop: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    backdropFilter: 'blur(2px)',
    zIndex: 199,
    transition: 'opacity 0.3s ease',
  },
  sidebar: {
    position: 'fixed',
    top: 0,
    left: 0,
    bottom: 0,
    width: 272,
    backgroundColor: '#fff',
    zIndex: 200,
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '4px 0 24px rgba(0,0,0,0.12)',
    transition: 'transform 0.3s cubic-bezier(0.4,0,0.2,1)',
  },
  sidebarTop: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '1rem 1.25rem',
    borderBottom: '1px solid #f0f0f0',
  },
  sidebarLogo: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
  },
  sidebarLogoImg: {
    height: 34,
    width: 'auto',
  },
  sidebarLogoText: {
    fontFamily: 'var(--font)',
    fontSize: '1.25rem',
    fontWeight: '800',
    color: BRAND,
    letterSpacing: '-0.2px',
  },
  closeBtn: {
    width: 36,
    height: 36,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#f4f5f7',
    border: 'none',
    cursor: 'pointer',
    borderRadius: '8px',
  },
  sidebarNav: {
    flex: 1,
    padding: '0.75rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    overflowY: 'auto',
  },
  sidebarItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    width: '100%',
    padding: '0.8rem 1rem',
    background: 'none',
    border: 'none',
    borderRadius: '8px',
    fontFamily: 'var(--font)',
    fontSize: '0.95rem',
    color: '#374151',
    cursor: 'pointer',
    textAlign: 'left',
    fontWeight: '500',
    transition: 'background 0.15s',
  },
  sidebarItemActive: {
    backgroundColor: '#fef2f2',
    color: BRAND,
    fontWeight: '700',
    borderLeft: `3px solid ${BRAND}`,
    paddingLeft: 'calc(1rem - 3px)',
  },
  sidebarFooter: {
    borderTop: '1px solid #f0f0f0',
    padding: '0.75rem',
  },
  sidebarLogout: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    width: '100%',
    padding: '0.8rem 1rem',
    background: 'none',
    border: 'none',
    borderRadius: '8px',
    fontFamily: 'var(--font)',
    fontSize: '0.95rem',
    color: '#dc2626',
    cursor: 'pointer',
    textAlign: 'left',
    fontWeight: '600',
  },
};

export default Navbar;