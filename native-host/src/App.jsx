import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';

function App() {
  const [isRegistered, setIsRegistered] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [extensionId, setExtensionId] = useState('johjkjkidbedgjmogpekmlpfakccnoan');
  const [activeTab, setActiveTab] = useState('register'); // 'register' or 'logs'
  const [logs, setLogs] = useState([]);
  const [testUrl, setTestUrl] = useState('https://www.youtube.com/watch?v=1O0yazhqaxs');
  const [downloading, setDownloading] = useState(false);
  const [hideWindow, setHideWindow] = useState(true);

  useEffect(() => {
    checkRegistrationStatus();
    
    // Listen for log events from Rust backend
    const unlisten = listen('log-event', (event) => {
      const logEntry = {
        timestamp: new Date().toLocaleTimeString(),
        message: event.payload
      };
      setLogs(prev => [...prev, logEntry]);
    });
    
    return () => {
      unlisten.then(fn => fn());
    };
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

  const addLog = (message) => {
    const logEntry = {
      timestamp: new Date().toLocaleTimeString(),
      message
    };
    setLogs(prev => [...prev, logEntry]);
  };

  const handleTestDownload = async () => {
    if (!testUrl.trim()) {
      addLog('❌ Error: Please enter a URL');
      return;
    }

    setDownloading(true);
    addLog(`📥 Starting download: ${testUrl}`);

    try {
      const timestamp = Date.now();
      const outputPath = `C:\\Users\\Admin\\Downloads\\yt-dlp-test-${timestamp}.%(ext)s`;
      
      addLog(`📂 Output template: ${outputPath}`);
      addLog(`⏳ Executing yt-dlp...`);

      const result = await invoke('test_download', { 
        url: testUrl,
        outputPath: outputPath,
        hideWindow: hideWindow
      });

      addLog(`✅ Download successful!`);
      addLog(`📁 File saved to: ${result.filePath || 'Downloads folder'}`);
    } catch (error) {
      addLog(`❌ Download failed: ${error}`);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.title}>ImgVault Native Host</h1>
        
        {/* Tabs */}
        <div style={styles.tabs}>
          <button
            onClick={() => setActiveTab('register')}
            style={{
              ...styles.tab,
              ...(activeTab === 'register' ? styles.activeTab : {})
            }}
          >
            Registration
          </button>
          <button
            onClick={() => setActiveTab('logs')}
            style={{
              ...styles.tab,
              ...(activeTab === 'logs' ? styles.activeTab : {})
            }}
          >
            Logs ({logs.length})
          </button>
        </div>

        {/* Tab Content */}
        {activeTab === 'register' ? (
          <>
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
          </>) : (
          /* Logs Tab */
          <div style={styles.logsContainer}>
            <div style={styles.logsHeader}>
              <span>Native Messaging Logs</span>
              <button onClick={() => setLogs([])} style={styles.clearButton}>
                Clear Logs
              </button>
            </div>

            {/* Test Download Section */}
            <div style={styles.testSection}>
              <label style={styles.label}>Test Download (yt-dlp)</label>
              
              {/* Hide Window Checkbox */}
              <div style={{ marginBottom: '10px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={hideWindow}
                    onChange={(e) => setHideWindow(e.target.checked)}
                    style={{ cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: '14px' }}>Hide CMD Window</span>
                </label>
              </div>

              <div style={{ display: 'flex', gap: '10px' }}>
                <input
                  type="text"
                  value={testUrl}
                  onChange={(e) => setTestUrl(e.target.value)}
                  placeholder="https://www.youtube.com/watch?v=..."
                  style={{ ...styles.input, flex: 1 }}
                  disabled={downloading}
                />
                <button
                  onClick={handleTestDownload}
                  disabled={downloading || !testUrl.trim()}
                  style={{
                    ...styles.downloadButton,
                    opacity: downloading || !testUrl.trim() ? 0.6 : 1
                  }}
                >
                  {downloading ? '⏳ Downloading...' : '📥 Test Download'}
                </button>
              </div>
            </div>

            <div style={styles.logsContent}>
              {logs.length === 0 ? (
                <div style={styles.emptyLogs}>
                  No logs yet. Use the test download button above or wait for the extension to send download requests.
                </div>
              ) : (
                logs.map((log, index) => (
                  <div key={index} style={styles.logEntry}>
                    <span style={styles.logTimestamp}>[{log.timestamp}]</span>
                    <span style={styles.logMessage}>{log.message}</span>
                  </div>
                ))
              )}
            </div>
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
  tabs: {
    display: 'flex',
    gap: '10px',
    marginBottom: '30px',
    borderBottom: '2px solid #e5e7eb',
  },
  tab: {
    padding: '12px 24px',
    fontSize: '16px',
    fontWeight: '600',
    background: 'none',
    border: 'none',
    borderBottom: '3px solid transparent',
    cursor: 'pointer',
    color: '#6b7280',
    transition: 'all 0.2s',
    marginBottom: '-2px',
  },
  activeTab: {
    color: '#667eea',
    borderBottom: '3px solid #667eea',
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
  logsContainer: {
    minHeight: '400px',
    display: 'flex',
    flexDirection: 'column',
  },
  testSection: {
    marginBottom: '20px',
    padding: '15px',
    backgroundColor: '#f9fafb',
    borderRadius: '8px',
    border: '1px solid #e5e7eb',
  },
  downloadButton: {
    padding: '12px 24px',
    fontSize: '14px',
    fontWeight: '600',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'all 0.2s',
    whiteSpace: 'nowrap',
  },
  logsHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '15px',
    fontSize: '16px',
    fontWeight: '600',
    color: '#374151',
  },
  clearButton: {
    padding: '8px 16px',
    fontSize: '14px',
    background: '#ef4444',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  logsContent: {
    flex: 1,
    backgroundColor: '#1f2937',
    borderRadius: '8px',
    padding: '15px',
    fontFamily: 'monospace',
    fontSize: '13px',
    color: '#e5e7eb',
    overflowY: 'auto',
    maxHeight: '400px',
    minHeight: '300px',
  },
  emptyLogs: {
    textAlign: 'center',
    color: '#6b7280',
    padding: '40px 20px',
    fontFamily: 'sans-serif',
  },
  logEntry: {
    marginBottom: '8px',
    padding: '8px',
    borderRadius: '4px',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  logTimestamp: {
    color: '#60a5fa',
    marginRight: '10px',
  },
  logMessage: {
    color: '#e5e7eb',
  },
};

export default App;
