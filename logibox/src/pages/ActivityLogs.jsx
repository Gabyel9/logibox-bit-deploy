import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db } from '../config/firebase';
import Navbar from '../components/Navbar';

function ActivityLogs() {
  const { logout, user } = useAuth();
  const navigate = useNavigate();
  const [isMobile, setIsMobile] = useState(false);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState('all');

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, 'users', user.uid, 'activityLogs'),
      orderBy('timestamp', 'desc'),
      limit(50)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const logsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      }));
      setLogs(logsData);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user]);

  const handleLogout = () => {
    logout();
    navigate('/signin');
  };

  const getActionColor = (action) => {
    if (action === 'Login' || action === 'Logout') return '#22c55e';
    if (action === 'Vault Assigned') return '#3b82f6';
    if (action === 'OTP Generated') return '#f97316';
    if (action === 'Delivery Confirmed') return '#ef4444';
    if (action === 'Vault Reset') return '#9ca3af';
    return '#9ca3af';
  };

  const formatTimestamp = (timestamp) => {
    if (!timestamp) return '-';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleString();
  };

  const filterLogs = () => {
    if (activeFilter === 'all') return logs;
    if (activeFilter === 'Login') return logs.filter(l => l.action === 'Login' || l.action === 'Logout');
    if (activeFilter === 'Vault') return logs.filter(l => l.action === 'Vault Assigned' || l.action === 'Delivery Confirmed' || l.action === 'Vault Reset');
    if (activeFilter === 'OTP') return logs.filter(l => l.action === 'OTP Generated');
    return logs;
  };

  const filteredLogs = filterLogs();

  return (
    <div style={styles.layout}>
      <Navbar currentPath="/logs" onNavigate={navigate} onLogout={handleLogout} />

      {/* MAIN CONTENT — page-enter */}
      <main style={styles.main}>
        <div className="page-enter" style={{ ...styles.content, padding: isMobile ? '1rem' : '2rem' }}>
          <h1 style={{
            ...styles.pageTitle,
            fontSize: isMobile ? '1.5rem' : '1.75rem',
            marginBottom: isMobile ? '1rem' : '1.5rem',
          }}>
            Activity Logs
          </h1>

          {/* Filter Bar — btn-animate filter-btn-animate */}
          <div style={styles.filterBar}>
            {['all', 'Login', 'Vault', 'OTP'].map(filter => (
              <button
                key={filter}
                className="btn-animate filter-btn-animate"
                style={{
                  ...styles.filterBtn,
                  ...(activeFilter === filter ? styles.filterBtnActive : {}),
                }}
                onClick={() => setActiveFilter(filter)}
              >
                {filter.charAt(0).toUpperCase() + filter.slice(1)}
              </button>
            ))}
          </div>

          {/* Loading */}
          {loading && (
            <div style={styles.loadingSpinner}>
              <div style={styles.spinner}></div>
            </div>
          )}

          {/* No Logs */}
          {!loading && filteredLogs.length === 0 && (
            <div style={styles.noLogs}>No activity yet.</div>
          )}

          {/* Logs List — log-item-enter on each item */}
          {!loading && filteredLogs.length > 0 && (
            <div style={styles.logsList}>
              {filteredLogs.map((log) => (
                <div key={log.id} className="log-item-enter" style={styles.logItem}>
                  <div style={{ ...styles.logDot, backgroundColor: getActionColor(log.action) }}></div>
                  <div style={styles.logContent}>
                    <div style={styles.logAction}>{log.action}</div>
                    <div style={styles.logDetails}>{log.details}</div>
                  </div>
                  <div style={styles.logTimestamp}>{formatTimestamp(log.timestamp)}</div>
                </div>
              ))}
            </div>
          )}
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
  filterBar: {
    display: 'flex',
    gap: '0.5rem',
    marginBottom: '1.5rem',
    flexWrap: 'wrap',
  },
  filterBtn: {
    padding: '0.5rem 1rem',
    backgroundColor: '#f4f5f7',
    border: '1px solid transparent',
    borderRadius: '8px',
    fontSize: '0.8125rem',
    color: '#6b7280',
    cursor: 'pointer',
  },
  filterBtnActive: {
    backgroundColor: '#8B0000',
    borderColor: '#8B0000',
    color: '#fff',
  },
  loadingSpinner: {
    display: 'flex',
    justifyContent: 'center',
    padding: '3rem',
  },
  spinner: {
    width: 40,
    height: 40,
    border: '3px solid #e5e7eb',
    borderTopColor: '#8B0000',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  },
  noLogs: {
    textAlign: 'center',
    padding: '3rem',
    color: '#9ca3af',
  },
  logsList: {
    backgroundColor: '#fff',
    borderRadius: '14px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
    border: '1px solid #f0f1f3',
    overflow: 'hidden',
  },
  logItem: {
    display: 'flex',
    alignItems: 'center',
    padding: '1rem 1.25rem',
    borderBottom: '1px solid #f4f5f7',
  },
  logDot: {
    width: 10,
    height: 10,
    borderRadius: '50%',
    marginRight: '1rem',
    flexShrink: 0,
  },
  logContent: {
    flex: 1,
    minWidth: 0,
  },
  logAction: {
    fontWeight: 600,
    color: '#1f2937',
    fontSize: '0.875rem',
  },
  logDetails: {
    color: '#6b7280',
    fontSize: '0.8rem',
    marginTop: '0.25rem',
  },
  logTimestamp: {
    color: '#9ca3af',
    fontSize: '0.75rem',
    marginLeft: '1rem',
    flexShrink: 0,
  },
};

export default ActivityLogs;