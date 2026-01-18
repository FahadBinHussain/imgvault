import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/tauri';

function App() {
  const [isRegistered, setIsRegistered] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [extensionId, setExtensionId] = useState('johjkjkidbedgjmogpekmlpfakccnoan');

  useEffect(() => {
    checkRegistrationStatus();
  }, []);

  const checkRegistrationStatus = async () => {
    try {
      const status = await invoke('check_registration');
      setIsRegistered(status);
    } catch (error) {
      console.error('Failed to check registration:', error);
    }
  };

  const handleRegister = async () => {
    if (!extensionId.trim()) {
      setMessage('Please enter your extension ID');
      return;
    }

    if (extensionId.trim().length < 20) {
      setMessage('Extension ID seems too short. Please check it.');
      return;
    }

    setLoading(true);
    setMessage('');
    
    try {
      await invoke('register_host', { extensionId: extensionId.trim() });
      setIsRegistered(true);
      setMessage('Successfully registered ImgVault Native Host!');
      // Recheck registration status
      await checkRegistrationStatus();
    } catch (error) {
      setMessage(`Registration failed: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  const handleUnregister = async () => {
    setLoading(true);
    setMessage('');
    
    try {
      await invoke('unregister_host');
      setIsRegistered(false);
      setMessage('Successfully unregistered ImgVault Native Host!');
    } catch (error) {
      setMessage(`Unregister failed: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.title}>ImgVault Native Host</h1>
        
        <div style={styles.statusSection}>
          <div style={styles.statusLabel}>Status:</div>
          <div style={{
            ...styles.statusBadge,
            backgroundColor: isRegistered ? '#10b981' : '#ef4444'
          }}>
            {isRegistered ? 'Registered' : 'Not Registered'}
          </div>
        </div>

        {message && (
          <div style={{
            ...styles.message,
            backgroundColor: isRegistered ? '#d1fae5' : '#fee2e2',
            color: isRegistered ? '#065f46' : '#991b1b'
          }}>
            {message}
          </div>
        )}

        {!isRegistered && (
          <>
            <div style={{ marginBottom: '20px' }}>
              <label style={styles.label}>Extension ID</label>
              <input
                type="text"
                value={extensionId}
                onChange={(e) => setExtensionId(e.target.value)}
                placeholder="johjkjkidbedgjmogpekmlpfakccnoan"
                style={styles.input}
                disabled={loading}
              />
              <div style={styles.hint}>
                Open your extension → Right-click → Inspect → Console → Type: <code>chrome.runtime.id</code>
              </div>
            </div>

            <button
              onClick={handleRegister}
              disabled={loading || !extensionId.trim()}
              style={{
                ...styles.button,
                opacity: loading || !extensionId.trim() ? 0.6 : 1,
                cursor: loading || !extensionId.trim() ? 'not-allowed' : 'pointer'
              }}
            >
              {loading ? 'Registering...' : 'Register'}
            </button>
          </>
        )}

        {isRegistered && (
          <div style={styles.info}>
            <p>The native host is now registered and ready to receive messages from the ImgVault extension.</p>
            <p style={{ marginTop: '10px', fontSize: '14px', color: '#666' }}>
              You can close this window. To use the native messaging feature, run this app with the --native flag.
            </p>
            <button
              onClick={handleUnregister}
              disabled={loading}
              style={{
                ...styles.unregisterButton,
                opacity: loading ? 0.6 : 1,
                cursor: loading ? 'not-allowed' : 'pointer'
              }}
            >
              {loading ? 'Unregistering...' : 'Unregister'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  container: {
    width: '100%',
    maxWidth: '600px',
    margin: '0 auto',
  },
  card: {
    backgroundColor: 'white',
    borderRadius: '12px',
    padding: '40px',
    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
  },
  title: {
    fontSize: '28px',
    fontWeight: 'bold',
    color: '#1f2937',
    marginBottom: '30px',
    textAlign: 'center',
  },
  statusSection: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: '30px',
    gap: '15px',
  },
  statusLabel: {
    fontSize: '18px',
    fontWeight: '600',
    color: '#4b5563',
  },
  statusBadge: {
    padding: '8px 20px',
    borderRadius: '20px',
    color: 'white',
    fontWeight: '600',
    fontSize: '16px',
  },
  message: {
    padding: '15px',
    borderRadius: '8px',
    marginBottom: '20px',
    fontSize: '14px',
    fontWeight: '500',
  },
  button: {
    width: '100%',
    padding: '15px',
    fontSize: '18px',
    fontWeight: '600',
    color: 'white',
    backgroundColor: '#667eea',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  unregisterButton: {
    width: '100%',
    padding: '12px',
    fontSize: '16px',
    fontWeight: '600',
    color: 'white',
    backgroundColor: '#ef4444',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'all 0.2s',
    marginTop: '15px',
  },
  label: {
    display: 'block',
    fontSize: '14px',
    fontWeight: '600',
    color: '#374151',
    marginBottom: '8px',
  },
  input: {
    width: '100%',
    padding: '12px',
    fontSize: '14px',
    fontFamily: 'monospace',
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    outline: 'none',
    transition: 'border-color 0.2s',
  },
  hint: {
    marginTop: '8px',
    fontSize: '12px',
    color: '#6b7280',
    lineHeight: '1.5',
  },
  info: {
    backgroundColor: '#f3f4f6',
    padding: '20px',
    borderRadius: '8px',
    fontSize: '15px',
    color: '#374151',
    lineHeight: '1.6',
  },
};

export default App;
