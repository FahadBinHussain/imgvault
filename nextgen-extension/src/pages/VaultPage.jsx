/**
 * @fileoverview Secret Vault Page
 * @version 2.0.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  EyeOff,
  LockKeyhole,
  UnlockKeyhole,
  RotateCcw,
  Link2,
  Image as ImageIcon,
  Video,
} from 'lucide-react';
import { Button, Spinner, Toast, Modal } from '../components/UI';
import GalleryNavbar from '../components/GalleryNavbar';
import PremiumBackground from '../components/PremiumBackground';
import { useChromeMessage, useTrash, useCollections } from '../hooks/useChromeExtension';

const VAULT_CONFIG_KEY = 'secretVaultConfig';
const VAULT_SESSION_KEY = 'imgvault-vault-unlocked';

const bytesToHex = (bytes) =>
  Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');

const makeSalt = () => {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
};

const hashVaultPasscode = async (passcode, salt) => {
  const data = new TextEncoder().encode(`${salt}:${passcode}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return bytesToHex(new Uint8Array(digest));
};

const isHttpUrl = (value) => typeof value === 'string' && /^https?:\/\//i.test(value.trim());

const isTruthyFlag = (value) =>
  value === true ||
  value === 1 ||
  value === '1' ||
  (typeof value === 'string' && value.trim().toLowerCase() === 'true');

const getLocalVaultConfig = () => new Promise((resolve) => {
  chrome.storage.local.get([VAULT_CONFIG_KEY], (result) => {
    resolve(result[VAULT_CONFIG_KEY] || null);
  });
});

const saveLocalVaultConfig = (config) => chrome.storage.local.set({ [VAULT_CONFIG_KEY]: config });

export default function VaultPage() {
  const navigate = useNavigate();
  const sendMessage = useChromeMessage();
  const { trashedImages, loading: trashLoading } = useTrash();
  const { collections, loading: collectionsLoading } = useCollections();
  const [navbarHeight, setNavbarHeight] = useState(0);
  const [vaultConfig, setVaultConfig] = useState(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [unlocked, setUnlocked] = useState(false);
  const [passcode, setPasscode] = useState('');
  const [confirmPasscode, setConfirmPasscode] = useState('');
  const [authError, setAuthError] = useState('');
  const [vaultItems, setVaultItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedItem, setSelectedItem] = useState(null);
  const [activeTab, setActiveTab] = useState('noobs');
  const [isModalAnimating, setIsModalAnimating] = useState(false);
  const [loadedImages, setLoadedImages] = useState(new Set());
  const [toast, setToast] = useState(null);
  const [restoringId, setRestoringId] = useState('');

  const showToast = (message, type = 'info', duration = 3000) => {
    setToast({ message, type });
    if (duration > 0) {
      setTimeout(() => setToast(null), duration);
    }
  };

  const loadVaultItems = async () => {
    if (!unlocked) return;
    setLoading(true);
    try {
      const items = await sendMessage('getVaultImages');
      setVaultItems(items || []);
    } catch (error) {
      showToast(`Failed to load Secret Vault: ${error.message || String(error)}`, 'error', 5000);
      setVaultItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const loadVaultConfig = async () => {
      setConfigLoading(true);
      const localConfig = await getLocalVaultConfig();
      let remoteConfig = null;

      try {
        remoteConfig = await sendMessage('getVaultConfig');
      } catch (error) {
        console.warn('Could not load synced vault config:', error);
      }

      const config = remoteConfig || localConfig || null;

      if (remoteConfig && localConfig?.passHash !== remoteConfig.passHash) {
        await saveLocalVaultConfig(remoteConfig);
      } else if (!remoteConfig && localConfig) {
        try {
          await sendMessage('saveVaultConfig', { config: localConfig });
        } catch (error) {
          console.warn('Could not migrate local vault config to backend:', error);
        }
      }

      if (!cancelled) {
        setVaultConfig(config);
      }

      if (config && !cancelled) {
        try {
          const session = JSON.parse(sessionStorage.getItem(VAULT_SESSION_KEY) || '{}');
          setUnlocked(session?.passHash === config.passHash);
        } catch (_) {
          setUnlocked(false);
        }
      }

      if (!cancelled) {
        setConfigLoading(false);
      }
    };

    loadVaultConfig();

    return () => {
      cancelled = true;
    };
  }, [sendMessage]);

  useEffect(() => {
    loadVaultItems();
  }, [unlocked]);

  const filteredItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return vaultItems;
    return vaultItems.filter((item) => (
      item.pageTitle?.toLowerCase().includes(query) ||
      item.description?.toLowerCase().includes(query) ||
      item.fileName?.toLowerCase().includes(query) ||
      item.sourcePageUrl?.toLowerCase().includes(query) ||
      item.linkUrl?.toLowerCase().includes(query) ||
      item.tags?.some((tag) => String(tag).toLowerCase().includes(query))
    ));
  }, [searchQuery, vaultItems]);

  const isLinkItem = (item) => isTruthyFlag(item?.isLink);

  const isVideoItem = (item) => (
    isTruthyFlag(item?.isVideo) ||
    String(item?.fileType || '').startsWith('video/') ||
    isHttpUrl(item?.filemoonWatchUrl) ||
    isHttpUrl(item?.udropWatchUrl) ||
    isHttpUrl(item?.filemoonDirectUrl) ||
    isHttpUrl(item?.udropDirectUrl)
  );

  const getPreviewUrl = (item) => (
    item?.linkPreviewImageUrl ||
    item?.imgbbThumbUrl ||
    item?.imgbbUrl ||
    item?.pixvidUrl ||
    item?.sourceImageUrl ||
    ''
  );

  const getVideoDirectUrl = (item) => (
    item?.udropDirectUrl ||
    item?.filemoonDirectUrl ||
    ''
  );

  const getVideoWatchUrl = (item) => (
    item?.filemoonWatchUrl ||
    item?.udropWatchUrl ||
    getVideoDirectUrl(item) ||
    ''
  );

  const getLinkPreviewImage = (item) => (
    item?.linkPreviewImageUrl ||
    item?.previewImageUrl ||
    item?.ogImage ||
    item?.thumbnailUrl ||
    item?.faviconUrl ||
    ''
  );

  const getKind = (item) => {
    if (isLinkItem(item)) return 'Link';
    if (isVideoItem(item)) return 'Video';
    return 'Image';
  };

  const closeItemModal = () => {
    setSelectedItem(null);
    setActiveTab('noobs');
  };

  const openItemModal = (item) => {
    setIsModalAnimating(true);
    setSelectedItem(item);
    setActiveTab('noobs');
    setTimeout(() => setIsModalAnimating(false), 300);
  };

  const handleMediaLoad = (id) => {
    setLoadedImages((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  };

  const groupItemsByDate = (items) => {
    const groups = {};
    items.forEach((item) => {
      const rawDate = item.vaultedAt || item.internalAddedTimestamp || item.creationDate || item.createdAt;
      const date = rawDate ? new Date(rawDate) : new Date();
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      let dateKey;
      if (date.toDateString() === today.toDateString()) {
        dateKey = 'Today';
      } else if (date.toDateString() === yesterday.toDateString()) {
        dateKey = 'Yesterday';
      } else {
        dateKey = date.toLocaleDateString();
      }

      if (!groups[dateKey]) groups[dateKey] = [];
      groups[dateKey].push(item);
    });
    return groups;
  };

  const groupedItems = useMemo(() => groupItemsByDate(filteredItems), [filteredItems]);

  const formatDetailValue = (value) => {
    if (value === null || value === undefined || value === '') return 'N/A';
    if (Array.isArray(value)) return value.length ? value.join(', ') : '[]';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  };

  const overviewKeys = useMemo(() => {
    if (!selectedItem) return [];
    const linkKeys = ['linkUrl', 'pageTitle', 'description', 'tags', 'collectionId', 'internalAddedTimestamp', 'faviconUrl', 'lastVisitedAt', 'isLink', 'linkPreviewImageUrl', 'vaultedAt'];
    const mediaKeys = [
      'sourceImageUrl',
      'sourcePageUrl',
      'pageTitle',
      'fileName',
      'fileSize',
      'fileType',
      'description',
      'tags',
      'collectionId',
      'creationDate',
      'internalAddedTimestamp',
      'isVideo',
      'filemoonWatchUrl',
      'filemoonDirectUrl',
      'udropWatchUrl',
      'udropDirectUrl',
      'vaultedAt',
    ];
    const keys = isLinkItem(selectedItem) ? linkKeys : mediaKeys;
    return keys.filter((key) => Object.prototype.hasOwnProperty.call(selectedItem, key));
  }, [selectedItem]);

  const technicalEntries = useMemo(() => {
    if (!selectedItem) return [];
    const baseKeys = new Set(['id', ...overviewKeys]);
    return Object.entries(selectedItem).filter(([key, value]) => (
      !baseKeys.has(key) &&
      value !== undefined &&
      value !== null &&
      value !== ''
    ));
  }, [overviewKeys, selectedItem]);

  const createVault = async (event) => {
    event.preventDefault();
    setAuthError('');

    if (passcode.length < 4) {
      setAuthError('Use at least 4 characters.');
      return;
    }
    if (passcode !== confirmPasscode) {
      setAuthError('Passcodes do not match.');
      return;
    }

    const salt = makeSalt();
    const passHash = await hashVaultPasscode(passcode, salt);
    const config = {
      salt,
      passHash,
      createdAt: new Date().toISOString(),
      mode: 'hidden',
    };

    await saveLocalVaultConfig(config);
    try {
      await sendMessage('saveVaultConfig', { config });
    } catch (error) {
      console.warn('Could not sync vault config to backend:', error);
      showToast('Vault created locally, but backend sync failed. Check your database settings.', 'warning', 6000);
    }
    sessionStorage.setItem(VAULT_SESSION_KEY, JSON.stringify({ passHash, unlockedAt: Date.now() }));
    setVaultConfig(config);
    setUnlocked(true);
    setPasscode('');
    setConfirmPasscode('');
  };

  const unlockVault = async (event) => {
    event.preventDefault();
    setAuthError('');

    if (!vaultConfig) return;
    const passHash = await hashVaultPasscode(passcode, vaultConfig.salt);
    if (passHash !== vaultConfig.passHash) {
      setAuthError('Wrong passcode.');
      return;
    }

    sessionStorage.setItem(VAULT_SESSION_KEY, JSON.stringify({ passHash, unlockedAt: Date.now() }));
    setUnlocked(true);
    setPasscode('');
  };

  const lockVault = () => {
    sessionStorage.removeItem(VAULT_SESSION_KEY);
    setUnlocked(false);
    setSelectedItem(null);
    setVaultItems([]);
  };

  const restoreItem = async (item) => {
    if (!item?.id || restoringId) return;
    setRestoringId(item.id);
    try {
      await sendMessage('restoreFromVault', { id: item.id });
      setVaultItems((prev) => prev.filter((entry) => entry.id !== item.id));
      setSelectedItem(null);
      showToast('Restored to Gallery.', 'success', 3000);
    } catch (error) {
      showToast(`Restore failed: ${error.message || String(error)}`, 'error', 5000);
    } finally {
      setRestoringId('');
    }
  };

  const renderLockedState = () => (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col justify-center px-4">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-[var(--radius-box)] border border-base-300 bg-base-100 p-6 shadow-xl"
      >
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-[var(--radius-box)] bg-primary/10 text-primary">
            <LockKeyhole className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-base-content">
              {vaultConfig ? 'Unlock Secret Vault' : 'Create Secret Vault'}
            </h1>
            <p className="text-sm text-base-content/60">
              Hidden items stay out of the normal gallery until unlocked. The vault passcode check syncs through your configured backend.
            </p>
          </div>
        </div>

        <form onSubmit={vaultConfig ? unlockVault : createVault} className="space-y-4">
          <input
            type="password"
            value={passcode}
            onChange={(event) => setPasscode(event.target.value)}
            placeholder={vaultConfig ? 'Vault passcode' : 'Create passcode'}
            className="w-full rounded-[var(--radius-box)] border border-base-300 bg-base-200 px-4 py-3 text-base-content outline-none focus:border-primary"
            autoFocus
          />
          {!vaultConfig && (
            <input
              type="password"
              value={confirmPasscode}
              onChange={(event) => setConfirmPasscode(event.target.value)}
              placeholder="Confirm passcode"
              className="w-full rounded-[var(--radius-box)] border border-base-300 bg-base-200 px-4 py-3 text-base-content outline-none focus:border-primary"
            />
          )}
          {authError && (
            <p className="rounded-[var(--radius-box)] border border-error/20 bg-error/10 px-3 py-2 text-sm text-error">
              {authError}
            </p>
          )}
          <Button type="submit" className="w-full">
            {vaultConfig ? (
              <>
                <UnlockKeyhole className="mr-2 h-4 w-4" />
                Unlock Vault
              </>
            ) : (
              <>
                <LockKeyhole className="mr-2 h-4 w-4" />
                Create Vault
              </>
            )}
          </Button>
        </form>

        <p className="mt-4 text-xs leading-5 text-base-content/50">
          Phase 1 hides items from the regular UI. It does not encrypt hosted files or database fields yet.
        </p>
      </motion.div>
    </div>
  );

  const vaultGalleryCSS = `
    .g-page{font-family:'Outfit',system-ui,sans-serif;position:relative}
    .g-grid-bg{position:fixed;inset:0;pointer-events:none;background-image:radial-gradient(circle,oklch(from var(--color-base-content) l c h / 0.025) 1px,transparent 1px);background-size:28px 28px;z-index:0}
    .g-orb{position:fixed;border-radius:50%;filter:blur(90px);pointer-events:none;will-change:transform;z-index:0}
    .g-orb-a{width:480px;height:480px;background:oklch(from var(--color-primary) l c h / 0.06);top:-10%;right:-6%;animation:g-drift-a 26s ease-in-out infinite}
    .g-orb-b{width:380px;height:380px;background:oklch(from var(--color-secondary) l c h / 0.05);bottom:-12%;left:-5%;animation:g-drift-b 32s ease-in-out infinite}
    @keyframes g-drift-a{0%,100%{transform:translate(0,0) scale(1)}25%{transform:translate(-40px,30px) scale(1.04)}50%{transform:translate(20px,-45px) scale(.96)}75%{transform:translate(30px,20px) scale(1.02)}}
    @keyframes g-drift-b{0%,100%{transform:translate(0,0) scale(1)}25%{transform:translate(35px,-25px) scale(1.03)}50%{transform:translate(-25px,40px) scale(.97)}75%{transform:translate(-35px,-10px) scale(1.01)}}
    .g-card{position:relative;background:oklch(from var(--color-base-100) l c h / 0.5);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border:1px solid oklch(from var(--color-base-content) l c h / 0.06);border-radius:12px;overflow:hidden;transition:all .3s ease}
    .g-card:hover{border-color:oklch(from var(--color-base-content) l c h / 0.1);box-shadow:0 8px 32px oklch(from var(--color-base-content) l c h / 0.06)}
    .g-date{display:flex;align-items:center;gap:10px;margin-bottom:20px}
    .g-date-line{width:3px;height:20px;border-radius:2px;background:linear-gradient(180deg,var(--color-primary),var(--color-secondary))}
    .g-date-text{font-size:16px;font-weight:600;color:oklch(from var(--color-base-content) l c h / 0.7);letter-spacing:-.01em}
    .g-modal-close{position:sticky;top:16px;z-index:80;width:40px;height:40px;margin:16px 16px -56px auto;border-radius:10px;background:oklch(from var(--color-error) l c h / 0.1);border:1px solid oklch(from var(--color-error) l c h / 0.2);display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .2s ease;color:var(--color-error)}
    .g-modal-close:hover{background:oklch(from var(--color-error) l c h / 0.18);border-color:oklch(from var(--color-error) l c h / 0.35);transform:scale(1.08) rotate(90deg)}
    .g-tab{padding:8px 16px;font-size:13px;font-weight:600;font-family:'Outfit',system-ui,sans-serif;cursor:pointer;transition:all .15s ease;border:none;background:none;border-bottom:2px solid transparent;color:oklch(from var(--color-base-content) l c h / 0.4)}
    .g-tab:hover{color:oklch(from var(--color-base-content) l c h / 0.7)}
    .g-tab-on{color:var(--color-primary)!important;border-bottom-color:var(--color-primary)!important}
    .g-tab-succ{color:var(--color-success)!important;border-bottom-color:var(--color-success)!important}
    .g-field{padding:8px 10px;border-radius:8px;background:oklch(from var(--color-base-100) l c h / 0.4);border:1px solid oklch(from var(--color-base-content) l c h / 0.04)}
    .g-action{display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:7px;font-size:11px;font-weight:500;font-family:'Outfit',system-ui,sans-serif;cursor:pointer;transition:all .15s ease;border:1px solid oklch(from var(--color-base-content) l c h / 0.08);background:oklch(from var(--color-base-content) l c h / 0.03);color:oklch(from var(--color-base-content) l c h / 0.6)}
    .g-action:hover{color:var(--color-primary);border-color:oklch(from var(--color-primary) l c h / 0.2);background:oklch(from var(--color-primary) l c h / 0.05)}
    .g-action-warn{color:var(--color-warning);background:oklch(from var(--color-warning) l c h / 0.07);border-color:oklch(from var(--color-warning) l c h / 0.12)}
    .g-action-warn:hover{background:oklch(from var(--color-warning) l c h / 0.12);border-color:oklch(from var(--color-warning) l c h / 0.2)}
    .g-action-prim{color:var(--color-primary-content);background:linear-gradient(135deg,var(--color-primary),var(--color-secondary));border:none;box-shadow:0 2px 10px oklch(from var(--color-primary) l c h / 0.2)}
    .g-action-prim:hover{filter:brightness(1.1);transform:translateY(-1px)}
  `;

  return (
    <div className="min-h-screen bg-base-200 text-base-content g-page">
      <style>{vaultGalleryCSS}</style>
      <PremiumBackground />
      <div className="g-grid-bg" />
      <div className="g-orb g-orb-a" />
      <div className="g-orb g-orb-b" />
      <GalleryNavbar
        navigate={navigate}
        images={vaultItems}
        filteredImages={filteredItems}
        displayCount={filteredItems.length}
        reload={loadVaultItems}
        collections={collections}
        collectionsLoading={collectionsLoading}
        trashedImages={trashedImages}
        trashLoading={trashLoading}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        selectedImages={new Set()}
        selectAll={() => {}}
        deselectAll={() => {}}
        toggleSelectionMode={() => {}}
        selectionMode={false}
        setShowBulkDeleteConfirm={() => {}}
        openUploadModal={() => navigate('/gallery')}
        isDeleting={false}
        onHeightChange={setNavbarHeight}
        isVaultPage
      />
      <div style={{ height: navbarHeight ? `${navbarHeight + 8}px` : '90px' }} />

      {configLoading ? (
        <div className="flex min-h-[50vh] items-center justify-center">
          <Spinner size="lg" />
        </div>
      ) : !unlocked ? (
        renderLockedState()
      ) : (
        <main className="relative z-10 px-4 sm:px-6 pb-24">
          {loading ? (
            <div className="flex min-h-[40vh] items-center justify-center">
              <Spinner size="lg" />
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="rounded-[var(--radius-box)] border border-base-300 bg-base-100 p-12 text-center">
              <EyeOff className="mx-auto mb-4 h-12 w-12 text-base-content/30" />
              <h2 className="text-xl font-bold">Nothing hidden yet</h2>
              <p className="mt-2 text-base-content/60">
                Move items into the vault from a gallery detail modal or selected bulk actions.
              </p>
            </div>
          ) : (
            Object.keys(groupedItems).map((date) => (
              <div key={date} className="mb-10 relative z-10">
                <div className="g-date">
                  <span className="g-date-line" />
                  <span className="g-date-text">{date}</span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
                  {groupedItems[date].map((item, index) => {
                    const kind = getKind(item);
                    const linkPreviewImage = getLinkPreviewImage(item);
                    const videoWatchUrl = getVideoWatchUrl(item);
                    const videoDirectUrl = getVideoDirectUrl(item);
                    const imageUrl = getPreviewUrl(item);

                    return (
                      <motion.div
                        key={item.id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{
                          duration: 0.3,
                          delay: Math.min(index * 0.02, 1.0),
                          ease: 'easeOut',
                        }}
                        whileHover={{ scale: 1.02, y: -2 }}
                        className="group relative cursor-pointer"
                        onClick={() => openItemModal(item)}
                      >
                        <div
                          className="absolute -inset-1 rounded-2xl opacity-0 group-hover:opacity-100 blur-xl transition-all duration-500"
                          style={{ background: 'linear-gradient(135deg, oklch(from var(--color-primary) l c h / 0.2), oklch(from var(--color-secondary) l c h / 0.15))' }}
                        />

                        <div className="g-card">
                          {!loadedImages.has(item.id) && kind === 'Image' && (
                            <div className="absolute inset-0 overflow-hidden" style={{ background: 'var(--color-base-300)' }}>
                              <div className="absolute inset-0 shimmer" />
                            </div>
                          )}

                          {kind === 'Link' ? (
                            <div className="relative w-full aspect-video" style={{ background: 'var(--color-base-200)' }}>
                              {linkPreviewImage ? (
                                <img src={linkPreviewImage} alt={item.pageTitle || 'Link preview'} className="w-full h-full object-cover" loading="lazy" onLoad={() => handleMediaLoad(item.id)} />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center" style={{ color: 'oklch(from var(--color-base-content) l c h / 0.3)' }}>
                                  <Link2 style={{ width: 32, height: 32 }} />
                                </div>
                              )}
                            </div>
                          ) : kind === 'Video' && videoWatchUrl ? (
                            videoDirectUrl ? (
                              <video src={videoDirectUrl} className="w-full aspect-video object-cover pointer-events-none" muted playsInline preload="metadata" onLoadedData={() => handleMediaLoad(item.id)} />
                            ) : (
                              <iframe src={videoWatchUrl} className="w-full aspect-video object-cover pointer-events-none" frameBorder="0" scrolling="no" style={{ pointerEvents: 'none' }} onLoad={() => handleMediaLoad(item.id)} />
                            )
                          ) : imageUrl ? (
                            <img
                              src={imageUrl}
                              alt={item.pageTitle || item.fileName || 'Vault item'}
                              onLoad={() => handleMediaLoad(item.id)}
                              className={`w-full object-cover transition-all duration-500 ease-out group-hover:scale-110 ${loadedImages.has(item.id) ? 'opacity-100' : 'opacity-0'}`}
                              loading="lazy"
                            />
                          ) : (
                            <div className="w-full aspect-video flex items-center justify-center" style={{ background: 'var(--color-base-200)', color: 'oklch(from var(--color-base-content) l c h / 0.3)' }}>
                              {kind === 'Video' ? <Video style={{ width: 32, height: 32 }} /> : <ImageIcon style={{ width: 32, height: 32 }} />}
                            </div>
                          )}

                          {kind === 'Video' && videoWatchUrl && (
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                              <div style={{ background: 'oklch(from var(--color-base-100) l c h / 0.7)', backdropFilter: 'blur(8px)', borderRadius: '50%', padding: 12 }}>
                                <svg width="36" height="36" viewBox="0 0 24 24" fill="oklch(from var(--color-base-content) l c h / 0.7)"><path d="M8 5v14l11-7z"/></svg>
                              </div>
                            </div>
                          )}

                          <div className="absolute top-2 left-2 z-20 rounded-md px-2 py-1 text-[10px] font-semibold uppercase tracking-wide" style={{ background: 'oklch(from var(--color-base-100) l c h / 0.78)', color: 'var(--color-primary)', backdropFilter: 'blur(8px)' }}>
                            {kind}
                          </div>

                          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent opacity-0 group-hover:opacity-100 transition-all duration-400">
                            <div className="absolute bottom-0 left-0 right-0 p-3 space-y-1.5 transform translate-y-2 group-hover:translate-y-0 transition-transform duration-400">
                              <p className="text-white text-xs font-semibold truncate" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.4)' }}>
                                {item.pageTitle || item.fileName || item.linkUrl || 'Untitled'}
                              </p>
                              {item.tags && item.tags.length > 0 && (
                                <div className="flex gap-1 flex-wrap">
                                  {item.tags.slice(0, 2).map((tag) => (
                                    <span
                                      key={tag}
                                      className="text-[10px] px-2 py-0.5 rounded-md font-medium"
                                      style={{ background: 'hsl(0 0% 100% / 0.15)', backdropFilter: 'blur(8px)', color: 'rgba(255,255,255,0.85)', border: '1px solid rgba(255,255,255,0.1)' }}
                                    >
                                      {tag}
                                    </span>
                                  ))}
                                  {item.tags.length > 2 && (
                                    <span
                                      className="text-[10px] px-2 py-0.5 rounded-md font-medium"
                                      style={{ background: 'hsl(0 0% 100% / 0.15)', backdropFilter: 'blur(8px)', color: 'rgba(255,255,255,0.85)', border: '1px solid rgba(255,255,255,0.1)' }}
                                    >
                                      +{item.tags.length - 2}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            ))
          )}

          <button
            type="button"
            onClick={lockVault}
            className="g-action g-action-warn fixed bottom-6 right-6 z-50"
            style={{ height: 40, padding: '0 16px', boxShadow: '0 10px 30px oklch(from var(--color-base-content) l c h / 0.12)' }}
          >
            <LockKeyhole className="h-4 w-4" />
            Lock Vault
          </button>
        </main>
      )}

      <Modal
        isOpen={!!selectedItem}
        onClose={closeItemModal}
        className="!max-w-[95vw] !w-full !h-[95vh] !p-0 !overflow-hidden"
      >
        {selectedItem && (
          <div className={`flex flex-col lg:flex-row h-full relative transition-all duration-500 ease-out ${isModalAnimating ? 'opacity-0 scale-95' : 'opacity-100 scale-100'}`}>
            <div className={`absolute inset-0 bg-base-300/90 transition-opacity duration-500 ${isModalAnimating ? 'opacity-0' : 'opacity-100'}`} />

            <div className="flex-1 min-h-[35vh] lg:min-h-0 flex items-center justify-center bg-gradient-to-br from-base-300 to-base-200 p-3 sm:p-6 lg:p-8 relative z-10">
              <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4/5 h-4/5 bg-primary/10 rounded-full blur-3xl transition-all duration-700 ease-out ${isModalAnimating ? 'opacity-0 scale-50' : 'opacity-100 scale-100'}`} />

              {isLinkItem(selectedItem) ? (
                <div className={`w-full h-full rounded-[var(--radius-box)] shadow-2xl relative z-10 overflow-hidden border border-base-300 bg-base-100 transition-all duration-700 ease-out ${isModalAnimating ? 'opacity-0 scale-50' : 'opacity-100 scale-100'}`}>
                  <div className="h-full p-4 sm:p-6">
                    <div className="h-full rounded-[var(--radius-box)] border border-base-300 bg-base-100 overflow-hidden">
                      <div className="h-full flex flex-col md:flex-row">
                        <div className="flex-1 p-4 sm:p-6 flex flex-col justify-between min-w-0">
                          <div className="space-y-3">
                            <div className="flex items-center gap-2 text-base-content/70">
                              <Link2 className="w-4 h-4" />
                              <span className="text-xs font-semibold uppercase tracking-wide">Saved Link</span>
                            </div>
                            <h3 className="text-xl font-bold text-base-content leading-snug">
                              {selectedItem.pageTitle || 'Untitled Link'}
                            </h3>
                            <p className="text-base-content/70 text-sm leading-relaxed whitespace-pre-wrap">
                              {selectedItem.description || 'Saved page bookmark'}
                            </p>
                          </div>
                          <a href={selectedItem.linkUrl || selectedItem.sourcePageUrl || '#'} target="_blank" rel="noopener noreferrer" className="text-info text-sm break-all hover:underline mt-4">
                            {selectedItem.linkUrl || selectedItem.sourcePageUrl || 'N/A'}
                          </a>
                        </div>
                        <div className="md:w-[42%] lg:w-[40%] h-48 md:h-auto bg-base-200 border-t md:border-t-0 md:border-l border-base-300">
                          {getLinkPreviewImage(selectedItem) ? (
                            <img src={getLinkPreviewImage(selectedItem)} alt={selectedItem.pageTitle || 'Link preview'} className="w-full h-full object-contain" loading="lazy" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-base-content/45">
                              <Link2 className="w-12 h-12" />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : getKind(selectedItem) === 'Video' && getVideoDirectUrl(selectedItem) ? (
                <video
                  src={getVideoDirectUrl(selectedItem)}
                  className={`w-full h-full rounded-[var(--radius-box)] shadow-2xl relative z-10 bg-black object-contain transition-all duration-700 ease-out ${isModalAnimating ? 'opacity-0 scale-50' : 'opacity-100 scale-100'}`}
                  controls
                  preload="metadata"
                  playsInline
                />
              ) : getKind(selectedItem) === 'Video' && getVideoWatchUrl(selectedItem) ? (
                <iframe
                  src={getVideoWatchUrl(selectedItem)}
                  className={`w-full h-full rounded-[var(--radius-box)] shadow-2xl relative z-10 transition-all duration-700 ease-out ${isModalAnimating ? 'opacity-0 scale-50' : 'opacity-100 scale-100'}`}
                  frameBorder="0"
                  allowFullScreen
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  title={selectedItem.pageTitle || 'Vault video'}
                />
              ) : getPreviewUrl(selectedItem) ? (
                <img
                  src={getPreviewUrl(selectedItem)}
                  alt={selectedItem.pageTitle || selectedItem.fileName || 'Vault item'}
                  className={`max-w-full max-h-full object-contain rounded-[var(--radius-box)] shadow-2xl relative z-10 transition-all duration-700 ease-out hover:scale-[1.02] hover:shadow-primary/30 ${isModalAnimating ? 'opacity-0 scale-50' : 'opacity-100 scale-100'}`}
                />
              ) : (
                <div className={`w-full h-full rounded-[var(--radius-box)] shadow-2xl relative z-10 flex items-center justify-center bg-base-200 transition-all duration-700 ease-out ${isModalAnimating ? 'opacity-0 scale-50' : 'opacity-100 scale-100'}`}>
                  <ImageIcon className="h-16 w-16 text-base-content/30" />
                </div>
              )}
            </div>

            <div
              className={`w-full lg:w-[550px] lg:flex-shrink-0 overflow-y-auto flex flex-col relative z-10 transition-all duration-500 ease-out ${isModalAnimating ? 'translate-y-8 opacity-0' : 'translate-y-0 opacity-100'}`}
              style={{
                scrollbarWidth: 'thin',
                scrollbarColor: 'oklch(from var(--color-base-content) l c h / 0.06) transparent',
                background: 'oklch(from var(--color-base-100) l c h / 0.8)',
                backdropFilter: 'blur(24px)',
                borderLeft: '1px solid oklch(from var(--color-base-content) l c h / 0.06)',
                fontFamily: "'Outfit', system-ui, sans-serif",
              }}
            >
              <button onClick={closeItemModal} className={`g-modal-close ${isModalAnimating ? 'opacity-0' : 'opacity-100'}`} title="Close">
                <span style={{ fontSize: 16, fontWeight: 700 }}>x</span>
              </button>

              <div className="p-6 flex-1 pt-16">
                <h2 className="text-2xl font-bold text-base-content mb-4">Details</h2>

                <div className="flex items-center justify-between gap-3 mb-4" style={{ borderBottom: '1px solid oklch(from var(--color-base-content) l c h / 0.06)' }}>
                  {!isLinkItem(selectedItem) && (
                    <div className="flex gap-1 overflow-x-auto whitespace-nowrap">
                      <button onClick={() => setActiveTab('noobs')} className={`g-tab ${activeTab === 'noobs' ? 'g-tab-on' : ''}`}>
                        <span>Overview</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-md ml-1.5" style={{ background: activeTab === 'noobs' ? 'oklch(from var(--color-primary) l c h / 0.1)' : 'oklch(from var(--color-base-content) l c h / 0.05)', color: activeTab === 'noobs' ? 'var(--color-primary)' : 'oklch(from var(--color-base-content) l c h / 0.4)' }}>
                          {overviewKeys.length}
                        </span>
                      </button>
                      <button onClick={() => setActiveTab('nerds')} className={`g-tab ${activeTab === 'nerds' ? 'g-tab-succ' : ''}`}>
                        <span>Technical</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-md ml-1.5" style={{ background: activeTab === 'nerds' ? 'oklch(from var(--color-success) l c h / 0.1)' : 'oklch(from var(--color-base-content) l c h / 0.05)', color: activeTab === 'nerds' ? 'var(--color-success)' : 'oklch(from var(--color-base-content) l c h / 0.4)' }}>
                          {technicalEntries.length}
                        </span>
                      </button>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <button onClick={() => restoreItem(selectedItem)} disabled={restoringId === selectedItem.id} className="g-action g-action-prim" style={{ height: 32, padding: '0 14px' }}>
                      <RotateCcw style={{ width: 13, height: 13 }} />
                      <span>{restoringId === selectedItem.id ? 'Restoring...' : 'Restore'}</span>
                    </button>
                    <button onClick={lockVault} className="g-action g-action-warn" style={{ height: 32, padding: '0 14px' }}>
                      <LockKeyhole style={{ width: 13, height: 13 }} />
                      <span>Lock</span>
                    </button>
                  </div>
                </div>

                {(activeTab === 'noobs' || isLinkItem(selectedItem)) && (
                  <div className="space-y-4">
                    <div>
                      <div className="text-[11px] font-semibold mb-1 flex items-center gap-2" style={{ color: 'oklch(from var(--color-base-content) l c h / 0.45)' }}>
                        <span className="font-mono">firestoreDocumentId</span>
                      </div>
                      <div className="g-field">
                        <p className="text-base-content font-mono text-sm break-all">{formatDetailValue(selectedItem.id)}</p>
                      </div>
                    </div>
                    {overviewKeys.map((key, index) => (
                      <div key={key}>
                        <div className="text-[11px] font-semibold mb-1 flex items-center gap-2" style={{ color: 'oklch(from var(--color-base-content) l c h / 0.45)' }}>
                          <span style={{ color: 'var(--color-primary)', fontWeight: 700 }}>{index + 1}.</span>
                          <span className="font-mono">{key}</span>
                        </div>
                        <div className="g-field">
                          <p className={`text-base-content font-mono text-sm ${key === 'description' ? 'whitespace-pre-wrap break-words' : 'break-all'}`}>
                            {formatDetailValue(selectedItem[key])}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {activeTab === 'nerds' && !isLinkItem(selectedItem) && (
                  <div className="space-y-4">
                    {technicalEntries.length === 0 ? (
                      <div className="g-field text-sm text-base-content/60">No extra technical fields on this vault item.</div>
                    ) : technicalEntries.map(([key, value], index) => (
                      <div key={key}>
                        <div className="text-[11px] font-semibold mb-1 flex items-center gap-2" style={{ color: 'oklch(from var(--color-base-content) l c h / 0.45)' }}>
                          <span style={{ color: 'var(--color-success)', fontWeight: 700 }}>{index + 1}.</span>
                          <span className="font-mono">{key}</span>
                        </div>
                        <div className="g-field">
                          <p className="text-base-content font-mono text-sm break-all">{formatDetailValue(value)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </Modal>

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}
