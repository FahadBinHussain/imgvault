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
  Send,
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
  deleteFilemoonFile,
} from '../utils/filemoonApi';
import {
  checkTeraBoxIntegrity,
  checkTeraBoxSceneIntegrity,
  deleteTeraBoxFiles,
  extractTeraBoxFileId,
  teraBoxFsIdFromUrl,
  resolveTeraBoxPlaybackUrl,
} from '../utils/teraBoxApi';
import { retryVideoHostPageSide } from '../utils/videoRetryPageSide';
import { getVideoProviderLinks, getVideoSourceHostOptions } from '../utils/videoProviderLinks';
import { checkTelegramSceneIntegrity, deleteTelegramMessage, listTelegramPosts, scrapeTelegramPostUrl, telegramLocalMediaUrl } from '../utils/telegramApi';
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

const SCENE_HOST_LABELS = { udrop: 'UDrop', terabox: 'TeraBox', telegram: 'Telegram' };

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
  const [activeTab, setActiveTab] = useState('images'); // 'images' | 'videos' | 'scenes'
  const [videoSubTab, setVideoSubTab] = useState('udrop'); // 'udrop' | 'filemoon' | 'terabox' | 'telegram'
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
  // Which host the CURRENT sceneIntegrity belongs to. Every label on this tab
  // is derived from sceneSubTab, so the check that produced the numbers and the
  // subtab must never diverge — the auto-run effect below keeps them in sync.
  const [sceneCheckedTab, setSceneCheckedTab] = useState('');
  // Once the user picks a subtab or re-checks manually, their choice wins over
  // the default-3D-source auto-sync.
  const sceneUserPickedRef = useRef(false);

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

  // ---- Telegram integrity check state (Video hosts subtab — sibling of the
  // ---- other video-host integrity checks; found/missing cover the VIDEO type only) ----
  const [telegramIntegrity, setTelegramIntegrity] = useState({ found: [], missing: [], noUrl: [], extra: [] });
  const [telegramLoading, setTelegramLoading] = useState(false);
  const [telegramLoadingMessage, setTelegramLoadingMessage] = useState(null);
  const [telegramError, setTelegramError] = useState(null);
  const [telegramFilter, setTelegramFilter] = useState('all');
  // Empty results are valid — this flag stops the auto-check retriggering forever.
  const [telegramHasChecked, setTelegramHasChecked] = useState(false);
  const [deletingTelegramPosts, setDeletingTelegramPosts] = useState({});
  const [fixingTelegram, setFixingTelegram] = useState({});

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
      // never show stale counts alongside a fresh loud error
      setUdropIntegrity({ found: [], missing: [], noUrl: [], extra: [] });
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

  // Notices are scoped to the check that set them — carrying a stale "3D
  // check" toast onto the video tab (or a video toast onto scenes) made two
  // different results look like contradictory numbers for the same check.
  useEffect(() => {
    setNotice(null);
  }, [activeTab, videoSubTab, sceneSubTab]);

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
      setFilemoonIntegrity({ found: [], missing: [], noUrl: [], extra: [] });
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

      const result = await checkTeraBoxIntegrity(videoItems, allVideoItems, settings.teraboxCookie, (p) => {
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
      setTeraBoxIntegrity({ found: [], missing: [], noUrl: [], extra: [] });
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

  const runTelegramIntegrityCheck = useCallback(async () => {
    const token = settings?.telegramBotToken;
    const channel = settings?.telegramChannel;
    if (!hasText(token) || !hasText(channel)) {
      setTelegramError('Telegram bot token / channel not configured. Go to Settings -> API Keys.');
      return;
    }
    setTelegramLoading(true);
    setTelegramError(null);
    setNotice(null);
    try {
      const [freshImages, freshVault] = await Promise.all([sendMessage('getImages'), sendMessage('getVaultImages')]);
      const allItems = [...(freshImages || []), ...(freshVault || [])];

      // This subtab lives under Video hosts, so found/missing/no-url judge the
      // VIDEO type only (2.12.79 rule, same filter as the UDrop/Filemoon/TeraBox
      // tabs): scenes belong to the 3D tab, vaulted encrypted blobs are not
      // host videos, and other rows only count once they carry a telegram
      // post. Trash rows never appear at all (getImages filters deleted_at).
      //
      // Two reference sets:
      //  - allRefs: every item's telegram post, image or video. Extras compare
      //    against this, so a post an image item still points at is never a
      //    false orphan.
      //  - videoRefs: the video type's posts — the found/missing buckets.
      // A video with no telegram post lands in noUrl — the gap bucket, same
      // "never uploaded yet" meaning as the sibling tabs.
      const allRefs = new Set();
      const videoRefs = new Map();
      const noUrl = [];
      for (const item of allItems) {
        if (!item) continue;

        const imageMsgId = Number(getImageProviderLinks(item)?.telegram?.messageId);
        if (Number.isFinite(imageMsgId)) allRefs.add(imageMsgId);

        const videoMsgId = Number(getVideoProviderLinks(item)?.telegram?.messageId);
        if (Number.isFinite(videoMsgId)) allRefs.add(videoMsgId);

        // scene posts: the 3D tab owns their verification, but their ids still
        // must not show up here as orphan posts (one scene = two documents).
        const sceneTelegram = item.extraMetadata?.sceneFiles?.telegram || {};
        [sceneTelegram.spz?.messageId, sceneTelegram.texture?.messageId].forEach((value) => {
          const id = Number(value);
          if (Number.isFinite(id)) allRefs.add(id);
        });

        // vault blob posts: an encrypted .bin is a channel document like any
        // other, so its post is live media even though the video buckets skip
        // vaulted rows. listing it as an orphan would invite a delete that
        // removes the item's only ciphertext.
        const vaultCopies = Array.isArray(item.extraMetadata?.encryptedBlobHosts)
          ? item.extraMetadata.encryptedBlobHosts
          : [];
        vaultCopies
          .filter((copy) => String(copy?.host || '').toLowerCase() === 'telegram')
          .forEach((copy) => {
            const id = Number(copy?.encryptedBlobMessageId);
            if (Number.isFinite(id)) allRefs.add(id);
          });
        const mirroredVaultMsgId = Number(
          item.encryptedBlobMessageId ?? item.extraMetadata?.encryptedBlobMessageId
        );
        if (Number.isFinite(mirroredVaultMsgId)) allRefs.add(mirroredVaultMsgId);

        if (isVaultedEncryptedItem(item)) continue;
        if (item.kind === 'scene' || item.spzUrl) continue;

        const isVideo = Boolean(item.isVideo || String(item.fileType || '').startsWith('video/'));
        // A telegram post counts as a host link (mirrors the sibling checks'
        // host-URL test); a plain video with none is a gap row.
        if (!isVideo && !Number.isFinite(videoMsgId)) continue;

        if (!Number.isFinite(videoMsgId)) {
          noUrl.push({ item, codes: [] });
          continue;
        }

        const list = videoRefs.get(videoMsgId) || [];
        list.push(item);
        videoRefs.set(videoMsgId, list);
      }

      const posts = await listTelegramPosts(token, channel, {
        onProgress: (p) => setTelegramLoadingMessage(`Reading channel history… page ${p.page}, ${p.posts} media posts`),
      });
      setTelegramLoadingMessage(null);

      const cleanChannel = String(channel).trim().replace(/^@+/, '');
      const channelIds = new Set(posts.map((post) => Number(post.messageId)));
      const toEntry = (msgId, items) => ({
        messageId: String(msgId),
        codes: [String(msgId)],
        pageUrl: `https://t.me/${cleanChannel}/${msgId}`,
        items,
      });

      const found = [];
      const extra = [];
      for (const msgId of channelIds) {
        const items = videoRefs.get(msgId);
        if (items) found.push(toEntry(msgId, items));
        else if (!allRefs.has(msgId)) extra.push(toEntry(msgId, undefined));
      }
      const missingRaw = [];
      for (const [msgId, items] of videoRefs) {
        if (!channelIds.has(msgId)) missingRaw.push(toEntry(msgId, items));
      }

      // The listing page is fastly-cached and can lag a post (or a fix upload)
      // by minutes - observed live: after a fix the just-posted ref was absent
      // from the listing for >20s while the post page itself was live since
      // the uploader's own scrape (the uploader scrapes it for the CDN url).
      // The post page t.me/s/<ch>/<id> is the authoritative existence probe: a
      // ref counts as broken only when BOTH the listing and its own post page
      // lack the message. A dead ref still probes as gone (no marker), so
      // nothing gets softened - but a live post can never flash as broken
      // (a false broken card would offer a duplicate re-upload Fix).
      const missing = [];
      for (const entry of missingRaw) {
        let alive = false;
        try {
          await scrapeTelegramPostUrl(channel, entry.messageId, { wantMp4: false, attempts: 2 });
          alive = true;
        } catch (err) {
          console.warn(`[telegram] post ${entry.messageId} is neither in the listing nor live on its post page: ${err.message || err}`);
        }
        if (alive) found.push(entry);
        else missing.push(entry);
      }
      const byNumericId = (a, b) => Number(a.messageId) - Number(b.messageId);
      found.sort(byNumericId);
      missing.sort(byNumericId);
      extra.sort(byNumericId);

      setTelegramIntegrity({ found, missing, noUrl, extra });
      setNotice({
        type: missing.length > 0 ? 'error' : 'success',
        message: `Telegram check: ${found.length} found, ${missing.length} broken links, ${noUrl.length} no url, ${extra.length} extra on Telegram.`,
      });
    } catch (err) {
      setTelegramLoadingMessage(null);
      setTelegramError(err.message || String(err));
      setTelegramIntegrity({ found: [], missing: [], noUrl: [], extra: [] });
    } finally {
      setTelegramLoading(false);
      setTelegramHasChecked(true);
    }
  }, [settings, sendMessage]);

  useEffect(() => {
    if (activeTab === 'videos' && videoSubTab === 'telegram' && !telegramLoading && !telegramHasChecked) {
      runTelegramIntegrityCheck();
    }
  }, [activeTab, videoSubTab, telegramLoading, telegramHasChecked, runTelegramIntegrityCheck]);

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
    if (hostKey === 'telegram') await runTelegramIntegrityCheck();
    setResolvingAllTeraBox(false);
    setNotice({
      type: failed > 0 ? 'error' : 'success',
      message: `Resolved ${completed}/${targets.length} to ${label}. ${failed} failed.`,
    });
  }, [resolvingAllTeraBox, sendMessage, runTeraBoxIntegrityCheck, runUdropIntegrityCheck, runFilemoonIntegrityCheck, runTelegramIntegrityCheck, reloadImages, reloadVaultImages]);

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

  const resolveAllTelegram = useCallback(async () => {
    // missing entries are per message id and carry the referencing items —
    // each item is its own re-upload target (symmetric with the sibling tabs'
    // noUrl + missing bulk fixed set).
    const targets = [
      ...(telegramIntegrity.noUrl || []),
      ...(telegramIntegrity.missing || []).flatMap((entry) => (entry.items || []).map((item) => ({ item }))),
    ];
    await resolveAllVideoHost('telegram', targets, 'Telegram');
  }, [telegramIntegrity, resolveAllVideoHost]);

  // Run a Fix for a single video, optionally restricted to an explicit source
  // host the video is already on. No hidden fallback chain — if the user picks
  // a source, only that host is used as the download source.
  const runVideoFix = async (item, targetHost, hostSettings, sourceHost, label, recheck) => {
    const setFixing = targetHost === 'terabox' ? setFixingTeraBox
      : targetHost === 'udrop' ? setFixingUdrop
      : targetHost === 'telegram' ? setFixingTelegram
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
      const sceneFiles = {
        ...(item.extraMetadata?.sceneFiles || {}),
        host,
        [host]: {
          spz: { fileId: spzRes.fileId || '', messageId: spzRes.messageId || '', filename: spzFile.name },
          ...(texRes ? { texture: { fileId: texRes.fileId || '', messageId: texRes.messageId || '', filename: textureFile.name } } : {}),
        },
      };
      // every host writes the per-host file/post refs - telegram integrity reads
      // them (it has no watch/direct columns, and message ids are not in the url).
      // sceneFiles ALSO goes top-level for the legacy firestore backend, which
      // stores only the fields named in the update mask. neon no longer needs the
      // duplicate: buildExtraSeed lets this write beat the mirrored top-level key
      // (before, a scene that already had a sceneFiles block kept the stale one,
      // so telegram refs listed their own posts as extras).
      updates.sceneFiles = sceneFiles;
      updates.extraMetadata = {
        ...(item.extraMetadata || {}),
        sceneFiles,
      };

      await sendMessage('updateImage', { id: item.id, ...updates });
      await Promise.all([reloadImages({ silent: true }), reloadVaultImages()]);
      const recheck = () => { sceneUserPickedRef.current = true; return runSceneIntegrityCheck(sceneSubTab); };
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
      const hostLabel = SCENE_HOST_LABELS[targetHost] || 'UDrop';
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
      const hasTelegram = Boolean(
        freshItem.extraMetadata?.sceneFiles?.telegram ||
        /^\/telegram-media\//.test(String(freshItem.spzUrl || '')) ||
        /^\/telegram-media\//.test(String(freshItem.textureUrl || '')) ||
        freshItem.videoHosts?.telegram || freshItem.extraMetadata?.videoHosts?.telegram
      );
      let sourceHost = null;
      if (targetHost === 'telegram' && hasUdrop) sourceHost = 'udrop';
      else if (targetHost === 'telegram' && hasTerabox) sourceHost = 'terabox';
      else if (targetHost === 'udrop' && hasTerabox) sourceHost = 'terabox';
      else if (targetHost === 'udrop' && hasTelegram) sourceHost = 'telegram';
      else if (targetHost === 'terabox' && hasUdrop) sourceHost = 'udrop';
      else if (targetHost === 'terabox' && hasTelegram) sourceHost = 'telegram';
      else if (hasUdrop) sourceHost = 'udrop';
      else if (hasTerabox) sourceHost = 'terabox';
      else if (hasTelegram) sourceHost = 'telegram';
      if (!sourceHost) {
        setSceneFixFor({ item: freshItem, host: targetHost });
        return;
      }
      const fetchBlob = async (url, fileId, fileName) => {
        const candidates = [];
        if (sourceHost === 'telegram') {
          // stored as a root-relative /telegram-media/<fileId> url; the extension
          // service worker serves it same-origin (no token, no expiry). When the
          // url itself is gone the file id rebuilds the same path.
          const sourceUrl = url || (fileId ? telegramLocalMediaUrl(fileId) : '');
          if (!sourceUrl) throw new Error(`No Telegram file id or media url is stored for ${fileName || 'scene file'}.`);
          candidates.push(sourceUrl);
        } else if (sourceHost === 'terabox') {
          const stableFileId = String(fileId || teraBoxFsIdFromUrl(url) || extractTeraBoxFileId(freshItem) || '').trim();
          if (!stableFileId) throw new Error(`No TeraBox file id is stored for ${fileName || 'scene file'}.`);
          const fresh = await resolveTeraBoxPlaybackUrl(hostSettings?.teraboxCookie || '', stableFileId, fileName || '');
          if (!fresh) throw new Error(`TeraBox returned no fresh download link for fs_id ${stableFileId}.`);
          candidates.push(fresh);
        } else if (url && /^https?:\/\//i.test(url)) {
          candidates.push(url);
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
      const spzFileId = String(freshItem.extraMetadata?.sceneSpzFileId || freshItem.extraMetadata?.sceneFiles?.[sourceHost]?.spz?.fileId || (sourceHost === 'terabox' ? extractTeraBoxFileId(freshItem) : '') || teraBoxFsIdFromUrl(freshItem.spzUrl) || '').trim();
      const texFileId = String(freshItem.extraMetadata?.sceneTextureFileId || freshItem.extraMetadata?.sceneFiles?.[sourceHost]?.texture?.fileId || freshItem.textureFileId || (sourceHost === 'terabox' ? teraBoxFsIdFromUrl(freshItem.textureUrl) : '') || '').trim();
      const spzFileName = String(freshItem.extraMetadata?.sceneFiles?.[sourceHost]?.spz?.filename || freshItem.fileName || freshItem.spzUrl?.split('/').pop()?.split('?')[0] || 'scene.spz');
      const texFileName = String(freshItem.extraMetadata?.sceneFiles?.[sourceHost]?.texture?.filename || freshItem.textureUrl?.split('/').pop()?.split('?')[0] || 'texture.webp');
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
        host: targetHost,
        [targetHost]: {
          spz: {
            fileId: spzRes.fileId || spzRes.filecode || '',
            messageId: spzRes.messageId || '',
            filename: spzFileName,
          },
          ...(texRes ? {
            texture: {
              fileId: texRes.fileId || texRes.filecode || '',
              messageId: texRes.messageId || '',
              filename: texFileName,
            },
          } : {}),
        },
      };
      updates.extraMetadata = { ...(freshItem.extraMetadata || {}), sceneFiles };
      // top-level copy, same firestore reason as runSceneFix above.
      updates.sceneFiles = sceneFiles;
      await sendMessage('updateImage', { id: freshItem.id, ...updates });
      await Promise.all([reloadImages({ silent: true }), reloadVaultImages()]);
      sceneUserPickedRef.current = true;
      await runSceneIntegrityCheck(targetHost);
      setNotice({ type: 'success', message: `Scene fixed on ${hostLabel} for "${freshItem.pageTitle || freshItem.fileName || 'scene'}" — SPZ${texRes ? '+Image' : ''} copied from ${SCENE_HOST_LABELS[sourceHost] || sourceHost}.` });
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

  // ---- 3D Scene integrity helpers (UDrop + TeraBox + Telegram) ----
  const checkSceneKeysConfigured = useCallback(() => {
    const udropConfigured = hasText(settings?.udropKey1) && hasText(settings?.udropKey2);
    const teraboxConfigured = true;
    const telegramConfigured = hasText(settings?.telegramBotToken) && hasText(settings?.telegramChannel);
    const configured = udropConfigured || teraboxConfigured || telegramConfigured;
    setSceneKeysConfigured(configured);
    return configured;
  }, [settings]);

  useEffect(() => {
    checkSceneKeysConfigured();
  }, [checkSceneKeysConfigured]);

  const runSceneIntegrityCheck = useCallback(async (overrideTab) => {
    const tab = SCENE_HOST_LABELS[overrideTab] ? overrideTab : sceneSubTab;
    if (tab !== sceneSubTab) setSceneSubTab(tab);
    const seq = ++sceneCheckSeqRef.current;
    if (!checkSceneKeysConfigured()) {
      if (seq !== sceneCheckSeqRef.current) return;
      setSceneError('No 3D host configured. Add UDrop keys, log into TeraBox, or set the Telegram token + channel.');
      setSceneCheckedTab(tab);
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
      } else if (tab === 'telegram') {
        if (!hasText(settings?.telegramBotToken) || !hasText(settings?.telegramChannel)) throw new Error('Telegram bot token + channel not configured. Go to Settings.');
        result = await checkTelegramSceneIntegrity(sceneItems, allItems, {
          token: settings.telegramBotToken,
          channel: settings.telegramChannel,
          onProgress: (p) => {
            if (seq !== sceneCheckSeqRef.current) return;
            setSceneLoadingMessage(p.phase === 'listing'
              ? `Reading channel history… page ${p.page}, ${p.posts} media posts`
              : `Probing scene file ${p.done}/${p.total}…`);
          },
        });
      } else {
        result = await checkTeraBoxSceneIntegrity(sceneItems, allItems, settings.teraboxCookie, (p) => {
          if (seq !== sceneCheckSeqRef.current) return;
          setSceneLoadingMessage(p.phase === 'token' ? 'Resolving TeraBox session…' : `Listing ${p.folder || '/'}… ${p.files} files so far`);
        });
      }
      if (seq !== sceneCheckSeqRef.current) return;
      setSceneLoadingMessage(null);
      setSceneCheckedTab(tab);
      setSceneIntegrity(result);
      setNotice({
        type: result.missing.length > 0 ? 'error' : 'success',
        message: `${SCENE_HOST_LABELS[tab]} 3D check: ${result.found.length} found, ${result.missing.length} broken, ${result.noUrl.length} no url, ${result.extra.length} extra${tab === 'telegram' ? ' (Telegram counts posts: 2 per scene)' : ''}.`,
      });
    } catch (err) {
      if (seq !== sceneCheckSeqRef.current) return;
      setSceneLoadingMessage(null);
      setSceneError(err.message || String(err));
      setSceneCheckedTab(tab);
      setSceneIntegrity({ found: [], missing: [], noUrl: [], extra: [] });
    } finally {
      if (seq === sceneCheckSeqRef.current) {
        setSceneLoading(false);
        setSceneHasChecked(true);
      }
    }
  }, [settings, sendMessage, checkSceneKeysConfigured, sceneSubTab]);

  // Enter the 3D tab: run the check FOR the default 3D source, which also sets
  // the subtab atomically (line `if (tab !== sceneSubTab) setSceneSubTab(tab)`
  // above). Previously this was TWO effects — the auto-run fired the check with
  // the pre-flip subtab ('udrop' is also useChromeStorage's placeholder before
  // the stored value lands from chrome.storage.sync), then the default-source
  // init effect flipped sceneSubTab to 'terabox' mid-flight. The check then
  // committed UDrop numbers under TeraBox labels and nothing ever re-synced
  // (the init effect's deps never changed again). One effect, one commit.
  // Re-runs when the stored default resolves AFTER a check already ran for the
  // placeholder tab — sceneCheckedTab !== target is exactly that divergence.
  // Once the user picked a subtab manually, their choice wins (no auto-switch).
  useEffect(() => {
    if (activeTab !== 'scenes' || sceneLoading || sceneUserPickedRef.current) return;
    const targetTab = SCENE_HOST_LABELS[default3DSource] ? default3DSource : 'udrop';
    if (sceneHasChecked && sceneCheckedTab === targetTab) return;
    runSceneIntegrityCheck(targetTab);
  }, [activeTab, sceneLoading, sceneHasChecked, sceneCheckedTab, default3DSource, runSceneIntegrityCheck]);

  useEffect(() => {
    if (activeTab === 'scenes') {
      setSceneIntegrity({ found: [], missing: [], noUrl: [], extra: [] });
      setSceneError(null);
      setSceneLoadingMessage(null);
      setSceneHasChecked(false);
      setNotice(null);
    }
  }, [sceneSubTab, activeTab]);

  const sceneHostLabel = SCENE_HOST_LABELS[sceneSubTab] || 'UDrop';

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

  // Telegram Fix targets: noUrl rows are 1 item each; a missing bucket entry is
  // one message id referencing N items — each item is its own fix target.
  const telegramFixTargetCount = telegramIntegrity.noUrl.length
    + telegramIntegrity.missing.reduce((sum, entry) => sum + ((entry.items || []).length), 0);

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
            <button
              type="button"
              onClick={() => setVideoSubTab('telegram')}
              className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition ${
                videoSubTab === 'telegram'
                  ? 'border-primary bg-primary text-primary-content shadow-sm'
                  : 'border-base-300 bg-base-100 text-base-content/70 hover:text-base-content'
              }`}
            >
              <Send className="h-4 w-4" />
              Telegram integrity
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
                                  <Button
                                    variant="outline"
                                    className="h-9 justify-center gap-2 border-error/30 text-sm text-error hover:bg-error/10"
                                    disabled={Boolean(deletingOrphans[`fm:${fc}`])}
                                    onClick={async () => {
                                      if (!confirm(`Delete "${fc}" from Filemoon? This is permanent.`)) return;
                                      setDeletingOrphans((prev) => ({ ...prev, [`fm:${fc}`]: true }));
                                      try {
                                        await deleteFilemoonFile(settings.filemoonApiKey, fc);
                                        setFilemoonIntegrity((prev) => ({
                                          ...prev,
                                          extra: prev.extra.filter((e) => String(e.file?.file_code || e.file?.filecode) !== fc),
                                        }));
                                        setNotice({ type: 'success', message: `Deleted orphan file "${fc}" from Filemoon.` });
                                      } catch (err) {
                                        setNotice({ type: 'error', message: `Failed to delete: ${err.message || err}` });
                                      } finally {
                                        setDeletingOrphans((prev) => {
                                          const next = { ...prev };
                                          delete next[`fm:${fc}`];
                                          return next;
                                        });
                                      }
                                    }}
                                  >
                                    {deletingOrphans[`fm:${fc}`] ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                                    {deletingOrphans[`fm:${fc}`] ? 'Deleting...' : 'Delete'}
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
                                  {file.path && (
                                    <Button
                                      variant="outline"
                                      className="h-9 justify-center gap-2 border-error/30 text-sm text-error hover:bg-error/10"
                                      disabled={Boolean(deletingOrphans[String(file.fs_id || file.path)])}
                                      onClick={async () => {
                                        const delKey = String(file.fs_id || file.path);
                                        if (!confirm(`Move "${title}" to the TeraBox recycle bin?`)) return;
                                        setDeletingOrphans((prev) => ({ ...prev, [delKey]: true }));
                                        try {
                                          await deleteTeraBoxFiles(settings.teraboxCookie, [file.path]);
                                          setTeraBoxIntegrity((prev) => ({
                                            ...prev,
                                            extra: prev.extra.filter((e) => String(e.file?.fs_id || e.file?.path) !== delKey),
                                          }));
                                          setNotice({ type: 'success', message: `Moved orphan "${title}" to the TeraBox recycle bin (recoverable there).` });
                                        } catch (err) {
                                          setNotice({ type: 'error', message: `Delete failed: ${err.message || err}` });
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
                                      {deletingOrphans[String(file.fs_id || file.path)] ? 'Deleting...' : 'Delete'}
                                    </Button>
                                  )}
                                  {!file.path && (
                                    <div className="rounded-[var(--radius-box)] border border-error/25 bg-error/10 px-3 py-2 text-xs text-error">
                                      No exact path in the listing — refusing to delete by name alone. Re-run Check TeraBox.
                                    </div>
                                  )}
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
                <h1 className="text-3xl font-semibold tracking-tight text-base-content">{sceneHostLabel} scene files (.spz)</h1>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Button
                  variant="primary"
                  onClick={() => { sceneUserPickedRef.current = true; runSceneIntegrityCheck(); }}
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
              <button type="button" onClick={() => { sceneUserPickedRef.current = true; runSceneIntegrityCheck('udrop'); }} className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition ${sceneSubTab === 'udrop' ? 'border-primary bg-primary text-primary-content shadow-sm' : 'border-base-300 bg-base-100 text-base-content/70 hover:text-base-content'}`}>
                <Shield className="h-4 w-4" /> UDrop 3D
              </button>
              <button type="button" onClick={() => { sceneUserPickedRef.current = true; runSceneIntegrityCheck('terabox'); }} className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition ${sceneSubTab === 'terabox' ? 'border-primary bg-primary text-primary-content shadow-sm' : 'border-base-300 bg-base-100 text-base-content/70 hover:text-base-content'}`}>
                <Box className="h-4 w-4" /> TeraBox 3D
              </button>
              <button type="button" onClick={() => { sceneUserPickedRef.current = true; runSceneIntegrityCheck('telegram'); }} className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition ${sceneSubTab === 'telegram' ? 'border-primary bg-primary text-primary-content shadow-sm' : 'border-base-300 bg-base-100 text-base-content/70 hover:text-base-content'}`}>
                <Send className="h-4 w-4" /> Telegram 3D
              </button>
            </section>


            {!sceneKeysConfigured && (
              <div className="rounded-[var(--radius-box)] border border-warning/25 bg-warning/10 px-4 py-3 text-sm text-warning">
                No 3D host is configured. Add UDrop keys, log into TeraBox, or set the Telegram bot token + channel in Settings.
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
                { value: 'missing', label: 'Broken links', count: sceneIntegrity.missing.length, tip: `Scenes whose .spz or texture file was deleted from ${sceneHostLabel} or whose link is broken.` },
                { value: 'found', label: 'Found', count: sceneIntegrity.found.length, tip: `Scenes with working .spz + texture files on ${sceneHostLabel}. Nothing to do.` },
                { value: 'noUrl', label: 'No scene URL', count: sceneIntegrity.noUrl.length, tip: 'Saved scenes that have no host link at all — they were never uploaded.' },
                { value: 'extra', label: `Extra on ${sceneHostLabel}`, count: sceneIntegrity.extra.length, tip: sceneSubTab === 'telegram' ? 'Channel posts not linked to any saved item. Telegram lists posts, not scene groups — one scene is 2 posts (.spz + texture).' : `Scene groups (1 .spz + its textures) on ${sceneHostLabel} not linked to any saved scene. Config lives in the DB, so only host files list here.` },
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
                    Loading {sceneHostLabel} file list...
                  </div>
                  {sceneSubTab !== 'udrop' && sceneLoadingMessage && (
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
                    if (sceneSubTab === 'telegram') {
                      // Telegram lists POSTS (ids only), not files: one scene is
                      // two posts, so an "extra" here is a single post.
                      const messageId = String(entry.messageId || '');
                      const delKey = `telegram-${messageId}`;
                      return (
                        <article
                          key={delKey}
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
                                <h2 className="truncate text-base font-semibold text-base-content">Post {messageId}</h2>
                                <span className="inline-flex items-center gap-1 rounded-full border border-warning/20 bg-warning/10 px-2 py-0.5 text-xs font-semibold text-warning">
                                  <AlertCircle className="h-3 w-3" /> Not in DB
                                </span>
                              </div>
                              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-base-content/55">
                                <span>Message ID: {messageId}</span>
                              </div>
                            </div>
                            <div className="text-xs text-base-content/70">
                              This Telegram post is not linked to any saved item. The listing shows post ids only — open the post first, since one scene is 2 posts (.spz + texture).
                            </div>
                          </div>

                          <div className="flex flex-col justify-between gap-3 sm:w-52">
                            <div className="rounded-[var(--radius-box)] border border-base-300 bg-base-200/60 px-3 py-2 text-xs text-base-content/65">
                              Orphaned post
                            </div>
                            <div className="flex flex-col gap-2">
                              {entry.pageUrl && (
                                <Button variant="outline" className="h-9 justify-center gap-2 text-sm" onClick={() => window.open(entry.pageUrl, '_blank')}>
                                  <ExternalLink className="h-4 w-4" /> Open post
                                </Button>
                              )}
                              <Button
                                variant="primary"
                                className="h-9 justify-center gap-2 text-sm"
                                disabled={deletingOrphans[delKey]}
                                onClick={async () => {
                                  setDeletingOrphans((prev) => ({ ...prev, [delKey]: true }));
                                  try {
                                    // pre-flight: re-read the DB and never delete a
                                    // post some item started referencing since the check
                                    const [freshImages, freshVault] = await Promise.all([sendMessage('getImages'), sendMessage('getVaultImages')]);
                                    const referenced = [...(freshImages || []), ...(freshVault || [])].some((it) => {
                                      if (!it) return false;
                                      const extra = it.extraMetadata && typeof it.extraMetadata === 'object' ? it.extraMetadata : {};
                                      const ids = [
                                        extra.sceneFiles?.telegram?.spz?.messageId,
                                        extra.sceneFiles?.telegram?.texture?.messageId,
                                        extra.videoHosts?.telegram?.messageId,
                                        extra.imageHosts?.telegram?.messageId,
                                        it.videoHosts?.telegram?.messageId,
                                        it.imageHosts?.telegram?.messageId,
                                        // an item vaulted to telegram since the check
                                        ...(Array.isArray(extra.encryptedBlobHosts) ? extra.encryptedBlobHosts : [])
                                          .filter((copy) => String(copy?.host || '').toLowerCase() === 'telegram')
                                          .map((copy) => copy?.encryptedBlobMessageId),
                                        it.encryptedBlobMessageId ?? extra.encryptedBlobMessageId,
                                      ];
                                      return ids.some((v) => String(v || '') === messageId);
                                    });
                                    if (referenced) throw new Error(`Post ${messageId} is linked to an item since the check — re-run Check Scenes. Nothing deleted.`);
                                    await deleteTelegramMessage({ token: settings?.telegramBotToken, channel: settings?.telegramChannel, messageId });
                                    setSceneIntegrity((prev) => ({
                                      ...prev,
                                      extra: prev.extra.filter((e) => String(e.messageId) !== messageId),
                                    }));
                                    setNotice({ type: 'success', message: `Deleted Telegram post ${messageId}.` });
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
                                {deletingOrphans[delKey] ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                                {deletingOrphans[delKey] ? 'Deleting...' : 'Delete'}
                              </Button>
                            </div>
                          </div>
                        </article>
                      );
                    }
                    const file = entry.file || {};
                    const textureFiles = Array.isArray(entry.textureFiles) ? entry.textureFiles : [];
                    const isStandaloneTexture = Boolean(entry.standaloneTexture);
                    const isTeraTab = sceneSubTab === 'terabox';
                    const hostLabel = sceneHostLabel;
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
                  const hostLabel = sceneHostLabel;
                  const spzMatched = entry.spzMatched || null;
                  const texMatched = entry.texMatched || null;
                  const spzCode = entry.spzCode || entry.spzFid || null;
                  const texCode = entry.texCode || entry.texFid || null;
                  const baseName = (u) => String(u || '').split('/').pop().split('?')[0].split('#')[0] || '';
                  const spzName = entry.spzFileName || baseName(spzUrl) || item.fileName || (spzCode ? String(spzCode) : 'spz');
                  const texName = entry.texFileName || baseName(texUrl) || (texCode ? String(texCode) : 'texture');
                  // telegram's stored urls are extension-local (`/telegram-media/…`)
                  // and mean nothing outside the app - the public post is the link.
                  const spzOpenUrl = entry.spzPageUrl || spzUrl;
                  const texOpenUrl = entry.texPageUrl || texUrl;

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
                            {spzOpenUrl && (
                              <a href={spzOpenUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                                {entry.spzPageUrl ? 'SPZ post' : 'SPZ'} <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                            {texOpenUrl && (
                              <a href={texOpenUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                                {entry.texPageUrl ? 'Texture post' : 'Image'} <ExternalLink className="h-3 w-3" />
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
                            {status === 'missing' && (entry.reasons || []).length > 0 && (
                              <div className="space-y-0.5 rounded border border-error/20 bg-error/5 px-2 py-1 font-mono text-[10px] text-error/80">
                                {entry.reasons.map((reason) => <div key={reason} className="truncate">{reason}</div>)}
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
                          {spzOpenUrl && texOpenUrl ? (
                            <>
                              <Button variant="outline" className="h-9 justify-center gap-2 text-sm" onClick={() => window.open(spzOpenUrl, '_blank')}>
                                <ExternalLink className="h-4 w-4" /> Open {entry.spzPageUrl ? 'SPZ post' : 'SPZ'}
                              </Button>
                              <Button variant="outline" className="h-9 justify-center gap-2 text-sm" onClick={() => window.open(texOpenUrl, '_blank')}>
                                <ExternalLink className="h-4 w-4" /> Open {entry.texPageUrl ? 'texture post' : 'Image'}
                              </Button>
                            </>
                          ) : (spzOpenUrl || texOpenUrl) ? (
                            <Button
                              variant="outline"
                              className="h-9 justify-center gap-2 text-sm"
                              onClick={() => window.open(spzOpenUrl || texOpenUrl, '_blank')}
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

        {activeTab === 'videos' && videoSubTab === 'telegram' && (
          <>
            <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                  <Send className="h-4 w-4" />
                  Telegram integrity
                </div>
                <h1 className="text-3xl font-semibold tracking-tight text-base-content">Telegram video integrity</h1>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Button
                  variant="primary"
                  onClick={resolveAllTelegram}
                  className="h-10 gap-2 px-3 text-sm"
                  disabled={resolvingAllTeraBox || telegramFixTargetCount === 0}
                >
                  {resolvingAllTeraBox ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
                  {resolvingAllTeraBox ? 'Resolving...' : `Resolve all to Telegram (${telegramFixTargetCount})`}
                </Button>
                <Button variant="primary" onClick={runTelegramIntegrityCheck} className="h-10 gap-2 px-3 text-sm" disabled={telegramLoading}>
                  {telegramLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  {telegramLoading ? 'Checking...' : 'Check Telegram'}
                </Button>
                <Button variant="outline" onClick={() => navigate('/settings')} className="h-10 gap-2 px-3 text-sm">
                  <Settings className="h-4 w-4" />
                  Settings
                </Button>
              </div>
            </section>

            {telegramError && (
              <div className="rounded-[var(--radius-box)] border border-red-500/40 bg-red-500/15 px-4 py-3 text-sm text-error">{telegramError}</div>
            )}

            {notice && activeTab === 'videos' && videoSubTab === 'telegram' && (
              <div className={`rounded-[var(--radius-box)] border px-4 py-3 text-sm font-medium ${notice.type === 'error' ? 'border-red-500/40 bg-red-500/15 text-error' : 'border-green-500/40 bg-green-500/15 text-success'}`}>
                {notice.message}
              </div>
            )}

            <section className="flex flex-wrap gap-2">
              {[
                { value: 'all', label: 'All', count: telegramIntegrity.found.length + telegramIntegrity.missing.length + telegramIntegrity.noUrl.length + telegramIntegrity.extra.length, tip: 'Every telegram-touched video plus every unclaimed channel post, counted once.' },
                { value: 'missing', label: 'Broken links', count: telegramIntegrity.missing.length, tip: 'Videos whose telegram post no longer exists in the channel. The post was deleted or the id is wrong.' },
                { value: 'found', label: 'Found', count: telegramIntegrity.found.length, tip: 'Videos whose telegram post is still in the channel. Nothing to do.' },
                { value: 'noUrl', label: 'No Telegram URL', count: telegramIntegrity.noUrl.length, tip: 'Saved videos that have no Telegram link at all — they were never uploaded to Telegram.' },
                { value: 'extra', label: 'Extra on Telegram', count: telegramIntegrity.extra.length, tip: 'Media posts in the channel that no saved item references. Likely old uploads or duplicates.' },
              ].map((option) => (
                <StatChip
                  key={option.value}
                  value={option.value}
                  label={option.label}
                  count={option.count}
                  tip={option.tip}
                  active={telegramFilter === option.value}
                  onClick={() => setTelegramFilter(option.value)}
                />
              ))}
            </section>

            <section className="grid gap-3">
              {telegramLoading && (
                <div className="flex min-h-64 flex-col items-center justify-center gap-2 rounded-[var(--radius-box)] border border-base-300 bg-base-100 text-base-content/60">
                  <div className="flex items-center">
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Checking Telegram...
                  </div>
                  {telegramLoadingMessage && (
                    <div className="text-xs text-base-content/50">{telegramLoadingMessage}</div>
                  )}
                </div>
              )}

              {!telegramLoading && (() => {
                let displayItems = [];
                if (telegramFilter === 'all') {
                  displayItems = [
                    ...telegramIntegrity.missing.map((i) => ({ ...i, status: 'missing' })),
                    ...telegramIntegrity.found.map((i) => ({ ...i, status: 'found' })),
                    ...telegramIntegrity.noUrl.map((i) => ({ ...i, status: 'noUrl' })),
                    ...telegramIntegrity.extra.map((i) => ({ ...i, status: 'extra' })),
                  ];
                } else {
                  displayItems = (telegramIntegrity[telegramFilter] || []).map((i) => ({ ...i, status: telegramFilter }));
                }

                if (displayItems.length === 0) {
                  return (
                    <div className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-[var(--radius-box)] border border-base-300 bg-base-100 px-4 text-center">
                      <ShieldCheck className="h-8 w-8 text-success" />
                      <div>
                        <h2 className="text-lg font-semibold text-base-content">No items in this view</h2>
                        <p className="mt-1 text-sm text-base-content/60">
                          {telegramFilter === 'missing' ? 'Every referenced telegram post still exists in the channel.' : 'Nothing to show here.'}
                        </p>
                      </div>
                    </div>
                  );
                }

                return displayItems.map((entry) => {
                  const { messageId, codes, pageUrl, items, status } = entry;

                  if (status === 'extra') {
                    return (
                      <article key={`tg-extra-${messageId}`} className="grid gap-4 rounded-[var(--radius-box)] border border-base-300 bg-base-100 p-3 shadow-sm transition hover:border-amber-500/40 sm:grid-cols-[132px_1fr_auto]">
                        <div className="flex h-28 items-center justify-center overflow-hidden rounded-[var(--radius-box)] bg-base-200">
                          <div className="flex flex-col items-center gap-1 text-amber-500/80">
                            <AlertCircle className="h-8 w-8" />
                            <span className="text-[10px] font-semibold uppercase tracking-wider">Orphan</span>
                          </div>
                        </div>
                        <div className="min-w-0 space-y-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <h2 className="truncate text-base font-semibold text-base-content">Post #{messageId}</h2>
                              <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-warning">
                                <AlertCircle className="h-3 w-3" /> Not in DB
                              </span>
                            </div>
                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-base-content/55">
                              <span>Codes: {codes.join(', ')}</span>
                              <a href={pageUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                                Open post <ExternalLink className="h-3 w-3" />
                              </a>
                            </div>
                          </div>
                          <div className="text-xs text-base-content/70">
                            This media post exists in the channel but no saved item references it.
                          </div>
                        </div>
                        <div className="flex flex-col justify-between gap-3 sm:w-52">
                          <div className="rounded-[var(--radius-box)] border border-base-300 bg-base-200/60 px-3 py-2 text-xs text-base-content/65">
                            Message ID: {messageId}
                          </div>
                          <div className="flex flex-col gap-2">
                            <Button variant="outline" className="h-9 justify-center gap-2 text-sm" onClick={() => window.open(pageUrl, '_blank')}>
                              <ExternalLink className="h-4 w-4" />
                              Open post
                            </Button>
                            <Button
                              variant="outline"
                              className="h-9 justify-center gap-2 border-red-500/40 text-sm text-error hover:bg-red-500/10"
                              disabled={Boolean(deletingTelegramPosts[messageId])}
                              onClick={async () => {
                                if (!confirm(`Delete post #${messageId} from the Telegram channel? This cannot be undone.`)) return;
                                setDeletingTelegramPosts((prev) => ({ ...prev, [messageId]: true }));
                                try {
                                  await deleteTelegramMessage({ token: settings.telegramBotToken, channel: settings.telegramChannel, messageId });
                                  setTelegramIntegrity((prev) => ({ ...prev, extra: prev.extra.filter((e) => e.messageId !== messageId) }));
                                  setNotice({ type: 'success', message: `Deleted post #${messageId} from the channel.` });
                                } catch (err) {
                                  setNotice({ type: 'error', message: `Delete failed: ${err.message || err}` });
                                } finally {
                                  setDeletingTelegramPosts((prev) => {
                                    const next = { ...prev };
                                    delete next[messageId];
                                    return next;
                                  });
                                }
                              }}
                            >
                              {deletingTelegramPosts[messageId] ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                              {deletingTelegramPosts[messageId] ? 'Deleting...' : 'Delete'}
                            </Button>
                          </div>
                        </div>
                      </article>
                    );
                  }

                  if (status === 'noUrl') {
                    const item = entry.item || {};
                    const title = item.pageTitle || item.fileName || item.description || 'Untitled';
                    const isVideo = Boolean(item.isVideo || String(item.fileType || '').startsWith('video/'));
                    return (
                      <article
                        key={`tg-noUrl-${item.id}`}
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
                              {isVideo ? <Video className="h-4 w-4" /> : <ImageIcon className="h-4 w-4" />}
                              <span className="text-[10px] font-semibold uppercase tracking-wider">{isVideo ? 'Video' : 'Media'}</span>
                            </div>
                          )}
                        </div>

                        <div className="min-w-0 space-y-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <h2 className="truncate text-base font-semibold text-base-content">{title}</h2>
                              <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-warning">
                                <AlertCircle className="h-3 w-3" /> No Telegram URL
                              </span>
                            </div>
                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-base-content/55">
                              {item.fileName && <span className="truncate">{item.fileName}</span>}
                              {formatDate(item.createdAt || item.internalAddedTimestamp)}
                            </div>
                          </div>

                          <div className="text-xs text-base-content/70">
                            This video was never uploaded to Telegram — it has no Telegram link stored.
                          </div>
                        </div>

                        <div className="flex flex-col justify-between gap-3 sm:w-52">
                          <div className="rounded-[var(--radius-box)] border border-base-300 bg-base-200/60 px-3 py-2 text-xs text-base-content/65">
                            No Telegram URL stored
                          </div>

                          <div className="flex flex-col gap-2">
                            <Button
                              variant="primary"
                              className="h-9 justify-center gap-2 text-sm"
                              disabled={Boolean(fixingTelegram[item.id])}
                              onClick={() => startVideoFix(item, 'telegram', 'Telegram', runTelegramIntegrityCheck)}
                            >
                              {fixingTelegram[item.id] ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
                              {fixingTelegram[item.id] ? 'Fixing...' : 'Fix'}
                            </Button>
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
                  }

                  const isBroken = status === 'missing';
                  return (
                    <article key={`tg-${status}-${messageId}`} className={`rounded-[var(--radius-box)] border bg-base-100 p-3 shadow-sm ${isBroken ? 'border-red-500/40' : 'border-base-300'}`}>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-base font-semibold text-base-content">Post #{messageId}</h2>
                        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${isBroken ? 'border-red-500/40 bg-red-500/15 text-error' : 'border-green-500/40 bg-green-500/15 text-success'}`}>
                          {isBroken ? <ShieldAlert className="h-3 w-3" /> : <ShieldCheck className="h-3 w-3" />}
                          {isBroken ? 'Broken link' : 'Found'}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-base-content/55">
                        <span>Codes: {codes.join(', ')}</span>
                        <a href={pageUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                          Open post <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                      {items && items.length > 0 && (
                        <div className="mt-2 space-y-2 text-xs text-base-content/70">
                          {items.map((it) => {
                            const referencedLabel = it.pageTitle || it.fileName || it.title || it.file_name || it.id;
                            if (!isBroken) {
                              return <div key={it.id}>Referenced by: {referencedLabel}</div>;
                            }
                            return (
                              <div key={it.id} className="space-y-1.5 rounded-[var(--radius-box)] border border-base-300 bg-base-200/40 px-2 py-1.5">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <span>Referenced by: {referencedLabel}</span>
                                  <Button
                                    variant="outline"
                                    className="h-7 gap-1.5 px-2 text-xs"
                                    disabled={Boolean(fixingTelegram[it.id])}
                                    onClick={() => startVideoFix(it, 'telegram', 'Telegram', runTelegramIntegrityCheck)}
                                  >
                                    {fixingTelegram[it.id] ? <Loader2 className="h-3 w-3 animate-spin" /> : <UploadCloud className="h-3 w-3" />}
                                    {fixingTelegram[it.id] ? 'Fixing...' : 'Fix'}
                                  </Button>
                                </div>
                                {fixProgress[it.id] && (
                                  <div className="flex flex-col gap-1">
                                    <div className="text-[11px] leading-tight text-base-content/60">
                                      {fixProgress[it.id].message || 'Working...'}
                                    </div>
                                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-base-300">
                                      <div
                                        className="h-full rounded-full bg-gradient-to-r from-primary-500 to-secondary-500 transition-all duration-300"
                                        style={{ width: `${Math.max(4, fixProgress[it.id].percent ?? 100)}%` }}
                                      />
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                      {isBroken && (
                        <div className="mt-2 text-xs text-error">
                          No media post with this message id exists in the channel — the post was deleted or the id is wrong.
                        </div>
                      )}
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
