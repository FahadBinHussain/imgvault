import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Cable, RotateCw, Download, CheckCircle2, AlertCircle, Activity } from 'lucide-react';
import GalleryNavbar from '../components/GalleryNavbar';

function toNetscapeCookieLine(cookie) {
  const domain = cookie.domain || '';
  const includeSubdomains = domain.startsWith('.') ? 'TRUE' : 'FALSE';
  const path = cookie.path || '/';
  const secure = cookie.secure ? 'TRUE' : 'FALSE';
  const expiration =
    typeof cookie.expirationDate === 'number'
      ? Math.floor(cookie.expirationDate).toString()
      : '0';

  return [
    domain,
    includeSubdomains,
    path,
    secure,
    expiration,
    cookie.name || '',
    cookie.value || '',
  ].join('\t');
}

function HostLog({ entry }) {
  const colorClass =
    entry.type === 'error'
      ? 'bg-red-500/10 text-red-300 border-red-500/20'
      : entry.type === 'success'
        ? 'bg-green-500/10 text-green-300 border-green-500/20'
        : 'bg-base-200/70 text-base-content/80 border-base-content/10';

  return (
    <div className={`rounded-lg border px-3 py-2 text-sm leading-5 ${colorClass}`}>
      <span className="mr-2 text-xs opacity-60">[{entry.timestamp}]</span>
      <span className="whitespace-pre-wrap break-all font-mono text-[12px]">{entry.message}</span>
    </div>
  );
}

export default function HostPage() {
  const navigate = useNavigate();
  const [navbarHeight, setNavbarHeight] = useState(0);
  const [downloadUrl, setDownloadUrl] = useState('');
  const [logs, setLogs] = useState([]);
  const [busyAction, setBusyAction] = useState('');
  const [hostStatus, setHostStatus] = useState({
    checking: true,
    reachable: false,
    hostMessage: 'Checking native host...',
    ytDlpAvailable: false,
    ytDlpMessage: 'Checking yt-dlp...',
    cookiesAvailable: false,
    cookiesMessage: 'Checking cookies.txt...',
  });

  const addLog = (message, type = 'info') => {
    setLogs((prev) => [
      {
        timestamp: new Date().toLocaleTimeString(),
        message,
        type,
      },
      ...prev,
    ]);
  };

  const addRawLogBlock = (label, value, type = 'info') => {
    if (!value || !String(value).trim()) {
      return;
    }

    String(value)
      .split(/\r?\n/)
      .filter((line) => line.length > 0)
      .forEach((line) => addLog(`${label}${line}`, type));
  };

  const runHostCommand = async (command, data = {}) => {
    setBusyAction(command);

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'nativeHostCommand',
        command,
        data,
      });

      if (!response?.success) {
        throw new Error(response?.error || 'Command failed');
      }

      addLog(response.data?.message || `${command} completed`, 'success');
      return response.data;
    } catch (error) {
      addLog(error.message || `${command} failed`, 'error');
      throw error;
    } finally {
      setBusyAction('');
    }
  };

  const handleReloadPath = async () => {
    addLog('Requesting PATH reload from native host...');
    await runHostCommand('reload_path');
    await refreshHostStatus();
  };

  const refreshHostStatus = async () => {
    setHostStatus((prev) => ({
      ...prev,
      checking: true,
      hostMessage: 'Checking native host...',
      ytDlpMessage: 'Checking yt-dlp...',
      cookiesMessage: 'Checking cookies.txt...',
    }));

    try {
      const pingResponse = await chrome.runtime.sendMessage({
        action: 'nativeHostCommand',
        command: 'ping',
        data: {},
      });

      if (!pingResponse?.success) {
        throw new Error(pingResponse?.error || 'Native host unreachable');
      }

      const nextStatus = {
        checking: false,
        reachable: true,
        hostMessage: pingResponse.data?.message || 'Native host reachable',
        ytDlpAvailable: false,
        ytDlpMessage: 'Checking yt-dlp...',
        cookiesAvailable: false,
        cookiesMessage: 'Checking cookies.txt...',
      };

      try {
        const [ytDlpResponse, cookiesResponse] = await Promise.all([
          chrome.runtime.sendMessage({
            action: 'nativeHostCommand',
            command: 'check_yt_dlp',
            data: {},
          }),
          chrome.runtime.sendMessage({
            action: 'nativeHostCommand',
            command: 'check_cookies',
            data: {},
          }),
        ]);

        const mergedStatus = {
          ...nextStatus,
          ytDlpAvailable: !!ytDlpResponse?.success,
          ytDlpMessage: ytDlpResponse?.success
            ? ytDlpResponse.data?.message || 'yt-dlp available'
            : ytDlpResponse?.error || 'yt-dlp not available',
          cookiesAvailable: !!cookiesResponse?.success,
          cookiesMessage: cookiesResponse?.success
            ? cookiesResponse.data?.message || 'cookies.txt found'
            : cookiesResponse?.error || 'cookies.txt not found',
        };

        setHostStatus(mergedStatus);
        addLog(mergedStatus.ytDlpMessage, ytDlpResponse?.success ? 'success' : 'error');
        addLog(mergedStatus.cookiesMessage, cookiesResponse?.success ? 'success' : 'error');
      } catch (error) {
        setHostStatus({
          ...nextStatus,
          ytDlpAvailable: false,
          ytDlpMessage: error.message || 'yt-dlp check failed',
          cookiesAvailable: false,
          cookiesMessage: error.message || 'cookies.txt check failed',
        });
        addLog(error.message || 'Host status check failed', 'error');
      }
    } catch (error) {
      setHostStatus({
        checking: false,
        reachable: false,
        hostMessage: error.message || 'Native host unreachable',
        ytDlpAvailable: false,
        ytDlpMessage: 'yt-dlp not checked',
        cookiesAvailable: false,
        cookiesMessage: 'cookies.txt not checked',
      });
      addLog(error.message || 'Native host unreachable', 'error');
    }
  };

  useEffect(() => {
    refreshHostStatus();
  }, []);

  const handleNativeDownload = async () => {
    if (!downloadUrl.trim()) {
      addLog('Enter a video URL first.', 'error');
      return;
    }

    setBusyAction('download');
    addLog(`Sending native download request: ${downloadUrl}`);

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'nativeDownload',
        url: downloadUrl,
      });

      if (!response?.success) {
        throw response || new Error('Download failed');
      }

      addLog(`Downloaded to: ${response.filePath || 'completed'}`, 'success');
      addRawLogBlock('[yt-dlp stderr] ', response.stderr, 'info');
      addRawLogBlock('[yt-dlp stdout] ', response.stdout, 'info');
    } catch (error) {
      addLog(error?.error || error?.message || 'Download failed', 'error');
      addRawLogBlock('[yt-dlp stderr] ', error?.stderr, 'error');
      addRawLogBlock('[yt-dlp stdout] ', error?.stdout, 'info');
    } finally {
      setBusyAction('');
    }
  };

  const handleExportYoutubeCookies = async () => {
    setBusyAction('export_cookies');
    addLog('Collecting YouTube cookies from Chrome...');

    try {
      const [youtubeCookies, googleCookies] = await Promise.all([
        chrome.cookies.getAll({ domain: '.youtube.com' }),
        chrome.cookies.getAll({ domain: '.google.com' }),
      ]);

      const allCookies = [...youtubeCookies, ...googleCookies];

      if (allCookies.length === 0) {
        throw new Error('No YouTube/Google cookies found in Chrome.');
      }

      const uniqueCookies = Array.from(
        new Map(
          allCookies.map((cookie) => [
            `${cookie.domain}|${cookie.path}|${cookie.name}|${cookie.storeId ?? ''}`,
            cookie,
          ])
        ).values()
      );

      const contents = [
        '# Netscape HTTP Cookie File',
        '# Exported by ImgVault',
        ...uniqueCookies.map(toNetscapeCookieLine),
        '',
      ].join('\n');

      const blob = new Blob([contents], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);

      try {
        const downloadId = await chrome.downloads.download({
          url,
          filename: 'cookies.txt',
          saveAs: true,
          conflictAction: 'overwrite',
        });

        addLog(`cookies.txt exported successfully (download ${downloadId})`, 'success');
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 30000);
      }
    } catch (error) {
      addLog(error.message || 'Failed to export YouTube cookies.', 'error');
    } finally {
      setBusyAction('');
    }
  };

  return (
    <div className="min-h-screen bg-base-200 text-base-content p-3 sm:p-6">
      <GalleryNavbar
        navigate={navigate}
        images={[]}
        reload={() => {}}
        toggleSelectionMode={() => {}}
        selectionMode={false}
        collectionsLoading={false}
        collections={[]}
        trashLoading={false}
        trashedImages={[]}
        openUploadModal={() => {}}
        searchQuery=""
        setSearchQuery={() => {}}
        selectedImages={new Set()}
        selectAll={() => {}}
        filteredImages={[]}
        deselectAll={() => {}}
        setShowBulkDeleteConfirm={() => {}}
        isDeleting={false}
        onHeightChange={setNavbarHeight}
        isHostPage={true}
      />

      <div style={{ height: navbarHeight ? `${navbarHeight + 8}px` : '90px' }} />

      <div className="max-w-4xl mx-auto space-y-6">
        <div className="bg-base-100 border border-base-content/15 rounded-2xl shadow-xl p-5 sm:p-6">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-primary/15 text-primary flex items-center justify-center">
              <Cable className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Native Host</h1>
              <p className="text-sm text-base-content/70 mt-1">
                Send commands to the installed native host from inside the extension.
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] items-start">
          <div className="min-w-0 bg-base-100 border border-base-content/15 rounded-2xl shadow-xl p-5 sm:p-6 space-y-5">
            <div className="rounded-xl border border-base-content/15 bg-base-200/60 p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4" />
                  <h3 className="font-medium">Host Status</h3>
                </div>
                <button
                  onClick={refreshHostStatus}
                  disabled={hostStatus.checking}
                  className="text-sm text-base-content/70 hover:text-base-content disabled:opacity-60"
                >
                  {hostStatus.checking ? 'Checking...' : 'Refresh'}
                </button>
              </div>

              <div className={`rounded-lg border px-3 py-2 text-sm ${hostStatus.reachable ? 'border-green-500/20 bg-green-500/10 text-green-300' : 'border-red-500/20 bg-red-500/10 text-red-300'}`}>
                <div className="font-medium">Native Host</div>
                <div className="mt-1">{hostStatus.hostMessage}</div>
              </div>

              <div className={`rounded-lg border px-3 py-2 text-sm ${hostStatus.ytDlpAvailable ? 'border-green-500/20 bg-green-500/10 text-green-300' : 'border-amber-500/20 bg-amber-500/10 text-amber-300'}`}>
                <div className="font-medium">yt-dlp</div>
                <div className="mt-1 break-all">{hostStatus.ytDlpMessage}</div>
              </div>

              <div className={`rounded-lg border px-3 py-2 text-sm ${hostStatus.cookiesAvailable ? 'border-green-500/20 bg-green-500/10 text-green-300' : 'border-amber-500/20 bg-amber-500/10 text-amber-300'}`}>
                <div className="font-medium">cookies.txt</div>
                <div className="mt-1 break-all">{hostStatus.cookiesMessage}</div>
              </div>
            </div>

            <div>
              <h2 className="text-lg font-semibold">Host Actions</h2>
              <p className="text-sm text-base-content/65 mt-1">
                Quick controls for the currently registered native host.
              </p>
            </div>

            <button
              onClick={handleReloadPath}
              disabled={busyAction === 'reload_path'}
              className="w-full rounded-xl bg-base-200 hover:bg-base-300 border border-base-content/15 px-4 py-3 text-left transition-colors disabled:opacity-60"
            >
              <div className="flex items-center gap-3">
                <RotateCw className={`w-5 h-5 ${busyAction === 'reload_path' ? 'animate-spin' : ''}`} />
                <div>
                  <div className="font-medium">Reload PATH</div>
                  <div className="text-sm text-base-content/65">Refresh environment variables inside the host process.</div>
                </div>
              </div>
            </button>

            <button
              onClick={handleExportYoutubeCookies}
              disabled={busyAction === 'export_cookies'}
              className="w-full rounded-xl bg-base-200 hover:bg-base-300 border border-base-content/15 px-4 py-3 text-left transition-colors disabled:opacity-60"
            >
              <div className="flex items-center gap-3">
                <Download className={`w-5 h-5 ${busyAction === 'export_cookies' ? 'animate-pulse' : ''}`} />
                <div>
                  <div className="font-medium">Export YouTube Cookies</div>
                  <div className="text-sm text-base-content/65">Download a fresh `cookies.txt` from the current Chrome profile.</div>
                </div>
              </div>
            </button>

            <div className="rounded-xl border border-base-content/15 bg-base-200/60 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Download className="w-4 h-4" />
                <h3 className="font-medium">Native Download</h3>
              </div>

              <input
                type="text"
                value={downloadUrl}
                onChange={(e) => setDownloadUrl(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=..."
                className="w-full rounded-lg border border-base-content/20 bg-base-100 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                disabled={busyAction === 'download'}
              />

              <button
                onClick={handleNativeDownload}
                disabled={busyAction === 'download' || !downloadUrl.trim()}
                className="inline-flex items-center gap-2 rounded-lg bg-primary text-primary-content px-4 py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-60"
              >
                <Download className="w-4 h-4" />
                {busyAction === 'download' ? 'Downloading...' : 'Download with Host'}
              </button>
            </div>
          </div>

          <div className="min-w-0 bg-base-100 border border-base-content/15 rounded-2xl shadow-xl p-5 sm:p-6 overflow-hidden">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="text-lg font-semibold">Host Log</h2>
                <p className="text-sm text-base-content/65 mt-1">Recent commands and responses.</p>
              </div>
              <button
                onClick={() => setLogs([])}
                className="text-sm text-base-content/60 hover:text-base-content"
              >
                Clear
              </button>
            </div>

            <div className="rounded-xl border border-base-content/10 bg-base-200/40 p-3">
              <div className="space-y-3 max-h-[min(56vh,520px)] overflow-auto pr-1">
                {logs.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-base-content/20 px-4 py-8 text-center text-sm text-base-content/60">
                    No host commands sent yet.
                  </div>
                ) : (
                  logs.map((entry, index) => <HostLog key={`${entry.timestamp}-${index}`} entry={entry} />)
                )}
              </div>
            </div>

            <div className="mt-5 grid gap-3 text-sm">
              <div className="flex items-start gap-2 text-base-content/70">
                <CheckCircle2 className="w-4 h-4 mt-0.5 text-green-500" />
                <span>`Download with Host` uses the same native messaging path as the extension's video downloads.</span>
              </div>
              <div className="flex items-start gap-2 text-base-content/70">
                <AlertCircle className="w-4 h-4 mt-0.5 text-amber-500" />
                <span>If YouTube returns 403 on this network, place `cookies.txt` beside the native host exe and refresh this page.</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
