import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Cable, RotateCw, Download, CheckCircle2, AlertCircle, Activity } from 'lucide-react';
import GalleryNavbar from '../components/GalleryNavbar';
import { Button, Input } from '../components/UI';

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
      ? 'bg-error/10 text-error border-error/20'
      : entry.type === 'success'
        ? 'bg-success/10 text-success border-success/20'
        : 'bg-base-200/70 text-base-content/80 border-base-content/10';

  return (
    <div className={`rounded-[var(--radius-box)] border px-3 py-2 text-sm leading-5 ${colorClass}`}>
      <span className="mr-2 text-xs opacity-60">[{entry.timestamp}]</span>
      <span className="whitespace-pre-wrap break-all font-mono text-[12px]">{entry.message}</span>
    </div>
  );
}

function getVideoPreview(url) {
  if (!url) {
    return null;
  }

  try {
    const parsedUrl = new URL(url);
    const host = parsedUrl.hostname.toLowerCase();
    const isYouTube = host === 'youtube.com' ||
      host === 'www.youtube.com' ||
      host === 'm.youtube.com' ||
      host === 'youtu.be';

    let videoId = '';

    if (host === 'youtu.be') {
      videoId = parsedUrl.pathname.replace(/^\/+/, '').split('/')[0];
    } else {
      videoId = parsedUrl.searchParams.get('v') || '';
    }

    if (isYouTube && videoId) {
      return {
        siteLabel: 'YouTube',
        title: 'YouTube video detected',
        subtitle: videoId,
        href: url,
        thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      };
    }

    return {
      siteLabel: parsedUrl.hostname.replace(/^www\./, ''),
      title: 'Video URL ready for host download',
      subtitle: parsedUrl.pathname === '/' ? parsedUrl.hostname : `${parsedUrl.hostname}${parsedUrl.pathname}`,
      href: url,
      thumbnailUrl: '',
    };
  } catch (error) {
    return null;
  }
}

export default function HostPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const browserLabel = (() => {
    const ua = navigator.userAgent || '';

    if (ua.includes('Edg/')) {
      return 'Edge';
    }

    if (ua.includes('Firefox/')) {
      return 'Firefox';
    }

    if (ua.includes('Chrome/')) {
      return 'Chrome';
    }

    return 'browser';
  })();
  const [navbarHeight, setNavbarHeight] = useState(0);
  const [downloadUrl, setDownloadUrl] = useState('');
  const [logs, setLogs] = useState([]);
  const [busyAction, setBusyAction] = useState('');
  const activeDownloadRequestIdRef = useRef('');
  const [hostStatus, setHostStatus] = useState({
    checking: true,
    reachable: false,
    hostMessage: 'Checking native host...',
    ytDlpAvailable: false,
    ytDlpMessage: 'Checking yt-dlp...',
  });
  const videoPreview = getVideoPreview(downloadUrl);

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
      };

      try {
        const ytDlpResponse = await chrome.runtime.sendMessage({
          action: 'nativeHostCommand',
          command: 'check_yt_dlp',
          data: {},
        });

        const mergedStatus = {
          ...nextStatus,
          ytDlpAvailable: !!ytDlpResponse?.success,
          ytDlpMessage: ytDlpResponse?.success
            ? ytDlpResponse.data?.message || 'yt-dlp available'
            : ytDlpResponse?.error || 'yt-dlp not available',
        };

        setHostStatus(mergedStatus);
        addLog(mergedStatus.ytDlpMessage, ytDlpResponse?.success ? 'success' : 'error');
      } catch (error) {
        setHostStatus({
          ...nextStatus,
          ytDlpAvailable: false,
          ytDlpMessage: error.message || 'yt-dlp check failed',
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
      });
      addLog(error.message || 'Native host unreachable', 'error');
    }
  };

  useEffect(() => {
    refreshHostStatus();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const prefillUrl = (params.get('url') || '').trim();

    if (prefillUrl) {
      setDownloadUrl(prefillUrl);
    }
  }, [location.search]);

  useEffect(() => {
    const handleRuntimeMessage = (message) => {
      if (message?.action !== 'nativeDownloadProgress') {
        return;
      }

      if (!message.requestId || message.requestId !== activeDownloadRequestIdRef.current) {
        return;
      }

      const rawLine = String(message.line || '').trim();
      if (!rawLine) {
        return;
      }

      const type = message.stream === 'stderr' && /^error:/i.test(rawLine) ? 'error' : 'info';
      const prefix = message.stream === 'stderr' ? '[yt-dlp] ' : '[yt-dlp] ';
      addLog(`${prefix}${rawLine}`, type);
    };

    chrome.runtime.onMessage.addListener(handleRuntimeMessage);
    return () => {
      chrome.runtime.onMessage.removeListener(handleRuntimeMessage);
    };
  }, []);

  const handleNativeDownload = async () => {
    if (!downloadUrl.trim()) {
      addLog('Enter a video URL first.', 'error');
      return;
    }

    setBusyAction('download');
    addLog(`Sending native download request: ${downloadUrl}`);

    try {
      const requestId = `host-download-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      activeDownloadRequestIdRef.current = requestId;
      const response = await chrome.runtime.sendMessage({
        action: 'nativeDownload',
        url: downloadUrl,
        requestId,
      });

      if (!response?.success) {
        throw response || new Error('Download failed');
      }

      addLog(`Downloaded to: ${response.filePath || 'completed'}`, 'success');

      if (response.filePath) {
        addLog('Opening gallery to auto-load the downloaded file...', 'success');
        navigate('/gallery', {
          state: {
            autoOpenUpload: true,
            downloadFilePath: response.filePath,
          },
        });
      }
    } catch (error) {
      addLog(error?.error || error?.message || 'Download failed', 'error');
    } finally {
      activeDownloadRequestIdRef.current = '';
      setBusyAction('');
    }
  };

  const handleExportYoutubeCookies = async () => {
    setBusyAction('export_cookies');
    addLog(`Collecting YouTube cookies from ${browserLabel}...`);

    try {
      const [youtubeCookies, googleCookies] = await Promise.all([
        chrome.cookies.getAll({ domain: '.youtube.com' }),
        chrome.cookies.getAll({ domain: '.google.com' }),
      ]);

      const allCookies = [...youtubeCookies, ...googleCookies];

      if (allCookies.length === 0) {
        throw new Error(`No YouTube/Google cookies found in ${browserLabel}.`);
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

      <div className="max-w-5xl mx-auto space-y-5">
        <div className="bg-base-100 border border-base-content/15 rounded-[var(--radius-box)] shadow-xl p-5 sm:p-6">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-[var(--radius-box)] bg-primary/15 text-primary flex items-center justify-center">
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

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)] items-start">
          <div className="min-w-0 bg-base-100 border border-base-content/15 rounded-[var(--radius-box)] shadow-xl p-5 sm:p-6 space-y-4">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(260px,0.95fr)] items-stretch">
              <div className="rounded-[var(--radius-box)] border border-base-content/15 bg-base-200/60 p-4 space-y-3">
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

                <div className={`rounded-[var(--radius-box)] border px-3 py-2 text-sm ${hostStatus.reachable ? 'border-success/20 bg-success/10 text-success' : 'border-error/20 bg-error/10 text-error'}`}>
                  <div className="font-medium">Native Host</div>
                  <div className="mt-1">{hostStatus.hostMessage}</div>
                </div>

                <div className={`rounded-[var(--radius-box)] border px-3 py-2 text-sm ${hostStatus.ytDlpAvailable ? 'border-success/20 bg-success/10 text-success' : 'border-warning/20 bg-warning/10 text-warning'}`}>
                  <div className="font-medium">yt-dlp</div>
                  <div className="mt-1 break-all">{hostStatus.ytDlpMessage}</div>
                </div>
              </div>

              {videoPreview ? (
                <div className="overflow-hidden rounded-[var(--radius-box)] border border-base-content/15 bg-base-200/60 shadow-sm">
                  {videoPreview.thumbnailUrl ? (
                    <div className="aspect-video overflow-hidden bg-base-300">
                      <img
                        src={videoPreview.thumbnailUrl}
                        alt={videoPreview.title}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  ) : (
                    <div className="flex items-center justify-center aspect-video bg-gradient-to-br from-primary/15 via-base-200 to-secondary/15">
                      <Cable className="w-12 h-12 text-primary" />
                    </div>
                  )}

                  <div className="p-4 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="badge badge-outline">{videoPreview.siteLabel}</span>
                      <a
                        href={videoPreview.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-primary hover:text-primary/80 underline"
                      >
                        Open source
                      </a>
                    </div>
                    <div>
                      <h3 className="font-semibold text-base-content">{videoPreview.title}</h3>
                      <p className="text-sm text-base-content/65 break-all mt-1">{videoPreview.subtitle}</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-[var(--radius-box)] border border-dashed border-base-content/15 bg-base-200/40 p-5 flex items-center justify-center min-h-[220px]">
                  <div className="text-center max-w-xs">
                    <Cable className="w-10 h-10 mx-auto text-primary/70 mb-3" />
                    <h3 className="font-semibold text-base-content">Video Preview</h3>
                    <p className="text-sm text-base-content/65 mt-2">
                      Paste a supported video URL to get a quick preview before downloading with the native host.
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-[var(--radius-box)] border border-base-content/15 bg-base-200/60 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Download className="w-4 h-4" />
                <h3 className="font-medium">Native Download</h3>
              </div>

              <Input
                type="text"
                value={downloadUrl}
                onChange={(e) => setDownloadUrl(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=..."
                className="bg-base-100 border-base-content/15 shadow-sm"
                disabled={busyAction === 'download'}
              />

              <Button
                onClick={handleNativeDownload}
                disabled={busyAction === 'download' || !downloadUrl.trim()}
                variant="primary"
                className="w-full justify-center gap-2 !text-base-content border border-primary/20 shadow-lg shadow-primary/10 hover:shadow-xl hover:shadow-primary/20 disabled:border-base-content/10 disabled:shadow-none"
              >
                <Download className="w-4 h-4" />
                {busyAction === 'download' ? 'Downloading... this can take a few minutes' : 'Download with Host'}
              </Button>

              <p className="text-xs text-base-content/60">
                Large video downloads may take several minutes before the native host sends its final completion message.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <button
                onClick={handleReloadPath}
                disabled={busyAction === 'reload_path'}
                className="w-full rounded-[var(--radius-box)] bg-base-200 hover:bg-base-300 border border-base-content/15 px-4 py-3 text-left transition-colors disabled:opacity-60"
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
                className="w-full rounded-[var(--radius-box)] bg-base-200 hover:bg-base-300 border border-base-content/15 px-4 py-3 text-left transition-colors disabled:opacity-60"
              >
                <div className="flex items-center gap-3">
                  <Download className={`w-5 h-5 ${busyAction === 'export_cookies' ? 'animate-pulse' : ''}`} />
                  <div>
                    <div className="font-medium">Export YouTube Cookies</div>
                    <div className="text-sm text-base-content/65">{`Download a fresh cookies.txt from the current ${browserLabel} profile.`}</div>
                  </div>
                </div>
              </button>
            </div>
          </div>

          <div className="min-w-0 bg-base-100 border border-base-content/15 rounded-[var(--radius-box)] shadow-xl p-5 sm:p-6 overflow-hidden">
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

            <div className="rounded-[var(--radius-box)] border border-base-content/10 bg-base-200/40 p-3">
              <div className="space-y-3 max-h-[min(48vh,440px)] overflow-auto pr-1">
                {logs.length === 0 ? (
                  <div className="rounded-[var(--radius-box)] border border-dashed border-base-content/20 px-4 py-8 text-center text-sm text-base-content/60">
                    No host commands sent yet.
                  </div>
                ) : (
                  logs.map((entry, index) => <HostLog key={`${entry.timestamp}-${index}`} entry={entry} />)
                )}
              </div>
            </div>

            <div className="mt-5 grid gap-3 text-sm">
              <div className="flex items-start gap-2 text-base-content/70">
                <CheckCircle2 className="w-4 h-4 mt-0.5 text-success" />
                <span>`Download with Host` uses the same native messaging path as the extension's video downloads.</span>
              </div>
              <div className="flex items-start gap-2 text-base-content/70">
                <AlertCircle className="w-4 h-4 mt-0.5 text-warning" />
                <span>The host now uses fresh Chrome YouTube cookies automatically when you download.</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

