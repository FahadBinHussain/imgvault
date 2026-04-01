import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader, FolderOpen, File, Download } from 'lucide-react';
import { Button, Input } from '../components/UI';

export default function DebugPage() {
  const [filePath, setFilePath] = useState('jenna-ortega-nodding.mp4');
  const [directoryHandle, setDirectoryHandle] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [downloadUrl, setDownloadUrl] = useState('');
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [downloadSuccess, setDownloadSuccess] = useState('');
  const [autoUpload, setAutoUpload] = useState(false);
  const [logs, setLogs] = useState([]);
  const fileInputRef = useRef(null);
  const logsEndRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const addLog = (message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev, { timestamp, message, type }]);
  };

  const isSupported = 'showDirectoryPicker' in window;

  const handleSelectDirectory = async () => {
    if (!isSupported) {
      setError('File System Access API not supported in this browser');
      return;
    }

    try {
      const dirHandle = await window.showDirectoryPicker({ mode: 'read' });
      setDirectoryHandle(dirHandle);
      setError('');
      localStorage.setItem('debugDirectoryName', dirHandle.name);
    } catch (err) {
      if (err.name !== 'AbortError') {
        setError(`Failed to select directory: ${err.message}`);
      }
    }
  };

  const handleUploadFromPath = async () => {
    if (!filePath.trim()) {
      setError('Please enter a file path');
      return;
    }

    if (!directoryHandle) {
      setError('Please select a directory first');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const fileName = filePath.split('\\').pop().split('/').pop();
      const fileHandle = await directoryHandle.getFileHandle(fileName, { create: false });
      const file = await fileHandle.getFile();

      navigate('/gallery', {
        state: {
          autoOpenUpload: true,
          uploadFile: file,
        },
      });
    } catch (err) {
      setError(err.message || 'Failed to access file. Make sure the file exists in the selected directory.');
      setLoading(false);
    }
  };

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setError('');

    try {
      navigate('/gallery', {
        state: {
          autoOpenUpload: true,
          uploadFile: file,
        },
      });
    } catch (err) {
      setError(err.message || 'Failed to process file');
      setLoading(false);
    }
  };

  const handleNativeDownload = async () => {
    if (!downloadUrl.trim()) {
      setError('Please enter a URL to download');
      addLog('Error: Please enter a URL to download', 'error');
      return;
    }

    setDownloadLoading(true);
    setError('');
    setDownloadSuccess('');
    addLog(`Starting download: ${downloadUrl}`, 'info');

    try {
      addLog('Sending message to background script...', 'info');

      const response = await chrome.runtime.sendMessage({
        action: 'nativeDownload',
        url: downloadUrl,
      });

      addLog('Received response from background script', 'info');
      addLog(`Response: ${JSON.stringify(response)}`, 'debug');

      if (response.success) {
        const successMsg = `Downloaded: ${response.filePath || 'Success!'}`;
        setDownloadSuccess(successMsg);
        addLog(successMsg, 'success');

        if (autoUpload && response.filePath) {
          addLog('Auto-open modal enabled, navigating to gallery...', 'info');
          addLog(`Downloaded file: ${response.filePath}`, 'info');

          setTimeout(() => {
            navigate('/gallery', {
              state: {
                autoOpenUpload: true,
                downloadFilePath: response.filePath,
              },
            });
          }, 1000);
        }

        setDownloadUrl('');
      } else {
        const errorMsg = response.error || 'Download failed';
        setError(errorMsg);
        addLog(`Download failed: ${errorMsg}`, 'error');
      }
    } catch (err) {
      const errorMsg = err.message || "Failed to communicate with native host. Make sure it's registered.";
      setError(errorMsg);
      addLog(`Exception: ${errorMsg}`, 'error');
    } finally {
      setDownloadLoading(false);
      addLog('Download request completed', 'info');
    }
  };

  const logClassName = (type) => {
    if (type === 'error') return 'bg-error/15 text-error';
    if (type === 'success') return 'bg-success/15 text-success';
    if (type === 'debug') return 'bg-info/15 text-info';
    return 'bg-base-200 text-base-content/80';
  };

  return (
    <div className="min-h-screen bg-base-200 text-base-content p-3 sm:p-6 lg:p-8">
      <div className="max-w-2xl mx-auto space-y-6 w-full">
        <h1 className="text-3xl sm:text-4xl font-bold text-base-content mb-8">Debug Upload</h1>

        {!isSupported && (
          <div className="p-4 bg-warning/15 border border-warning/40 rounded-xl text-warning">
            File System Access API not supported in this browser. Please use the manual file picker instead.
          </div>
        )}

        {isSupported && (
          <div className="bg-base-100 border border-base-content/15 rounded-xl p-6 space-y-4 shadow-xl">
            <h2 className="text-lg font-semibold text-base-content">1. Select Directory</h2>
            <Button onClick={handleSelectDirectory} variant="primary" className="w-full justify-center gap-2">
              <FolderOpen size={20} />
              {directoryHandle ? `Selected: ${directoryHandle.name}` : 'Select Directory'}
            </Button>
            {directoryHandle && <p className="text-sm text-success">Directory access granted</p>}
          </div>
        )}

        {isSupported && (
          <div className="bg-base-100 border border-base-content/15 rounded-xl p-6 space-y-4 shadow-xl">
            <h2 className="text-lg font-semibold text-base-content">2. Upload from Path</h2>
            <div>
              <label className="text-sm font-semibold text-base-content/80 mb-2 block">
                File Name (in selected directory)
              </label>
              <Input
                type="text"
                value={filePath}
                onChange={(e) => setFilePath(e.target.value)}
                placeholder="jenna-ortega-nodding.mp4"
                className="shadow-sm"
                disabled={loading}
              />
              <p className="text-xs text-base-content/60 mt-1">Enter just the filename (e.g., video.mp4)</p>
            </div>

            <Button
              onClick={handleUploadFromPath}
              disabled={loading || !directoryHandle}
              variant="primary"
              className="w-full justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader className="animate-spin" size={20} />
                  Loading...
                </>
              ) : (
                <>
                  <File size={20} />
                  Load File & Open Upload
                </>
              )}
            </Button>
          </div>
        )}

        <div className="bg-base-100 border border-base-content/15 rounded-xl p-6 space-y-4 shadow-xl">
          <h2 className="text-lg font-semibold text-base-content">
            {isSupported ? '3. Or Use File Picker' : 'Upload File'}
          </h2>
          <input
            ref={fileInputRef}
            type="file"
            onChange={handleFileSelect}
            accept="image/*,video/*"
            className="hidden"
            disabled={loading}
          />
          <Button onClick={() => fileInputRef.current?.click()} disabled={loading} variant="outline" className="w-full justify-center gap-2">
            {loading ? (
              <>
                <Loader className="animate-spin" size={20} />
                Loading...
              </>
            ) : (
              <>
                <FolderOpen size={20} />
                Choose File & Open Upload...
              </>
            )}
          </Button>
        </div>

        <div className="bg-base-100 border border-base-content/15 rounded-xl p-6 space-y-4 shadow-xl">
          <h2 className="text-lg font-semibold text-base-content flex items-center gap-2">
            <Download size={20} className="text-primary" />
            {isSupported ? '4. Native Host Download (yt-dlp)' : 'Native Host Download (yt-dlp)'}
          </h2>
          <p className="text-sm text-base-content/70">Download videos using yt-dlp via the native messaging host</p>

          <div className="flex items-center gap-3 p-3 bg-base-200 rounded-lg border border-base-content/10">
            <input
              type="checkbox"
              id="autoUpload"
              checked={autoUpload}
              onChange={(e) => setAutoUpload(e.target.checked)}
              className="w-4 h-4 rounded border-primary text-primary focus:ring-primary cursor-pointer"
            />
            <label htmlFor="autoUpload" className="text-sm text-base-content/80 cursor-pointer flex-1">
              Auto-open upload modal after download
            </label>
          </div>

          <div>
            <label className="text-sm font-semibold text-base-content/80 mb-2 block">Video URL</label>
            <Input
              type="text"
              value={downloadUrl}
              onChange={(e) => setDownloadUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
              className="shadow-sm"
              disabled={downloadLoading}
            />
          </div>

          <Button
            onClick={handleNativeDownload}
            disabled={downloadLoading || !downloadUrl.trim()}
            variant="primary"
            className="w-full justify-center gap-2"
          >
            {downloadLoading ? (
              <>
                <Loader className="animate-spin" size={20} />
                Downloading...
              </>
            ) : (
              <>
                <Download size={20} />
                Download with yt-dlp
              </>
            )}
          </Button>

          {downloadSuccess && (
            <div className="p-3 bg-success/15 border border-success/40 rounded-lg text-success text-sm">
              {downloadSuccess}
            </div>
          )}
        </div>

        {logs.length > 0 && (
          <div className="bg-base-100 border border-base-content/15 rounded-xl p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-base-content">Debug Logs</h2>
              <Button onClick={() => setLogs([])} variant="outline" size="sm">
                Clear
              </Button>
            </div>
            <div className="max-h-96 overflow-y-auto space-y-1 font-mono text-xs">
              {logs.map((log, index) => (
                <div key={index} className={`p-2 rounded ${logClassName(log.type)}`}>
                  <span className="text-base-content/50">[{log.timestamp}]</span> {log.message}
                </div>
              ))}
              <div ref={logsEndRef} />
            </div>
          </div>
        )}

        {error && (
          <div className="p-4 bg-error/15 border border-error/40 rounded-lg text-error">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
