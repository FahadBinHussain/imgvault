import React, { useMemo, useState } from 'react';
import { Check, ArrowRightLeft } from 'lucide-react';
import { Modal } from './UI';
import UploadHostSelector from './UploadHostSelector';
import { getVideoSourceHostOptions } from '../utils/videoProviderLinks';
import { getImageProviderLinks } from '../utils/imageProviderLinks';
import { getVaultBlobHostServices, DEFAULT_VAULT_BLOB_HOST } from '../config/providerCatalog';
import { useChromeStorage } from '../hooks/useChromeExtension';

export default function VaultMoveModal({
  isOpen,
  onClose,
  items = [],
  onConfirm,
  confirming = false,
}) {
  const [selectedVaultHostKeys, setSelectedVaultHostKeys] = useChromeStorage('selectedVaultHostKeys', [DEFAULT_VAULT_BLOB_HOST], 'local');
  const [sourceHost, setSourceHost] = useState('');

  const sourceOptions = useMemo(() => {
    if (items.length === 0) return [];
    const optionSets = items.map((item) => {
      const isVideo = Boolean(item.isVideo || String(item.fileType || '').startsWith('video/'));
      if (isVideo) {
        return getVideoSourceHostOptions(item, '');
      }
      const links = getImageProviderLinks(item);
      return Object.keys(links).map((key) => ({ key, label: key }));
    });
    // intersect across all selected items so a single source host works for the batch
    const available = new Set(optionSets[0].map((o) => o.key));
    for (let i = 1; i < optionSets.length; i++) {
      const keys = new Set(optionSets[i].map((o) => o.key));
      for (const key of Array.from(available)) {
        if (!keys.has(key)) available.delete(key);
      }
    }
    return optionSets[0].filter((o) => available.has(o.key));
  }, [items]);

  const defaultSource = useMemo(() => {
    if (sourceHost) return sourceHost;
    if (sourceOptions.length > 0) return sourceOptions[0].key;
    return '';
  }, [sourceHost, sourceOptions]);

  const canConfirm = defaultSource && selectedVaultHostKeys.length > 0;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Move ${items.length} item${items.length !== 1 ? 's' : ''} to Secret Vault`}
    >
      <div className="space-y-4">
        <p className="text-sm text-base-content/60">
          The item is re-encrypted and stored as an opaque blob on the selected vault host. Choose which
          host to pull the original media from and where to store the encrypted blob.
        </p>

        {/* Source host */}
        <section className="rounded-[var(--radius-box)] border border-base-300 bg-base-200/60 p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-base-content">
            <ArrowRightLeft className="h-4 w-4 text-primary" />
            Source host
          </div>
          <p className="mb-3 mt-1 text-xs text-base-content/60">
            The host the original media is fetched from. Only hosts this item has a link on are listed.
          </p>
          {sourceOptions.length === 0 ? (
            <div className="rounded-[var(--radius-box)] border border-warning/30 bg-warning/10 px-3 py-2 text-xs font-medium text-warning">
              No hosts with links found on this item. Pick a host that has a saved link.
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {sourceOptions.map((option) => {
                const selected = defaultSource === option.key;
                return (
                  <button
                    key={option.key}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setSourceHost(option.key)}
                    className={`flex items-center justify-between gap-3 rounded-[var(--radius-box)] border px-3 py-2 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-base-100 ${
                      selected
                        ? 'border-primary-500/65 bg-gradient-to-br from-primary-50 via-base-100 to-secondary-400/10 text-base-content shadow-sm ring-1 ring-primary-500/15'
                        : 'border-base-300 bg-base-100 text-base-content/75 hover:border-primary-400/50 hover:bg-primary-50/45'
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{option.label}</span>
                    </span>
                    <span
                      aria-hidden="true"
                      className={`flex h-7 w-7 flex-none items-center justify-center rounded-[0.65rem] border transition-all duration-200 ${
                        selected
                          ? 'border-transparent bg-gradient-to-br from-primary-500 to-secondary-500 text-white shadow-lg shadow-primary-500/25'
                          : 'border-base-content/20 bg-base-100 text-transparent'
                      }`}
                    >
                      <Check className="h-4 w-4" strokeWidth={3} />
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* Vault blob target */}
        <UploadHostSelector
          services={getVaultBlobHostServices()}
          selectedKeys={selectedVaultHostKeys}
          onChange={setSelectedVaultHostKeys}
          disabled={confirming}
          title="Vault blob host"
          description="Where the encrypted .bin blob is stored. Select one or more."
          defaultAll={false}
          emptyMessage="No vault blob hosts available."
        />

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={confirming}
            className="px-4 py-2 rounded-[var(--radius-box)] border border-base-300 bg-base-200 hover:bg-base-300 text-base-content text-sm font-medium transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm({ sourceHost: defaultSource, vaultHostKeys: selectedVaultHostKeys })}
            disabled={!canConfirm || confirming}
            className="px-4 py-2 rounded-[var(--radius-box)] bg-gradient-to-r from-primary-500 to-secondary-500 hover:from-primary-600 hover:to-secondary-600 text-primary-content text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-xl"
          >
            {confirming ? 'Moving...' : `Move ${items.length} item${items.length !== 1 ? 's' : ''} to Vault`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
