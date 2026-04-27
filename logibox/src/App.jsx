import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SettingsProvider } from './context/SettingsContext';
import Dashboard from './pages/Dashboard';
import CameraFeed from './pages/CameraFeed';
import ActivityLogs from './pages/ActivityLogs';
import Settings from './pages/Settings';
import Help from './pages/Help';
import Landing from './pages/Landing';
import SignIn from './pages/SignIn';
import SignUp from './pages/SignUp';

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <div style={{ padding: '2rem', textAlign: 'center', color: '#7f8c8d' }}>Loading...</div>;
  }

  if (!user) {
    return <Navigate to="/signin" />;
  }

  return children;
}

function PublicRoute({ children }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <div style={{ padding: '2rem', textAlign: 'center', color: '#7f8c8d' }}>Loading...</div>;
  }

  if (user) {
    return <Navigate to="/dashboard" />;
  }

  return children;
}

function AppRoutes() {
  return (
    <div style={styles.container}>
      <main style={styles.mainFull}>
        <Routes>
          <Route path="/" element={<PublicRoute><Landing /></PublicRoute>} />
          <Route path="/signin" element={<PublicRoute><SignIn /></PublicRoute>} />
          <Route path="/signup" element={<PublicRoute><SignUp /></PublicRoute>} />
          <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="/camera" element={<ProtectedRoute><CameraFeed /></ProtectedRoute>} />
          <Route path="/logs" element={<ProtectedRoute><ActivityLogs /></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
          <Route path="/help" element={<ProtectedRoute><Help /></ProtectedRoute>} />
        </Routes>
      </main>
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <SettingsProvider>
        <Router>
          <AppRoutes />
        </Router>
      </SettingsProvider>
    </AuthProvider>
  );
}

const styles = {
  container: {
    minHeight: '100vh',
    backgroundColor: '#f5f6fa',
  },
  mainFull: {
    padding: '0',
    maxWidth: '100%',
    margin: '0 auto',
    width: '100%',
    boxSizing: 'border-box',
  },
};

export default App;
