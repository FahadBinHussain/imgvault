import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, AlertCircle, CheckCircle2, Clock3, FileText } from 'lucide-react';
import GalleryNavbar from '../components/GalleryNavbar';
import { Button } from '../components/UI';
import { useChromeStorage, useCollections, useImageUpload, useImages, useTrash } from '../hooks/useChromeExtension';

function formatTimestamp(value) {
  if (!value) {
    return 'Unknown time';
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function getLogColorClass(type) {
  if (type === 'error') {
    return 'border-error/20 bg-error/10 text-error';
  }

  if (type === 'success') {
    return 'border-success/20 bg-success/10 text-success';
  }

  if (type === 'warning') {
    return 'border-warning/20 bg-warning/10 text-warning';
  }

  return 'border-base-content/10 bg-base-200/70 text-base-content/80';
}

function LogLine({ entry }) {
  return (
    <div className={`rounded-[var(--radius-box)] border px-3 py-2 text-sm leading-5 ${getLogColorClass(entry?.type)}`}>
      <span className="mr-2 text-xs opacity-60">[{entry?.timestamp || '--:--:--'}]</span>
      <span className="whitespace-pre-wrap break-all font-mono text-[12px]">{entry?.message || ''}</span>
    </div>
  );
}

export default function LogsPage() {
  const navigate = useNavigate();
  const { images } = useImages();
  const { trashedImages, loading: trashLoading } = useTrash();
  const { collections, loading: collectionsLoading } = useCollections();
  const { uploading, progress, logs, history } = useImageUpload();
  const [defaultGallerySource] = useChromeStorage('defaultGallerySource', 'imgbb', 'sync');
  const [navbarHeight, setNavbarHeight] = useState(0);
  const [expandedRunIds, setExpandedRunIds] = useState(() => new Set());

  const sortedHistory = useMemo(
    () => [...history].sort((a, b) => new Date(b.completedAt || 0).getTime() - new Date(a.completedAt || 0).getTime()),
    [history]
  );

  const toggleRun = (runId) => {
    setExpandedRunIds((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) {
        next.delete(runId);
      } else {
        next.add(runId);
      }
      return next;
    });
  };

  const clearHistory = () => {
    chrome.storage.local.set({ uploadLogHistory: [] });
    setExpandedRunIds(new Set());
  };

  return (
    <div className="min-h-screen bg-base-200 text-base-content">
      <GalleryNavbar
        navigate={navigate}
        images={images}
        defaultGallerySource={defaultGallerySource}
        reload={() => {}}
        toggleSelectionMode={() => {}}
        selectionMode={false}
        collectionsLoading={collectionsLoading}
        collections={collections}
        trashLoading={trashLoading}
        trashedImages={trashedImages}
        openUploadModal={() => navigate('/gallery')}
        searchQuery=""
        setSearchQuery={() => {}}
        selectedImages={new Set()}
        selectAll={() => {}}
        filteredImages={images}
        displayCount={sortedHistory.length}
        deselectAll={() => {}}
        setShowBulkDeleteConfirm={() => {}}
        isDeleting={false}
        onHeightChange={setNavbarHeight}
        isLogsPage
      />

      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 pb-8 sm:px-6" style={{ paddingTop: navbarHeight + 16 }}>
        <section className="rounded-[var(--radius-box)] border border-base-content/10 bg-base-100 p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-primary">
                <FileText className="h-4 w-4" />
                Centralized logs
              </div>
              <h2 className="text-2xl font-semibold text-base-content">Upload and host activity</h2>
              <p className="max-w-2xl text-sm leading-6 text-base-content/70">
                Live uploader output stays here while finished runs are archived below, so we have one stable place for debugging instead of burying logs inside the modal.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => navigate('/host')}>
                Open Host
              </Button>
              <Button variant="outline" onClick={() => navigate('/gallery')}>
                Open Gallery
              </Button>
              <Button variant="ghost" onClick={clearHistory} disabled={sortedHistory.length === 0}>
                Clear History
              </Button>
            </div>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-[var(--radius-box)] border border-base-content/10 bg-base-100 p-4 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-base-content">Live Upload Log</h3>
                <p className="text-sm text-base-content/60">
                  {uploading ? progress || 'Upload is running.' : 'No upload is active right now.'}
                </p>
              </div>
              <span className={`badge ${uploading ? 'badge-primary' : 'badge-ghost'}`}>
                {uploading ? 'Active' : 'Idle'}
              </span>
            </div>

            <div className="max-h-[420px] space-y-2 overflow-y-auto rounded-[var(--radius-box)] border border-base-content/10 bg-base-200/50 p-3">
              {logs.length === 0 ? (
                <div className="flex min-h-48 flex-col items-center justify-center gap-2 text-center text-sm text-base-content/60">
                  <Activity className="h-5 w-5" />
                  <p>{uploading ? 'Waiting for uploader logs...' : 'Start an upload and the live log will appear here.'}</p>
                </div>
              ) : (
                logs.map((entry, index) => <LogLine key={`${entry.timestamp}-${index}`} entry={entry} />)
              )}
            </div>
          </div>

          <div className="rounded-[var(--radius-box)] border border-base-content/10 bg-base-100 p-4 shadow-sm">
            <h3 className="text-base font-semibold text-base-content">Summary</h3>
            <div className="mt-4 space-y-3">
              <div className="rounded-[var(--radius-box)] border border-base-content/10 bg-base-200/50 p-3">
                <div className="text-xs uppercase tracking-wide text-base-content/50">Current state</div>
                <div className="mt-1 text-sm font-medium text-base-content">{uploading ? 'Uploading now' : 'Idle'}</div>
              </div>
              <div className="rounded-[var(--radius-box)] border border-base-content/10 bg-base-200/50 p-3">
                <div className="text-xs uppercase tracking-wide text-base-content/50">Saved runs</div>
                <div className="mt-1 text-sm font-medium text-base-content">{sortedHistory.length}</div>
              </div>
              <div className="rounded-[var(--radius-box)] border border-base-content/10 bg-base-200/50 p-3">
                <div className="text-xs uppercase tracking-wide text-base-content/50">Latest status</div>
                <div className="mt-1 text-sm font-medium text-base-content">{progress || 'No recent upload status yet.'}</div>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-[var(--radius-box)] border border-base-content/10 bg-base-100 p-4 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-base-content">Previous Upload Logs</h3>
              <p className="text-sm text-base-content/60">Completed and failed upload runs are archived here for later review.</p>
            </div>
            <span className="badge badge-ghost">{sortedHistory.length} runs</span>
          </div>

          {sortedHistory.length === 0 ? (
            <div className="flex min-h-48 flex-col items-center justify-center gap-2 rounded-[var(--radius-box)] border border-dashed border-base-content/15 bg-base-200/40 text-center text-sm text-base-content/60">
              <Clock3 className="h-5 w-5" />
              <p>No saved upload runs yet.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {sortedHistory.map((run) => {
                const isExpanded = expandedRunIds.has(run.id);
                const statusTone =
                  run.status === 'success'
                    ? 'badge-success'
                    : run.status === 'partial'
                      ? 'badge-warning'
                      : 'badge-error';

                return (
                  <div key={run.id} className="rounded-[var(--radius-box)] border border-base-content/10 bg-base-200/35">
                    <button
                      type="button"
                      onClick={() => toggleRun(run.id)}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`badge ${statusTone}`}>{run.status || 'unknown'}</span>
                          <span className="truncate text-sm font-medium text-base-content">{run.summary || 'Upload run'}</span>
                        </div>
                        <div className="mt-1 text-xs text-base-content/55">{formatTimestamp(run.completedAt)}</div>
                      </div>
                      <div className="text-xs text-base-content/55">{run.logs?.length || 0} lines</div>
                    </button>

                    {isExpanded && (
                      <div className="border-t border-base-content/10 px-4 py-3">
                        {(run.logs || []).length === 0 ? (
                          <div className="text-sm text-base-content/60">
                            <div className="flex items-center gap-2">
                              <AlertCircle className="h-4 w-4" />
                              No saved logs for this run.
                            </div>
                          </div>
                        ) : (
                          <div className="max-h-[320px] space-y-2 overflow-y-auto rounded-[var(--radius-box)] border border-base-content/10 bg-base-100 p-3">
                            {(run.logs || []).map((entry, index) => (
                              <LogLine key={`${run.id}-${index}`} entry={entry} />
                            ))}
                          </div>
                        )}

                        {run.status === 'success' && (
                          <div className="mt-3 flex items-center gap-2 text-sm text-success">
                            <CheckCircle2 className="h-4 w-4" />
                            Upload completed successfully.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
