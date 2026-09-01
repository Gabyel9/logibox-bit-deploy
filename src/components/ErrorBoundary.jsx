import React, { Component } from 'react';

/**
 * Error Boundary Component
 * Catches unexpected React errors and displays a user-friendly fallback UI
 * instead of crashing the entire application
 */
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  /**
   * Static lifecycle method - called when an error is thrown in a child component
   */
  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  /**
   * Component lifecycle method - called after an error has been thrown
   */
  componentDidCatch(error, errorInfo) {
    // Log the error to console for debugging (but not to user)
    console.error('ErrorBoundary caught an error:', error, errorInfo);

    // Update state with error details (for internal logging only)
    this.setState({
      error,
      errorInfo,
    });
  }

  /**
   * Handler to reset the error state and retry rendering
   */
  handleRetry = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  render() {
    if (this.state.hasError) {
      // Render fallback UI
      return (
        <div style={styles.container}>
          <div style={styles.card}>
            <div style={styles.iconContainer}>
              <svg
                width="64"
                height="64"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#8B0000"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>

            <h1 style={styles.title}>Something went wrong</h1>
            <p style={styles.message}>
              We encountered an unexpected error. Please try again.
            </p>

            <div style={styles.buttonGroup}>
              <button
                onClick={this.handleRetry}
                style={styles.retryButton}
                className="btn-animate"
              >
                Try Again
              </button>

              <button
                onClick={() => window.location.href = '/'}
                style={styles.homeButton}
                className="btn-animate"
              >
                Go to Home
              </button>
            </div>
          </div>
        </div>
      );
    }

    // Normal rendering - render children
    return this.props.children;
  }
}

const styles = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(145deg, #fff8f8 0%, #f4f5f7 60%, #fff 100%)',
    padding: '1rem',
    boxSizing: 'border-box',
    fontFamily: 'var(--font)',
  },
  card: {
    backgroundColor: '#fff',
    padding: '2.5rem',
    borderRadius: '20px',
    boxShadow: '0 4px 24px rgba(0,0,0,0.07), 0 1px 4px rgba(0,0,0,0.05)',
    border: '1px solid #f0f1f3',
    width: '100%',
    maxWidth: '400px',
    textAlign: 'center',
    boxSizing: 'border-box',
  },
  iconContainer: {
    marginBottom: '1.5rem',
    display: 'flex',
    justifyContent: 'center',
  },
  title: {
    color: '#0f172a',
    fontSize: '1.5rem',
    fontWeight: 800,
    marginBottom: '0.75rem',
    marginTop: 0,
  },
  message: {
    color: '#6b7280',
    fontSize: '0.95rem',
    lineHeight: 1.5,
    marginBottom: '1.5rem',
    marginTop: 0,
  },
  buttonGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
  },
  retryButton: {
    width: '100%',
    padding: '0.875rem',
    backgroundColor: '#8B0000',
    color: '#fff',
    border: 'none',
    borderRadius: '10px',
    fontSize: '1rem',
    fontWeight: 700,
    cursor: 'pointer',
    boxSizing: 'border-box',
    fontFamily: 'var(--font)',
  },
  homeButton: {
    width: '100%',
    padding: '0.875rem',
    backgroundColor: '#f4f5f7',
    color: '#374151',
    border: '1px solid #e5e7eb',
    borderRadius: '10px',
    fontSize: '1rem',
    fontWeight: 600,
    cursor: 'pointer',
    boxSizing: 'border-box',
    fontFamily: 'var(--font)',
  },
};

export default ErrorBoundary;