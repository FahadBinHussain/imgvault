import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  Box,
  CheckCircle2,
  ExternalLink,
  Film,
  Image as ImageIcon,
  Link2,
  Loader2,
  RefreshCw,
  Search,
  Settings,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UploadCloud,
  Video,
} from 'lucide-react';
import PremiumBackground from '../components/PremiumBackground';
import GalleryNavbar from '../components/GalleryNavbar';
import { Button } from '../components/UI';
import { IMAGE_UPLOAD_SERVICES, VIDEO_UPLOAD_SERVICES } from '../config/providerCatalog';
import { useChromeMessage, useChromeStorage, useCollections, useImages, useTrash, useVault } from '../hooks/useChromeExtension';
import {
  getImageProviderLinks,
  getImageRetrySourceCandidates,
  getMissingImageUploadServices,
  getPreferredImageProviderLink,
  hasImageProviderLink,
} from '../utils/imageProviderLinks';
import {
  authorizeUdrop,
  checkUdropIntegrity,
  checkSceneIntegrity,
  deleteUdropFile,
} from '../utils/udropApi';
import {
  checkFilemoonIntegrity,
} from '../utils/filemoonApi';
import {
  checkTeraBoxIntegrity,
} from '../utils/teraBoxApi';
import { retryVideoHostPageSide } from '../utils/videoRetryPageSide';

const IMAGE_SETTING_KEYS = Array.from(
  new Set([
    ...IMAGE_UPLOAD_SERVICES.flatMap((service) => service.apiKeyFields || []),
    ...VIDEO_UPLOAD_SERVICES.flatMap((service) => service.apiKeyFields || []),
  ])
);
const RESOLVE_RUN_HISTORY_KEY = 'imgvaultResolveRunHistory';
const RESOLVE_RUN_HISTORY_LIMIT = 12;

const hasText = (value) => typeof value === 'string' && value.trim().length > 0;

const isHttpUrl = (value) => /^https?:\/\//i.test(String(value || '').trim());

function isImageItem(item) {
  return Boolean(item) && !item.isLink && !item.isVideo && item.kind !== 'scene' && !item.spzUrl && !String(item.fileType || '').startsWith('video/');
}

function isVaultedEncryptedItem(item) {
  return Boolean(item) && Boolean(
    item.encryptedBlobUrl ||
    item.encryptedBlobWatchUrl ||
    item.extraMetadata?.encryptedBlobUrl ||
    item.extraMetadata?.encryptedBlobWatchUrl
  );
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString();
}

function formatTimestamp(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
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
  const { images, loading, reload: reloadImages } = useImages();
  const { vaultImages, reload: reloadVaultImages } = useVault();
  const { trashedImages, loading: trashLoading } = useTrash();
  const { collections, loading: collectionsLoading } = useCollections();
  const [defaultGallerySource] = useChromeStorage('defaultGallerySource', 'imgbb', 'sync');
  const [navbarHeight, setNavbarHeight] = useState(0);
  const [settings, setSettings] = useState({});
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('ready');
  const [resolving, setResolving] = useState({});
  const [bulkResolveState, setBulkResolveState] = useState({
    active: false,
    completed: 0,
    failed: 0,
    total: 0,
    current: '',
  });
  const [resolveRuns, setResolveRuns] = useState([]);
  const [notice, setNotice] = useState(null);

  // ---- UDrop integrity check state ----
  const [activeTab, setActiveTab] = useState('images'); // 'images' | 'videos'
  const [videoSubTab, setVideoSubTab] = useState('udrop'); // 'udrop' | 'filemoon' | 'terabox'
  const [udropLoading, setUdropLoading] = useState(false);
  const [udropError, setUdropError] = useState(null);
  const [udropIntegrity, setUdropIntegrity] = useState({ found: [], missing: [], noUrl: [], extra: [] });
  const [udropFilter, setUdropFilter] = useState('all'); // 'all' | 'missing' | 'found' | 'noUrl' | 'extra'
  const [udropKeysConfigured, setUdropKeysConfigured] = useState(false);
  const [deletingOrphans, setDeletingOrphans] = useState({});
  const [linkingExtra, setLinkingExtra] = useState({});

  // ---- 3D Scene integrity check state ----
  const [sceneIntegrity, setSceneIntegrity] = useState({ found: [], missing: [], noUrl: [], extra: [] });
  const [sceneLoading, setSceneLoading] = useState(false);
  const [sceneError, setSceneError] = useState(null);
  const [sceneFilter, setSceneFilter] = useState('all');
  const [sceneKeysConfigured, setSceneKeysConfigured] = useState(false);

  // ---- Filemoon integrity check state ----
  const [filemoonIntegrity, setFilemoonIntegrity] = useState({ found: [], missing: [], noUrl: [], extra: [] });
  const [filemoonLoading, setFilemoonLoading] = useState(false);
  const [filemoonError, setFilemoonError] = useState(null);
  const [filemoonFilter, setFilemoonFilter] = useState('all');
  const [filemoonKeysConfigured, setFilemoonKeysConfigured] = useState(false);
  const [fixingFilemoon, setFixingFilemoon] = useState({});
  const [fixingUdrop, setFixingUdrop] = useState({});
  const [fixProgress, setFixProgress] = useState({});

  // ---- TeraBox integrity check state ----
  const [teraboxIntegrity, setTeraBoxIntegrity] = useState({ found: [], missing: [], noUrl: [], extra: [] });
  const [teraboxLoading, setTeraBoxLoading] = useState(false);
  const [teraboxError, setTeraBoxError] = useState(null);
  const [teraboxFilter, setTeraBoxFilter] = useState('all');
  const [teraboxKeysConfigured, setTeraBoxKeysConfigured] = useState(false);
  const [fixingTeraBox, setFixingTeraBox] = useState({});

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

  useEffect(() => {
    chrome.storage.local.get([RESOLVE_RUN_HISTORY_KEY], (result) => {
      const savedRuns = result?.[RESOLVE_RUN_HISTORY_KEY];
      setResolveRuns(Array.isArray(savedRuns) ? savedRuns.slice(0, RESOLVE_RUN_HISTORY_LIMIT) : []);
    });

    const handleStorageChange = (changes, area) => {
      if (area !== 'local' || !changes[RESOLVE_RUN_HISTORY_KEY]) return;
      const nextRuns = changes[RESOLVE_RUN_HISTORY_KEY].newValue;
      setResolveRuns(Array.isArray(nextRuns) ? nextRuns.slice(0, RESOLVE_RUN_HISTORY_LIMIT) : []);
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

  const visibleResolveTargets = useMemo(() => (
    visibleRows.flatMap((row) => (
      row.readyMissingProviders.map((service) => ({ row, service }))
    ))
  ), [visibleRows]);

  const latestRunWithFailures = useMemo(
    () => resolveRuns.find((run) => Array.isArray(run.failures) && run.failures.length > 0) || null,
    [resolveRuns]
  );

  const failedRetryTargets = useMemo(() => {
    if (!latestRunWithFailures) return [];

    const rowsById = new Map(rows.map((row) => [row.item.id, row]));
    return latestRunWithFailures.failures
      .map((failure) => {
        const row = rowsById.get(failure.imageId);
        if (!row) return null;
        const service = row.readyMissingProviders.find((candidate) => candidate.key === failure.serviceKey);
        if (!service) return null;
        return { row, service };
      })
      .filter(Boolean);
  }, [latestRunWithFailures, rows]);

  const saveResolveRun = (run) => {
    const nextRuns = [run, ...resolveRuns].slice(0, RESOLVE_RUN_HISTORY_LIMIT);
    setResolveRuns(nextRuns);
    chrome.storage.local.set({ [RESOLVE_RUN_HISTORY_KEY]: nextRuns });
  };

  // ---- UDrop integrity helpers ----
  const checkUdropKeysConfigured = useCallback(() => {
    const configured = hasText(settings?.udropKey1) && hasText(settings?.udropKey2);
    setUdropKeysConfigured(configured);
    return configured;
  }, [settings]);

  useEffect(() => {
    checkUdropKeysConfigured();
  }, [checkUdropKeysConfigured]);

  const runUdropIntegrityCheck = useCallback(async () => {
    if (!checkUdropKeysConfigured()) {
      setUdropError('UDrop keys not configured. Go to Settings.');
      return;
    }
    setUdropLoading(true);
    setUdropError(null);
    setNotice(null);
    try {
      const auth = await authorizeUdrop(settings.udropKey1, settings.udropKey2);

      // Fetch FRESH items from the DB instead of trusting hook state — after a
      // link/upload the in-memory lists are stale and the just-written URL is
      // invisible, so the file keeps showing as a false orphan until a page
      // remount. Vault items are excluded from getImages, merge them in.
      const [freshImages, freshVault] = await Promise.all([sendMessage('getImages'), sendMessage('getVaultImages')]);
      const allItems = [...(freshImages || []), ...(freshVault || [])];
      const videoItems = allItems.filter((item) => {
        if (!item) return false;
        // Link items can be fixed/uploaded too (Fix buttons appear on their
        // rows), so they must count as referenced when they have a host URL.
        // Scenes are tracked on the dedicated 3D Scene Hosts tab, not here.
        if (item.kind === 'scene' || item.spzUrl) return false;
        const isVideo = Boolean(item.isVideo || String(item.fileType || '').startsWith('video/'));
        const hasUdrop = Boolean(
          item.udropWatchUrl || item.udropDirectUrl || item.udropUrl ||
          item.encryptedBlobUrl || item.encryptedBlobWatchUrl ||
          item.extraMetadata?.encryptedBlobUrl || item.extraMetadata?.encryptedBlobWatchUrl
        ) || (Array.isArray(item.extraMetadata?.udropLinks) && item.extraMetadata.udropLinks.length > 0);
        return isVideo || hasUdrop;
      });

      const result = await checkUdropIntegrity(videoItems, allItems, auth.access_token, auth.account_id);
      setUdropIntegrity(result);
      setNotice({
        type: result.missing.length > 0 ? 'error' : 'success',
        message: `UDrop check: ${result.found.length} found, ${result.missing.length} broken links, ${result.noUrl.length} no url, ${result.extra.length} extra on udrop.`,
      });
    } catch (err) {
      setUdropError(err.message || String(err));
    } finally {
      setUdropLoading(false);
    }
  }, [settings, sendMessage, checkUdropKeysConfigured]);

  // Auto-run when switching to udrop tab if not loaded yet
  useEffect(() => {
    if (activeTab === 'videos' && videoSubTab === 'udrop' && !udropLoading && !udropError && udropIntegrity.found.length === 0 && udropIntegrity.missing.length === 0 && udropIntegrity.noUrl.length === 0 && udropIntegrity.extra.length === 0) {
      runUdropIntegrityCheck();
    }
  }, [activeTab, videoSubTab, udropLoading, udropError, udropIntegrity, runUdropIntegrityCheck]);

  // ---- Filemoon integrity helpers ----
  const checkFilemoonKeysConfigured = useCallback(() => {
    const configured = hasText(settings?.filemoonApiKey);
    setFilemoonKeysConfigured(configured);
    return configured;
  }, [settings]);

  useEffect(() => {
    checkFilemoonKeysConfigured();
  }, [checkFilemoonKeysConfigured]);

  const runFilemoonIntegrityCheck = useCallback(async () => {
    if (!checkFilemoonKeysConfigured()) {
      setFilemoonError('Filemoon API key not configured. Go to Settings.');
      return;
    }
    setFilemoonLoading(true);
    setFilemoonError(null);
    setNotice(null);
    try {
      // Fetch FRESH items from the DB instead of trusting hook state — after a
      // link/upload the in-memory lists are stale and the just-written URL is
      // invisible, so the file keeps showing as a false orphan until a page
      // remount. Vault items are excluded from getImages, merge them in.
      const [freshImages, freshVault] = await Promise.all([sendMessage('getImages'), sendMessage('getVaultImages')]);
      const allVideoItems = [...(freshImages || []), ...(freshVault || [])];
      const videoItems = allVideoItems.filter((item) => {
        if (!item) return false;
        // Link items can be uploaded/fixed like videos, so they must count
        // as referenced when they carry a Filemoon URL.
        if (item.kind === 'scene' || item.spzUrl) return false;
        const isVideo = Boolean(item.isVideo || String(item.fileType || '').startsWith('video/'));
        const hasFilemoon = Boolean(item.filemoonWatchUrl || item.filemoonDirectUrl || item.filemoonUrl) || (Array.isArray(item.extraMetadata?.filemoonLinks) && item.extraMetadata.filemoonLinks.length > 0);
        return isVideo || hasFilemoon;
      });

      const result = await checkFilemoonIntegrity(videoItems, settings.filemoonApiKey);
      setFilemoonIntegrity(result);
      setNotice({
        type: result.missing.length > 0 ? 'error' : 'success',
        message: `Filemoon check: ${result.found.length} found, ${result.missing.length} broken links, ${result.noUrl.length} no url, ${result.extra.length} extra on filemoon.`,
      });
    } catch (err) {
      setFilemoonError(err.message || String(err));
    } finally {
      setFilemoonLoading(false);
    }
  }, [settings, sendMessage, checkFilemoonKeysConfigured]);

  useEffect(() => {
    if (activeTab === 'videos' && videoSubTab === 'filemoon' && !filemoonLoading && !filemoonError && filemoonIntegrity.found.length === 0 && filemoonIntegrity.missing.length === 0 && filemoonIntegrity.noUrl.length === 0 && filemoonIntegrity.extra.length === 0) {
      runFilemoonIntegrityCheck();
    }
  }, [activeTab, videoSubTab, filemoonLoading, filemoonError, filemoonIntegrity, runFilemoonIntegrityCheck]);

  // ---- TeraBox integrity helpers ----
  const checkTeraBoxKeysConfigured = useCallback(() => {
    // cookie auto-reads from the browser session when the settings field is
    // empty, so the tab is always available; a missing session surfaces as a
    // real error from the integrity check itself.
    setTeraBoxKeysConfigured(true);
    return true;
  }, []);

  useEffect(() => {
    checkTeraBoxKeysConfigured();
  }, [checkTeraBoxKeysConfigured]);

  const runTeraBoxIntegrityCheck = useCallback(async () => {
    if (!checkTeraBoxKeysConfigured()) {
      setTeraBoxError('TeraBox cookie not configured. Go to Settings.');
      return;
    }
    setTeraBoxLoading(true);
    setTeraBoxError(null);
    setNotice(null);
    try {
      const [freshImages, freshVault] = await Promise.all([sendMessage('getImages'), sendMessage('getVaultImages')]);
      const allVideoItems = [...(freshImages || []), ...(freshVault || [])];
      const videoItems = allVideoItems.filter((item) => {
        if (!item) return false;
        if (item.kind === 'scene' || item.spzUrl) return false;
        const isVideo = Boolean(item.isVideo || String(item.fileType || '').startsWith('video/'));
        const hasTeraBox = Boolean(item.teraboxWatchUrl || item.teraboxDirectUrl || item.teraboxUrl) ||
          Boolean(item.videoHosts?.terabox?.watchUrl || item.videoHosts?.terabox?.directUrl) ||
          Boolean(item.teraboxFileId || item.videoHosts?.terabox?.fileId);
        return isVideo || hasTeraBox;
      });

      const result = await checkTeraBoxIntegrity(videoItems, settings.teraboxCookie);
      setTeraBoxIntegrity(result);
      setNotice({
        type: result.missing.length > 0 ? 'error' : 'success',
        message: `TeraBox check: ${result.found.length} found, ${result.missing.length} broken links, ${result.noUrl.length} no url, ${result.extra.length} extra on terabox.`,
      });
    } catch (err) {
      setTeraBoxError(err.message || String(err));
    } finally {
      setTeraBoxLoading(false);
    }
  }, [settings, sendMessage, checkTeraBoxKeysConfigured]);

  useEffect(() => {
    if (activeTab === 'videos' && videoSubTab === 'terabox' && !teraboxLoading && !teraboxError && teraboxIntegrity.found.length === 0 && teraboxIntegrity.missing.length === 0 && teraboxIntegrity.noUrl.length === 0 && teraboxIntegrity.extra.length === 0) {
      runTeraBoxIntegrityCheck();
    }
  }, [activeTab, videoSubTab, teraboxLoading, teraboxError, teraboxIntegrity, runTeraBoxIntegrityCheck]);

  // ---- 3D Scene integrity helpers ----
  const checkSceneKeysConfigured = useCallback(() => {
    const configured = hasText(settings?.udropKey1) && hasText(settings?.udropKey2);
    setSceneKeysConfigured(configured);
    return configured;
  }, [settings]);

  useEffect(() => {
    checkSceneKeysConfigured();
  }, [checkSceneKeysConfigured]);

  const runSceneIntegrityCheck = useCallback(async () => {
    if (!checkSceneKeysConfigured()) {
      setSceneError('UDrop keys not configured. Go to Settings.');
      return;
    }
    setSceneLoading(true);
    setSceneError(null);
    setNotice(null);
    try {
      const auth = await authorizeUdrop(settings.udropKey1, settings.udropKey2);

      // Fetch FRESH items; scenes live on UDrop as .spz files (spzUrl).
      const [freshImages, freshVault] = await Promise.all([sendMessage('getImages'), sendMessage('getVaultImages')]);
      const allItems = [...(freshImages || []), ...(freshVault || [])];
      const sceneItems = allItems.filter((item) => {
        if (!item) return false;
        return item.kind === 'scene' || Boolean(item.spzUrl);
      });

      const result = await checkSceneIntegrity(sceneItems, allItems, auth.access_token, auth.account_id);
      setSceneIntegrity(result);
      setNotice({
        type: result.missing.length > 0 ? 'error' : 'success',
        message: `3D Scene check: ${result.found.length} found, ${result.missing.length} broken links, ${result.noUrl.length} no url, ${result.extra.length} extra on udrop.`,
      });
    } catch (err) {
      setSceneError(err.message || String(err));
    } finally {
      setSceneLoading(false);
    }
  }, [settings, sendMessage, checkSceneKeysConfigured]);

  useEffect(() => {
    if (activeTab === 'scenes' && !sceneLoading && !sceneError && sceneIntegrity.found.length === 0 && sceneIntegrity.missing.length === 0 && sceneIntegrity.noUrl.length === 0 && sceneIntegrity.extra.length === 0) {
      runSceneIntegrityCheck();
    }
  }, [activeTab, sceneLoading, sceneError, sceneIntegrity, runSceneIntegrityCheck]);

  const resolveProvider = async (row, service, options = {}) => {
    const { reloadAfter = true, showNotice = true } = options;
    const key = `${row.item.id}:${service.key}`;
    setResolving((current) => ({ ...current, [key]: true }));
    if (showNotice) setNotice(null);

    try {
      await sendMessage('retryImageHostUpload', {
        imageId: row.item.id,
        host: service.key,
      });
      if (showNotice) {
        setNotice({
          type: 'success',
          message: `${service.label} saved for ${row.title}.`,
        });
      }
      if (reloadAfter) await reloadImages({ silent: true });
      return { ok: true };
    } catch (error) {
      const errorMessage = error.message || String(error);
      if (showNotice) {
        setNotice({
          type: 'error',
          message: `${service.label} failed for ${row.title}: ${errorMessage}`,
        });
      }
      return { ok: false, error: errorMessage };
    } finally {
      setResolving((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
  };

  const resolveTargetBatch = async (targets, label = 'Resolve all') => {
    if (targets.length === 0 || bulkResolveState.active) return;

    let completed = 0;
    let failed = 0;
    const successes = [];
    const failures = [];
    const startedAt = new Date().toISOString();

    setNotice(null);
    setBulkResolveState({
      active: true,
      completed: 0,
      failed: 0,
      total: targets.length,
      current: '',
    });

    for (const { row, service } of targets) {
      setBulkResolveState({
        active: true,
        completed,
        failed,
        total: targets.length,
        current: `${service.label} for ${row.title}`,
      });

      const result = await resolveProvider(row, service, {
        reloadAfter: false,
        showNotice: false,
      });

      const entry = {
        imageId: row.item.id,
        title: row.title,
        serviceKey: service.key,
        serviceLabel: service.label,
      };

      if (result.ok) {
        completed += 1;
        successes.push(entry);
      } else {
        failed += 1;
        failures.push({
          ...entry,
          error: result.error || 'Unknown error',
        });
      }

      setBulkResolveState({
        active: true,
        completed,
        failed,
        total: targets.length,
        current: `${service.label} for ${row.title}`,
      });
    }

    await reloadImages({ silent: true });
    const run = {
      id: `resolve_${Date.now()}`,
      label,
      startedAt,
      completedAt: new Date().toISOString(),
      total: targets.length,
      completed,
      failed,
      successes,
      failures,
    };
    saveResolveRun(run);
    setBulkResolveState({
      active: false,
      completed,
      failed,
      total: targets.length,
      current: '',
    });
    setNotice({
      type: failed > 0 ? 'error' : 'success',
      message: failed > 0
        ? `Resolved ${completed}/${targets.length} host gap${targets.length !== 1 ? 's' : ''}. ${failed} failed.`
        : `Resolved ${completed} host gap${completed !== 1 ? 's' : ''}.`,
    });
  };

  const resolveAllVisible = async () => {
    await resolveTargetBatch(visibleResolveTargets, 'Resolve all');
  };

  const retryFailed = async () => {
    await resolveTargetBatch(failedRetryTargets, 'Retry failed');
  };

  const clearResolveHistory = () => {
    setResolveRuns([]);
    chrome.storage.local.set({ [RESOLVE_RUN_HISTORY_KEY]: [] });
  };

  const refreshAll = async () => {
    loadSettings();
    await reloadImages();
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
            <Button
              variant="primary"
              onClick={resolveAllVisible}
              className="h-10 gap-2 px-3 text-sm"
              disabled={loading || settingsLoading || bulkResolveState.active || visibleResolveTargets.length === 0}
            >
              {bulkResolveState.active ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
              {bulkResolveState.active
                ? `${bulkResolveState.completed}/${bulkResolveState.total}`
                : `Resolve all (${visibleResolveTargets.length})`}
            </Button>
            <Button
              variant="outline"
              onClick={retryFailed}
              className="h-10 gap-2 px-3 text-sm"
              disabled={loading || settingsLoading || bulkResolveState.active || failedRetryTargets.length === 0}
            >
              <RefreshCw className={`h-4 w-4 ${bulkResolveState.active ? 'animate-spin' : ''}`} />
              Retry failed ({failedRetryTargets.length})
            </Button>
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

        {/* Tab Switcher */}
        <section className="flex flex-wrap gap-2 border-b border-base-300 pb-5">
          <button
            type="button"
            onClick={() => setActiveTab('images')}
            className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition ${
              activeTab === 'images'
                ? 'border-primary bg-primary text-primary-content shadow-sm'
                : 'border-base-300 bg-base-100 text-base-content/70 hover:text-base-content'
            }`}
          >
            <ImageIcon className="h-4 w-4" />
            Image hosts
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('videos')}
            className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition ${
              activeTab === 'videos'
                ? 'border-primary bg-primary text-primary-content shadow-sm'
                : 'border-base-300 bg-base-100 text-base-content/70 hover:text-base-content'
            }`}
          >
            <Video className="h-4 w-4" />
            Video hosts
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('scenes')}
            className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition ${
              activeTab === 'scenes'
                ? 'border-primary bg-primary text-primary-content shadow-sm'
                : 'border-base-300 bg-base-100 text-base-content/70 hover:text-base-content'
            }`}
          >
            <Box className="h-4 w-4" />
            3D file hosts
          </button>
        </section>

        {activeTab === 'videos' && (
          <section className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setVideoSubTab('udrop')}
              className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition ${
                videoSubTab === 'udrop'
                  ? 'border-primary bg-primary text-primary-content shadow-sm'
                  : 'border-base-300 bg-base-100 text-base-content/70 hover:text-base-content'
              }`}
            >
              <Shield className="h-4 w-4" />
              UDrop integrity
            </button>
            <button
              type="button"
              onClick={() => setVideoSubTab('filemoon')}
              className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition ${
                videoSubTab === 'filemoon'
                  ? 'border-primary bg-primary text-primary-content shadow-sm'
                  : 'border-base-300 bg-base-100 text-base-content/70 hover:text-base-content'
              }`}
            >
              <Film className="h-4 w-4" />
              Filemoon integrity
            </button>
            <button
              type="button"
              onClick={() => setVideoSubTab('terabox')}
              className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition ${
                videoSubTab === 'terabox'
                  ? 'border-primary bg-primary text-primary-content shadow-sm'
                  : 'border-base-300 bg-base-100 text-base-content/70 hover:text-base-content'
              }`}
            >
              <Box className="h-4 w-4" />
              TeraBox integrity
            </button>
          </section>
        )}

        {activeTab === 'images' && (
          <>
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

            {notice && activeTab === 'images' && (
              <div className={`rounded-[var(--radius-box)] border px-4 py-3 text-sm font-medium ${
                notice.type === 'success'
                  ? 'border-success/25 bg-success/10 text-success'
                  : 'border-error/25 bg-error/10 text-error'
              }`}>
                {notice.message}
              </div>
            )}

            {bulkResolveState.active && (
              <div className="rounded-[var(--radius-box)] border border-primary/20 bg-primary/10 px-4 py-3 text-sm text-primary">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold">
                    Resolving {bulkResolveState.completed}/{bulkResolveState.total}
                  </span>
                  {bulkResolveState.failed > 0 && (
                    <span className="text-error">{bulkResolveState.failed} failed</span>
                  )}
                </div>
                {bulkResolveState.current && (
                  <div className="mt-1 truncate text-primary/80">{bulkResolveState.current}</div>
                )}
              </div>
            )}

            {resolveRuns.length > 0 && (
              <section className="rounded-[var(--radius-box)] border border-base-300 bg-base-100 p-4 shadow-sm">
                <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h2 className="text-base font-semibold text-base-content">Resolve history</h2>
                    <p className="mt-1 text-sm text-base-content/60">
                      Failed rows stay here so you can retry only the gaps that did not finish.
                    </p>
                  </div>
                  <Button variant="outline" onClick={clearResolveHistory} className="h-8 px-3 text-xs">
                    Clear
                  </Button>
                </div>

                <div className="grid gap-3">
                  {resolveRuns.slice(0, 5).map((run) => (
                    <div key={run.id} className="rounded-[var(--radius-box)] border border-base-300 bg-base-200/60 p-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <div className="text-sm font-semibold text-base-content">
                            {run.label || 'Resolve run'}
                          </div>
                          <div className="text-xs text-base-content/55">
                            {formatTimestamp(run.completedAt || run.startedAt)}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2 text-xs font-semibold">
                          <span className="rounded-full border border-success/20 bg-success/10 px-2.5 py-1 text-success">
                            {run.completed || 0}/{run.total || 0} resolved
                          </span>
                          {(run.failed || 0) > 0 && (
                            <span className="rounded-full border border-error/20 bg-error/10 px-2.5 py-1 text-error">
                              {run.failed} failed
                            </span>
                          )}
                        </div>
                      </div>

                      {Array.isArray(run.failures) && run.failures.length > 0 && (
                        <details className="mt-3">
                          <summary className="cursor-pointer text-sm font-medium text-error">
                            Failed items
                          </summary>
                          <div className="mt-2 grid gap-2">
                            {run.failures.map((failure, index) => (
                              <div
                                key={`${failure.imageId}-${failure.serviceKey}-${index}`}
                                className="rounded-[var(--radius-box)] border border-error/15 bg-error/5 px-3 py-2 text-sm"
                              >
                                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                                  <span className="font-medium text-base-content">{failure.title || 'Untitled image'}</span>
                                  <span className="text-xs font-semibold text-error">{failure.serviceLabel || failure.serviceKey}</span>
                                </div>
                                <div className="mt-1 break-words text-xs text-base-content/60">
                                  {failure.error || 'Unknown error'}
                                </div>
                              </div>
                            ))}
                          </div>
                        </details>
                      )}
                    </div>
                  ))}
                </div>
              </section>
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
                              disabled={isResolving || bulkResolveState.active}
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
          </>
        )}

        {/* UDrop Integrity Tab */}
        {activeTab === 'videos' && videoSubTab === 'udrop' && (
          <>
            <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                  <Shield className="h-4 w-4" />
                  UDrop integrity
                </div>
                <h1 className="text-3xl font-semibold tracking-tight text-base-content">UDrop file integrity</h1>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Button
                  variant="primary"
                  onClick={runUdropIntegrityCheck}
                  className="h-10 gap-2 px-3 text-sm"
                  disabled={udropLoading}
                >
                  {udropLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  {udropLoading ? 'Checking...' : 'Check UDrop'}
                </Button>
                <Button variant="outline" onClick={() => navigate('/settings')} className="h-10 gap-2 px-3 text-sm">
                  <Settings className="h-4 w-4" />
                  Settings
                </Button>
              </div>
            </section>

            {!udropKeysConfigured && (
              <div className="rounded-[var(--radius-box)] border border-warning/25 bg-warning/10 px-4 py-3 text-sm text-warning">
                UDrop API keys are not configured. Go to Settings to add them.
              </div>
            )}

            {udropError && (
              <div className="rounded-[var(--radius-box)] border border-error/25 bg-error/10 px-4 py-3 text-sm text-error">
                {udropError}
              </div>
            )}

            {notice && activeTab === 'videos' && videoSubTab === 'udrop' && (
              <div className="rounded-[var(--radius-box)] border border-error/25 bg-error/10 px-4 py-3 text-sm font-medium text-error">
                {notice.message}
              </div>
            )}

            <section className="flex flex-wrap gap-2">
              {[
                { value: 'all', label: 'All', count: udropIntegrity.found.length + udropIntegrity.missing.length + udropIntegrity.noUrl.length + udropIntegrity.extra.length, tip: 'Every saved video, counted once. This is the full list.' },
                { value: 'missing', label: 'Broken links', count: udropIntegrity.missing.length, tip: 'Videos whose UDrop link is broken or whose file was deleted from UDrop. These need fixing or a fresh upload.' },
                { value: 'found', label: 'Found', count: udropIntegrity.found.length, tip: 'Videos with a working file on UDrop. Nothing to do.' },
                { value: 'noUrl', label: 'No UDrop URL', count: udropIntegrity.noUrl.length, tip: 'Saved videos that have no UDrop link at all — they were never uploaded to UDrop.' },
                { value: 'extra', label: 'Extra on UDrop', count: udropIntegrity.extra.length, tip: 'Files on UDrop that are not linked to any saved video. Likely old uploads or duplicates.' },
              ].map((option) => (
                <StatChip
                  key={option.value}
                  value={option.value}
                  label={option.label}
                  count={option.count}
                  tip={option.tip}
                  active={udropFilter === option.value}
                  onClick={() => setUdropFilter(option.value)}
                />
              ))}
            </section>

            <section className="grid gap-3">
              {udropLoading && (
                <div className="flex min-h-64 items-center justify-center rounded-[var(--radius-box)] border border-base-300 bg-base-100 text-base-content/60">
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Loading UDrop file list...
                </div>
              )}

              {!udropLoading && (() => {
                let displayItems = [];
                if (udropFilter === 'all') {
                  displayItems = [
                    ...udropIntegrity.missing.map((i) => ({ ...i, status: 'missing' })),
                    ...udropIntegrity.found.map((i) => ({ ...i, status: 'found' })),
                    ...udropIntegrity.noUrl.map((i) => ({ ...i, status: 'noUrl' })),
                    ...udropIntegrity.extra.map((i) => ({ ...i, status: 'extra' })),
                  ];
                } else if (udropFilter === 'missing') {
                  displayItems = udropIntegrity.missing.map((i) => ({ ...i, status: 'missing' }));
                } else if (udropFilter === 'found') {
                  displayItems = udropIntegrity.found.map((i) => ({ ...i, status: 'found' }));
                } else if (udropFilter === 'noUrl') {
                  displayItems = udropIntegrity.noUrl.map((i) => ({ ...i, status: 'noUrl' }));
                } else if (udropFilter === 'extra') {
                  displayItems = udropIntegrity.extra.map((i) => ({ ...i, status: 'extra' }));
                }

                if (displayItems.length === 0) {
                  return (
                    <div className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-[var(--radius-box)] border border-base-300 bg-base-100 px-4 text-center">
                      <ShieldCheck className="h-8 w-8 text-success" />
                      <div>
                        <h2 className="text-lg font-semibold text-base-content">No items in this view</h2>
                        <p className="mt-1 text-sm text-base-content/60">
                          {udropFilter === 'missing' ? 'All UDrop files are accounted for.' : 'Nothing to show here.'}
                        </p>
                      </div>
                    </div>
                  );
                }

                return displayItems.map((entry) => {
                  const { item, status, matchedFile, codes } = entry;

                  // ---- Extra (orphan) UDrop files ----
                  if (status === 'extra') {
                    const file = entry.file || {};
                    const title = file.name || file.filename || file.file_id || 'Unknown file';
                    const udropUrl = file.short_url || file.url || '';
                    return (
                      <article
                        key={`extra-${file.file_id || file.id || file.short_url || Math.random()}`}
                        className="grid gap-4 rounded-[var(--radius-box)] border border-base-300 bg-base-100 p-3 shadow-sm transition hover:border-warning/25 sm:grid-cols-[132px_1fr_auto]"
                      >
                        <div className="flex h-28 items-center justify-center overflow-hidden rounded-[var(--radius-box)] bg-base-200">
                          <div className="flex flex-col items-center gap-1 text-warning/70">
                            <AlertCircle className="h-8 w-8" />
                            <span className="text-[10px] font-semibold uppercase tracking-wider">Orphan</span>
                          </div>
                        </div>

                        <div className="min-w-0 space-y-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <h2 className="truncate text-base font-semibold text-base-content">{title}</h2>
                              <span className="inline-flex items-center gap-1 rounded-full border border-warning/20 bg-warning/10 px-2 py-0.5 text-xs font-semibold text-warning">
                                <AlertCircle className="h-3 w-3" /> Not in DB
                              </span>
                            </div>
                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-base-content/55">
                              {file.file_id && <span>ID: {file.file_id}</span>}
                              {file._folderName && <span>Folder: {file._folderName}</span>}
                              {udropUrl && (
                                <a href={udropUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                                  UDrop <ExternalLink className="h-3 w-3" />
                                </a>
                              )}
                            </div>
                          </div>

                          <div className="text-xs text-base-content/70">
                            This file exists on UDrop but is not linked to any item in your vault. It might be safe to delete.
                          </div>
                        </div>

                        <div className="flex flex-col justify-between gap-3 sm:w-52">
                          <div className="rounded-[var(--radius-box)] border border-base-300 bg-base-200/60 px-3 py-2 text-xs text-base-content/65">
                            Orphaned UDrop file
                          </div>
                          <div className="flex flex-col gap-2">
                            {udropUrl && (
                              <Button variant="outline" className="h-9 justify-center gap-2 text-sm" onClick={() => window.open(udropUrl, '_blank')}>
                                <ExternalLink className="h-4 w-4" />
                                Open UDrop
                              </Button>
                            )}
                            {(file.short_url || file.shortUrl || file.file_id || file.id) && (() => {
                              const code = String(file.short_url || file.shortUrl || file.file_id || file.id);
                              const linkKey = `udrop:${code}`;
                              const pendingMatch = findPendingItemForFile([...(images || []), ...(vaultImages || [])], file);
                              return (
                                <>
                                  {pendingMatch && (
                                    <Button
                                      variant="outline"
                                      className="h-9 justify-center gap-2 border-success/30 bg-success/10 text-sm text-success hover:bg-success/15"
                                      disabled={Boolean(linkingExtra[linkKey])}
                                      onClick={async () => {
                                        setLinkingExtra((prev) => ({ ...prev, [linkKey]: true }));
                                        try {
                                          await sendMessage('finalizeUploadedVideo', {
                                            id: pendingMatch.id,
                                            videoUploadResults: {
                                              udrop: { filecode: code, watchUrl: `https://www.udrop.com/file/${code}`, directUrl: `https://www.udrop.com/file/${code}` },
                                            },
                                          });
                                          await Promise.all([reloadImages({ silent: true }), reloadVaultImages()]);
                                          await runUdropIntegrityCheck();
                                          setNotice({ type: 'success', message: `Recovered "${pendingMatch.fileName || pendingMatch.pageTitle || 'pending upload'}" from the interrupted upload.` });
                                        } catch (err) {
                                          setNotice({ type: 'error', message: `Recovery failed: ${err.message || err}` });
                                        } finally {
                                          setLinkingExtra((prev) => {
                                            const next = { ...prev };
                                            delete next[linkKey];
                                            return next;
                                          });
                                        }
                                      }}
                                    >
                                      {linkingExtra[linkKey] ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                                      {linkingExtra[linkKey] ? 'Recovering...' : 'Recover pending upload'}
                                    </Button>
                                  )}
                                  <Button
                                    variant="outline"
                                    className="h-9 justify-center gap-2 text-sm"
                                    disabled={Boolean(linkingExtra[linkKey])}
                                    onClick={async () => {
                                      setLinkingExtra((prev) => ({ ...prev, [linkKey]: true }));
                                      try {
                                        const match = findMatchingItemForFile([...(images || []), ...(vaultImages || [])], file);
                                        if (!match) {
                                          throw new Error('No item matched by title or filename. Link the file from the dashboard instead.');
                                        }
                                        await sendMessage('linkProviderFileToItem', {
                                          id: match.id,
                                          providerKey: 'udrop',
                                          link: { filecode: code, watchUrl: `https://www.udrop.com/file/${code}`, directUrl: `https://www.udrop.com/file/${code}` },
                                        });
                                        await Promise.all([reloadImages({ silent: true }), reloadVaultImages()]);
                                        await runUdropIntegrityCheck();
                                        setNotice({ type: 'success', message: `Linked UDrop file "${file.name || file.filename || code}" to "${match.pageTitle || match.fileName || 'item'}".` });
                                      } catch (err) {
                                        setNotice({ type: 'error', message: `Link failed: ${err.message || err}` });
                                      } finally {
                                        setLinkingExtra((prev) => {
                                          const next = { ...prev };
                                          delete next[linkKey];
                                          return next;
                                        });
                                      }
                                    }}
                                  >
                                    {linkingExtra[linkKey] ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                                    {linkingExtra[linkKey] ? 'Linking...' : 'Link to item'}
                                  </Button>
                                </>
                              );
                            })()}
                            {(file.file_id || file.id) && (
                              <Button
                                variant="primary"
                                className="h-9 justify-center gap-2 text-sm"
                                disabled={Boolean(deletingOrphans[String(file.file_id || file.id)])}
                                onClick={async () => {
                                  const fid = String(file.file_id || file.id);
                                  if (!confirm(`Delete "${file.name || file.filename || fid}" from UDrop? This cannot be undone.`)) return;
                                  setDeletingOrphans((prev) => ({ ...prev, [fid]: true }));
                                  try {
                                    const auth = await authorizeUdrop(settings.udropKey1, settings.udropKey2);
                                    await deleteUdropFile(auth.access_token, auth.account_id, fid);
                                    setUdropIntegrity((prev) => ({
                                      ...prev,
                                      extra: prev.extra.filter((e) => String((e.file?.file_id || e.file?.id)) !== fid),
                                    }));
                                    setNotice({ type: 'success', message: `Deleted orphan file "${file.name || file.filename || fid}" from UDrop.` });
                                  } catch (err) {
                                    setNotice({ type: 'error', message: `Failed to delete: ${err.message || err}` });
                                  } finally {
                                    setDeletingOrphans((prev) => {
                                      const next = { ...prev };
                                      delete next[fid];
                                      return next;
                                    });
                                  }
                                }}
                              >
                                {deletingOrphans[String(file.file_id || file.id)] ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                                {deletingOrphans[String(file.file_id || file.id)] ? 'Deleting...' : 'Delete'}
                              </Button>
                            )}
                          </div>
                        </div>
                      </article>
                    );
                  }

                  // ---- Normal DB items ----
                  const title = item.pageTitle || item.fileName || item.description || 'Untitled';
                  const isVideo = Boolean(item.isVideo || String(item.fileType || '').startsWith('video/'));
                  const isScene = Boolean(item.spzUrl);
                  const typeLabel = isScene ? '3D scene' : isVideo ? 'Video' : 'Media';
                  const typeIcon = isScene ? <Box className="h-4 w-4" /> : isVideo ? <Video className="h-4 w-4" /> : <ImageIcon className="h-4 w-4" />;
                  const udropUrl = item.udropWatchUrl || item.udropDirectUrl || item.udropUrl || item.spzUrl || '';

                  return (
                    <article
                      key={item.id}
                      className="grid gap-4 rounded-[var(--radius-box)] border border-base-300 bg-base-100 p-3 shadow-sm transition hover:border-primary/25 sm:grid-cols-[132px_1fr_auto]"
                    >
                      <div className="flex h-28 items-center justify-center overflow-hidden rounded-[var(--radius-box)] bg-base-200">
                        {item.linkPreviewImageUrl || item.imgbbThumbUrl ? (
                          <img
                            src={item.linkPreviewImageUrl || item.imgbbThumbUrl}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex flex-col items-center gap-1 text-base-content/35">
                            {typeIcon}
                            <span className="text-[10px] font-semibold uppercase tracking-wider">{typeLabel}</span>
                          </div>
                        )}
                      </div>

                      <div className="min-w-0 space-y-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <h2 className="truncate text-base font-semibold text-base-content">{title}</h2>
                            {status === 'missing' && (
                              <span className="inline-flex items-center gap-1 rounded-full border border-error/20 bg-error/10 px-2 py-0.5 text-xs font-semibold text-error">
                                <ShieldAlert className="h-3 w-3" /> Broken link
                              </span>
                            )}
                            {status === 'found' && (
                              <span className="inline-flex items-center gap-1 rounded-full border border-success/20 bg-success/10 px-2 py-0.5 text-xs font-semibold text-success">
                                <ShieldCheck className="h-3 w-3" /> Found
                              </span>
                            )}
                            {status === 'noUrl' && (
                              <span className="inline-flex items-center gap-1 rounded-full border border-warning/20 bg-warning/10 px-2 py-0.5 text-xs font-semibold text-warning">
                                <AlertCircle className="h-3 w-3" /> No UDrop URL
                              </span>
                            )}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-base-content/55">
                            {item.fileName && <span className="truncate">{item.fileName}</span>}
                            {formatDate(item.createdAt || item.internalAddedTimestamp)}
                            {udropUrl && (
                              <a
                                href={udropUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-primary hover:underline"
                              >
                                UDrop <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </div>
                        </div>

                        {status === 'found' && matchedFile && (
                          <div className="text-xs text-base-content/70">
                            <div className="font-medium text-success">UDrop file: {matchedFile.name || matchedFile.file_id}</div>
                            {matchedFile.short_url && (
                              <a href={matchedFile.short_url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                                {matchedFile.short_url}
                              </a>
                            )}
                          </div>
                        )}

                        {status === 'missing' && codes.length > 0 && (
                          <div className="text-xs text-base-content/70">
                            <div className="font-medium text-error">Broken UDrop links:</div>
                            <div className="font-mono">{codes.join(', ')}</div>
                            <div className="mt-1 text-base-content/50">These files are no longer on UDrop. They may have been deleted, the upload may have failed, or the platform may have removed them.</div>
                          </div>
                        )}
                      </div>

                      <div className="flex flex-col justify-between gap-3 sm:w-52">
                        <div className="rounded-[var(--radius-box)] border border-base-300 bg-base-200/60 px-3 py-2 text-xs text-base-content/65">
                          {status === 'missing' && 'Needs re-upload to UDrop'}
                          {status === 'found' && 'Verified on UDrop'}
                          {status === 'noUrl' && 'No UDrop URL stored'}
                        </div>

                        <div className="flex flex-col gap-2">
                          {udropUrl && (
                            <Button
                              variant="outline"
                              className="h-9 justify-center gap-2 text-sm"
                              onClick={() => window.open(udropUrl, '_blank')}
                            >
                              <ExternalLink className="h-4 w-4" />
                              Open UDrop
                            </Button>
                          )}
                          {status === 'missing' && item.sourceImageUrl && (
                            <Button
                              variant="outline"
                              className="h-9 justify-center gap-2 text-sm"
                              onClick={() => window.open(item.sourceImageUrl, '_blank')}
                            >
                              <ExternalLink className="h-4 w-4" />
                              Source
                            </Button>
                          )}
                          {(status === 'noUrl' || status === 'missing') && (
                            <Button
                              variant="primary"
                              className="h-9 justify-center gap-2 text-sm"
                              disabled={Boolean(fixingUdrop[item.id])}
                              onClick={async () => {
                                setFixingUdrop((prev) => ({ ...prev, [item.id]: true }));
                                setFixProgress((prev) => ({ ...prev, [item.id]: { phase: 'download', message: 'Starting...', percent: null } }));
                                try {
                                  const [freshItem, hostSettings] = await Promise.all([
                                    sendMessage('getImageById', { id: item.id }),
                                    sendMessage('getVideoHostSettings'),
                                  ]);
                                  const updates = await retryVideoHostPageSide(freshItem, 'udrop', hostSettings, {
                                    onProgress: (progress) => setFixProgress((prev) => ({ ...prev, [item.id]: progress })),
                                  });
                                  await sendMessage('updateImage', { id: item.id, ...updates });
                                  await Promise.all([reloadImages({ silent: true }), reloadVaultImages()]);
                                  await runUdropIntegrityCheck();
                                  setNotice({ type: 'success', message: `UDrop upload fixed for "${title}".` });
                                } catch (err) {
                                  setNotice({ type: 'error', message: `Failed to fix: ${err.message || err}` });
                                } finally {
                                  setFixingUdrop((prev) => {
                                    const next = { ...prev };
                                    delete next[item.id];
                                    return next;
                                  });
                                  setFixProgress((prev) => {
                                    const next = { ...prev };
                                    delete next[item.id];
                                    return next;
                                  });
                                }
                              }}
                            >
                              {fixingUdrop[item.id] ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
                              {fixingUdrop[item.id] ? 'Fixing...' : 'Fix'}
                            </Button>
                          )}
                          {fixProgress[item.id] && (
                            <div className="flex flex-col gap-1.5">
                              <div className="text-[11px] leading-tight text-base-content/70">
                                {fixProgress[item.id].message || 'Working...'}
                              </div>
                              <div className="h-1.5 w-full overflow-hidden rounded-full bg-base-300">
                                <div
                                  className="h-full rounded-full bg-gradient-to-r from-primary-500 to-secondary-500 transition-all duration-300"
                                  style={{ width: `${Math.max(4, fixProgress[item.id].percent ?? 100)}%` }}
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                });
              })()}
            </section>
          </>
        )}

        {/* Filemoon Integrity Tab */}
        {activeTab === 'videos' && videoSubTab === 'filemoon' && (
          <>
            <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                  <Film className="h-4 w-4" />
                  Filemoon integrity
                </div>
                <h1 className="text-3xl font-semibold tracking-tight text-base-content">Filemoon video integrity</h1>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Button
                  variant="primary"
                  onClick={runFilemoonIntegrityCheck}
                  className="h-10 gap-2 px-3 text-sm"
                  disabled={filemoonLoading}
                >
                  {filemoonLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  {filemoonLoading ? 'Checking...' : 'Check Filemoon'}
                </Button>
                <Button variant="outline" onClick={() => navigate('/settings')} className="h-10 gap-2 px-3 text-sm">
                  <Settings className="h-4 w-4" />
                  Settings
                </Button>
              </div>
            </section>

            {!filemoonKeysConfigured && (
              <div className="rounded-[var(--radius-box)] border border-warning/25 bg-warning/10 px-4 py-3 text-sm text-warning">
                Filemoon API key is not configured. Go to Settings to add it.
              </div>
            )}

            {filemoonError && (
              <div className="rounded-[var(--radius-box)] border border-error/25 bg-error/10 px-4 py-3 text-sm text-error">
                {filemoonError}
              </div>
            )}

            {notice && activeTab === 'videos' && videoSubTab === 'filemoon' && (
              <div className="rounded-[var(--radius-box)] border border-error/25 bg-error/10 px-4 py-3 text-sm font-medium text-error">
                {notice.message}
              </div>
            )}

            <section className="flex flex-wrap gap-2">
              {[
                { value: 'all', label: 'All', count: filemoonIntegrity.found.length + filemoonIntegrity.missing.length + filemoonIntegrity.noUrl.length + filemoonIntegrity.extra.length, tip: 'Every saved video, counted once. This is the full list.' },
                { value: 'missing', label: 'Broken links', count: filemoonIntegrity.missing.length, tip: 'Videos whose Filemoon link is broken or whose file was deleted from Filemoon. These need fixing or a fresh upload.' },
                { value: 'found', label: 'Found', count: filemoonIntegrity.found.length, tip: 'Videos with a working file on Filemoon. Nothing to do.' },
                { value: 'noUrl', label: 'No Filemoon URL', count: filemoonIntegrity.noUrl.length, tip: 'Saved videos that have no Filemoon link at all — they were never uploaded to Filemoon.' },
                { value: 'extra', label: 'Extra on Filemoon', count: filemoonIntegrity.extra.length, tip: 'Files on Filemoon that are not linked to any saved video. Likely old uploads or duplicates.' },
              ].map((option) => (
                <StatChip
                  key={option.value}
                  value={option.value}
                  label={option.label}
                  count={option.count}
                  tip={option.tip}
                  active={filemoonFilter === option.value}
                  onClick={() => setFilemoonFilter(option.value)}
                />
              ))}
            </section>

            <section className="grid gap-3">
              {filemoonLoading && (
                <div className="flex min-h-64 items-center justify-center rounded-[var(--radius-box)] border border-base-300 bg-base-100 text-base-content/60">
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Checking Filemoon...
                </div>
              )}

              {!filemoonLoading && (() => {
                let displayItems = [];
                if (filemoonFilter === 'all') {
                  displayItems = [
                    ...filemoonIntegrity.missing.map((i) => ({ ...i, status: 'missing' })),
                    ...filemoonIntegrity.found.map((i) => ({ ...i, status: 'found' })),
                    ...filemoonIntegrity.noUrl.map((i) => ({ ...i, status: 'noUrl' })),
                    ...filemoonIntegrity.extra.map((i) => ({ ...i, status: 'extra' })),
                  ];
                } else if (filemoonFilter === 'missing') {
                  displayItems = filemoonIntegrity.missing.map((i) => ({ ...i, status: 'missing' }));
                } else if (filemoonFilter === 'found') {
                  displayItems = filemoonIntegrity.found.map((i) => ({ ...i, status: 'found' }));
                } else if (filemoonFilter === 'noUrl') {
                  displayItems = filemoonIntegrity.noUrl.map((i) => ({ ...i, status: 'noUrl' }));
                } else if (filemoonFilter === 'extra') {
                  displayItems = filemoonIntegrity.extra.map((i) => ({ ...i, status: 'extra' }));
                }

                if (displayItems.length === 0) {
                  return (
                    <div className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-[var(--radius-box)] border border-base-300 bg-base-100 px-4 text-center">
                      <ShieldCheck className="h-8 w-8 text-success" />
                      <div>
                        <h2 className="text-lg font-semibold text-base-content">No items in this view</h2>
                        <p className="mt-1 text-sm text-base-content/60">
                          {filemoonFilter === 'missing' ? 'All Filemoon videos are accounted for.' : 'Nothing to show here.'}
                        </p>
                      </div>
                    </div>
                  );
                }

                return displayItems.map((entry) => {
                  const { item, status, matchedFile, codes } = entry;

                  if (status === 'extra') {
                    const file = entry.file || {};
                    const title = file.title || file.name || file.file_code || 'Unknown file';
                    const filemoonUrl = `https://filemoon.sx/d/${file.file_code || file.filecode || ''}`;
                    return (
                      <article
                        key={`fm-extra-${file.file_code || file.filecode || Math.random()}`}
                        className="grid gap-4 rounded-[var(--radius-box)] border border-base-300 bg-base-100 p-3 shadow-sm transition hover:border-warning/25 sm:grid-cols-[132px_1fr_auto]"
                      >
                        <div className="flex h-28 items-center justify-center overflow-hidden rounded-[var(--radius-box)] bg-base-200">
                          <div className="flex flex-col items-center gap-1 text-warning/70">
                            <AlertCircle className="h-8 w-8" />
                            <span className="text-[10px] font-semibold uppercase tracking-wider">Orphan</span>
                          </div>
                        </div>
                        <div className="min-w-0 space-y-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <h2 className="truncate text-base font-semibold text-base-content">{title}</h2>
                              <span className="inline-flex items-center gap-1 rounded-full border border-warning/20 bg-warning/10 px-2 py-0.5 text-xs font-semibold text-warning">
                                <AlertCircle className="h-3 w-3" /> Not in DB
                              </span>
                            </div>
                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-base-content/55">
                              {file.file_code && <span>Code: {file.file_code}</span>}
                              {file.size && <span>{(Number(file.size) / 1024 / 1024).toFixed(1)} MB</span>}
                              <a href={filemoonUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                                Filemoon <ExternalLink className="h-3 w-3" />
                              </a>
                            </div>
                          </div>
                          <div className="text-xs text-base-content/70">
                            This video exists on Filemoon but is not linked to any item in your vault.
                          </div>
                        </div>
                        <div className="flex flex-col justify-between gap-3 sm:w-52">
                          <div className="rounded-[var(--radius-box)] border border-base-300 bg-base-200/60 px-3 py-2 text-xs text-base-content/65">
                            Orphaned Filemoon video
                          </div>
                          <div className="flex flex-col gap-2">
                            <Button variant="outline" className="h-9 justify-center gap-2 text-sm" onClick={() => window.open(filemoonUrl, '_blank')}>
                              <ExternalLink className="h-4 w-4" />
                              Open Filemoon
                            </Button>
                            {(file.file_code || file.filecode) && (() => {
                              const fc = String(file.file_code || file.filecode);
                              const linkKey = `fm:${fc}`;
                              const pendingMatch = findPendingItemForFile([...(images || []), ...(vaultImages || [])], file);
                              return (
                                <>
                                  {pendingMatch && (
                                    <Button
                                      variant="outline"
                                      className="h-9 justify-center gap-2 border-success/30 bg-success/10 text-sm text-success hover:bg-success/15"
                                      disabled={Boolean(linkingExtra[linkKey])}
                                      onClick={async () => {
                                        setLinkingExtra((prev) => ({ ...prev, [linkKey]: true }));
                                        try {
                                          await sendMessage('finalizeUploadedVideo', {
                                            id: pendingMatch.id,
                                            videoUploadResults: {
                                              filemoon: { filecode: fc, watchUrl: `https://filemoon.sx/d/${fc}`, directUrl: `https://filemoon.sx/e/${fc}` },
                                            },
                                          });
                                          await Promise.all([reloadImages({ silent: true }), reloadVaultImages()]);
                                          await runFilemoonIntegrityCheck();
                                          setNotice({ type: 'success', message: `Recovered "${pendingMatch.fileName || pendingMatch.pageTitle || 'pending upload'}" from the interrupted upload.` });
                                        } catch (err) {
                                          setNotice({ type: 'error', message: `Recovery failed: ${err.message || err}` });
                                        } finally {
                                          setLinkingExtra((prev) => {
                                            const next = { ...prev };
                                            delete next[linkKey];
                                            return next;
                                          });
                                        }
                                      }}
                                    >
                                      {linkingExtra[linkKey] ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                                      {linkingExtra[linkKey] ? 'Recovering...' : 'Recover pending upload'}
                                    </Button>
                                  )}
                                  <Button
                                    variant="outline"
                                    className="h-9 justify-center gap-2 text-sm"
                                    disabled={Boolean(linkingExtra[linkKey])}
                                    onClick={async () => {
                                      setLinkingExtra((prev) => ({ ...prev, [linkKey]: true }));
                                      try {
                                        const match = findMatchingItemForFile([...(images || []), ...(vaultImages || [])], file);
                                        if (!match) {
                                          throw new Error('No item matched by title or filename. Link the file from the dashboard instead.');
                                        }
                                        await sendMessage('linkProviderFileToItem', {
                                          id: match.id,
                                          providerKey: 'filemoon',
                                          link: { filecode: fc, watchUrl: `https://filemoon.sx/d/${fc}`, directUrl: `https://filemoon.sx/e/${fc}` },
                                        });
                                        await Promise.all([reloadImages({ silent: true }), reloadVaultImages()]);
                                        await runFilemoonIntegrityCheck();
                                        setNotice({ type: 'success', message: `Linked ${fc} to "${match.pageTitle || match.fileName || 'item'}".` });
                                      } catch (err) {
                                        setNotice({ type: 'error', message: `Link failed: ${err.message || err}` });
                                      } finally {
                                        setLinkingExtra((prev) => {
                                          const next = { ...prev };
                                          delete next[linkKey];
                                          return next;
                                        });
                                      }
                                    }}
                                  >
                                    {linkingExtra[linkKey] ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                                    {linkingExtra[linkKey] ? 'Linking...' : 'Link to item'}
                                  </Button>
                                </>
                              );
                            })()}
                            {(file.file_code || file.filecode) && (() => {
                              const fc = String(file.file_code || file.filecode);
                              return (
                                <Button
                                  variant="primary"
                                  className="h-9 justify-center gap-2 text-sm"
                                  onClick={async () => {
                                    const tab = await chrome.tabs.create({ url: 'https://byse.sx/videos', active: true });
                                    setTimeout(async () => {
                                      try {
                                        await chrome.scripting.executeScript({
                                          target: { tabId: tab.id },
                                          func: (code) => {
                                            const searchbox = document.querySelector('input[placeholder*="Search"]');
                                            if (!searchbox) return;
                                            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                                            setter.call(searchbox, code);
                                            searchbox.dispatchEvent(new Event('input', { bubbles: true }));
                                          },
                                          args: [fc],
                                        });
                                      } catch (e) {}
                                    }, 3000);
                                  }}
                                >
                                  <Trash2 className="h-4 w-4" />
                                  Find on Dashboard
                                </Button>
                              );
                            })()}
                          </div>
                        </div>
                      </article>
                    );
                  }

                  const title = item.pageTitle || item.fileName || item.description || 'Untitled';
                  const filemoonUrl = item.filemoonWatchUrl || item.filemoonDirectUrl || item.filemoonUrl || '';

                  return (
                    <article
                      key={item.id}
                      className="grid gap-4 rounded-[var(--radius-box)] border border-base-300 bg-base-100 p-3 shadow-sm transition hover:border-primary/25 sm:grid-cols-[132px_1fr_auto]"
                    >
                      <div className="flex h-28 items-center justify-center overflow-hidden rounded-[var(--radius-box)] bg-base-200">
                        {item.filemoonThumbUrl ? (
                          <img src={item.filemoonThumbUrl} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex flex-col items-center gap-1 text-base-content/35">
                            <Video className="h-4 w-4" />
                            <span className="text-[10px] font-semibold uppercase tracking-wider">Video</span>
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 space-y-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <h2 className="truncate text-base font-semibold text-base-content">{title}</h2>
                            {status === 'missing' && (
                              <span className="inline-flex items-center gap-1 rounded-full border border-error/20 bg-error/10 px-2 py-0.5 text-xs font-semibold text-error">
                                <ShieldAlert className="h-3 w-3" /> Broken link
                              </span>
                            )}
                            {status === 'found' && (
                              <span className="inline-flex items-center gap-1 rounded-full border border-success/20 bg-success/10 px-2 py-0.5 text-xs font-semibold text-success">
                                <ShieldCheck className="h-3 w-3" /> Found
                              </span>
                            )}
                            {status === 'noUrl' && (
                              <span className="inline-flex items-center gap-1 rounded-full border border-warning/20 bg-warning/10 px-2 py-0.5 text-xs font-semibold text-warning">
                                <AlertCircle className="h-3 w-3" /> No Filemoon URL
                              </span>
                            )}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-base-content/55">
                            {item.fileName && <span className="truncate">{item.fileName}</span>}
                            {formatDate(item.createdAt || item.internalAddedTimestamp)}
                            {filemoonUrl && (
                              <a href={filemoonUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                                Filemoon <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </div>
                        </div>
                        {status === 'found' && matchedFile && (
                          <div className="text-xs text-base-content/70">
                            <div className="font-medium text-success">Filemoon file: {matchedFile.title || matchedFile.file_code}</div>
                          </div>
                        )}
                        {status === 'missing' && codes.length > 0 && (
                          <div className="text-xs text-base-content/70">
                            <div className="font-medium text-error">Broken Filemoon links:</div>
                            <div className="font-mono">{codes.join(', ')}</div>
                            <div className="mt-1 text-base-content/50">These files are no longer on Filemoon. They may have been deleted, the upload may have failed, or the platform may have removed them.</div>
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col justify-between gap-3 sm:w-52">
                        <div className="rounded-[var(--radius-box)] border border-base-300 bg-base-200/60 px-3 py-2 text-xs text-base-content/65">
                          {status === 'missing' && 'Needs re-upload'}
                          {status === 'found' && 'Verified on Filemoon'}
                          {status === 'noUrl' && 'No Filemoon URL stored'}
                        </div>
                        <div className="flex flex-col gap-2">
                          {filemoonUrl && (
                            <Button variant="outline" className="h-9 justify-center gap-2 text-sm" onClick={() => window.open(filemoonUrl, '_blank')}>
                              <ExternalLink className="h-4 w-4" />
                              Open Filemoon
                            </Button>
                          )}
                           {(status === 'noUrl' || status === 'missing') && (() => {
                            const encrypted = isVaultedEncryptedItem(item);
                            return (
                            <Button
                              variant="primary"
                              className="h-9 justify-center gap-2 text-sm"
                              disabled={Boolean(fixingFilemoon[item.id]) || encrypted}
                              title={encrypted ? 'Encrypted vault file — Filemoon does not accept this format. Use the UDrop or TeraBox tab to resolve it.' : undefined}
                              onClick={async () => {
                                setFixingFilemoon((prev) => ({ ...prev, [item.id]: true }));
                                setFixProgress((prev) => ({ ...prev, [item.id]: { phase: 'download', message: 'Starting...', percent: null } }));
                                try {
                                  const [freshItem, hostSettings] = await Promise.all([
                                    sendMessage('getImageById', { id: item.id }),
                                    sendMessage('getVideoHostSettings'),
                                  ]);
                                  const updates = await retryVideoHostPageSide(freshItem, 'filemoon', hostSettings, {
                                    onProgress: (progress) => setFixProgress((prev) => ({ ...prev, [item.id]: progress })),
                                  });
                                  await sendMessage('updateImage', { id: item.id, ...updates });
                                  await Promise.all([reloadImages({ silent: true }), reloadVaultImages()]);
                                  await runFilemoonIntegrityCheck();
                                  setNotice({ type: 'success', message: `Filemoon upload fixed for "${title}".` });
                                } catch (err) {
                                  setNotice({ type: 'error', message: `Failed to fix: ${err.message || err}` });
                                } finally {
                                  setFixingFilemoon((prev) => {
                                    const next = { ...prev };
                                    delete next[item.id];
                                    return next;
                                  });
                                  setFixProgress((prev) => {
                                    const next = { ...prev };
                                    delete next[item.id];
                                    return next;
                                  });
                                }
                              }}
                             >
                               {fixingFilemoon[item.id] ? <Loader2 className="h-4 w-4 animate-spin" /> : encrypted ? <AlertCircle className="h-4 w-4" /> : <UploadCloud className="h-4 w-4" />}
                               {fixingFilemoon[item.id] ? 'Fixing...' : encrypted ? 'Unsupported on Filemoon' : 'Fix'}
                             </Button>
                            );
                          })()}
                           {fixProgress[item.id] && (
                             <div className="flex flex-col gap-1.5">
                               <div className="text-[11px] leading-tight text-base-content/70">
                                 {fixProgress[item.id].message || 'Working...'}
                               </div>
                               <div className="h-1.5 w-full overflow-hidden rounded-full bg-base-300">
                                 <div
                                   className="h-full rounded-full bg-gradient-to-r from-primary-500 to-secondary-500 transition-all duration-300"
                                   style={{ width: `${Math.max(4, fixProgress[item.id].percent ?? 100)}%` }}
                                 />
                               </div>
                             </div>
                           )}
                         </div>
                       </div>
                     </article>
                   );
                 });
                })()}
             </section>
           </>
         )}

        {/* TeraBox Integrity Tab */}
        {activeTab === 'videos' && videoSubTab === 'terabox' && (
          <>
            <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                  <Box className="h-4 w-4" />
                  TeraBox integrity
                </div>
                <h1 className="text-3xl font-semibold tracking-tight text-base-content">TeraBox video integrity</h1>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Button
                  variant="primary"
                  onClick={runTeraBoxIntegrityCheck}
                  className="h-10 gap-2 px-3 text-sm"
                  disabled={teraboxLoading}
                >
                  {teraboxLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  {teraboxLoading ? 'Checking...' : 'Check TeraBox'}
                </Button>
                <Button variant="outline" onClick={() => navigate('/settings')} className="h-10 gap-2 px-3 text-sm">
                  <Settings className="h-4 w-4" />
                  Settings
                </Button>
              </div>
            </section>

            {!teraboxKeysConfigured && (
              <div className="rounded-[var(--radius-box)] border border-warning/25 bg-warning/10 px-4 py-3 text-sm text-warning">
                TeraBox cookie is not configured. Go to Settings to add it, or log in to TeraBox in this browser.
              </div>
            )}

            {teraboxError && (
              <div className="rounded-[var(--radius-box)] border border-error/25 bg-error/10 px-4 py-3 text-sm text-error">
                {teraboxError}
              </div>
            )}

            {notice && activeTab === 'videos' && videoSubTab === 'terabox' && (
              <div className="rounded-[var(--radius-box)] border border-error/25 bg-error/10 px-4 py-3 text-sm font-medium text-error">
                {notice.message}
              </div>
            )}

            <section className="flex flex-wrap gap-2">
              {[
                { value: 'all', label: 'All', count: teraboxIntegrity.found.length + teraboxIntegrity.missing.length + teraboxIntegrity.noUrl.length + teraboxIntegrity.extra.length, tip: 'Every saved video, counted once. This is the full list.' },
                { value: 'missing', label: 'Broken links', count: teraboxIntegrity.missing.length, tip: 'Videos whose TeraBox link is broken or whose file was deleted from TeraBox. These need fixing or a fresh upload.' },
                { value: 'found', label: 'Found', count: teraboxIntegrity.found.length, tip: 'Videos with a working file on TeraBox. Nothing to do.' },
                { value: 'noUrl', label: 'No TeraBox URL', count: teraboxIntegrity.noUrl.length, tip: 'Saved videos that have no TeraBox link at all — they were never uploaded to TeraBox.' },
                { value: 'extra', label: 'Extra on TeraBox', count: teraboxIntegrity.extra.length, tip: 'Files on TeraBox that are not linked to any saved video. Likely old uploads or duplicates.' },
              ].map((option) => (
                <StatChip
                  key={option.value}
                  value={option.value}
                  label={option.label}
                  count={option.count}
                  tip={option.tip}
                  active={teraboxFilter === option.value}
                  onClick={() => setTeraBoxFilter(option.value)}
                />
              ))}
            </section>

            <section className="grid gap-3">
              {teraboxLoading && (
                <div className="flex min-h-64 items-center justify-center rounded-[var(--radius-box)] border border-base-300 bg-base-100 text-base-content/60">
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Checking TeraBox...
                </div>
              )}

              {!teraboxLoading && (() => {
                let displayItems = [];
                if (teraboxFilter === 'all') {
                  displayItems = [
                    ...teraboxIntegrity.missing.map((i) => ({ ...i, status: 'missing' })),
                    ...teraboxIntegrity.found.map((i) => ({ ...i, status: 'found' })),
                    ...teraboxIntegrity.noUrl.map((i) => ({ ...i, status: 'noUrl' })),
                    ...teraboxIntegrity.extra.map((i) => ({ ...i, status: 'extra' })),
                  ];
                } else if (teraboxFilter === 'missing') {
                  displayItems = teraboxIntegrity.missing.map((i) => ({ ...i, status: 'missing' }));
                } else if (teraboxFilter === 'found') {
                  displayItems = teraboxIntegrity.found.map((i) => ({ ...i, status: 'found' }));
                } else if (teraboxFilter === 'noUrl') {
                  displayItems = teraboxIntegrity.noUrl.map((i) => ({ ...i, status: 'noUrl' }));
                } else if (teraboxFilter === 'extra') {
                  displayItems = teraboxIntegrity.extra.map((i) => ({ ...i, status: 'extra' }));
                }

                if (displayItems.length === 0) {
                  return (
                    <div className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-[var(--radius-box)] border border-base-300 bg-base-100 px-4 text-center">
                      <ShieldCheck className="h-8 w-8 text-success" />
                      <div>
                        <h2 className="text-lg font-semibold text-base-content">No items in this view</h2>
                        <p className="mt-1 text-sm text-base-content/60">
                          {teraboxFilter === 'missing' ? 'All TeraBox videos are accounted for.' : 'Nothing to show here.'}
                        </p>
                      </div>
                    </div>
                  );
                }

                return displayItems.map((entry) => {
                  const { item, status, matchedFile } = entry;

                  if (status === 'extra') {
                    const file = entry.file || {};
                    const title = file.title || file.name || file.filename || file.server_filename || 'Unknown file';
                    const fsId = String(file.fs_id || file.file_id || '');
                    const tbxUrl = `https://www.terabox.com/sharing/link?fidlist=${encodeURIComponent(JSON.stringify([fsId]))}`;
                    return (
                      <article
                        key={`tbx-extra-${fsId || Math.random()}`}
                        className="grid gap-4 rounded-[var(--radius-box)] border border-base-300 bg-base-100 p-3 shadow-sm transition hover:border-warning/25 sm:grid-cols-[132px_1fr_auto]"
                      >
                        <div className="flex h-28 items-center justify-center overflow-hidden rounded-[var(--radius-box)] bg-base-200">
                          <div className="flex flex-col items-center gap-1 text-warning/70">
                            <AlertCircle className="h-8 w-8" />
                            <span className="text-[10px] font-semibold uppercase tracking-wider">Orphan</span>
                          </div>
                        </div>
                        <div className="min-w-0 space-y-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <h2 className="truncate text-base font-semibold text-base-content">{title}</h2>
                              <span className="inline-flex items-center gap-1 rounded-full border border-warning/20 bg-warning/10 px-2 py-0.5 text-xs font-semibold text-warning">
                                <AlertCircle className="h-3 w-3" /> Not in DB
                              </span>
                            </div>
                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-base-content/55">
                              {fsId && <span>FS ID: {fsId}</span>}
                              {file.size && <span>{(Number(file.size) / 1024 / 1024).toFixed(1)} MB</span>}
                              {file._folder && <span>Folder: {file._folder}</span>}
                              <a href={tbxUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                                TeraBox <ExternalLink className="h-3 w-3" />
                              </a>
                            </div>
                          </div>
                          <div className="text-xs text-base-content/70">
                            This video exists on TeraBox but is not linked to any item in your vault.
                          </div>
                        </div>
                        <div className="flex flex-col justify-between gap-3 sm:w-52">
                          <div className="rounded-[var(--radius-box)] border border-base-300 bg-base-200/60 px-3 py-2 text-xs text-base-content/65">
                            Orphaned TeraBox video
                          </div>
                          <div className="flex flex-col gap-2">
                            <Button variant="outline" className="h-9 justify-center gap-2 text-sm" onClick={() => window.open(tbxUrl, '_blank')}>
                              <ExternalLink className="h-4 w-4" />
                              Open TeraBox
                            </Button>
                            {fsId && (() => {
                              const linkKey = `tbx:${fsId}`;
                              const pendingMatch = findPendingItemForFile([...(images || []), ...(vaultImages || [])], file);
                              return (
                                <>
                                  {pendingMatch && (
                                    <Button
                                      variant="outline"
                                      className="h-9 justify-center gap-2 border-success/30 bg-success/10 text-sm text-success hover:bg-success/15"
                                      disabled={Boolean(linkingExtra[linkKey])}
                                      onClick={async () => {
                                        setLinkingExtra((prev) => ({ ...prev, [linkKey]: true }));
                                        try {
                                          await sendMessage('finalizeUploadedVideo', {
                                            id: pendingMatch.id,
                                            videoUploadResults: {
                                              terabox: { fileId: fsId, filecode: fsId, filename: title, watchUrl: tbxUrl, directUrl: '' },
                                            },
                                          });
                                          await Promise.all([reloadImages({ silent: true }), reloadVaultImages()]);
                                          await runTeraBoxIntegrityCheck();
                                          setNotice({ type: 'success', message: `Recovered "${pendingMatch.fileName || pendingMatch.pageTitle || 'pending upload'}" from the interrupted upload.` });
                                        } catch (err) {
                                          setNotice({ type: 'error', message: `Recovery failed: ${err.message || err}` });
                                        } finally {
                                          setLinkingExtra((prev) => {
                                            const next = { ...prev };
                                            delete next[linkKey];
                                            return next;
                                          });
                                        }
                                      }}
                                    >
                                      {linkingExtra[linkKey] ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                                      {linkingExtra[linkKey] ? 'Recovering...' : 'Recover pending upload'}
                                    </Button>
                                  )}
                                  <Button
                                    variant="outline"
                                    className="h-9 justify-center gap-2 text-sm"
                                    disabled={Boolean(linkingExtra[linkKey])}
                                    onClick={async () => {
                                      setLinkingExtra((prev) => ({ ...prev, [linkKey]: true }));
                                      try {
                                        const match = findMatchingItemForFile([...(images || []), ...(vaultImages || [])], file);
                                        if (!match) {
                                          throw new Error('No item matched by title or filename. Link the file from the dashboard instead.');
                                        }
                                        await sendMessage('linkProviderFileToItem', {
                                          id: match.id,
                                          providerKey: 'terabox',
                                          link: { filecode: fsId, fileId: fsId, filename: title, watchUrl: tbxUrl, directUrl: '' },
                                        });
                                        await Promise.all([reloadImages({ silent: true }), reloadVaultImages()]);
                                        await runTeraBoxIntegrityCheck();
                                        setNotice({ type: 'success', message: `Linked ${title} to "${match.pageTitle || match.fileName || 'item'}".` });
                                      } catch (err) {
                                        setNotice({ type: 'error', message: `Link failed: ${err.message || err}` });
                                      } finally {
                                        setLinkingExtra((prev) => {
                                          const next = { ...prev };
                                          delete next[linkKey];
                                          return next;
                                        });
                                      }
                                    }}
                                  >
                                    {linkingExtra[linkKey] ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                                    {linkingExtra[linkKey] ? 'Linking...' : 'Link to item'}
                                  </Button>
                                </>
                              );
                            })()}
                          </div>
                        </div>
                      </article>
                    );
                  }

                  const title = item.pageTitle || item.fileName || item.description || 'Untitled';
                  const teraboxLinks = item.videoHosts?.terabox || {};
                  const teraboxUrl = teraboxLinks.watchUrl || teraboxLinks.directUrl || teraboxLinks.url || item.teraboxWatchUrl || item.teraboxDirectUrl || item.teraboxUrl || '';

                  return (
                    <article
                      key={item.id}
                      className="grid gap-4 rounded-[var(--radius-box)] border border-base-300 bg-base-100 p-3 shadow-sm transition hover:border-primary/25 sm:grid-cols-[132px_1fr_auto]"
                    >
                      <div className="flex h-28 items-center justify-center overflow-hidden rounded-[var(--radius-box)] bg-base-200">
                        <div className="flex flex-col items-center gap-1 text-base-content/35">
                          <Video className="h-4 w-4" />
                          <span className="text-[10px] font-semibold uppercase tracking-wider">Video</span>
                        </div>
                      </div>
                      <div className="min-w-0 space-y-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <h2 className="truncate text-base font-semibold text-base-content">{title}</h2>
                            {status === 'missing' && (
                              <span className="inline-flex items-center gap-1 rounded-full border border-error/20 bg-error/10 px-2 py-0.5 text-xs font-semibold text-error">
                                <ShieldAlert className="h-3 w-3" /> Broken link
                              </span>
                            )}
                            {status === 'found' && (
                              <span className="inline-flex items-center gap-1 rounded-full border border-success/20 bg-success/10 px-2 py-0.5 text-xs font-semibold text-success">
                                <ShieldCheck className="h-3 w-3" /> Found
                              </span>
                            )}
                            {status === 'noUrl' && (
                              <span className="inline-flex items-center gap-1 rounded-full border border-warning/20 bg-warning/10 px-2 py-0.5 text-xs font-semibold text-warning">
                                <AlertCircle className="h-3 w-3" /> No TeraBox URL
                              </span>
                            )}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-base-content/55">
                            {item.fileName && <span className="truncate">{item.fileName}</span>}
                            {formatDate(item.createdAt || item.internalAddedTimestamp)}
                            {teraboxUrl && (
                              <a href={teraboxUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                                TeraBox <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </div>
                        </div>
                        {status === 'found' && matchedFile && (
                          <div className="text-xs text-base-content/70">
                            <div className="font-medium text-success">TeraBox file: {matchedFile.server_filename || matchedFile.title || matchedFile.fs_id}</div>
                          </div>
                        )}
                        {status === 'missing' && (
                          <div className="text-xs text-base-content/70">
                            <div className="font-medium text-error">Broken TeraBox link</div>
                            <div className="mt-1 text-base-content/50">The TeraBox file could not be found. It may have been deleted, the upload may have failed, or the platform may have removed it.</div>
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col justify-between gap-3 sm:w-52">
                        <div className="rounded-[var(--radius-box)] border border-base-300 bg-base-200/60 px-3 py-2 text-xs text-base-content/65">
                          {status === 'missing' && 'Needs re-upload'}
                          {status === 'found' && 'Verified on TeraBox'}
                          {status === 'noUrl' && 'No TeraBox URL stored'}
                        </div>
                        <div className="flex flex-col gap-2">
                          {teraboxUrl && (
                            <Button variant="outline" className="h-9 justify-center gap-2 text-sm" onClick={() => window.open(teraboxUrl, '_blank')}>
                              <ExternalLink className="h-4 w-4" />
                              Open TeraBox
                            </Button>
                          )}
                          {(status === 'noUrl' || status === 'missing') && (
                            <Button
                              variant="primary"
                              className="h-9 justify-center gap-2 text-sm"
                              disabled={Boolean(fixingTeraBox[item.id])}
                              onClick={async () => {
                                setFixingTeraBox((prev) => ({ ...prev, [item.id]: true }));
                                setFixProgress((prev) => ({ ...prev, [item.id]: { phase: 'download', message: 'Starting...', percent: null } }));
                                try {
                                  const [freshItem, hostSettings] = await Promise.all([
                                    sendMessage('getImageById', { id: item.id }),
                                    sendMessage('getVideoHostSettings'),
                                  ]);
                                  const updates = await retryVideoHostPageSide(freshItem, 'terabox', hostSettings, {
                                    onProgress: (progress) => setFixProgress((prev) => ({ ...prev, [item.id]: progress })),
                                  });
                                  await sendMessage('updateImage', { id: item.id, ...updates });
                                  await Promise.all([reloadImages({ silent: true }), reloadVaultImages()]);
                                  await runTeraBoxIntegrityCheck();
                                  setNotice({ type: 'success', message: `TeraBox upload fixed for "${title}".` });
                                } catch (err) {
                                  setNotice({ type: 'error', message: `Failed to fix: ${err.message || err}` });
                                } finally {
                                  setFixingTeraBox((prev) => {
                                    const next = { ...prev };
                                    delete next[item.id];
                                    return next;
                                  });
                                  setFixProgress((prev) => {
                                    const next = { ...prev };
                                    delete next[item.id];
                                    return next;
                                  });
                                }
                              }}
                            >
                              {fixingTeraBox[item.id] ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
                              {fixingTeraBox[item.id] ? 'Fixing...' : 'Fix'}
                            </Button>
                          )}
                          {fixProgress[item.id] && (
                            <div className="flex flex-col gap-1.5">
                              <div className="text-[11px] leading-tight text-base-content/70">
                                {fixProgress[item.id].message || 'Working...'}
                              </div>
                              <div className="h-1.5 w-full overflow-hidden rounded-full bg-base-300">
                                <div
                                  className="h-full rounded-full bg-gradient-to-r from-primary-500 to-secondary-500 transition-all duration-300"
                                  style={{ width: `${Math.max(4, fixProgress[item.id].percent ?? 100)}%` }}
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                });
              })()}
            </section>
          </>
        )}

        {/* 3D Scene Integrity Tab */}
        {activeTab === 'scenes' && (
          <>
            <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                  <Box className="h-4 w-4" />
                  3D Scene integrity
                </div>
                <h1 className="text-3xl font-semibold tracking-tight text-base-content">UDrop scene files (.spz)</h1>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Button
                  variant="primary"
                  onClick={runSceneIntegrityCheck}
                  className="h-10 gap-2 px-3 text-sm"
                  disabled={sceneLoading}
                >
                  {sceneLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  {sceneLoading ? 'Checking...' : 'Check Scenes'}
                </Button>
                <Button variant="outline" onClick={() => navigate('/settings')} className="h-10 gap-2 px-3 text-sm">
                  <Settings className="h-4 w-4" />
                  Settings
                </Button>
              </div>
            </section>

            {!sceneKeysConfigured && (
              <div className="rounded-[var(--radius-box)] border border-warning/25 bg-warning/10 px-4 py-3 text-sm text-warning">
                UDrop API keys are not configured. Go to Settings to add them.
              </div>
            )}

            {sceneError && (
              <div className="rounded-[var(--radius-box)] border border-error/25 bg-error/10 px-4 py-3 text-sm text-error">
                {sceneError}
              </div>
            )}

            {notice && activeTab === 'scenes' && (
              <div className={`rounded-[var(--radius-box)] border px-4 py-3 text-sm font-medium ${
                notice.type === 'success'
                  ? 'border-success/25 bg-success/10 text-success'
                  : 'border-error/25 bg-error/10 text-error'
              }`}>
                {notice.message}
              </div>
            )}

            <section className="flex flex-wrap gap-2">
              {[
                { value: 'all', label: 'All', count: sceneIntegrity.found.length + sceneIntegrity.missing.length + sceneIntegrity.noUrl.length + sceneIntegrity.extra.length, tip: 'Every saved 3D scene, counted once. This is the full list.' },
                { value: 'missing', label: 'Broken links', count: sceneIntegrity.missing.length, tip: 'Scenes whose .spz file was deleted from UDrop or whose link is broken.' },
                { value: 'found', label: 'Found', count: sceneIntegrity.found.length, tip: 'Scenes with a working .spz file on UDrop. Nothing to do.' },
                { value: 'noUrl', label: 'No scene URL', count: sceneIntegrity.noUrl.length, tip: 'Saved scenes that have no UDrop link at all — they were never uploaded.' },
                { value: 'extra', label: 'Extra on UDrop', count: sceneIntegrity.extra.length, tip: '.spz files on UDrop that are not linked to any saved scene. Likely old uploads or duplicates.' },
              ].map((option) => (
                <StatChip
                  key={option.value}
                  value={option.value}
                  label={option.label}
                  count={option.count}
                  tip={option.tip}
                  active={sceneFilter === option.value}
                  onClick={() => setSceneFilter(option.value)}
                />
              ))}
            </section>

            <section className="grid gap-3">
              {sceneLoading && (
                <div className="flex min-h-64 items-center justify-center rounded-[var(--radius-box)] border border-base-300 bg-base-100 text-base-content/60">
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Loading UDrop file list...
                </div>
              )}

              {!sceneLoading && (() => {
                let displayItems = [];
                if (sceneFilter === 'all') {
                  displayItems = [
                    ...sceneIntegrity.missing.map((i) => ({ ...i, status: 'missing' })),
                    ...sceneIntegrity.found.map((i) => ({ ...i, status: 'found' })),
                    ...sceneIntegrity.noUrl.map((i) => ({ ...i, status: 'noUrl' })),
                    ...sceneIntegrity.extra.map((i) => ({ ...i, status: 'extra' })),
                  ];
                } else if (sceneFilter === 'missing') {
                  displayItems = sceneIntegrity.missing.map((i) => ({ ...i, status: 'missing' }));
                } else if (sceneFilter === 'found') {
                  displayItems = sceneIntegrity.found.map((i) => ({ ...i, status: 'found' }));
                } else if (sceneFilter === 'noUrl') {
                  displayItems = sceneIntegrity.noUrl.map((i) => ({ ...i, status: 'noUrl' }));
                } else if (sceneFilter === 'extra') {
                  displayItems = sceneIntegrity.extra.map((i) => ({ ...i, status: 'extra' }));
                }

                if (displayItems.length === 0) {
                  return (
                    <div className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-[var(--radius-box)] border border-base-300 bg-base-100 px-4 text-center">
                      <ShieldCheck className="h-8 w-8 text-success" />
                      <div>
                        <h2 className="text-lg font-semibold text-base-content">No items in this view</h2>
                        <p className="mt-1 text-sm text-base-content/60">
                          {sceneFilter === 'missing' ? 'All scene files are accounted for.' : 'Nothing to show here.'}
                        </p>
                      </div>
                    </div>
                  );
                }

                return displayItems.map((entry) => {
                  const { item, status, matchedFile, codes } = entry;

                  // ---- Extra (orphan) .spz files ----
                  if (status === 'extra') {
                    const file = entry.file || {};
                    const title = file.name || file.filename || file.file_id || 'Unknown file';
                    const udropUrl = file.short_url || file.url || '';
                    return (
                      <article
                        key={`scene-extra-${file.file_id || file.id || file.short_url || Math.random()}`}
                        className="grid gap-4 rounded-[var(--radius-box)] border border-base-300 bg-base-100 p-3 shadow-sm transition hover:border-warning/25 sm:grid-cols-[132px_1fr_auto]"
                      >
                        <div className="flex h-28 items-center justify-center overflow-hidden rounded-[var(--radius-box)] bg-base-200">
                          <div className="flex flex-col items-center gap-1 text-warning/70">
                            <AlertCircle className="h-8 w-8" />
                            <span className="text-[10px] font-semibold uppercase tracking-wider">Orphan</span>
                          </div>
                        </div>

                        <div className="min-w-0 space-y-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <h2 className="truncate text-base font-semibold text-base-content">{title}</h2>
                              <span className="inline-flex items-center gap-1 rounded-full border border-warning/20 bg-warning/10 px-2 py-0.5 text-xs font-semibold text-warning">
                                <AlertCircle className="h-3 w-3" /> Not in DB
                              </span>
                            </div>
                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-base-content/55">
                              {file.file_id && <span>ID: {file.file_id}</span>}
                              {file._folderName && <span>Folder: {file._folderName}</span>}
                              {udropUrl && (
                                <a href={udropUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                                  UDrop <ExternalLink className="h-3 w-3" />
                                </a>
                              )}
                            </div>
                          </div>

                          <div className="text-xs text-base-content/70">
                            This .spz file exists on UDrop but is not linked to any saved scene in your vault. It might be safe to delete.
                          </div>
                        </div>

                        <div className="flex flex-col justify-between gap-3 sm:w-52">
                          <div className="rounded-[var(--radius-box)] border border-base-300 bg-base-200/60 px-3 py-2 text-xs text-base-content/65">
                            Orphaned scene file
                          </div>
                          <div className="flex flex-col gap-2">
                            {udropUrl && (
                              <Button variant="outline" className="h-9 justify-center gap-2 text-sm" onClick={() => window.open(udropUrl, '_blank')}>
                                <ExternalLink className="h-4 w-4" />
                                Open UDrop
                              </Button>
                            )}
                            {(file.file_id || file.id) && (
                              <Button
                                variant="primary"
                                className="h-9 justify-center gap-2 text-sm"
                                disabled={Boolean(deletingOrphans[String(file.file_id || file.id)])}
                                onClick={async () => {
                                  const fid = String(file.file_id || file.id);
                                  if (!confirm(`Delete "${file.name || file.filename || fid}" from UDrop? This cannot be undone.`)) return;
                                  setDeletingOrphans((prev) => ({ ...prev, [fid]: true }));
                                  try {
                                    const auth = await authorizeUdrop(settings.udropKey1, settings.udropKey2);
                                    await deleteUdropFile(auth.access_token, auth.account_id, fid);
                                    setSceneIntegrity((prev) => ({
                                      ...prev,
                                      extra: prev.extra.filter((e) => String((e.file?.file_id || e.file?.id)) !== fid),
                                    }));
                                    setNotice({ type: 'success', message: `Deleted orphan scene file "${file.name || file.filename || fid}" from UDrop.` });
                                  } catch (err) {
                                    setNotice({ type: 'error', message: `Failed to delete: ${err.message || err}` });
                                  } finally {
                                    setDeletingOrphans((prev) => {
                                      const next = { ...prev };
                                      delete next[fid];
                                      return next;
                                    });
                                  }
                                }}
                              >
                                {deletingOrphans[String(file.file_id || file.id)] ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                                {deletingOrphans[String(file.file_id || file.id)] ? 'Deleting...' : 'Delete'}
                              </Button>
                            )}
                          </div>
                        </div>
                      </article>
                    );
                  }

                  // ---- Normal DB scene items ----
                  const title = item.pageTitle || item.fileName || item.description || 'Untitled';
                  const sceneUrl = item.spzUrl || item.textureUrl || '';

                  return (
                    <article
                      key={item.id}
                      className="grid gap-4 rounded-[var(--radius-box)] border border-base-300 bg-base-100 p-3 shadow-sm transition hover:border-primary/25 sm:grid-cols-[132px_1fr_auto]"
                    >
                      <div className="flex h-28 items-center justify-center overflow-hidden rounded-[var(--radius-box)] bg-base-200">
                        <div className="flex flex-col items-center gap-1 text-base-content/35">
                          <Box className="h-4 w-4" />
                          <span className="text-[10px] font-semibold uppercase tracking-wider">3D scene</span>
                        </div>
                      </div>

                      <div className="min-w-0 space-y-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <h2 className="truncate text-base font-semibold text-base-content">{title}</h2>
                            {status === 'missing' && (
                              <span className="inline-flex items-center gap-1 rounded-full border border-error/20 bg-error/10 px-2 py-0.5 text-xs font-semibold text-error">
                                <ShieldAlert className="h-3 w-3" /> Broken link
                              </span>
                            )}
                            {status === 'found' && (
                              <span className="inline-flex items-center gap-1 rounded-full border border-success/20 bg-success/10 px-2 py-0.5 text-xs font-semibold text-success">
                                <ShieldCheck className="h-3 w-3" /> Found
                              </span>
                            )}
                            {status === 'noUrl' && (
                              <span className="inline-flex items-center gap-1 rounded-full border border-warning/20 bg-warning/10 px-2 py-0.5 text-xs font-semibold text-warning">
                                <AlertCircle className="h-3 w-3" /> No scene URL
                              </span>
                            )}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-base-content/55">
                            {item.fileName && <span className="truncate">{item.fileName}</span>}
                            {formatDate(item.createdAt || item.internalAddedTimestamp)}
                            {sceneUrl && (
                              <a
                                href={sceneUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-primary hover:underline"
                              >
                                UDrop <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </div>
                        </div>

                        {status === 'found' && matchedFile && (
                          <div className="text-xs text-base-content/70">
                            <div className="font-medium text-success">UDrop file: {matchedFile.name || matchedFile.file_id}</div>
                            {matchedFile.short_url && (
                              <a href={matchedFile.short_url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                                {matchedFile.short_url}
                              </a>
                            )}
                          </div>
                        )}

                        {status === 'missing' && codes.length > 0 && (
                          <div className="text-xs text-base-content/70">
                            <div className="font-medium text-error">Broken scene links:</div>
                            <div className="font-mono">{codes.join(', ')}</div>
                            <div className="mt-1 text-base-content/50">These files are no longer on UDrop. They may have been deleted or the upload may have failed.</div>
                          </div>
                        )}
                      </div>

                      <div className="flex flex-col justify-between gap-3 sm:w-52">
                        <div className="rounded-[var(--radius-box)] border border-base-300 bg-base-200/60 px-3 py-2 text-xs text-base-content/65">
                          {status === 'missing' && 'Needs re-upload to UDrop'}
                          {status === 'found' && 'Verified on UDrop'}
                          {status === 'noUrl' && 'No scene URL stored'}
                        </div>

                        <div className="flex flex-col gap-2">
                          {sceneUrl && (
                            <Button
                              variant="outline"
                              className="h-9 justify-center gap-2 text-sm"
                              onClick={() => window.open(sceneUrl, '_blank')}
                            >
                              <ExternalLink className="h-4 w-4" />
                              Open UDrop
                            </Button>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                });
              })()}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function StatChip({ value, label, count, tip, active, onClick }) {
  const [showTip, setShowTip] = useState(false);
  return (
    <span className="relative inline-block">
      <button
        key={value}
        type="button"
        onMouseEnter={() => setShowTip(true)}
        onMouseLeave={() => setShowTip(false)}
        onClick={onClick}
        className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
          active
            ? 'border-primary bg-primary text-primary-content shadow-sm'
            : 'border-base-300 bg-base-100 text-base-content/70 hover:text-base-content'
        }`}
      >
        {label} <span className="opacity-70">{count}</span>
      </button>
      {showTip && (
        <div className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-max max-w-64 -translate-x-1/2 rounded-lg bg-[var(--color-neutral)] px-2.5 py-1.5 text-center text-xs font-normal leading-snug text-[var(--color-neutral-content)] shadow-lg">
          {tip}
        </div>
      )}
    </span>
  );
}

/**
 * Find the vault item an orphaned host file belongs to.
 * Matches by title, then filename, then the bracketed slug (e.g.
 * "[desi-bangla-...]") — comparing punctuation-insensitive so small
 * spelling differences ("? Analdin com" vs "/ Analdin.com") still match.
 */
function findMatchingItemForFile(items, file) {
  const norm = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
  const slugOf = (value) => {
    const match = String(value || '').match(/\[([^\]]+)\]/);
    return match ? match[1].toLowerCase() : '';
  };

  const fileTitle = norm(file.file_title || file.title || file.name || file.filename);
  const fileName = norm(file.file_name || file.filename || file.name);
  const fileSlug = slugOf(file.file_title || file.title || file.file_name || file.name);

  const candidates = (items || []).filter((item) => item && item.id);
  const shortEnough = (a, b) => Math.min(a.length, b.length) >= 12;

  for (const item of candidates) {
    const itemTitle = norm(item.pageTitle);
    if (fileTitle && itemTitle && shortEnough(fileTitle, itemTitle) && (itemTitle === fileTitle || itemTitle.includes(fileTitle) || fileTitle.includes(itemTitle))) {
      return item;
    }
  }

  for (const item of candidates) {
    const itemName = norm(item.fileName || item.file_name);
    if (fileName && itemName && shortEnough(fileName, itemName) && (itemName === fileName || itemName.includes(fileName) || fileName.includes(itemName))) {
      return item;
    }
  }

  if (fileSlug) {
    for (const item of candidates) {
      const itemSlug = slugOf(item.pageTitle) || slugOf(item.fileName || item.file_name);
      if (itemSlug && itemSlug === fileSlug) return item;
    }
  }

  return null;
}

/**
 * Like findMatchingItemForFile but restricted to items that were reserved
 * by createPendingUpload (extraMetadata.pendingUpload). An orphaned host file
 * that matches a pending item is almost certainly the interrupted upload's
 * file — linking it recovers the item instead of leaving a ghost orphan.
 */
function findPendingItemForFile(items, file) {
  const pendingItems = (items || []).filter(
    (item) => item && item.id && item.extraMetadata?.pendingUpload
  );
  if (pendingItems.length === 0) return null;
  return findMatchingItemForFile(pendingItems, file);
}
