/**
 * @fileoverview Secret Vault Page
 * @version 2.0.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  EyeOff,
  KeyRound,
  LockKeyhole,
  UnlockKeyhole,
  RotateCcw,
  Link2,
  Image as ImageIcon,
  Video,
  Trash2,
} from 'lucide-react';
import { Button, Spinner, Toast, Modal } from '../components/UI';
import GalleryNavbar from '../components/GalleryNavbar';
import PremiumBackground from '../components/PremiumBackground';
import { useChromeMessage, useTrash, useCollections, useChromeStorage } from '../hooks/useChromeExtension';
import { useKeyboardShortcuts, SHORTCUTS } from '../hooks/useKeyboardShortcuts';
import {
  getStrictVideoProviderLink,
} from '../utils/videoProviderLinks';
import { getPreferredImageProviderLink } from '../utils/imageProviderLinks';
import {
  getMediaItemKind,
  getOverviewEntries,
  getTechnicalMetadataEntries,
} from '@shared/mediaFieldRegistry.js';
import MediaDetailModal from '../components/MediaDetailModal';
import {
  createVaultConfig,
  unwrapMasterKey,
  rewrapMasterKey,
  decryptMetadata,
} from '../utils/vaultCrypto.js';
import {
  getVaultMasterKey,
  setVaultMasterKey,
  clearVaultMasterKey,
} from '../utils/vaultSession.js';

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
  const [defaultVideoSource] = useChromeStorage('defaultVideoSource', 'filemoon', 'sync');
  const [navbarHeight, setNavbarHeight] = useState(0);
  const [vaultConfig, setVaultConfig] = useState(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [unlocked, setUnlocked] = useState(false);
  const [passcode, setPasscode] = useState('');
  const [confirmPasscode, setConfirmPasscode] = useState('');
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [changePasswordError, setChangePasswordError] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [authError, setAuthError] = useState('');
  const [vaultItems, setVaultItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedItem, setSelectedItem] = useState(null);
  const [activeTab, setActiveTab] = useState('noobs');
  const [loadedImages, setLoadedImages] = useState(new Set());
  const [toast, setToast] = useState(null);
  const [restoringId, setRestoringId] = useState('');
  const [deletingId, setDeletingId] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [decryptedUrls, setDecryptedUrls] = useState({});

  // Decrypt blob on demand when an encrypted item is selected.
  useEffect(() => {
    setDecryptedUrls((prev) => { Object.values(prev).forEach(URL.revokeObjectURL); return {}; });
    if (!selectedItem?.encryptedBlobUrl || !selectedItem?.id) return;
    const masterKey = getVaultMasterKey();
    if (!masterKey) return;
    let cancelled = false;
    (async () => {
      try {
        // Route through SW message so the SW can regenerate a stale udrop
        // download URL from the stored fileId (the SW has the udrop API keys).
        const result = await sendMessage('vaultDecryptBlob', {
          url: selectedItem.encryptedBlobUrl,
          fileId: selectedItem.encryptedBlobFileId || '',
          chunks: selectedItem.encryptedBlobChunks || [],
          mimeType: selectedItem.encryptedMimeType || 'application/octet-stream',
        });
        if (cancelled) return;
        if (!result.success || !result.data?.blob) throw new Error(result.error || 'Decrypt failed');
        const url = URL.createObjectURL(result.data.blob);
        if (!cancelled) setDecryptedUrls((prev) => ({ ...prev, [selectedItem.id]: url }));
      } catch (e) {
        console.warn('[Vault] decrypt blob failed:', e.message);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedItem?.id, selectedItem?.encryptedBlobUrl]);

  // Revoke object URLs on lock.
  useEffect(() => {
    return () => { Object.values(decryptedUrls).forEach(URL.revokeObjectURL); };
  }, []);

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
      // Decrypt metadata for encrypted items so the grid can show titles/tags.
      // Blob content stays encrypted until the detail view decrypts on demand.
      const masterKey = getVaultMasterKey();
      const enriched = await Promise.all(
        (items || []).map(async (item) => {
          if (item.encryptedMetadata && masterKey) {
            try {
              const meta = await decryptMetadata(masterKey, item.encryptedMetadata);
              return { ...item, _decryptedMeta: meta };
            } catch (e) {
              console.warn('[Vault] metadata decrypt failed for', item.id, e.message);
              return item;
            }
          }
          return item;
        })
      );
      setVaultItems(enriched);
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
    return vaultItems.filter((item) => {
      const meta = item._decryptedMeta || {};
      return (
        (item.pageTitle || meta.pageTitle || '').toLowerCase().includes(query) ||
        (item.description || meta.description || '').toLowerCase().includes(query) ||
        (item.fileName || '').toLowerCase().includes(query) ||
        (item.sourcePageUrl || meta.sourcePageUrl || '').toLowerCase().includes(query) ||
        item.linkUrl?.toLowerCase().includes(query) ||
        (item.tags || meta.tags || []).some((tag) => String(tag).toLowerCase().includes(query))
      );
    });
  }, [searchQuery, vaultItems]);

  const isLinkItem = (item) => getMediaItemKind(item) === 'link';

  const isVideoItem = (item) => getMediaItemKind(item) === 'video';

  const getPreviewUrl = (item) => (
    item?.linkPreviewImageUrl ||
    getPreferredImageProviderLink(item, 'imgbb', 'url') ||
    getPreferredImageProviderLink(item, 'imgbb', 'thumbnailUrl') ||
    item?.sourceImageUrl ||
    item?.imgbbThumbUrl ||
    ''
  );

  const getVideoDirectUrl = (item) => (
    getStrictVideoProviderLink(item, defaultVideoSource, 'directUrl')
  );

  const getVideoWatchUrl = (item) => (
    getStrictVideoProviderLink(item, defaultVideoSource, 'watchUrl')
  );

  const getLinkPreviewImage = (item) => (
    item?.linkPreviewImageUrl ||
    item?.previewImageUrl ||
    item?.ogImage ||
    item?.thumbnailUrl ||
    item?.faviconUrl ||
    ''
  );

  const getVideoPosterUrl = (item) => {
    const isLikelyVideoUrl = (url) => typeof url === 'string' && /\.(mp4|webm|mov|m4v|mkv|avi|ogv)(?:[?#].*)?$/i.test(url.trim());
    const videoThumb = getStrictVideoProviderLink(item, defaultVideoSource, 'thumbnailUrl');
    return isLikelyVideoUrl(videoThumb) ? '' : videoThumb;
  };

  const getKind = (item) => {
    const kind = getMediaItemKind(item);
    if (kind === 'link') return 'Link';
    if (kind === 'video') return 'Video';
    return 'Image';
  };

  const closeItemModal = () => {
    setSelectedItem(null);
    setActiveTab('noobs');
  };

  const closeChangePasswordModal = () => {
    if (changingPassword) return;
    setShowChangePassword(false);
    setCurrentPassword('');
    setNewPassword('');
    setConfirmNewPassword('');
    setChangePasswordError('');
  };

  const openItemModal = (item) => {
    setSelectedItem(item);
    setActiveTab('noobs');
  };

  // Keyboard navigation for the detail modal (mirrors gallery)
  const navigateToNextItem = () => {
    if (!selectedItem || filteredItems.length === 0) return;
    const currentIndex = filteredItems.findIndex((item) => item.id === selectedItem.id);
    if (currentIndex === -1 || currentIndex === filteredItems.length - 1) return;
    openItemModal(filteredItems[currentIndex + 1]);
  };

  const navigateToPreviousItem = () => {
    if (!selectedItem || filteredItems.length === 0) return;
    const currentIndex = filteredItems.findIndex((item) => item.id === selectedItem.id);
    if (currentIndex <= 0) return;
    openItemModal(filteredItems[currentIndex - 1]);
  };

  useKeyboardShortcuts({
    [SHORTCUTS.ARROW_RIGHT]: navigateToNextItem,
    [SHORTCUTS.ARROW_LEFT]: navigateToPreviousItem,
    [SHORTCUTS.ESCAPE]: () => {
      if (selectedItem) closeItemModal();
    },
    [SHORTCUTS.DELETE]: () => {
      if (selectedItem && !showDeleteConfirm) setShowDeleteConfirm(true);
    },
  });

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

    const config = await createVaultConfig(passcode);

    await saveLocalVaultConfig(config);
    try {
      await sendMessage('saveVaultConfig', { config });
    } catch (error) {
      console.warn('Could not sync vault config to backend:', error);
      showToast('Vault created locally, but backend sync failed. Check your database settings.', 'warning', 6000);
    }
    // Push the master key to the SW so encrypted uploads work from this session.
    await unlockWithPasscode(passcode, config);
    sessionStorage.setItem(VAULT_SESSION_KEY, JSON.stringify({ passHash: config.passHash, unlockedAt: Date.now() }));
    setVaultConfig(config);
    setUnlocked(true);
    setPasscode('');
    setConfirmPasscode('');
  };

  const unlockWithPasscode = async (passcode, config) => {
    try {
      let effectiveConfig = config;
      let masterKey;
      try {
        masterKey = await unwrapMasterKey(config, passcode);
      } catch (e) {
        // Legacy vault (salt+passHash only, no wrapped key) → upgrade by
        // generating a master key + wrapper under the same passcode.
        const upgraded = await createVaultConfig(passcode);
        effectiveConfig = {
          ...config,
          kdfSalt: upgraded.kdfSalt,
          kdfIterations: upgraded.kdfIterations,
          wrappedMasterKey: upgraded.wrappedMasterKey,
          vaultVersion: upgraded.vaultVersion,
        };
        masterKey = await unwrapMasterKey(effectiveConfig, passcode);
        try {
          await sendMessage('saveVaultConfig', { config: effectiveConfig });
        } catch (_) {}
        await saveLocalVaultConfig(effectiveConfig);
      }
      setVaultMasterKey(masterKey);
      const raw = new Uint8Array(await crypto.subtle.exportKey('raw', masterKey));
      const keyB64 = btoa(String.fromCharCode(...raw));
      await sendMessage('vaultSetMasterKey', { keyB64 });
      return true;
    } catch (error) {
      console.warn('Vault master key not available for encryption:', error.message);
      return false;
    }
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

    await unlockWithPasscode(passcode, vaultConfig);
    sessionStorage.setItem(VAULT_SESSION_KEY, JSON.stringify({ passHash, unlockedAt: Date.now() }));
    setUnlocked(true);
    setPasscode('');
  };

  const changeVaultPassword = async (event) => {
    event.preventDefault();
    setChangePasswordError('');

    if (!vaultConfig || changingPassword) return;

    const currentHash = await hashVaultPasscode(currentPassword, vaultConfig.salt);
    if (currentHash !== vaultConfig.passHash) {
      setChangePasswordError('Current password is wrong.');
      return;
    }

    if (newPassword.length < 4) {
      setChangePasswordError('Use at least 4 characters.');
      return;
    }

    if (newPassword !== confirmNewPassword) {
      setChangePasswordError('New passwords do not match.');
      return;
    }

    setChangingPassword(true);
    try {
      const config = await rewrapMasterKey(vaultConfig, currentPassword, newPassword);

      await sendMessage('saveVaultConfig', { config });
      await saveLocalVaultConfig(config);
      await unlockWithPasscode(newPassword, config);
      sessionStorage.setItem(VAULT_SESSION_KEY, JSON.stringify({ passHash: config.passHash, unlockedAt: Date.now() }));
      setVaultConfig(config);
      setShowChangePassword(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
      showToast('Vault password changed.', 'success', 3000);
    } catch (error) {
      setChangePasswordError(error.message || 'Failed to change password. Check your database settings and try again.');
    } finally {
      setChangingPassword(false);
    }
  };

  const lockVault = () => {
    sessionStorage.removeItem(VAULT_SESSION_KEY);
    clearVaultMasterKey();
    sendMessage('vaultClearMasterKey').catch(() => {});
    Object.values(decryptedUrls).forEach(URL.revokeObjectURL);
    setDecryptedUrls({});
    setUnlocked(false);
    setSelectedItem(null);
    setVaultItems([]);
    closeChangePasswordModal();
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

  const deleteVaultItem = async () => {
    if (!selectedItem?.id || deletingId) return;
    setDeletingId(selectedItem.id);
    try {
      await sendMessage('deleteFromVault', { id: selectedItem.id });
      setVaultItems((prev) => prev.filter((entry) => entry.id !== selectedItem.id));
      setShowDeleteConfirm(false);
      setSelectedItem(null);
      showToast('Moved to Trash.', 'success', 3000);
    } catch (error) {
      showToast(`Move to Trash failed: ${error.message || String(error)}`, 'error', 5000);
    } finally {
      setDeletingId('');
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
    .g-action-danger{color:var(--color-error);background:oklch(from var(--color-error) l c h / 0.07);border-color:oklch(from var(--color-error) l c h / 0.12)}
    .g-action-danger:hover{background:oklch(from var(--color-error) l c h / 0.12);border-color:oklch(from var(--color-error) l c h / 0.2)}
    .g-action-prim{color:var(--color-primary-content);background:linear-gradient(135deg,var(--color-primary),var(--color-secondary));border:none;box-shadow:0 2px 10px oklch(from var(--color-primary) l c h / 0.2)}
    .g-action-prim:hover{filter:brightness(1.1);transform:translateY(-1px)}
  `;

  const renderVaultMedia = (item, { isModalAnimating }) => {
    const animCls = isModalAnimating ? 'opacity-0 scale-50' : 'opacity-100 scale-100';
    const encryptedUrl = item?.id ? decryptedUrls[item.id] : null;
    const isEncrypted = Boolean(item?.encryptedBlobUrl);
    if (isEncrypted) {
      const isVideo = Boolean(item.isVideo || item._decryptedMeta?.isVideo || String(item.encryptedMimeType || '').startsWith('video/'));
      if (encryptedUrl) {
        return isVideo ? (
          <video
            src={encryptedUrl}
            className={`w-full h-full rounded-[var(--radius-box)] shadow-2xl relative z-10 bg-black object-contain transition-all duration-700 ease-out ${animCls}`}
            controls
            preload="metadata"
            playsInline
          />
        ) : (
          <img
            src={encryptedUrl}
            alt={item._decryptedMeta?.pageTitle || item.fileName || 'Vault item'}
            className={`max-w-full max-h-full object-contain rounded-[var(--radius-box)] shadow-2xl relative z-10 transition-all duration-700 ease-out hover:scale-[1.02] hover:shadow-primary/30 ${animCls}`}
          />
        );
      }
      return (
        <div className={`w-full h-full rounded-[var(--radius-box)] shadow-2xl relative z-10 flex items-center justify-center bg-base-200 transition-all duration-700 ease-out ${animCls}`}>
          <div className="text-center text-base-content/50">
            <LockKeyhole className="mx-auto mb-3 h-12 w-12" />
            <p className="text-sm">Decrypting item...</p>
          </div>
        </div>
      );
    }
    if (isLinkItem(item)) {
      return (
        <div className={`w-full h-full rounded-[var(--radius-box)] shadow-2xl relative z-10 overflow-hidden border border-base-300 bg-base-100 transition-all duration-700 ease-out ${animCls}`}>
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
                      {item.pageTitle || 'Untitled Link'}
                    </h3>
                    <p className="text-base-content/70 text-sm leading-relaxed whitespace-pre-wrap">
                      {item.description || 'Saved page bookmark'}
                    </p>
                  </div>
                  <a href={item.linkUrl || item.sourcePageUrl || '#'} target="_blank" rel="noopener noreferrer" className="text-info text-sm break-all hover:underline mt-4">
                    {item.linkUrl || item.sourcePageUrl || 'N/A'}
                  </a>
                </div>
                <div className="md:w-[42%] lg:w-[40%] h-48 md:h-auto bg-base-200 border-t md:border-t-0 md:border-l border-base-300">
                  {getLinkPreviewImage(item) ? (
                    <img src={getLinkPreviewImage(item)} alt={item.pageTitle || 'Link preview'} className="w-full h-full object-contain" loading="lazy" />
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
      );
    }
    if (getKind(item) === 'Video' && getVideoDirectUrl(item)) {
      return (
        <video
          src={getVideoDirectUrl(item)}
          className={`w-full h-full rounded-[var(--radius-box)] shadow-2xl relative z-10 bg-black object-contain transition-all duration-700 ease-out ${animCls}`}
          controls
          preload="metadata"
          playsInline
        />
      );
    }
    if (getKind(item) === 'Video' && getVideoWatchUrl(item)) {
      return (
        <iframe
          src={getVideoWatchUrl(item)}
          className={`w-full h-full rounded-[var(--radius-box)] shadow-2xl relative z-10 transition-all duration-700 ease-out ${animCls}`}
          frameBorder="0"
          allowFullScreen
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          title={item.pageTitle || 'Vault video'}
        />
      );
    }
    if (getPreviewUrl(item)) {
      return (
        <img
          src={getPreviewUrl(item)}
          alt={item.pageTitle || item.fileName || 'Vault item'}
          className={`max-w-full max-h-full object-contain rounded-[var(--radius-box)] shadow-2xl relative z-10 transition-all duration-700 ease-out hover:scale-[1.02] hover:shadow-primary/30 ${animCls}`}
        />
      );
    }
    return (
      <div className={`w-full h-full rounded-[var(--radius-box)] shadow-2xl relative z-10 flex items-center justify-center bg-base-200 transition-all duration-700 ease-out ${animCls}`}>
        <ImageIcon className="h-16 w-16 text-base-content/30" />
      </div>
    );
  };

  const renderVaultActions = (
    <>
      <button onClick={() => restoreItem(selectedItem)} disabled={restoringId === selectedItem?.id} className="g-action g-action-prim" style={{ height: 32, padding: '0 14px' }}>
        <RotateCcw style={{ width: 13, height: 13 }} />
        <span>{restoringId === selectedItem?.id ? 'Restoring...' : 'Restore'}</span>
      </button>
      <button onClick={() => setShowDeleteConfirm(true)} disabled={deletingId === selectedItem?.id} className="g-action g-action-danger" style={{ height: 32, padding: '0 14px' }}>
        <Trash2 style={{ width: 13, height: 13 }} />
        <span>{deletingId === selectedItem?.id ? 'Moving...' : 'Trash'}</span>
      </button>
      <button onClick={lockVault} className="g-action g-action-warn" style={{ height: 32, padding: '0 14px' }}>
        <LockKeyhole style={{ width: 13, height: 13 }} />
        <span>Lock</span>
      </button>
    </>
  );

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

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4 items-start">
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
                          {item.encryptedBlobUrl ? (
                            <div className="relative w-full aspect-video flex items-center justify-center" style={{ background: 'var(--color-base-200)', color: 'oklch(from var(--color-base-content) l c h / 0.4)' }}>
                              <LockKeyhole className="h-10 w-10" />
                            </div>
                          ) : (
                          <>
                          {!loadedImages.has(item.id) && kind === 'Image' && (
                            <div className="absolute inset-0 overflow-hidden" style={{ background: 'var(--color-base-300)' }}>
                              <div className="absolute inset-0 shimmer" />
                            </div>
                          )}

                          {kind === 'Link' ? (
                            <div className="relative w-full aspect-video" style={{ background: 'var(--color-base-200)' }}>
                              {linkPreviewImage ? (
                                <img src={linkPreviewImage} alt={item.pageTitle || 'Link preview'} className="w-full h-full object-contain" loading="lazy" onLoad={() => handleMediaLoad(item.id)} />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center" style={{ color: 'oklch(from var(--color-base-content) l c h / 0.3)' }}>
                                  <Link2 style={{ width: 32, height: 32 }} />
                                </div>
                              )}
                            </div>
                          ) : kind === 'Video' ? (
                            (() => {
                              const poster = getVideoPosterUrl(item);
                              const videoDirectUrlItem = getVideoDirectUrl(item);
                              return videoDirectUrlItem ? (
                                <video
                                  src={videoDirectUrlItem}
                                  poster={poster || undefined}
                                  className="w-full h-auto object-cover"
                                  muted
                                  playsInline
                                  preload="metadata"
                                  onLoadedMetadata={(e) => {
                                    handleMediaLoad(item.id);
                                  }}
                                  onCanPlayThrough={() => handleMediaLoad(item.id)}
                                  onError={() => handleMediaLoad(item.id)}
                                />
                              ) : poster ? (
                                <div className="relative w-full overflow-hidden aspect-video bg-base-200">
                                  <img
                                    src={poster}
                                    alt={item.pageTitle || item.fileName || 'Video preview'}
                                    className="absolute inset-0 w-full h-full object-cover"
                                    loading="lazy"
                                    onLoad={() => handleMediaLoad(item.id)}
                                    onError={() => handleMediaLoad(item.id)}
                                  />
                                </div>
                              ) : (
                                <div className="relative w-full overflow-hidden aspect-video bg-base-200 flex items-center justify-center">
                                  <Video style={{ width: 32, height: 32, color: 'oklch(from var(--color-base-content) l c h / 0.3)' }} />
                                </div>
                              );
                            })()
                          ) : imageUrl ? (
                            <img
                              src={imageUrl}
                              alt={item.pageTitle || item.fileName || 'Vault item'}
                              onLoad={() => handleMediaLoad(item.id)}
                              className={`w-full h-auto object-contain transition-all duration-500 ease-out ${loadedImages.has(item.id) ? 'opacity-100' : 'opacity-0'}`}
                              loading="lazy"
                            />
                          ) : (
                            <div className="w-full h-auto flex items-center justify-center" style={{ background: 'var(--color-base-200)', color: 'oklch(from var(--color-base-content) l c h / 0.3)' }}>
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
                          </>
                          )}
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            ))
          )}

          <div className="fixed bottom-6 right-6 z-50 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowChangePassword(true)}
              className="g-action"
              style={{ height: 40, padding: '0 16px', boxShadow: '0 10px 30px oklch(from var(--color-base-content) l c h / 0.12)' }}
            >
              <KeyRound className="h-4 w-4" />
              Change Password
            </button>
            <button
              type="button"
              onClick={lockVault}
              className="g-action g-action-warn"
              style={{ height: 40, padding: '0 16px', boxShadow: '0 10px 30px oklch(from var(--color-base-content) l c h / 0.12)' }}
            >
              <LockKeyhole className="h-4 w-4" />
              Lock Vault
            </button>
          </div>
        </main>
      )}

      <MediaDetailModal
        isOpen={!!selectedItem}
        onClose={closeItemModal}
        item={selectedItem}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        isLink={isLinkItem(selectedItem)}
        overviewEntries={getOverviewEntries(selectedItem, { extraKeys: ['vaultedAt'] })}
        technicalEntries={getTechnicalMetadataEntries(selectedItem)}
        technicalLoading={false}
        renderMedia={renderVaultMedia}
        actions={renderVaultActions}
        technicalEmptyText="No extra technical fields on this vault item."
      />

      <Modal
        isOpen={showChangePassword}
        onClose={closeChangePasswordModal}
        title="Change Vault Password"
      >
        <form onSubmit={changeVaultPassword} className="space-y-4">
          <p className="text-sm text-base-content/60">
            This updates the vault unlock password for both the extension and the web app.
          </p>
          <input
            type="password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            placeholder="Current password"
            className="w-full rounded-[var(--radius-box)] border border-base-300 bg-base-200 px-4 py-3 text-base-content outline-none focus:border-primary"
            autoFocus
          />
          <input
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            placeholder="New password"
            className="w-full rounded-[var(--radius-box)] border border-base-300 bg-base-200 px-4 py-3 text-base-content outline-none focus:border-primary"
          />
          <input
            type="password"
            value={confirmNewPassword}
            onChange={(event) => setConfirmNewPassword(event.target.value)}
            placeholder="Confirm new password"
            className="w-full rounded-[var(--radius-box)] border border-base-300 bg-base-200 px-4 py-3 text-base-content outline-none focus:border-primary"
          />
          {changePasswordError && (
            <p className="rounded-[var(--radius-box)] border border-error/20 bg-error/10 px-3 py-2 text-sm text-error">
              {changePasswordError}
            </p>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={closeChangePasswordModal} disabled={changingPassword}>
              Cancel
            </Button>
            <Button type="submit" disabled={changingPassword}>
              {changingPassword ? (
                <>
                  <Spinner size="sm" className="mr-2" />
                  Saving...
                </>
              ) : (
                <>
                  <KeyRound className="mr-2 h-4 w-4" />
                  Change Password
                </>
              )}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        title="Move to Trash?"
      >
        <div className="space-y-4">
          <p className="text-sm text-base-content/60">
            This removes the item from the vault and moves it to Trash. Hosted
            files stay intact and the item can be restored from Trash later.
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => setShowDeleteConfirm(false)} disabled={!!deletingId}>
              Cancel
            </Button>
            <Button type="button" variant="danger" onClick={deleteVaultItem} disabled={!!deletingId}>
              {deletingId ? (
                <>
                  <Spinner size="sm" className="mr-2" />
                  Moving...
                </>
              ) : (
                <>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Move to Trash
                </>
              )}
            </Button>
          </div>
        </div>
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
