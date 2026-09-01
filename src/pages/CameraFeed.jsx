import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { doc, collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db } from '../config/firebase';
import Navbar from '../components/Navbar';

const OFFLINE_THRESHOLD_MS = 10 * 1000;
const SNAPSHOT_HISTORY_LIMIT = 60;

function CameraFeed() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [isMobile, setIsMobile] = useState(false);
  const [cameraData, setCameraData] = useState(null);
  const [now, setNow] = useState(0);
  const [snapshots, setSnapshots] = useState([]);
  const [expandedSession, setExpandedSession] = useState(null);

  useEffect(() => {
    const updateNow = () => setNow(Date.now());
    updateNow();
    const id = setInterval(updateNow, 1000);
    return () => clearInterval(id);
  }, []);

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
    const cameraRef = doc(db, 'users', user.uid, 'camera', 'current');
    const unsubscribe = onSnapshot(
      cameraRef,
      (snap) => setCameraData(snap.exists() ? snap.data() : null),
      (err) => console.error('Camera feed subscription error:', err)
    );
    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, 'users', user.uid, 'cameraSnapshots'),
      orderBy('createdAt', 'desc'),
      limit(SNAPSHOT_HISTORY_LIMIT)
    );
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setSnapshots(items);
      },
      (err) => console.error('Snapshot history subscription error:', err)
    );
    return () => unsubscribe();
  }, [user]);

  const handleLogout = () => {
    logout();
    navigate('/signin');
  };

  const updatedAtMs = cameraData?.updatedAt
    ? (cameraData.updatedAt.toDate
        ? cameraData.updatedAt.toDate().getTime()
        : new Date(cameraData.updatedAt).getTime())
    : null;

  const isOnline = !!cameraData?.imageBase64 && !!updatedAtMs && (now - updatedAtMs < OFFLINE_THRESHOLD_MS);
  const lastUpdatedText = updatedAtMs ? new Date(updatedAtMs).toLocaleString() : 'Never';

  // Group captured frames into delivery sessions (by sessionId from the camera).
  const sessions = useMemo(() => {
    const map = new Map();
    for (const s of snapshots) {
      const key = s.sessionId || 'unsorted';
      if (!map.has(key)) {
        map.set(key, { key, vaultId: s.vaultId || null, frames: [] });
      }
      map.get(key).frames.push(s);
    }
    const list = Array.from(map.values());
    for (const session of list) {
      session.frames.sort((a, b) => toMs(a.createdAt) - toMs(b.createdAt));
      session.startAtMs = session.frames.length > 0 ? toMs(session.frames[0].createdAt) : 0;
    }
    list.sort((a, b) => b.startAtMs - a.startAtMs);
    return list;
  }, [snapshots]);

  const totalStored = snapshots.length;

  const toggleSession = (key) => {
    setExpandedSession((prev) => (prev === key ? null : key));
  };

  const downloadImage = (imageBase64, filename) => {
    const a = document.createElement('a');
    a.href = `data:image/jpeg;base64,${imageBase64}`;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const formatSessionStart = (ms) => (ms ? new Date(ms).toLocaleString() : 'Unknown');

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

          {/* Single camera card — one camera for the entire vault */}
          <div className="card-enter vault-card-animate" style={styles.cameraCard}>
            <div style={styles.cameraHeader}>
              <span style={styles.cameraTitle}>LogiBox Vault Camera</span>
              <span style={{ ...styles.badge, ...(isOnline ? styles.liveBadge : styles.offlineBadge) }}>
                {isOnline ? 'Live' : 'Offline'}
              </span>
            </div>

            {cameraData?.imageBase64 ? (
              <div style={styles.videoWrap}>
                <img
                  src={`data:image/jpeg;base64,${cameraData.imageBase64}`}
                  alt="LogiBox vault camera feed"
                  style={styles.video}
                />
              </div>
            ) : (
              <div style={styles.cameraPlaceholder}>
                <div style={styles.cameraIconCircle}>
                  <svg width={32} height={32} viewBox="0 0 24 24" fill="#9ca3af">
                    <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/>
                  </svg>
                </div>
                <span style={styles.noFeedText}>No Feed Available</span>
                <span style={styles.noFeedSubtext}>Press any key on the keypad to start capturing</span>
              </div>
            )}

            <div style={styles.lastUpdated}>
              Last updated: {lastUpdatedText}
            </div>
          </div>

          {/* Captured Sessions — evidence history */}
          <div style={styles.historySection}>
            <div style={styles.historyHeader}>
              <h2 style={styles.historyTitle}>Captured Sessions</h2>
              <span style={styles.historyCount}>
                {totalStored} frame{totalStored === 1 ? '' : 's'} stored
              </span>
            </div>

            {sessions.length === 0 ? (
              <div style={styles.historyEmpty}>
                No captured sessions yet. Once the keypad starts a delivery, every
                frame is saved here for review.
              </div>
            ) : (
              sessions.map((session) => {
                const isExpanded = expandedSession === session.key;
                const lastFrame = session.frames[session.frames.length - 1];
                return (
                  <div key={session.key} className="card-enter vault-card-animate" style={styles.sessionCard}>
                    <button style={styles.sessionHeader} onClick={() => toggleSession(session.key)}>
                      <div>
                        <div style={styles.sessionTitle}>
                          {session.vaultId ? `Vault ${session.vaultId} delivery` : 'Delivery session'}
                        </div>
                        <div style={styles.sessionMeta}>
                          {formatSessionStart(session.startAtMs)} · {session.frames.length} frame{session.frames.length === 1 ? '' : 's'}
                        </div>
                      </div>
                      <span style={styles.sessionChevron}>{isExpanded ? '▾' : '▸'}</span>
                    </button>

                    {isExpanded && (
                      <div style={styles.sessionBody}>
                        <div style={styles.thumbGrid}>
                          {session.frames.map((frame, i) => (
                            <div key={frame.id} style={styles.thumbWrap}>
                              <img
                                src={`data:image/jpeg;base64,${frame.imageBase64}`}
                                alt={`Frame ${frame.frameIndex ?? i + 1}`}
                                style={styles.thumb}
                              />
                              <div style={styles.thumbFooter}>
                                <span style={styles.thumbTime}>
                                  {frame.createdAt?.toDate ? frame.createdAt.toDate().toLocaleTimeString() : ''}
                                </span>
                                <button
                                  style={styles.downloadBtn}
                                  onClick={() => downloadImage(
                                    frame.imageBase64,
                                    `logibox-vault${session.vaultId ? '-' + session.vaultId : ''}-${i + 1}.jpg`
                                  )}
                                  title="Download image"
                                >
                                  Download
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                        {session.frames.length > 0 && lastFrame && (
                          <button
                            style={styles.downloadAllBtn}
                            onClick={() => {
                              session.frames.forEach((frame, i) => {
                                downloadImage(
                                  frame.imageBase64,
                                  `logibox-vault${session.vaultId ? '-' + session.vaultId : ''}-${i + 1}.jpg`
                                );
                              });
                            }}
                          >
                            Download all ({session.frames.length})
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function toMs(value) {
  if (!value) return 0;
  if (value.toDate) return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  return new Date(value).getTime();
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
  cameraCard: {
    maxWidth: 960,
    width: '100%',
    margin: '0 auto',
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
  badge: {
    padding: '0.25rem 0.75rem',
    borderRadius: '9999px',
    fontSize: '0.7rem',
    fontWeight: 700,
    textTransform: 'uppercase',
  },
  liveBadge: {
    backgroundColor: '#d1fae5',
    color: '#059669',
  },
  offlineBadge: {
    backgroundColor: '#f4f5f7',
    color: '#6b7280',
  },
  videoWrap: {
    aspectRatio: '16/9',
    backgroundColor: '#0f172a',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  video: {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    display: 'block',
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
    width: 72,
    height: 72,
    borderRadius: '50%',
    backgroundColor: 'rgba(255,255,255,0.06)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  noFeedText: {
    color: '#9ca3af',
    fontSize: '0.95rem',
  },
  noFeedSubtext: {
    color: '#6b7280',
    fontSize: '0.8rem',
  },
  lastUpdated: {
    padding: '0.75rem 1.25rem',
    fontSize: '0.8rem',
    color: '#9ca3af',
    borderTop: '1px solid #e5e7eb',
  },
  historySection: {
    maxWidth: 960,
    width: '100%',
    margin: '2rem auto 0',
  },
  historyHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '1rem',
  },
  historyTitle: {
    fontSize: '1.15rem',
    fontWeight: 800,
    color: '#0f172a',
    margin: 0,
  },
  historyCount: {
    fontSize: '0.8rem',
    color: '#6b7280',
  },
  historyEmpty: {
    backgroundColor: '#fff',
    border: '1px solid #f0f1f3',
    borderRadius: '12px',
    padding: '1.5rem',
    color: '#6b7280',
    fontSize: '0.9rem',
  },
  sessionCard: {
    backgroundColor: '#fff',
    borderRadius: '12px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
    border: '1px solid #f0f1f3',
    marginBottom: '0.75rem',
    overflow: 'hidden',
  },
  sessionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    padding: '0.9rem 1.25rem',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    textAlign: 'left',
  },
  sessionTitle: {
    fontSize: '0.95rem',
    fontWeight: 700,
    color: '#1f2937',
  },
  sessionMeta: {
    fontSize: '0.8rem',
    color: '#9ca3af',
    marginTop: '2px',
  },
  sessionChevron: {
    fontSize: '0.9rem',
    color: '#9ca3af',
  },
  sessionBody: {
    padding: '1rem 1.25rem 1.25rem',
    borderTop: '1px solid #f4f5f7',
  },
  thumbGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
    gap: '0.75rem',
  },
  thumbWrap: {
    border: '1px solid #f0f1f3',
    borderRadius: '10px',
    overflow: 'hidden',
    backgroundColor: '#0f172a',
  },
  thumb: {
    width: '100%',
    aspectRatio: '16/9',
    objectFit: 'cover',
    display: 'block',
  },
  thumbFooter: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0.4rem 0.5rem',
    backgroundColor: '#fff',
  },
  thumbTime: {
    fontSize: '0.68rem',
    color: '#9ca3af',
  },
  downloadBtn: {
    fontSize: '0.68rem',
    padding: '0.25rem 0.5rem',
    backgroundColor: '#8B0000',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontWeight: 600,
  },
  downloadAllBtn: {
    marginTop: '1rem',
    padding: '0.5rem 1rem',
    backgroundColor: '#fef2f2',
    color: '#8B0000',
    border: '1px solid #fecaca',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '0.85rem',
    fontWeight: 600,
  },
};

export default CameraFeed;
