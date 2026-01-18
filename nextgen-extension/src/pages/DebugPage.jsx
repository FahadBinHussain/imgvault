import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader, FolderOpen, File, Download } from 'lucide-react';

export default function DebugPage() {
  const [filePath, setFilePath] = useState('jenna-ortega-nodding.mp4');
  const [directoryHandle, setDirectoryHandle] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [downloadUrl, setDownloadUrl] = useState('');
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [downloadSuccess, setDownloadSuccess] = useState('');
  const fileInputRef = useRef(null);
  const navigate = useNavigate();

  // Check if File System Access API is supported
  const isSupported = 'showDirectoryPicker' in window;

  const handleSelectDirectory = async () => {
    if (!isSupported) {
      setError('File System Access API not supported in this browser');
      return;
    }

    try {
      const dirHandle = await window.showDirectoryPicker({
        mode: 'read'
      });
      setDirectoryHandle(dirHandle);
      setError('');
      // Store handle for future use
      localStorage.setItem('debugDirectoryName', dirHandle.name);
    } catch (err) {
      if (err.name !== 'AbortError') {
        setError('Failed to select directory: ' + err.message);
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
      // Parse the file path to extract filename
      const fileName = filePath.split('\\').pop().split('/').pop();
      
      // Get file handle from directory
      const fileHandle = await directoryHandle.getFileHandle(fileName, { create: false });
      const file = await fileHandle.getFile();

      // Navigate to gallery with file data
      navigate('/gallery', { 
        state: { 
          autoOpenUpload: true,
          uploadFile: file
        } 
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
      // Navigate to gallery with file data
      navigate('/gallery', { 
        state: { 
          autoOpenUpload: true,
          uploadFile: file
        } 
      });
    } catch (err) {
      setError(err.message || 'Failed to process file');
      setLoading(false);
    }
  };

  const handleNativeDownload = async () => {
    if (!downloadUrl.trim()) {
      setError('Please enter a URL to download');
      return;
    }

    setDownloadLoading(true);
    setError('');
    setDownloadSuccess('');

    try {
      // Send message to native host via background script
      const response = await chrome.runtime.sendMessage({
        action: 'nativeDownload',
        url: downloadUrl
      });

      if (response.success) {
        setDownloadSuccess(`✓ Downloaded: ${response.filePath || 'Success!'}`);
        setDownloadUrl('');
      } else {
        setError(response.error || 'Download failed');
      }
    } catch (err) {
      setError(err.message || 'Failed to communicate with native host. Make sure it\'s registered.');
    } finally {
      setDownloadLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-8">
      <div className="max-w-2xl mx-auto space-y-6">
        <h1 className="text-4xl font-bold text-white mb-8">
          🐛 Debug Upload
        </h1>

        {!isSupported && (
          <div className="p-4 bg-yellow-900/30 border border-yellow-500/50 rounded-xl text-yellow-300">
            ⚠️ File System Access API not supported in this browser. Please use the manual file picker instead.
          </div>
        )}

        {/* Directory Selection */}
        {isSupported && (
          <div className="bg-slate-800/50 backdrop-blur-sm border border-white/10 rounded-xl p-6 space-y-4">
            <h2 className="text-lg font-semibold text-white">1. Select Directory</h2>
            <button
              onClick={handleSelectDirectory}
              className="w-full px-4 py-3 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 rounded-lg text-white font-medium flex items-center justify-center gap-2 transition-all"
            >
              <FolderOpen size={20} />
              {directoryHandle ? `Selected: ${directoryHandle.name}` : 'Select Directory'}
            </button>
            {directoryHandle && (
              <p className="text-sm text-green-400">✓ Directory access granted</p>
            )}
          </div>
        )}

        {/* File Path Upload */}
        {isSupported && (
          <div className="bg-slate-800/50 backdrop-blur-sm border border-white/10 rounded-xl p-6 space-y-4">
            <h2 className="text-lg font-semibold text-white">2. Upload from Path</h2>
            <div>
              <label className="text-sm font-semibold text-slate-300 mb-2 block">
                File Name (in selected directory)
              </label>
              <input
                type="text"
                value={filePath}
                onChange={(e) => setFilePath(e.target.value)}
                placeholder="jenna-ortega-nodding.mp4"
                className="w-full px-4 py-3 bg-slate-900/50 border border-white/20 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
                disabled={loading}
              />
              <p className="text-xs text-slate-400 mt-1">Enter just the filename (e.g., video.mp4)</p>
            </div>

            <button
              onClick={handleUploadFromPath}
              disabled={loading || !directoryHandle}
              className="w-full px-6 py-3 bg-gradient-to-r from-primary-600 to-secondary-600 hover:from-primary-500 hover:to-secondary-500 rounded-lg text-white font-medium flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
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
            </button>
          </div>
        )}

        {/* Manual File Picker */}
        <div className="bg-slate-800/50 backdrop-blur-sm border border-white/10 rounded-xl p-6 space-y-4">
          <h2 className="text-lg font-semibold text-white">
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
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={loading}
            className="w-full px-4 py-3 bg-slate-900/50 border border-white/20 rounded-lg text-white hover:bg-slate-900/70 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
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
          </button>
        </div>

        {/* Native Host Download */}
        <div className="bg-gradient-to-br from-purple-900/30 to-pink-900/30 backdrop-blur-sm border border-purple-500/30 rounded-xl p-6 space-y-4">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Download size={20} className="text-purple-400" />
            {isSupported ? '4. Native Host Download (yt-dlp)' : 'Native Host Download (yt-dlp)'}
          </h2>
          <p className="text-sm text-slate-300">
            Download videos using yt-dlp via the native messaging host
          </p>
          <div>
            <label className="text-sm font-semibold text-slate-300 mb-2 block">
              Video URL
            </label>
            <input
              type="text"
              value={downloadUrl}
              onChange={(e) => setDownloadUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
              className="w-full px-4 py-3 bg-slate-900/50 border border-purple-500/30 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
              disabled={downloadLoading}
            />
          </div>

          <button
            onClick={handleNativeDownload}
            disabled={downloadLoading || !downloadUrl.trim()}
            className="w-full px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 rounded-lg text-white font-medium flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
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
          </button>

          {downloadSuccess && (
            <div className="p-3 bg-green-900/30 border border-green-500/50 rounded-lg text-green-300 text-sm">
              {downloadSuccess}
            </div>
          )}
        </div>

        {error && (
          <div className="p-4 bg-red-900/30 border border-red-500/50 rounded-lg text-red-300">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
