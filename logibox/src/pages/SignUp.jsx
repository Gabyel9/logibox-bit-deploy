import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

function SignUp() {
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { signup } = useAuth();
  const navigate = useNavigate();

  const handleChange = (e) => {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match');
      setLoading(false);
      return;
    }

    if (formData.password.length < 6) {
      setError('Password must be at least 6 characters');
      setLoading(false);
      return;
    }

    try {
      await signup(
        formData.email,
        formData.password,
        formData.firstName,
        formData.lastName
      );
      navigate('/dashboard');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div className="page-enter" style={styles.card}>

        <div style={styles.logoContainer}>
          <img
            src="/LOGO LOGIBOX.png"
            alt="LogiBox"
            style={styles.logo}
          />
        </div>

        <h1 style={styles.title}>Create Account</h1>
        <p style={styles.subtitle}>Get started with LogiBox</p>

        {error && <div style={styles.error}>{error}</div>}

        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.row}>
            <div style={styles.formGroup}>
              <label style={styles.label}>First Name</label>
              <input
                className="input-animate"
                type="text"
                name="firstName"
                value={formData.firstName}
                onChange={handleChange}
                style={styles.input}
                placeholder="First name"
                required
              />
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Last Name</label>
              <input
                className="input-animate"
                type="text"
                name="lastName"
                value={formData.lastName}
                onChange={handleChange}
                style={styles.input}
                placeholder="Last name"
                required
              />
            </div>
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Email</label>
            <input
              className="input-animate"
              type="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              style={styles.input}
              placeholder="Enter your email"
              required
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Password</label>
            <input
              className="input-animate"
              type="password"
              name="password"
              value={formData.password}
              onChange={handleChange}
              style={styles.input}
              placeholder="Create a password"
              required
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Confirm Password</label>
            <input
              className="input-animate"
              type="password"
              name="confirmPassword"
              value={formData.confirmPassword}
              onChange={handleChange}
              style={styles.input}
              placeholder="Confirm your password"
              required
            />
          </div>

          <button
            className="btn-animate"
            type="submit"
            style={styles.submitBtn}
            disabled={loading}
          >
            {loading ? 'Creating account...' : 'Create Account'}
          </button>
        </form>

        <p style={styles.footer}>
          Already have an account?{' '}
          <Link to="/signin" style={styles.link}>Sign In</Link>
        </p>

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
    padding: '1rem',
  },
  card: {
    backgroundColor: '#fff',
    padding: '2.5rem',
    borderRadius: '16px',
    boxShadow: '0 8px 32px rgba(0,0,0,0.08)',
    width: '100%',
    maxWidth: '450px',
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
    color: '#1f2937',
    marginBottom: '0.5rem',
    fontSize: '1.75rem',
    fontWeight: 'bold',
  },
  subtitle: {
    textAlign: 'center',
    color: '#6b7280',
    marginBottom: '1.5rem',
    fontSize: '1rem',
  },
  error: {
    padding: '0.75rem',
    backgroundColor: '#fee2e2',
    border: '1px solid #ef4444',
    borderRadius: '8px',
    color: '#dc2626',
    marginBottom: '1rem',
    fontSize: '0.9rem',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1.25rem',
  },
  row: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '1rem',
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  },
  label: {
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#374151',
  },
  input: {
    padding: '0.75rem',
    border: '1px solid #d1d5db',
    borderRadius: '12px',
    fontSize: '1rem',
  },
  submitBtn: {
    padding: '0.875rem',
    backgroundColor: '#9B0000',
    color: '#fff',
    border: 'none',
    borderRadius: '12px',
    fontSize: '1rem',
    fontWeight: '600',
    cursor: 'pointer',
    marginTop: '0.5rem',
  },
  footer: {
    textAlign: 'center',
    marginTop: '1.5rem',
    color: '#6b7280',
    fontSize: '0.9rem',
  },
  link: {
    color: '#9B0000',
    textDecoration: 'none',
    fontWeight: '600',
  },
};

export default SignUp;