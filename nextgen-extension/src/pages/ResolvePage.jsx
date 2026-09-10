import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { Button, Modal } from '../components/UI';
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
  extractUdropCode,
} from '../utils/udropApi';
import {
  checkFilemoonIntegrity,
} from '../utils/filemoonApi';
import {
  checkTeraBoxIntegrity,
  checkTeraBoxSceneIntegrity,
  deleteTeraBoxFiles,
  resolveTeraBoxPlaybackUrl,
} from '../utils/teraBoxApi';
import { retryVideoHostPageSide } from '../utils/videoRetryPageSide';
import { getVideoSourceHostOptions } from '../utils/videoProviderLinks';
import { flattenSceneConfig } from '../utils/sceneConfig';
import { UDropUploader, TeraBoxUploader } from '../utils/uploaders';

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
  // Empty results are valid — this flag stops the auto-check retriggering forever.
  const [udropHasChecked, setUdropHasChecked] = useState(false);
  const [deletingOrphans, setDeletingOrphans] = useState({});
  const [linkingExtra, setLinkingExtra] = useState({});

  // ---- 3D Scene integrity check state ----
  const [sceneIntegrity, setSceneIntegrity] = useState({ found: [], missing: [], noUrl: [], extra: [] });
  const [sceneLoading, setSceneLoading] = useState(false);
  const [sceneError, setSceneError] = useState(null);
  const [sceneFilter, setSceneFilter] = useState('all');
  const [sceneKeysConfigured, setSceneKeysConfigured] = useState(false);
  const [default3DSource] = useChromeStorage('default3DSource', 'udrop', 'sync');
  const [sceneSubTab, setSceneSubTab] = useState('udrop'); // 'udrop' | 'terabox'
  const [sceneLoadingMessage, setSceneLoadingMessage] = useState(null);
  // Empty results are valid (no scenes yet) — this flag, not result emptiness,
  // decides whether the auto-check still needs to run. Otherwise an all-empty
  // result retriggers the check forever ("stuck loading").
  const [sceneHasChecked, setSceneHasChecked] = useState(false);
  const sceneCheckSeqRef = useRef(0); // latest scene check wins; stale runs discard

  // ---- Filemoon integrity check state ----
  const [filemoonIntegrity, setFilemoonIntegrity] = useState({ found: [], missing: [], noUrl: [], extra: [] });
  const [filemoonLoading, setFilemoonLoading] = useState(false);
  const [filemoonError, setFilemoonError] = useState(null);
  const [filemoonFilter, setFilemoonFilter] = useState('all');
  const [filemoonKeysConfigured, setFilemoonKeysConfigured] = useState(false);
  // Empty results are valid — this flag stops the auto-check retriggering forever.
  const [filemoonHasChecked, setFilemoonHasChecked] = useState(false);
  const [fixingFilemoon, setFixingFilemoon] = useState({});
  const [fixingUdrop, setFixingUdrop] = useState({});
  const [fixProgress, setFixProgress] = useState({});
  const [fixSourcePicker, setFixSourcePicker] = useState(null); // { targetHost, item, hostSettings, sources, label, recheck }
  // ---- Scene fix (noUrl/missing rows): local file picker + re-upload in place ----
  const [sceneFixFor, setSceneFixFor] = useState(null); // { item, host }
  const [sceneFixBusy, setSceneFixBusy] = useState(false);
  const sceneFixSpzRef = useRef(null);
  const sceneFixTexRef = useRef(null);
  const sceneFixCfgRef = useRef(null);

  // ---- TeraBox integrity check state ----
  const [teraboxIntegrity, setTeraBoxIntegrity] = useState({ found: [], missing: [], noUrl: [], extra: [] });
  const [teraboxLoading, setTeraBoxLoading] = useState(false);
  const [teraboxLoadingMessage, setTeraBoxLoadingMessage] = useState(null);
  const [teraboxError, setTeraBoxError] = useState(null);
  const [teraboxFilter, setTeraBoxFilter] = useState('all');
  const [teraboxKeysConfigured, setTeraBoxKeysConfigured] = useState(false);
  // Empty results are valid — this flag stops the auto-check retriggering forever.
  const [teraboxHasChecked, setTeraboxHasChecked] = useState(false);
  const [fixingTeraBox, setFixingTeraBox] = useState({});
  const [resolvingAllTeraBox, setResolvingAllTeraBox] = useState(false);

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
      setUdropHasChecked(true);
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
        // Vaulted encrypted blobs are opaque — their udrop file is the vault's
        // own blob (trashed ones are auto-deleted), not a normal host video.
        if (isVaultedEncryptedItem(item)) return false;
        // Link items can be fixed/uploaded too (Fix buttons appear on their
        // rows), so they must count as referenced when they have a host URL.
        // Scenes are tracked on the dedicated 3D Scene Hosts tab, not here.
        if (item.kind === 'scene' || item.spzUrl) return false;
        const isVideo = Boolean(item.isVideo || String(item.fileType || '').startsWith('video/'));
        const hasUdrop = Boolean(item.udropWatchUrl || item.udropDirectUrl || item.udropUrl) || (Array.isArray(item.extraMetadata?.udropLinks) && item.extraMetadata.udropLinks.length > 0);
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
      setUdropHasChecked(true);
    }
  }, [settings, sendMessage, checkUdropKeysConfigured]);

  // Auto-run when switching to udrop tab if not checked yet
  useEffect(() => {
    if (activeTab === 'videos' && videoSubTab === 'udrop' && !udropLoading && !udropHasChecked) {
      runUdropIntegrityCheck();
    }
  }, [activeTab, videoSubTab, udropLoading, udropHasChecked, runUdropIntegrityCheck]);

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
      setFilemoonHasChecked(true);
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
        // Vaulted encrypted blobs are opaque — not real hostable videos and
        // trashed ones are auto-deleted, so ignore them on host tabs.
        if (isVaultedEncryptedItem(item)) return false;
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
      setFilemoonHasChecked(true);
    }
  }, [settings, sendMessage, checkFilemoonKeysConfigured]);

  useEffect(() => {
    if (activeTab === 'videos' && videoSubTab === 'filemoon' && !filemoonLoading && !filemoonHasChecked) {
      runFilemoonIntegrityCheck();
    }
  }, [activeTab, videoSubTab, filemoonLoading, filemoonHasChecked, runFilemoonIntegrityCheck]);

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
        // Vaulted encrypted blobs are opaque — not real hostable videos and
        // trashed ones are auto-deleted, so ignore them on host tabs.
        if (isVaultedEncryptedItem(item)) return false;
        if (item.kind === 'scene' || item.spzUrl) return false;
        const isVideo = Boolean(item.isVideo || String(item.fileType || '').startsWith('video/'));
        const hasTeraBox = Boolean(item.teraboxWatchUrl || item.teraboxDirectUrl || item.teraboxUrl) ||
          Boolean(item.videoHosts?.terabox?.watchUrl || item.videoHosts?.terabox?.directUrl) ||
          Boolean(item.teraboxFileId || item.videoHosts?.terabox?.fileId);
        return isVideo || hasTeraBox;
      });

      const result = await checkTeraBoxIntegrity(videoItems, settings.teraboxCookie, (p) => {
        setTeraBoxLoadingMessage(p.phase === 'token' ? 'Resolving TeraBox session…' : `Listing ${p.folder || '/'}… ${p.files} files so far`);
      });
      setTeraBoxLoadingMessage(null);
      setTeraBoxIntegrity(result);
      setNotice({
        type: result.missing.length > 0 ? 'error' : 'success',
        message: `TeraBox check: ${result.found.length} found, ${result.missing.length} broken links, ${result.noUrl.length} no url, ${result.extra.length} extra on terabox.`,
      });
    } catch (err) {
      setTeraBoxLoadingMessage(null);
      setTeraBoxError(err.message || String(err));
    } finally {
      setTeraBoxLoading(false);
      setTeraboxHasChecked(true);
    }
  }, [settings, sendMessage, checkTeraBoxKeysConfigured]);

  useEffect(() => {
    if (activeTab === 'videos' && videoSubTab === 'terabox' && !teraboxLoading && !teraboxHasChecked) {
      runTeraBoxIntegrityCheck();
    }
  }, [activeTab, videoSubTab, teraboxLoading, teraboxHasChecked, runTeraBoxIntegrityCheck]);

  const resolveAllVideoHost = useCallback(async (hostKey, targets, label) => {
    if (!targets || targets.length === 0 || resolvingAllTeraBox) return;

    setResolvingAllTeraBox(true);
    let completed = 0;
    let failed = 0;
    setNotice(null);

    for (const entry of targets) {
      const item = entry.item;
      if (!item || !item.id) continue;
      setFixingTeraBox((prev) => ({ ...prev, [item.id]: true }));
      setFixProgress((prev) => ({ ...prev, [item.id]: { phase: 'download', message: 'Starting...', percent: null } }));
      let succeeded = false;
      try {
        const [freshItem, hostSettings] = await Promise.all([
          sendMessage('getImageById', { id: item.id }),
          sendMessage('getVideoHostSettings'),
        ]);
        const updates = await retryVideoHostPageSide(freshItem, hostKey, hostSettings, {
          onProgress: (progress) => setFixProgress((prev) => ({ ...prev, [item.id]: progress })),
        });
        await sendMessage('updateImage', { id: item.id, ...updates });
        completed += 1;
        succeeded = true;
      } catch (err) {
        failed += 1;
        console.error(`[resolveAll] Failed to resolve "${item.pageTitle || item.fileName || item.id}" to ${label}:`, err);
        setFixProgress((prev) => ({ ...prev, [item.id]: { phase: 'error', message: `Failed: ${err.message || err}` } }));
        setNotice({
          type: 'error',
          message: `Failed to resolve "${item.pageTitle || item.fileName || item.id}" to ${label}: ${err.message || err}`,
        });
      } finally {
        setFixingTeraBox((prev) => {
          const next = { ...prev };
          delete next[item.id];
          return next;
        });
        if (succeeded) {
          setFixProgress((prev) => {
            const next = { ...prev };
            delete next[item.id];
            return next;
          });
        }
      }
    }

    await Promise.all([reloadImages({ silent: true }), reloadVaultImages()]);
    if (hostKey === 'terabox') await runTeraBoxIntegrityCheck();
    if (hostKey === 'udrop') await runUdropIntegrityCheck();
    if (hostKey === 'filemoon') await runFilemoonIntegrityCheck();
    setResolvingAllTeraBox(false);
    setNotice({
      type: failed > 0 ? 'error' : 'success',
      message: `Resolved ${completed}/${targets.length} to ${label}. ${failed} failed.`,
    });
  }, [resolvingAllTeraBox, sendMessage, runTeraBoxIntegrityCheck, runUdropIntegrityCheck, runFilemoonIntegrityCheck, reloadImages, reloadVaultImages]);

  const resolveAllTeraBox = useCallback(async () => {
    const targets = [...(teraboxIntegrity.noUrl || []), ...(teraboxIntegrity.missing || [])];
    await resolveAllVideoHost('terabox', targets, 'TeraBox');
  }, [teraboxIntegrity, resolveAllVideoHost]);

  const resolveAllUdrop = useCallback(async () => {
    const targets = [...(udropIntegrity.noUrl || []), ...(udropIntegrity.missing || [])];
    await resolveAllVideoHost('udrop', targets, 'UDrop');
  }, [udropIntegrity, resolveAllVideoHost]);

  const resolveAllFilemoon = useCallback(async () => {
    const targets = [...(filemoonIntegrity.noUrl || []), ...(filemoonIntegrity.missing || [])];
    await resolveAllVideoHost('filemoon', targets, 'Filemoon');
  }, [filemoonIntegrity, resolveAllVideoHost]);

  // Run a Fix for a single video, optionally restricted to an explicit source
  // host the video is already on. No hidden fallback chain — if the user picks
  // a source, only that host is used as the download source.
  const runVideoFix = async (item, targetHost, hostSettings, sourceHost, label, recheck) => {
    const setFixing = targetHost === 'terabox' ? setFixingTeraBox
      : targetHost === 'udrop' ? setFixingUdrop
      : setFixingFilemoon;
    setFixing((prev) => ({ ...prev, [item.id]: true }));
    setFixProgress((prev) => ({ ...prev, [item.id]: { phase: 'download', message: 'Starting...', percent: null } }));
    try {
      const updates = await retryVideoHostPageSide(item, targetHost, hostSettings, {
        ...(sourceHost ? { sourceHost } : {}),
        onProgress: (progress) => setFixProgress((prev) => ({ ...prev, [item.id]: progress })),
      });
      await sendMessage('updateImage', { id: item.id, ...updates });
      await Promise.all([reloadImages({ silent: true }), reloadVaultImages()]);
      await recheck();
      setNotice({ type: 'success', message: `${label} upload fixed for "${item.pageTitle || item.fileName || item.description || 'item'}".` });
    } catch (err) {
      setNotice({ type: 'error', message: `Failed to fix: ${err.message || err}` });
    } finally {
      setFixing((prev) => {
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
  };

  // Scene Fix: pick .spz (+ optional texture/config) locally, upload via the
  // catalog uploader (direct XHR, no 64MiB limit), then update the EXISTING
  // scene row in place — same semantics as the video Fix (same item gains a
  // working host link), not a duplicate item (2.12.57).
  const runSceneFix = async ({ item, host, spzFile, textureFile, configFile }) => {
    setSceneFixBusy(true);
    setFixProgress((prev) => ({ ...prev, [item.id]: { phase: 'upload', message: 'Starting scene upload...', percent: null } }));
    try {
      const service = VIDEO_UPLOAD_SERVICES.find((s) => s.key === host);
      if (!service) throw new Error(`Unknown scene host: ${host}`);
      if (!service.isConfigured(settings)) throw new Error(`${service.label} is not configured. Go to Settings.`);

      let sceneConfig = null;
      if (configFile) {
        try { sceneConfig = flattenSceneConfig(JSON.parse(await configFile.text())); } catch { throw new Error(`"${configFile.name}" is not valid JSON.`); }
        const hasViewFields = Boolean(sceneConfig && (sceneConfig.position || sceneConfig.rotation || sceneConfig.cameraRadius || sceneConfig.scene || sceneConfig.controls));
        if (!hasViewFields) {
          setNotice({ type: 'warning', message: `Config "${configFile.name}" has no camera fields — viewer will use default framing.` });
        }
      }

      const progress = async ({ loaded, total, percent }) => {
        const message = percent !== null
          ? `${service.label} scene upload: ${percent}% (${loaded} / ${total} bytes)`
          : `${service.label} scene upload: ${loaded} bytes sent`;
        setFixProgress((prev) => ({ ...prev, [item.id]: { phase: 'upload', message, percent } }));
      };

      const spzRes = await service.uploadWithProgress({
        uploader: new service.uploaderClass(),
        blob: spzFile,
        settings,
        data: { fileName: spzFile.name },
        onProgress: progress,
      });
      let texRes = null;
      if (textureFile) {
        texRes = await service.uploadWithProgress({
          uploader: new service.uploaderClass(),
          blob: textureFile,
          settings,
          data: { fileName: textureFile.name },
          onProgress: progress,
        });
      }

      const updates = {};
      if (host === 'udrop') {
        updates.udropWatchUrl = spzRes.watchUrl || spzRes.url || '';
        updates.udropDirectUrl = spzRes.directUrl || spzRes.url || '';
      } else if (host === 'terabox') {
        updates.teraboxWatchUrl = spzRes.watchUrl || spzRes.url || '';
        updates.teraboxDirectUrl = spzRes.directUrl || spzRes.url || '';
      }
      updates.spzUrl = spzRes.directUrl || spzRes.url || spzRes.watchUrl || '';
      updates.spzFileSize = spzFile.size;
      if (texRes) {
        updates.textureUrl = texRes.directUrl || texRes.url || texRes.watchUrl || '';
        updates.textureFileSize = textureFile.size;
      }
      if (sceneConfig) updates.configJson = JSON.stringify(sceneConfig);

      await sendMessage('updateImage', { id: item.id, ...updates });
      await Promise.all([reloadImages({ silent: true }), reloadVaultImages()]);
      const recheck = () => runSceneIntegrityCheck(sceneSubTab);
      await recheck();
      setNotice({ type: 'success', message: `Scene fixed on ${service.label} for "${item.pageTitle || item.fileName || 'scene'}".` });
    } catch (err) {
      setNotice({ type: 'error', message: `Failed to fix: ${err.message || err}` });
    } finally {
      setSceneFixBusy(false);
      setFixProgress((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
    }
  };

  // Scene Fix (auto): download from the host where the scene lives and re-upload to the missing host — like video Fix (2.12.60)
  const startSceneFix = async (item, targetHost) => {
    try {
      const [freshItem, hostSettings] = await Promise.all([
        sendMessage('getImageById', { id: item.id }),
        sendMessage('getVideoHostSettings'),
      ]);
      const service = VIDEO_UPLOAD_SERVICES.find((s) => s.key === targetHost);
      const hostLabel = targetHost === 'terabox' ? 'TeraBox' : 'UDrop';
      if (!service || !service.isConfigured(hostSettings)) {
        setNotice({ type: 'error', message: `${hostLabel} is not configured. Go to Settings.` });
        return;
      }
      const hasUdrop = Boolean(
        (freshItem.spzUrl && String(freshItem.spzUrl).includes('udrop.com')) ||
        freshItem.udropWatchUrl || freshItem.udropDirectUrl || freshItem.udropUrl ||
        freshItem.extraMetadata?.udropLinks?.length ||
        freshItem.videoHosts?.udrop || freshItem.extraMetadata?.videoHosts?.udrop ||
        freshItem.extraMetadata?.sceneSpzFileId || freshItem.extraMetadata?.sceneFiles?.udrop
      );
      const hasTerabox = Boolean(
        freshItem.teraboxWatchUrl || freshItem.teraboxDirectUrl || freshItem.teraboxUrl ||
        freshItem.teraboxFileId || freshItem.videoHosts?.terabox || freshItem.extraMetadata?.videoHosts?.terabox ||
        (freshItem.spzUrl && String(freshItem.spzUrl).includes('terabox.com')) ||
        freshItem.extraMetadata?.sceneFiles?.terabox
      );
      let sourceHost = null;
      if (targetHost === 'terabox' && hasUdrop) sourceHost = 'udrop';
      else if (targetHost === 'udrop' && hasTerabox) sourceHost = 'terabox';
      else if (hasUdrop) sourceHost = 'udrop';
      else if (hasTerabox) sourceHost = 'terabox';
      if (!sourceHost) {
        setSceneFixFor({ item: freshItem, host: targetHost });
        return;
      }
      const fetchBlob = async (url, fileId, fileName) => {
        const candidates = [];
        if (url && /^https?:\/\//i.test(url)) candidates.push(url);
        if (sourceHost === 'terabox' && fileId) {
          try {
            const fresh = await resolveTeraBoxPlaybackUrl(hostSettings?.teraboxCookie || '', fileId, fileName || '');
            if (fresh && fresh !== url) candidates.push(fresh);
          } catch {}
        }
        if (sourceHost === 'udrop') {
          const code = extractUdropCode(url) || (fileId && /^\d+$/.test(fileId) ? null : fileId);
          // Try fileId-based fresh URL first
          if (fileId) {
            try {
              const svc = VIDEO_UPLOAD_SERVICES.find((s) => s.key === 'udrop');
              if (svc?.vaultDownloadUrl) {
                const fresh = await svc.vaultDownloadUrl({ url, fileId, settings: hostSettings });
                if (fresh && fresh !== url) candidates.push(fresh);
              }
            } catch {}
          }
          // Fallback: short_code via API (covers stale download_token URLs where fileId wasn't stored)
          if (code) {
            try {
              const auth = await authorizeUdrop(hostSettings.udropKey1, hostSettings.udropKey2);
              const fd = new FormData();
              fd.append('access_token', auth.access_token);
              fd.append('account_id', auth.account_id);
              fd.append('short_url', code);
              const r = await fetch('https://www.udrop.com/api/v2/file/download', { method: 'POST', body: fd });
              if (r.ok) {
                const j = await r.json();
                const fresh = j?.data?.download_url;
                if (fresh && fresh !== url) candidates.push(fresh);
              }
            } catch {}
          }
        }
        let lastErr = null;
        for (const cand of candidates) {
          try {
            const resp = await fetch(cand);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const blob = await resp.blob();
            if (blob.size === 0) throw new Error('empty blob');
            return blob;
          } catch (e) { lastErr = e; }
        }
        throw lastErr || new Error('no url');
      };
      setSceneFixBusy(true);
      setFixProgress((prev) => ({ ...prev, [freshItem.id]: { phase: 'download', message: `Downloading SPZ from ${sourceHost}...`, percent: null } }));
      const spzFileId = String(freshItem.extraMetadata?.sceneSpzFileId || freshItem.extraMetadata?.sceneFiles?.[sourceHost]?.spz?.fileId || freshItem.teraboxFileId || '').trim();
      const texFileId = String(freshItem.extraMetadata?.sceneTextureFileId || freshItem.extraMetadata?.sceneFiles?.[sourceHost]?.texture?.fileId || freshItem.textureFileId || '').trim();
      const spzFileName = String(freshItem.fileName || freshItem.spzUrl?.split('/').pop()?.split('?')[0] || 'scene.spz');
      const texFileName = String(freshItem.textureUrl?.split('/').pop()?.split('?')[0] || 'texture.webp');
      let spzBlob = null;
      let texBlob = null;
      try {
        spzBlob = await fetchBlob(freshItem.spzUrl, spzFileId, spzFileName);
      } catch (e) {
        const alt = freshItem.udropWatchUrl || freshItem.teraboxWatchUrl || freshItem.udropDirectUrl || freshItem.teraboxDirectUrl;
        if (alt && alt !== freshItem.spzUrl) {
          try { spzBlob = await fetchBlob(alt, spzFileId, spzFileName); } catch {}
        }
      }
      if (!spzBlob) throw new Error(`Could not download SPZ from ${sourceHost} — try manual upload.`);
      if (freshItem.textureUrl) {
        setFixProgress((prev) => ({ ...prev, [freshItem.id]: { phase: 'download', message: `Downloading texture from ${sourceHost}...`, percent: null } }));
        try { texBlob = await fetchBlob(freshItem.textureUrl, texFileId, texFileName); } catch {}
        if (!texBlob) {
          setNotice({ type: 'warning', message: `SPZ downloaded, but texture missing — uploading SPZ only to ${hostLabel}.` });
        }
      }
      const sceneConfig = (() => { try { return freshItem.configJson ? flattenSceneConfig(JSON.parse(freshItem.configJson)) : null; } catch { return null; }})();
      const onProgress = async ({ loaded, total, percent }) => {
        const msg = percent !== null ? `${hostLabel} scene upload: ${percent}% (${loaded}/${total} bytes)` : `${hostLabel} scene upload: ${loaded} bytes`;
        setFixProgress((prev) => ({ ...prev, [freshItem.id]: { phase: 'upload', message: msg, percent } }));
      };
      const spzRes = await service.uploadWithProgress({
        uploader: new service.uploaderClass(),
        blob: spzBlob,
        settings: hostSettings,
        data: { fileName: spzFileName },
        onProgress,
      });
      let texRes = null;
      if (texBlob) {
        texRes = await service.uploadWithProgress({
          uploader: new service.uploaderClass(),
          blob: texBlob,
          settings: hostSettings,
          data: { fileName: texFileName },
          onProgress,
        });
      }
      const updates = {};
      if (targetHost === 'udrop') {
        updates.udropWatchUrl = spzRes.watchUrl || spzRes.url || '';
        updates.udropDirectUrl = spzRes.directUrl || spzRes.url || '';
      } else if (targetHost === 'terabox') {
        updates.teraboxWatchUrl = spzRes.watchUrl || spzRes.url || '';
        updates.teraboxDirectUrl = spzRes.directUrl || spzRes.url || '';
      }
      updates.spzUrl = spzRes.directUrl || spzRes.url || spzRes.watchUrl || freshItem.spzUrl;
      updates.spzFileSize = spzBlob.size;
      if (texRes) {
        updates.textureUrl = texRes.directUrl || texRes.url || texRes.watchUrl || '';
        updates.textureFileSize = texBlob.size;
      }
      if (sceneConfig) updates.configJson = JSON.stringify(sceneConfig);
      const sceneFiles = {
        ...(freshItem.extraMetadata?.sceneFiles || {}),
        [targetHost]: {
          spz: { fileId: spzRes.fileId || spzRes.filecode || '', filename: spzFileName },
          ...(texRes ? { texture: { fileId: texRes.fileId || texRes.filecode || '', filename: texFileName } } : {}),
        },
      };
      updates.extraMetadata = { ...(freshItem.extraMetadata || {}), sceneFiles };
      await sendMessage('updateImage', { id: freshItem.id, ...updates });
      await Promise.all([reloadImages({ silent: true }), reloadVaultImages()]);
      await runSceneIntegrityCheck(targetHost);
      setNotice({ type: 'success', message: `Scene fixed on ${hostLabel} for "${freshItem.pageTitle || freshItem.fileName || 'scene'}" — SPZ${texRes ? '+Image' : ''} copied from ${sourceHost}.` });
    } catch (err) {
      const msg = err?.message || String(err);
      if (/no source|Could not download/i.test(msg)) {
        try {
          const fresh = await sendMessage('getImageById', { id: item.id });
          setSceneFixFor({ item: fresh || item, host: targetHost });
          setNotice({ type: 'warning', message: `Auto Fix needs a hosted file to copy — ${msg} Pick local files.` });
          return;
        } catch {}
      }
      setNotice({ type: 'error', message: `Failed to fix: ${msg}` });
    } finally {
      setSceneFixBusy(false);
      const fid = item?.id;
      if (fid) setFixProgress((prev) => { const n = { ...prev }; delete n[fid]; return n; });
    }
  };

  // Clicking "Fix" opens a source picker when the video is on more than one
  // host, so the user decides where the file is downloaded from (symmetric —
  // no hardcoded filemoon-first fallback). Single-source videos fix directly.
  const startVideoFix = async (item, targetHost, label, recheck) => {
    try {
      const [freshItem, hostSettings] = await Promise.all([
        sendMessage('getImageById', { id: item.id }),
        sendMessage('getVideoHostSettings'),
      ]);
      const sources = getVideoSourceHostOptions(freshItem, targetHost);
      if (sources.length <= 1) {
        await runVideoFix(freshItem, targetHost, hostSettings, '', label, recheck);
        return;
      }
      setFixSourcePicker({ targetHost, item: freshItem, hostSettings, sources, label, recheck });
    } catch (err) {
      setNotice({ type: 'error', message: `Failed to fix: ${err.message || err}` });
    }
  };

  // ---- 3D Scene integrity helpers (UDrop + Terabox) ----
  const checkSceneKeysConfigured = useCallback(() => {
    const udropConfigured = hasText(settings?.udropKey1) && hasText(settings?.udropKey2);
    const teraboxConfigured = true;
    const configured = udropConfigured || teraboxConfigured;
    setSceneKeysConfigured(configured);
    return configured;
  }, [settings]);

  useEffect(() => {
    checkSceneKeysConfigured();
  }, [checkSceneKeysConfigured]);

  const runSceneIntegrityCheck = useCallback(async (overrideTab) => {
    const tab = overrideTab === 'udrop' || overrideTab === 'terabox' ? overrideTab : sceneSubTab;
    if (tab !== sceneSubTab) setSceneSubTab(tab);
    const seq = ++sceneCheckSeqRef.current;
    if (!checkSceneKeysConfigured()) {
      if (seq !== sceneCheckSeqRef.current) return;
      setSceneError('No 3D host configured. Add UDrop keys or log into TeraBox.');
      setSceneHasChecked(true);
      return;
    }
    setSceneLoading(true);
    setSceneError(null);
    setNotice(null);
    try {
      const [freshImages, freshVault] = await Promise.all([sendMessage('getImages'), sendMessage('getVaultImages')]);
      const allItems = [...(freshImages || []), ...(freshVault || [])];
      const sceneItems = allItems.filter((item) => {
        if (!item) return false;
        return item.kind === 'scene' || Boolean(item.spzUrl) || String(item.fileName||'').toLowerCase().endsWith('.spz') || String(item.fileType||'').toLowerCase().startsWith('model/');
      });
      // Symmetry with the video tabs: EVERY scene enters EACH host check, so a
      // udrop-only scene shows as no-url on the terabox tab and vice versa
      // (2.12.55). Filtering to already-linked scenes hid cross-host gaps.
      let result = { found: [], missing: [], noUrl: [], extra: [] };
      if (tab === 'udrop') {
        if (!hasText(settings?.udropKey1) || !hasText(settings?.udropKey2)) throw new Error('UDrop keys not configured. Go to Settings.');
        const auth = await authorizeUdrop(settings.udropKey1, settings.udropKey2);
        result = await checkSceneIntegrity(sceneItems, allItems, auth.access_token, auth.account_id);
      } else {
        result = await checkTeraBoxSceneIntegrity(sceneItems, allItems, settings.teraboxCookie, (p) => {
          if (seq !== sceneCheckSeqRef.current) return;
          setSceneLoadingMessage(p.phase === 'token' ? 'Resolving TeraBox session…' : `Listing ${p.folder || '/'}… ${p.files} files so far`);
        });
      }
      if (seq !== sceneCheckSeqRef.current) return;
      setSceneLoadingMessage(null);
      setSceneIntegrity(result);
      setNotice({
        type: result.missing.length > 0 ? 'error' : 'success',
        message: `${tab === 'udrop' ? 'UDrop' : 'TeraBox'} 3D check: ${result.found.length} found, ${result.missing.length} broken, ${result.noUrl.length} no url, ${result.extra.length} extra.`,
      });
    } catch (err) {
      if (seq !== sceneCheckSeqRef.current) return;
      setSceneLoadingMessage(null);
      setSceneError(err.message || String(err));
    } finally {
      if (seq === sceneCheckSeqRef.current) {
        setSceneLoading(false);
        setSceneHasChecked(true);
      }
    }
  }, [settings, sendMessage, checkSceneKeysConfigured, sceneSubTab]);

  useEffect(() => {
    if (activeTab === 'scenes' && !sceneLoading && !sceneHasChecked) {
      runSceneIntegrityCheck();
    }
  }, [activeTab, sceneLoading, sceneHasChecked, runSceneIntegrityCheck]);

  useEffect(() => {
    if (activeTab === 'scenes' && default3DSource && sceneSubTab !== default3DSource && !sceneHasChecked) {
      setSceneSubTab(default3DSource === 'terabox' ? 'terabox' : 'udrop');
    }
  }, [activeTab, default3DSource]);

  useEffect(() => {
    if (activeTab === 'scenes') {
      setSceneIntegrity({ found: [], missing: [], noUrl: [], extra: [] });
      setSceneError(null);
      setSceneLoadingMessage(null);
      setSceneHasChecked(false);
      setNotice(null);
    }
  }, [sceneSubTab, activeTab]);

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
                  onClick={resolveAllUdrop}
                  className="h-10 gap-2 px-3 text-sm"
                  disabled={resolvingAllTeraBox || (udropIntegrity.noUrl.length + udropIntegrity.missing.length) === 0}
                >
                  {resolvingAllTeraBox ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
                  {resolvingAllTeraBox ? 'Resolving...' : `Resolve all to UDrop (${udropIntegrity.noUrl.length + udropIntegrity.missing.length})`}
                </Button>
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
                              onClick={() => startVideoFix(item, 'udrop', 'UDrop', runUdropIntegrityCheck)}
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
                  onClick={resolveAllFilemoon}
                  className="h-10 gap-2 px-3 text-sm"
                  disabled={resolvingAllTeraBox || (filemoonIntegrity.noUrl.length + filemoonIntegrity.missing.length) === 0}
                >
                  {resolvingAllTeraBox ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
                  {resolvingAllTeraBox ? 'Resolving...' : `Resolve all to Filemoon (${filemoonIntegrity.noUrl.length + filemoonIntegrity.missing.length})`}
                </Button>
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
                              onClick={() => !encrypted && startVideoFix(item, 'filemoon', 'Filemoon', runFilemoonIntegrityCheck)}
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
                  onClick={resolveAllTeraBox}
                  className="h-10 gap-2 px-3 text-sm"
                  disabled={resolvingAllTeraBox || (teraboxIntegrity.noUrl.length + teraboxIntegrity.missing.length) === 0}
                >
                  {resolvingAllTeraBox ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
                  {resolvingAllTeraBox ? 'Resolving...' : `Resolve all to TeraBox (${teraboxIntegrity.noUrl.length + teraboxIntegrity.missing.length})`}
                </Button>
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
                <div className="flex min-h-64 flex-col items-center justify-center gap-2 rounded-[var(--radius-box)] border border-base-300 bg-base-100 text-base-content/60">
                  <div className="flex items-center">
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Checking TeraBox...
                  </div>
                  {teraboxLoadingMessage && (
                    <div className="text-xs text-base-content/50">{teraboxLoadingMessage}</div>
                  )}
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
                              onClick={() => startVideoFix(item, 'terabox', 'TeraBox', runTeraBoxIntegrityCheck)}
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

        {/* 3D Scene Integrity Tab - symmetric to Video hosts sub-tabs */}
        {activeTab === 'scenes' && (
          <>
            <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                  <Box className="h-4 w-4" />
                  3D Scene integrity
                </div>
                <h1 className="text-3xl font-semibold tracking-tight text-base-content">{sceneSubTab === 'udrop' ? 'UDrop scene files (.spz)' : 'TeraBox scene files (.spz)'}</h1>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Button
                  variant="primary"
                  onClick={() => runSceneIntegrityCheck()}
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

            <section className="flex flex-wrap gap-2">
              <button type="button" onClick={() => runSceneIntegrityCheck('udrop')} className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition ${sceneSubTab === 'udrop' ? 'border-primary bg-primary text-primary-content shadow-sm' : 'border-base-300 bg-base-100 text-base-content/70 hover:text-base-content'}`}>
                <Shield className="h-4 w-4" /> UDrop 3D
              </button>
              <button type="button" onClick={() => runSceneIntegrityCheck('terabox')} className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition ${sceneSubTab === 'terabox' ? 'border-primary bg-primary text-primary-content shadow-sm' : 'border-base-300 bg-base-100 text-base-content/70 hover:text-base-content'}`}>
                <Box className="h-4 w-4" /> TeraBox 3D
              </button>
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
                { value: 'missing', label: 'Broken links', count: sceneIntegrity.missing.length, tip: sceneSubTab === 'terabox' ? 'Scenes whose .spz file was deleted from TeraBox or whose link is broken.' : 'Scenes whose .spz file was deleted from UDrop or whose link is broken.' },
                { value: 'found', label: 'Found', count: sceneIntegrity.found.length, tip: sceneSubTab === 'terabox' ? 'Scenes with a working .spz file on TeraBox. Nothing to do.' : 'Scenes with a working .spz file on UDrop. Nothing to do.' },
                { value: 'noUrl', label: 'No scene URL', count: sceneIntegrity.noUrl.length, tip: 'Saved scenes that have no host link at all — they were never uploaded.' },
                { value: 'extra', label: sceneSubTab === 'terabox' ? 'Extra on TeraBox' : 'Extra on UDrop', count: sceneIntegrity.extra.length, tip: sceneSubTab === 'terabox' ? 'Scene groups (1 .spz + its textures) on TeraBox not linked to any saved scene. Config lives in the DB, so only host files list here.' : 'Scene groups (1 .spz + its textures) on UDrop not linked to any saved scene. Config lives in the DB, so only host files list here.' },
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
                <div className="flex min-h-64 flex-col items-center justify-center gap-2 rounded-[var(--radius-box)] border border-base-300 bg-base-100 text-base-content/60">
                  <div className="flex items-center">
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Loading {sceneSubTab === 'terabox' ? 'TeraBox' : 'UDrop'} file list...
                  </div>
                  {sceneSubTab === 'terabox' && sceneLoadingMessage && (
                    <div className="text-xs text-base-content/50">{sceneLoadingMessage}</div>
                  )}
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

                  // ---- Extra (orphan) scene groups: .spz + its texture files ----
                  if (status === 'extra') {
                    const file = entry.file || {};
                    const textureFiles = Array.isArray(entry.textureFiles) ? entry.textureFiles : [];
                    const isStandaloneTexture = Boolean(entry.standaloneTexture);
                    const isTeraTab = sceneSubTab === 'terabox';
                    const hostLabel = isTeraTab ? 'TeraBox' : 'UDrop';
                    const title = file.server_filename || file.name || file.filename || file.file_id || file.fs_id || 'Unknown file';
                    const udropUrl = !isTeraTab ? (file.short_url || file.url || '') : '';
                    const groupKey = isTeraTab
                      ? `scene-extra-tera-${file.fs_id || file.server_filename || Math.random()}`
                      : `scene-extra-${file.file_id || file.id || file.short_url || Math.random()}`;
                    const texName = (f) => f.server_filename || f.name || f.filename || f.file_id || f.fs_id || 'texture';
                    const texKey = (f) => String(f.fs_id || f.file_id || f.id || f.server_filename || f.name || Math.random());
                    return (
                      <article
                        key={groupKey}
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
                            <div className="flex flex-wrap items-center gap-2">
                              <h2 className="truncate text-base font-semibold text-base-content">{title}</h2>
                              <span className="inline-flex items-center gap-1 rounded-full border border-warning/20 bg-warning/10 px-2 py-0.5 text-xs font-semibold text-warning">
                                <AlertCircle className="h-3 w-3" /> Not in DB
                              </span>
                              {isStandaloneTexture && (
                                <span className="inline-flex items-center gap-1 rounded-full border border-info/20 bg-info/10 px-2 py-0.5 text-xs font-semibold text-info">
                                  Texture only
                                </span>
                              )}
                              {textureFiles.length > 0 && (
                                <span className="inline-flex items-center gap-1 rounded-full border border-base-300 bg-base-200/60 px-2 py-0.5 text-xs font-semibold text-base-content/70">
                                  +{textureFiles.length} texture{textureFiles.length > 1 ? 's' : ''}
                                </span>
                              )}
                            </div>
                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-base-content/55">
                              {!isTeraTab && file.file_id && <span>ID: {file.file_id}</span>}
                              {isTeraTab && file.fs_id && <span>ID: {file.fs_id}</span>}
                              {file._folderName && <span>Folder: {file._folderName}</span>}
                              {file._folder && isTeraTab && <span>Folder: {file._folder}</span>}
                              {udropUrl && (
                                <a href={udropUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                                  UDrop <ExternalLink className="h-3 w-3" />
                                </a>
                              )}
                            </div>
                          </div>

                          <div className="text-xs text-base-content/70">
                            {isStandaloneTexture
                              ? `This texture file exists on ${hostLabel} but is not linked to any saved scene. No matching .spz was found — it may be a leftover thumbnail or an unused upload.`
                              : textureFiles.length > 0
                                ? `This scene group (1 .spz + ${textureFiles.length} texture${textureFiles.length > 1 ? 's' : ''}) exists on ${hostLabel} but is not linked to any saved scene. Config lives in the DB, so only these ${1 + textureFiles.length} host files need cleanup.`
                                : `This .spz file exists on ${hostLabel} but is not linked to any saved scene in your vault. It might be safe to delete.`}
                          </div>
                          {textureFiles.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                              {textureFiles.map((texFile) => (
                                <span key={texKey(texFile)} className="inline-flex items-center gap-1 rounded-full border border-base-300 bg-base-200/50 px-2 py-0.5 text-[11px] text-base-content/70">
                                  {texName(texFile)}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>

                        <div className="flex flex-col justify-between gap-3 sm:w-52">
                          <div className="rounded-[var(--radius-box)] border border-base-300 bg-base-200/60 px-3 py-2 text-xs text-base-content/65">
                            {isStandaloneTexture ? 'Orphaned texture' : `Orphaned scene (${1 + textureFiles.length} files)`}
                          </div>
                          <div className="flex flex-col gap-2">
                            {udropUrl && (
                              <Button variant="outline" className="h-9 justify-center gap-2 text-sm" onClick={() => window.open(udropUrl, '_blank')}>
                                <ExternalLink className="h-4 w-4" />
                                Open UDrop
                              </Button>
                            )}
                            {!isTeraTab && (file.file_id || file.id) && (
                              <Button
                                variant="primary"
                                className="h-9 justify-center gap-2 text-sm"
                                disabled={Boolean(deletingOrphans[String(file.file_id || file.id)])}
                                onClick={async () => {
                                  const fid = String(file.file_id || file.id);
                                  const total = 1 + textureFiles.length;
                                  if (!confirm(`Delete this orphaned scene (${total} file${total > 1 ? 's' : ''}: "${file.name || file.filename || fid}"${textureFiles.length > 0 ? ` + ${textureFiles.length} texture${textureFiles.length > 1 ? 's' : ''}` : ''}) from UDrop? This cannot be undone.`)) return;
                                  setDeletingOrphans((prev) => ({ ...prev, [fid]: true }));
                                  try {
                                    const auth = await authorizeUdrop(settings.udropKey1, settings.udropKey2);
                                    await deleteUdropFile(auth.access_token, auth.account_id, fid);
                                    for (const texFile of textureFiles) {
                                      const texId = String(texFile.file_id || texFile.id || '');
                                      if (!texId) continue;
                                      try { await deleteUdropFile(auth.access_token, auth.account_id, texId); } catch (_) {}
                                    }
                                    setSceneIntegrity((prev) => ({
                                      ...prev,
                                      extra: prev.extra.filter((e) => String((e.file?.file_id || e.file?.id)) !== fid),
                                    }));
                                    setNotice({ type: 'success', message: `Deleted orphaned scene (${total} files) from UDrop.` });
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
                                {deletingOrphans[String(file.file_id || file.id)] ? 'Deleting...' : `Delete${textureFiles.length > 0 ? ` (${1 + textureFiles.length})` : ''}`}
                              </Button>
                            )}
                            {isTeraTab && (file.path || file.fs_id) && (
                              <Button
                                variant="primary"
                                className="h-9 justify-center gap-2 text-sm"
                                disabled={Boolean(deletingOrphans[String(file.fs_id || file.path)])}
                                onClick={async () => {
                                  const mainName = file.server_filename || file.name || file.path || 'file';
                                  const total = 1 + textureFiles.length;
                                  if (!file.path) {
                                    setNotice({ type: 'error', message: `Cannot delete "${mainName}": no exact path recorded (refusing to guess — re-run Check Scenes).` });
                                    return;
                                  }
                                  if (!confirm(`Move this orphaned scene (${total} file${total > 1 ? 's' : ''}: "${mainName}"${textureFiles.length > 0 ? ` + ${textureFiles.length} texture${textureFiles.length > 1 ? 's' : ''}` : ''}) to the TeraBox recycle bin? Recoverable from trash. This deletes ONLY the listed files.`)) return;
                                  const delKey = String(file.fs_id || file.path);
                                  setDeletingOrphans((prev) => ({ ...prev, [delKey]: true }));
                                  try {
                                    const paths = [file.path, ...textureFiles.map((t) => t.path).filter(Boolean)];
                                    if (paths.length !== total) throw new Error('A file in this group has no exact path — refusing to delete the group.');
                                    // Pre-flight: re-read the DB and abort if any file in this
                                    // group got linked since the check ran. Never delete a
                                    // file that any item references now.
                                    const [freshImages, freshVault] = await Promise.all([sendMessage('getImages'), sendMessage('getVaultImages')]);
                                    const refIds = new Set();
                                    const refNames = new Set();
                                    for (const it of [...(freshImages || []), ...(freshVault || [])]) {
                                      if (!it) continue;
                                      const tb = it.videoHosts?.terabox || {};
                                      const ex = it.extraMetadata?.videoHosts?.terabox || {};
                                      [tb.fileId, tb.fs_id, ex.fileId, ex.fs_id, it.teraboxFileId].filter(Boolean).forEach((v) => refIds.add(String(v)));
                                      [tb.filename, ex.filename, it.teraboxFileName, it.fileName].filter(Boolean).forEach((v) => refNames.add(String(v)));
                                    }
                                    const groupFiles = [file, ...textureFiles];
                                    const linked = groupFiles.find((f) => (f.fs_id && refIds.has(String(f.fs_id))) || (f.server_filename && refNames.has(String(f.server_filename))));
                                    if (linked) throw new Error(`"${linked.server_filename || linked.fs_id}" was linked to a gallery item since the check — re-run Check Scenes. Nothing deleted.`);
                                    await deleteTeraBoxFiles(settings.teraboxCookie, paths);
                                    setSceneIntegrity((prev) => ({
                                      ...prev,
                                      extra: prev.extra.filter((e) => String((e.file?.fs_id || e.file?.path)) !== delKey),
                                    }));
                                    setNotice({ type: 'success', message: `Moved orphaned scene (${paths.length} files) to TeraBox recycle bin.` });
                                  } catch (err) {
                                    setNotice({ type: 'error', message: `Failed to delete: ${err.message || err}` });
                                  } finally {
                                    setDeletingOrphans((prev) => {
                                      const next = { ...prev };
                                      delete next[delKey];
                                      return next;
                                    });
                                  }
                                }}
                              >
                                {deletingOrphans[String(file.fs_id || file.path)] ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                                {deletingOrphans[String(file.fs_id || file.path)] ? 'Deleting...' : `Delete${textureFiles.length > 0 ? ` (${1 + textureFiles.length})` : ''}`}
                              </Button>
                            )}
                          </div>
                        </div>
                      </article>
                    );
                  }

                  // ---- Normal DB scene items — both files are part of 1 scene (2.12.58) ----
                  const title = item.pageTitle || item.fileName || item.description || 'Untitled';
                  const spzUrl = item.spzUrl || '';
                  const texUrl = item.textureUrl || '';
                  const sceneUrl = spzUrl || texUrl || '';
                  const hostLabel = sceneSubTab === 'terabox' ? 'TeraBox' : 'UDrop';
                  const spzMatched = entry.spzMatched || null;
                  const texMatched = entry.texMatched || null;
                  const spzCode = entry.spzCode || entry.spzFid || null;
                  const texCode = entry.texCode || entry.texFid || null;
                  const baseName = (u) => String(u || '').split('/').pop().split('?')[0].split('#')[0] || '';
                  const spzName = baseName(spzUrl) || item.fileName || (spzCode ? String(spzCode) : 'spz');
                  const texName = baseName(texUrl) || (texCode ? String(texCode) : 'texture');

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
                            {spzUrl && (
                              <a href={spzUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                                SPZ <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                            {texUrl && (
                              <a href={texUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                                Image <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </div>
                        </div>

                        {/* Both files are 1 scene — show each with its own status so hosts stay symmetric (2.12.58) */}
                        {(status === 'found' || status === 'missing' || status === 'noUrl') && (spzUrl || texUrl) && (
                          <div className="space-y-2 text-xs">
                            {spzUrl && (
                              <div className={`flex items-center justify-between rounded border px-2 py-1 ${status === 'found' && (spzMatched || !spzCode) ? 'border-success/20 bg-success/5 text-success' : status === 'missing' && !spzMatched ? 'border-error/20 bg-error/5 text-error' : status === 'noUrl' ? 'border-warning/20 bg-warning/5 text-warning' : 'border-base-300 bg-base-200/40 text-base-content/70'}`}>
                                <span className="truncate font-mono text-[11px]">{spzName}</span>
                                <span className="ml-2 shrink-0 text-[10px] font-semibold uppercase tracking-wider">{status === 'found' && (spzMatched || !spzCode) ? 'SPZ found' : status === 'missing' && !spzMatched ? 'SPZ missing' : status === 'noUrl' ? `SPZ → ${hostLabel} missing` : 'SPZ'}</span>
                              </div>
                            )}
                            {texUrl && (
                              <div className={`flex items-center justify-between rounded border px-2 py-1 ${status === 'found' && (texMatched || !texCode) ? 'border-success/20 bg-success/5 text-success' : status === 'missing' && !texMatched ? 'border-error/20 bg-error/5 text-error' : status === 'noUrl' ? 'border-warning/20 bg-warning/5 text-warning' : 'border-base-300 bg-base-200/40 text-base-content/70'}`}>
                                <span className="truncate font-mono text-[11px]">{texName}</span>
                                <span className="ml-2 shrink-0 text-[10px] font-semibold uppercase tracking-wider">{status === 'found' && (texMatched || !texCode) ? 'Image found' : status === 'missing' && !texMatched ? 'Image missing' : status === 'noUrl' ? `Image → ${hostLabel} missing` : 'Image'}</span>
                              </div>
                            )}
                            {status === 'missing' && (
                              <div className="text-[11px] text-base-content/50">
                                {hostLabel} is missing {(!spzMatched && spzUrl ? 'SPZ' : '') + (!spzMatched && !texMatched && spzUrl && texUrl ? ' + ' : '') + (!texMatched && texUrl ? 'Image' : '') || 'a file'} for this scene. Fix re-uploads the pair.
                              </div>
                            )}
                            {status === 'noUrl' && (
                              <div className="text-[11px] text-base-content/50">
                                Not on {hostLabel} — SPZ + Image live on the other host. Fix copies both files to {hostLabel}.
                              </div>
                            )}
                          </div>
                        )}

                        {status === 'found' && matchedFile && !spzUrl && !texUrl && (
                          <div className="text-xs text-base-content/70">
                            <div className="font-medium text-success">{hostLabel} file: {matchedFile.name || matchedFile.file_id || matchedFile.server_filename || matchedFile.fs_id}</div>
                            {matchedFile.short_url && (
                              <a href={matchedFile.short_url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                                {matchedFile.short_url}
                              </a>
                            )}
                          </div>
                        )}

                        {status === 'missing' && (codes || []).length > 0 && !spzUrl && !texUrl && (
                          <div className="text-xs text-base-content/70">
                            <div className="font-medium text-error">Broken scene links:</div>
                            <div className="font-mono">{codes.join(', ')}</div>
                            <div className="mt-1 text-base-content/50">These files are no longer on {hostLabel}. They may have been deleted or the upload may have failed.</div>
                          </div>
                        )}
                      </div>

                      <div className="flex flex-col justify-between gap-3 sm:w-52">
                        <div className="rounded-[var(--radius-box)] border border-base-300 bg-base-200/60 px-3 py-2 text-xs text-base-content/65">
                          {status === 'missing' && `Needs re-upload to ${hostLabel}`}
                          {status === 'found' && `Verified on ${hostLabel} — SPZ + Image`}
                          {status === 'noUrl' && `Not on ${hostLabel} — SPZ + Image missing`}
                        </div>

                        <div className="flex flex-col gap-2">
                          {spzUrl && texUrl ? (
                            <>
                              <Button variant="outline" className="h-9 justify-center gap-2 text-sm" onClick={() => window.open(spzUrl, '_blank')}>
                                <ExternalLink className="h-4 w-4" /> Open SPZ
                              </Button>
                              <Button variant="outline" className="h-9 justify-center gap-2 text-sm" onClick={() => window.open(texUrl, '_blank')}>
                                <ExternalLink className="h-4 w-4" /> Open Image
                              </Button>
                            </>
                          ) : sceneUrl ? (
                            <Button
                              variant="outline"
                              className="h-9 justify-center gap-2 text-sm"
                              onClick={() => window.open(sceneUrl, '_blank')}
                            >
                              <ExternalLink className="h-4 w-4" />
                              Open {hostLabel}
                            </Button>
                          ) : null}
                          {(status === 'noUrl' || status === 'missing') && (
                            <Button
                              variant="primary"
                              className="h-9 justify-center gap-2 text-sm"
                              disabled={sceneFixBusy || Boolean(fixProgress[item.id])}
                              onClick={() => startSceneFix(item, sceneSubTab)}
                            >
                              {fixProgress[item.id] ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
                              {fixProgress[item.id] ? 'Fixing...' : 'Fix'}
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

        {sceneFixFor && (
          <SceneFixModal
            sceneFixFor={sceneFixFor}
            busy={sceneFixBusy}
            onClose={() => { if (!sceneFixBusy) setSceneFixFor(null); }}
            onSubmit={(files) => runSceneFix({ item: sceneFixFor.item, host: sceneFixFor.host, ...files })}
            spzRef={sceneFixSpzRef}
            texRef={sceneFixTexRef}
            cfgRef={sceneFixCfgRef}
          />
        )}
        {fixSourcePicker && (
          <Modal
            isOpen
            onClose={() => setFixSourcePicker(null)}
            title={`Download source for ${fixSourcePicker.label} fix`}
          >
            <div className="space-y-2">
              <p className="text-sm text-base-content/70">
                This video is on {fixSourcePicker.sources.length} host(s). Pick which one to download the full file from.
              </p>
              {fixSourcePicker.sources.map((source) => (
                <Button
                  key={source.key}
                  variant="outline"
                  className="h-10 w-full justify-center gap-2 text-sm"
                  onClick={async () => {
                    const { targetHost, item, hostSettings, label, recheck } = fixSourcePicker;
                    setFixSourcePicker(null);
                    await runVideoFix(item, targetHost, hostSettings, source.key, label, recheck);
                  }}
                >
                  <UploadCloud className="h-4 w-4" />
                  Download from {source.label}
                </Button>
              ))}
            </div>
          </Modal>
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

/**
 * Scene Fix modal: pick the .spz (+ optional texture/config) and re-upload to
 * the checked host, updating the existing scene row in place (2.12.57).
 */
function SceneFixModal({ sceneFixFor, busy, onClose, onSubmit, spzRef, texRef, cfgRef }) {
  const [spzFile, setSpzFile] = useState(null);
  const [texFile, setTexFile] = useState(null);
  const [cfgFile, setCfgFile] = useState(null);
  const { item, host } = sceneFixFor;
  const hostLabel = host === 'terabox' ? 'TeraBox' : 'UDrop';

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Fix scene on ${hostLabel}`}
    >
      <div className="space-y-4">
        <p className="text-sm text-base-content/70">
          Pick the scene files to re-upload. The existing item
          {' '}<span className="font-semibold">{item?.pageTitle || item?.fileName || item?.id}</span>
          {' '}is updated in place — no duplicate is created.
        </p>

        <div
          className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${spzFile ? 'border-cyan-500 bg-cyan-500/10' : 'border-base-300 hover:border-cyan-500/50'}`}
          onClick={() => spzRef.current?.click()}
        >
          <input ref={spzRef} type="file" accept=".spz" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f && /\.spz$/i.test(f.name)) setSpzFile(f); }} />
          {spzFile
            ? <p className="text-sm font-medium text-cyan-600">{spzFile.name} ({(spzFile.size / 1024 / 1024).toFixed(1)} MB)</p>
            : <p className="text-sm text-base-content/60">.spz file — required</p>}
        </div>

        <div
          className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${texFile ? 'border-purple-500 bg-purple-500/10' : 'border-base-300 hover:border-purple-500/50'}`}
          onClick={() => texRef.current?.click()}
        >
          <input ref={texRef} type="file" accept=".webp,image/webp" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) setTexFile(f); }} />
          {texFile
            ? <p className="text-sm font-medium text-purple-600">{texFile.name} ({(texFile.size / 1024 / 1024).toFixed(1)} MB)</p>
            : <p className="text-sm text-base-content/60">texture .webp — optional</p>}
        </div>

        <div
          className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${cfgFile ? 'border-amber-500 bg-amber-500/10' : 'border-base-300 hover:border-amber-500/50'}`}
          onClick={() => cfgRef.current?.click()}
        >
          <input ref={cfgRef} type="file" accept=".json" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) setCfgFile(f); }} />
          {cfgFile
            ? <p className="text-sm font-medium text-amber-600">{cfgFile.name}</p>
            : <p className="text-sm text-base-content/60">config .json — optional (keeps current when empty)</p>}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            variant="primary"
            disabled={busy || !spzFile}
            onClick={() => onSubmit({ spzFile, textureFile: texFile, configFile: cfgFile })}
            className="bg-cyan-600 hover:bg-cyan-700 border-none"
          >
            <UploadCloud className="h-4 w-4" />
            {busy ? 'Uploading...' : `Upload to ${hostLabel}`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
