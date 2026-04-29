import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Navbar from '../components/Navbar';

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
      <Navbar currentPath="/help" onNavigate={navigate} onLogout={handleLogout} />

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
};

export default Help;