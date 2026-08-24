/**
 * Shared media detail / lightbox modal used by Gallery, Vault, and Trash.
 * Owns the shell, animation, layout, close button, tabs, and standard field
 * rendering so every page feels the same. Pages supply the left-side media
 * preview (renderMedia), the header action buttons (actions), and optional
 * field renderers for page-specific editing.
 */
import React, { useState, useEffect } from 'react';
import { FileText, Database, Hash, Fingerprint } from 'lucide-react';
import { Modal, Spinner } from './UI';

const formatDetailValue = (value) => {
  if (value === null || value === undefined || value === '') return 'N/A';
  if (Array.isArray(value)) return value.length ? value.join(', ') : '[]';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

const isHttpUrl = (value) => typeof value === 'string' && /^https?:\/\//i.test(value.trim());

const defaultOverviewFieldRenderer = (entry, index) => {
  const rawValue = entry.value;
  const value = formatDetailValue(rawValue);
  const isUrl = entry.key.toLowerCase().endsWith('url') && typeof rawValue === 'string' && rawValue;

  return (
    <div key={entry.key}>
      <div className="text-[11px] font-semibold mb-1 flex items-center gap-2" style={{ color: 'oklch(from var(--color-base-content) l c h / 0.45)' }}>
        <span style={{ color: 'var(--color-primary)', fontWeight: 700 }}>{index + 1}.</span>
        <span className="font-mono">{entry.key}</span>
      </div>
      <div className="g-field">
        {entry.key === 'tags' && Array.isArray(rawValue) && rawValue.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {rawValue.map((tag) => (
              <span key={tag} className="px-3 py-1 rounded-full bg-primary/15 text-primary text-sm">
                {tag}
              </span>
            ))}
          </div>
        ) : isUrl ? (
          <a href={rawValue} target="_blank" rel="noopener noreferrer" className="text-info hover:opacity-80 break-all text-sm">
            {rawValue}
          </a>
        ) : (
          <p className="text-base-content font-mono text-sm break-all">{value}</p>
        )}
      </div>
    </div>
  );
};

const technicalFieldIcon = (key) => {
  if (key === 'sha256') return <Fingerprint className="w-3.5 h-3.5" />;
  if (key === 'pHash' || key === 'aHash' || key === 'dHash') return <Hash className="w-3.5 h-3.5" />;
  return <FileText className="w-3.5 h-3.5" />;
};

const technicalFieldLabel = (key) => (key === 'sha256' ? 'SHA-256' : key);

const defaultTechnicalFieldRenderer = ([key, value], index) => (
  <div key={key}>
    <div className="text-[11px] font-semibold mb-1 flex items-center gap-2" style={{ color: 'oklch(from var(--color-base-content) l c h / 0.45)' }}>
      <span style={{ color: 'var(--color-primary)', fontWeight: 700 }}>{index + 1}.</span>
      {technicalFieldIcon(key)}
      {technicalFieldLabel(key)}
    </div>
    <div className="g-field">
      <p className="text-base-content font-mono text-sm break-all">
        {typeof value === 'object' ? JSON.stringify(value) : String(value)}
      </p>
    </div>
  </div>
);

const defaultDocumentIdRenderer = (item) => (
  <p className="text-base-content font-mono text-sm break-all">{formatDetailValue(item?.id)}</p>
);

const sharedModalCSS = `
  .g-modal-close{position:sticky;top:16px;z-index:80;width:40px;height:40px;margin:16px 16px -56px auto;border-radius:10px;background:oklch(from var(--color-error) l c h / 0.1);border:1px solid oklch(from var(--color-error) l c h / 0.2);display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .2s ease;color:var(--color-error)}
  .g-modal-close:hover{background:oklch(from var(--color-error) l c h / 0.18);border-color:oklch(from var(--color-error) l c h / 0.35);transform:scale(1.08) rotate(90deg)}
  .g-tab{padding:8px 16px;font-size:13px;font-weight:600;font-family:'Outfit',system-ui,sans-serif;cursor:pointer;transition:all .15s ease;border:none;background:none;border-bottom:2px solid transparent;color:oklch(from var(--color-base-content) l c h / 0.4)}
  .g-tab:hover{color:oklch(from var(--color-base-content) l c h / 0.7)}
  .g-tab-on{color:var(--color-primary)!important;border-bottom-color:var(--color-primary)!important}
  .g-tab-succ{color:var(--color-success)!important;border-bottom-color:var(--color-success)!important}
  .g-field{padding:8px 10px;border-radius:8px;background:oklch(from var(--color-base-100) l c h / 0.4);border:1px solid oklch(from var(--color-base-content) l c h / 0.04)}
  .g-action{display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:7px;font-size:11px;font-weight:500;font-family:'Outfit',system-ui,sans-serif;cursor:pointer;transition:all .15s ease;border:1px solid oklch(from var(--color-base-content) l c h / 0.08);background:oklch(from var(--color-base-content) l c h / 0.03);color:oklch(from var(--color-base-content) l c h / 0.6)}
  .g-action:hover{color:var(--color-primary);border-color:oklch(from var(--color-primary) l c h / 0.2);background:oklch(from var(--color-primary) l c h / 0.05)}
  .g-action-prim{color:var(--color-primary-content);background:linear-gradient(135deg,var(--color-primary),var(--color-secondary));border:none;box-shadow:0 2px 10px oklch(from var(--color-primary) l c h / 0.2)}
  .g-action-prim:hover{filter:brightness(1.1);transform:translateY(-1px)}
  .g-action-err{color:var(--color-error);background:oklch(from var(--color-error) l c h / 0.07);border-color:oklch(from var(--color-error) l c h / 0.12)}
  .g-action-err:hover{background:oklch(from var(--color-error) l c h / 0.12);border-color:oklch(from var(--color-error) l c h / 0.2)}
  .g-action-danger{color:var(--color-error);background:oklch(from var(--color-error) l c h / 0.07);border-color:oklch(from var(--color-error) l c h / 0.12)}
  .g-action-danger:hover{background:oklch(from var(--color-error) l c h / 0.12);border-color:oklch(from var(--color-error) l c h / 0.2)}
  .g-action-warn{color:var(--color-warning);background:oklch(from var(--color-warning) l c h / 0.07);border-color:oklch(from var(--color-warning) l c h / 0.12)}
  .g-action-warn:hover{background:oklch(from var(--color-warning) l c h / 0.12);border-color:oklch(from var(--color-warning) l c h / 0.2)}
`;

export default function MediaDetailModal({
  isOpen,
  onClose,
  item,
  activeTab = 'noobs',
  onTabChange,
  overviewEntries = [],
  technicalEntries = [],
  technicalLoading = false,
  isLink = false,
  renderMedia,
  actions,
  renderOverviewField,
  renderTechnicalField,
  renderDocumentId,
  overviewFooter,
  technicalEmptyText = 'No extra technical fields on this document.',
}) {
  const [isModalAnimating, setIsModalAnimating] = useState(false);

  useEffect(() => {
    if (isOpen && item?.id) {
      setIsModalAnimating(true);
      const t = setTimeout(() => setIsModalAnimating(false), 300);
      return () => clearTimeout(t);
    }
  }, [isOpen, item?.id]);

  const overviewFieldRenderer = renderOverviewField || defaultOverviewFieldRenderer;
  const technicalFieldRenderer = renderTechnicalField || defaultTechnicalFieldRenderer;
  const documentIdRenderer = renderDocumentId || defaultDocumentIdRenderer;

  const handleTabSwitch = (tab) => {
    onTabChange?.(tab);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      className="!max-w-[95vw] !w-full !h-[95vh] !p-0 !overflow-hidden"
    >
      <style>{sharedModalCSS}</style>
      {item && (
        <div className={`flex flex-col lg:flex-row h-full relative transition-all duration-500 ease-out
                      ${isModalAnimating ? 'opacity-0 scale-95' : 'opacity-100 scale-100'}`}>
          <div className={`absolute inset-0 bg-base-300/90 transition-opacity duration-500
                        ${isModalAnimating ? 'opacity-0' : 'opacity-100'}`} />

          <div className="flex-1 min-h-[35vh] lg:min-h-0 flex items-center justify-center bg-gradient-to-br from-base-300 to-base-200 p-3 sm:p-6 lg:p-8 relative z-10">
            <div className={`absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2
                          w-4/5 h-4/5 bg-primary/10 rounded-full blur-3xl
                          transition-all duration-700 ease-out
                          ${isModalAnimating ? 'opacity-0 scale-50' : 'opacity-100 scale-100'}`} />
            {renderMedia(item, { isModalAnimating })}
          </div>

          <div className={`w-full lg:w-[550px] lg:flex-shrink-0 overflow-y-auto flex flex-col relative z-10
                        transition-all duration-500 ease-out
                        ${isModalAnimating ? 'translate-y-8 opacity-0' : 'translate-y-0 opacity-100'}`}
            style={{
              scrollbarWidth: 'thin',
              scrollbarColor: 'oklch(from var(--color-base-content) l c h / 0.06) transparent',
              background: 'oklch(from var(--color-base-100) l c h / 0.8)',
              backdropFilter: 'blur(24px)',
              borderLeft: '1px solid oklch(from var(--color-base-content) l c h / 0.06)',
              fontFamily: "'Outfit', system-ui, sans-serif",
            }}
          >
            <button onClick={onClose} className={`g-modal-close ${isModalAnimating ? 'opacity-0' : 'opacity-100'}`} title="Close">
              <span style={{ fontSize: 16, fontWeight: 700 }}>✕</span>
            </button>

            <div className="p-6 flex-1 pt-16">
              <h2 className="text-2xl font-bold text-base-content mb-4">Details</h2>

              <div className="flex items-center justify-between gap-3 mb-4" style={{ borderBottom: '1px solid oklch(from var(--color-base-content) l c h / 0.06)' }}>
                {!isLink && (
                  <div className="flex gap-1 overflow-x-auto whitespace-nowrap">
                    <button
                      onClick={() => handleTabSwitch('noobs')}
                      className={`g-tab ${activeTab === 'noobs' ? 'g-tab-on' : ''}`}
                    >
                      <span>Overview</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-md ml-1.5"
                        style={{ background: activeTab === 'noobs' ? 'oklch(from var(--color-primary) l c h / 0.1)' : 'oklch(from var(--color-base-content) l c h / 0.05)', color: activeTab === 'noobs' ? 'var(--color-primary)' : 'oklch(from var(--color-base-content) l c h / 0.4)' }}>
                        {overviewEntries.length}
                      </span>
                    </button>
                    <button
                      onClick={() => handleTabSwitch('nerds')}
                      className={`g-tab ${activeTab === 'nerds' ? 'g-tab-succ' : ''}`}
                    >
                      <span>Technical</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-md ml-1.5"
                        style={{ background: activeTab === 'nerds' ? 'oklch(from var(--color-success) l c h / 0.1)' : 'oklch(from var(--color-base-content) l c h / 0.05)', color: activeTab === 'nerds' ? 'var(--color-success)' : 'oklch(from var(--color-base-content) l c h / 0.4)' }}>
                        {technicalLoading ? '...' : technicalEntries.length}
                      </span>
                    </button>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  {actions}
                </div>
              </div>

              {(activeTab === 'noobs' || isLink) && (
                <div className="space-y-4">
                  <div className="space-y-3 pr-2">
                    <div>
                      <div className="text-[11px] font-semibold mb-1 flex items-center gap-2" style={{ color: 'oklch(from var(--color-base-content) l c h / 0.45)' }}>
                        <span className="font-mono">firestoreDocumentId</span>
                      </div>
                      <div className="g-field">{documentIdRenderer(item)}</div>
                    </div>
                    {overviewEntries.map(overviewFieldRenderer)}
                  </div>
                  {overviewFooter}
                </div>
              )}

              {activeTab === 'nerds' && !isLink && (
                <div className="space-y-4">
                  {technicalLoading && technicalEntries.length === 0 ? (
                    <div className="flex justify-center items-center py-10">
                      <Spinner size="md" />
                      <span className="ml-3 text-base-content/70">Loading technical details...</span>
                    </div>
                  ) : technicalEntries.length === 0 ? (
                    <div className="text-sm text-base-content/60 italic">{technicalEmptyText}</div>
                  ) : (
                    <div className="space-y-4 pr-2">{technicalEntries.map(technicalFieldRenderer)}</div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
