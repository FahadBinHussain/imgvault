import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Search,
  Settings,
  UploadCloud,
} from 'lucide-react';
import PremiumBackground from '../components/PremiumBackground';
import GalleryNavbar from '../components/GalleryNavbar';
import { Button } from '../components/UI';
import { IMAGE_UPLOAD_SERVICES } from '../config/providerCatalog';
import { useChromeMessage, useChromeStorage, useCollections, useImages, useTrash } from '../hooks/useChromeExtension';
import {
  getImageProviderLinks,
  getImageRetrySourceCandidates,
  getMissingImageUploadServices,
  getPreferredImageProviderLink,
  hasImageProviderLink,
} from '../utils/imageProviderLinks';

const IMAGE_SETTING_KEYS = Array.from(
  new Set(IMAGE_UPLOAD_SERVICES.flatMap((service) => service.apiKeyFields || []))
);

const isHttpUrl = (value) => /^https?:\/\//i.test(String(value || '').trim());

function isImageItem(item) {
  return Boolean(item) && !item.isLink && !item.isVideo && !String(item.fileType || '').startsWith('video/');
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString();
}

function getPreviewUrl(item, preferredSource) {
  return (
    getPreferredImageProviderLink(item, preferredSource, 'thumbnailUrl') ||
    getPreferredImageProviderLink(item, preferredSource, 'url') ||
    item?.sourceImageUrl ||
    ''
  );
}

export default function ResolvePage() {
  const navigate = useNavigate();
  const sendMessage = useChromeMessage();
  const { images, loading, reload } = useImages();
  const { trashedImages, loading: trashLoading } = useTrash();
  const { collections, loading: collectionsLoading } = useCollections();
  const [defaultGallerySource] = useChromeStorage('defaultGallerySource', 'imgbb', 'sync');
  const [navbarHeight, setNavbarHeight] = useState(0);
  const [settings, setSettings] = useState({});
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('ready');
  const [resolving, setResolving] = useState({});
  const [notice, setNotice] = useState(null);

  const loadSettings = () => {
    setSettingsLoading(true);
    chrome.storage.sync.get(IMAGE_SETTING_KEYS, (result) => {
      setSettings(result || {});
      setSettingsLoading(false);
    });
  };

  useEffect(() => {
    loadSettings();

    const handleStorageChange = (changes, area) => {
      if (area !== 'sync') return;
      if (IMAGE_SETTING_KEYS.some((key) => changes[key])) {
        loadSettings();
      }
    };

    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => chrome.storage.onChanged.removeListener(handleStorageChange);
  }, []);

  const configuredServices = useMemo(
    () => IMAGE_UPLOAD_SERVICES.filter((service) => service.isConfigured(settings)),
    [settings]
  );
  const configuredServiceKeys = useMemo(
    () => new Set(configuredServices.map((service) => service.key)),
    [configuredServices]
  );

  const rows = useMemo(() => {
    return (images || [])
      .filter(isImageItem)
      .map((item) => {
        const providerLinks = getImageProviderLinks(item);
        const presentProviders = IMAGE_UPLOAD_SERVICES.filter((service) => hasImageProviderLink(item, service.key));
        const missingProviders = getMissingImageUploadServices(item);
        const sourceCandidates = missingProviders.flatMap((service) => getImageRetrySourceCandidates(item, service.key));
        const hasResolvableSource = sourceCandidates.some(isHttpUrl);
        const readyMissingProviders = missingProviders.filter((service) => (
          configuredServiceKeys.has(service.key) && hasResolvableSource
        ));
        const blockedMissingProviders = missingProviders.filter((service) => (
          !configuredServiceKeys.has(service.key) || !hasResolvableSource
        ));
        const title = item.pageTitle || item.fileName || item.description || 'Untitled image';

        return {
          item,
          title,
          providerLinks,
          presentProviders,
          missingProviders,
          readyMissingProviders,
          blockedMissingProviders,
          hasResolvableSource,
          previewUrl: getPreviewUrl(item, defaultGallerySource),
          dateLabel: formatDate(item.createdAt || item.internalAddedTimestamp || item.creationDate),
        };
      })
      .filter((row) => row.missingProviders.length > 0)
      .sort((a, b) => {
        const readyDelta = b.readyMissingProviders.length - a.readyMissingProviders.length;
        if (readyDelta !== 0) return readyDelta;
        return b.missingProviders.length - a.missingProviders.length;
      });
  }, [configuredServiceKeys, defaultGallerySource, images]);

  const counts = useMemo(() => ({
    all: rows.length,
    ready: rows.filter((row) => row.readyMissingProviders.length > 0).length,
    waiting: rows.filter((row) => row.readyMissingProviders.length === 0).length,
  }), [rows]);

  const visibleRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (filter === 'ready' && row.readyMissingProviders.length === 0) return false;
      if (filter === 'waiting' && row.readyMissingProviders.length > 0) return false;
      if (!normalizedQuery) return true;

      return [
        row.title,
        row.item.fileName,
        row.item.description,
        row.item.sourcePageUrl,
        row.missingProviders.map((service) => service.label).join(' '),
      ].filter(Boolean).join(' ').toLowerCase().includes(normalizedQuery);
    });
  }, [filter, query, rows]);

  const resolveProvider = async (row, service) => {
    const key = `${row.item.id}:${service.key}`;
    setResolving((current) => ({ ...current, [key]: true }));
    setNotice(null);

    try {
      await sendMessage('retryImageHostUpload', {
        imageId: row.item.id,
        host: service.key,
      });
      setNotice({
        type: 'success',
        message: `${service.label} saved for ${row.title}.`,
      });
      await reload({ silent: true });
    } catch (error) {
      setNotice({
        type: 'error',
        message: `${service.label} failed for ${row.title}: ${error.message || String(error)}`,
      });
    } finally {
      setResolving((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
  };

  const refreshAll = async () => {
    loadSettings();
    await reload();
  };

  const renderProviderBadge = (service, state) => {
    const className = state === 'present'
      ? 'border-success/20 bg-success/10 text-success'
      : state === 'ready'
        ? 'border-primary/25 bg-primary/10 text-primary'
        : 'border-warning/25 bg-warning/10 text-warning';

    return (
      <span
        key={service.key}
        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${className}`}
      >
        {state === 'present' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
        {service.label}
      </span>
    );
  };

  return (
    <div className="min-h-screen bg-base-200 text-base-content prem-page">
      <PremiumBackground />
      <GalleryNavbar
        navigate={navigate}
        images={images}
        defaultGallerySource={defaultGallerySource}
        reload={refreshAll}
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
        displayCount={counts.ready}
        deselectAll={() => {}}
        setShowBulkDeleteConfirm={() => {}}
        isDeleting={false}
        onHeightChange={setNavbarHeight}
        isResolvePage
      />

      <main className="mx-auto flex max-w-7xl flex-col gap-5 px-4 pb-8 sm:px-6" style={{ paddingTop: navbarHeight + 16 }}>
        <section className="flex flex-col gap-4 border-b border-base-300 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-primary">
              <UploadCloud className="h-4 w-4" />
              Provider resolve
            </div>
            <h1 className="text-3xl font-semibold tracking-tight text-base-content">Missing host coverage</h1>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full border border-base-300 bg-base-100 px-3 py-1 text-xs font-semibold text-base-content/70">
                {counts.ready} ready
              </span>
              <span className="rounded-full border border-base-300 bg-base-100 px-3 py-1 text-xs font-semibold text-base-content/70">
                {counts.waiting} waiting
              </span>
              <span className="rounded-full border border-base-300 bg-base-100 px-3 py-1 text-xs font-semibold text-base-content/70">
                {configuredServices.length}/{IMAGE_UPLOAD_SERVICES.length} hosts configured
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative min-w-0 sm:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-base-content/35" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search resolve queue..."
                className="h-10 w-full rounded-[var(--radius-box)] border border-base-300 bg-base-100 pl-9 pr-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
              />
            </div>
            <Button variant="outline" onClick={refreshAll} className="h-10 gap-2 px-3 text-sm" disabled={loading || settingsLoading}>
              <RefreshCw className={`h-4 w-4 ${loading || settingsLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button variant="outline" onClick={() => navigate('/settings')} className="h-10 gap-2 px-3 text-sm">
              <Settings className="h-4 w-4" />
              Settings
            </Button>
          </div>
        </section>

        <section className="flex flex-wrap gap-2">
          {[
            { value: 'ready', label: 'Ready', count: counts.ready },
            { value: 'waiting', label: 'Waiting', count: counts.waiting },
            { value: 'all', label: 'All gaps', count: counts.all },
          ].map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setFilter(option.value)}
              className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                filter === option.value
                  ? 'border-primary bg-primary text-primary-content shadow-sm'
                  : 'border-base-300 bg-base-100 text-base-content/70 hover:text-base-content'
              }`}
            >
              {option.label} <span className="opacity-70">{option.count}</span>
            </button>
          ))}
        </section>

        {notice && (
          <div className={`rounded-[var(--radius-box)] border px-4 py-3 text-sm font-medium ${
            notice.type === 'success'
              ? 'border-success/25 bg-success/10 text-success'
              : 'border-error/25 bg-error/10 text-error'
          }`}>
            {notice.message}
          </div>
        )}

        <section className="grid gap-3">
          {(loading || settingsLoading) && (
            <div className="flex min-h-64 items-center justify-center rounded-[var(--radius-box)] border border-base-300 bg-base-100 text-base-content/60">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Loading resolve queue...
            </div>
          )}

          {!loading && !settingsLoading && visibleRows.length === 0 && (
            <div className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-[var(--radius-box)] border border-base-300 bg-base-100 px-4 text-center">
              <CheckCircle2 className="h-8 w-8 text-success" />
              <div>
                <h2 className="text-lg font-semibold text-base-content">No matching host gaps</h2>
                <p className="mt-1 text-sm text-base-content/60">
                  {filter === 'ready' ? 'Everything ready for configured hosts is already covered.' : 'No items match this view.'}
                </p>
              </div>
            </div>
          )}

          {!loading && !settingsLoading && visibleRows.map((row) => {
            const missingReadyLabels = row.readyMissingProviders.map((service) => service.label).join(', ');

            return (
              <article
                key={row.item.id}
                className="grid gap-4 rounded-[var(--radius-box)] border border-base-300 bg-base-100 p-3 shadow-sm transition hover:border-primary/25 sm:grid-cols-[132px_1fr_auto]"
              >
                <div className="flex h-28 items-center justify-center overflow-hidden rounded-[var(--radius-box)] bg-base-200">
                  {row.previewUrl ? (
                    <img
                      src={row.previewUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <ImageIcon className="h-8 w-8 text-base-content/35" />
                  )}
                </div>

                <div className="min-w-0 space-y-3">
                  <div>
                    <h2 className="truncate text-base font-semibold text-base-content">{row.title}</h2>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-base-content/55">
                      {row.item.fileName && <span className="truncate">{row.item.fileName}</span>}
                      {row.dateLabel && <span>{row.dateLabel}</span>}
                      {row.item.sourcePageUrl && (
                        <a
                          href={row.item.sourcePageUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-primary hover:underline"
                        >
                          Source <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {IMAGE_UPLOAD_SERVICES.map((service) => {
                      if (row.providerLinks[service.key]) return renderProviderBadge(service, 'present');
                      if (row.readyMissingProviders.some((missing) => missing.key === service.key)) {
                        return renderProviderBadge(service, 'ready');
                      }
                      return renderProviderBadge(service, 'waiting');
                    })}
                  </div>
                </div>

                <div className="flex flex-col justify-between gap-3 sm:w-52">
                  <div className="rounded-[var(--radius-box)] border border-base-300 bg-base-200/60 px-3 py-2 text-xs text-base-content/65">
                    {row.readyMissingProviders.length > 0
                      ? `Ready for ${missingReadyLabels}`
                      : row.hasResolvableSource
                        ? 'Needs provider keys'
                        : 'Needs a hosted source'}
                  </div>

                  <div className="flex flex-col gap-2">
                    {row.readyMissingProviders.map((service) => {
                      const key = `${row.item.id}:${service.key}`;
                      const isResolving = Boolean(resolving[key]);

                      return (
                        <Button
                          key={service.key}
                          variant="primary"
                          className="h-9 justify-center gap-2 text-sm"
                          disabled={isResolving}
                          onClick={() => resolveProvider(row, service)}
                        >
                          {isResolving ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
                          {isResolving ? `Resolving ${service.label}` : `Resolve ${service.label}`}
                        </Button>
                      );
                    })}

                    {row.readyMissingProviders.length === 0 && (
                      <Button variant="outline" className="h-9 justify-center text-sm" onClick={() => navigate('/settings')}>
                        Open Settings
                      </Button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      </main>
    </div>
  );
}
