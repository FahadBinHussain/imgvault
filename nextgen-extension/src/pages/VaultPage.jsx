/**
 * @fileoverview Secret Vault Page
 * @version 2.0.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  EyeOff,
  LockKeyhole,
  UnlockKeyhole,
  RotateCcw,
  X,
  Link2,
  Image as ImageIcon,
  Video,
} from 'lucide-react';
import { Button, Spinner, Toast } from '../components/UI';
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

  const getPreviewUrl = (item) => (
    item?.linkPreviewImageUrl ||
    item?.imgbbThumbUrl ||
    item?.imgbbUrl ||
    item?.pixvidUrl ||
    item?.sourceImageUrl ||
    ''
  );

  const getVideoUrl = (item) => (
    item?.udropDirectUrl ||
    item?.filemoonWatchUrl ||
    item?.udropWatchUrl ||
    item?.filemoonDirectUrl ||
    ''
  );

  const getKind = (item) => {
    if (item?.isLink) return 'Link';
    if (item?.isVideo || String(item?.fileType || '').startsWith('video/')) return 'Video';
    return 'Image';
  };

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

  const renderPreview = (item) => {
    const previewUrl = getPreviewUrl(item);
    const videoUrl = getVideoUrl(item);

    if (getKind(item) === 'Video' && isHttpUrl(videoUrl)) {
      return videoUrl.includes('udrop.com/file/')
        ? <video src={videoUrl} className="h-full w-full object-cover" muted playsInline preload="metadata" />
        : <iframe src={videoUrl} className="h-full w-full object-cover" frameBorder="0" title={item.pageTitle || 'Vault video'} />;
    }

    if (isHttpUrl(previewUrl)) {
      return <img src={previewUrl} alt={item.pageTitle || 'Vault item'} className="h-full w-full object-cover" loading="lazy" />;
    }

    const Icon = item?.isLink ? Link2 : item?.isVideo ? Video : ImageIcon;
    return (
      <div className="flex h-full w-full items-center justify-center bg-base-200 text-base-content/30">
        <Icon className="h-10 w-10" />
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-base-200 text-base-content">
      <PremiumBackground />
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
        <main className="relative z-10 mx-auto max-w-7xl px-4 pb-10 sm:px-6">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-box)] border border-base-300 bg-base-100 p-4">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-base-content">
                <EyeOff className="h-4 w-4 text-primary" />
                Secret Vault
              </div>
              <p className="mt-1 text-sm text-base-content/60">
                {filteredItems.length} hidden item{filteredItems.length !== 1 ? 's' : ''}. Restore items when you want them back in Gallery.
              </p>
            </div>
            <Button variant="ghost" onClick={lockVault}>
              <LockKeyhole className="mr-2 h-4 w-4" />
              Lock Vault
            </Button>
          </div>

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
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
              {filteredItems.map((item) => (
                <motion.button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedItem(item)}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="group overflow-hidden rounded-[var(--radius-box)] border border-base-300 bg-base-100 text-left shadow-sm transition hover:-translate-y-1 hover:border-primary/40 hover:shadow-xl"
                >
                  <div className="aspect-video overflow-hidden bg-base-200">
                    {renderPreview(item)}
                  </div>
                  <div className="p-3">
                    <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-primary">
                      {getKind(item)}
                    </div>
                    <p className="line-clamp-2 text-sm font-semibold text-base-content">
                      {item.pageTitle || item.fileName || item.linkUrl || 'Untitled vault item'}
                    </p>
                  </div>
                </motion.button>
              ))}
            </div>
          )}
        </main>
      )}

      <AnimatePresence>
        {selectedItem && (
          <motion.div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSelectedItem(null)}
          >
            <motion.div
              className="max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-[var(--radius-box)] border border-base-300 bg-base-100 shadow-2xl"
              initial={{ scale: 0.96, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.96, y: 20 }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-base-300 p-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-primary">{getKind(selectedItem)}</p>
                  <h2 className="text-lg font-bold">Vault Item</h2>
                </div>
                <button className="rounded-[var(--radius-box)] border border-base-300 bg-base-200 p-2" onClick={() => setSelectedItem(null)}>
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="grid max-h-[calc(90vh-74px)] overflow-y-auto md:grid-cols-[1.2fr_1fr]">
                <div className="min-h-[260px] bg-base-200">
                  {renderPreview(selectedItem)}
                </div>
                <div className="space-y-4 p-5">
                  <div>
                    <p className="text-xs font-semibold text-base-content/50">Title</p>
                    <p className="break-words font-semibold">{selectedItem.pageTitle || selectedItem.fileName || 'Untitled'}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-base-content/50">Source</p>
                    <p className="break-all font-mono text-sm">{selectedItem.linkUrl || selectedItem.sourcePageUrl || selectedItem.sourceImageUrl || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-base-content/50">Vaulted At</p>
                    <p className="font-mono text-sm">{selectedItem.vaultedAt ? new Date(selectedItem.vaultedAt).toLocaleString() : 'N/A'}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => restoreItem(selectedItem)} disabled={restoringId === selectedItem.id}>
                      <RotateCcw className="mr-2 h-4 w-4" />
                      {restoringId === selectedItem.id ? 'Restoring...' : 'Restore to Gallery'}
                    </Button>
                    <Button variant="ghost" onClick={lockVault}>
                      <LockKeyhole className="mr-2 h-4 w-4" />
                      Lock
                    </Button>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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
