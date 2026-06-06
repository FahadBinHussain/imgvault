import React from 'react';
import { Check, Server } from 'lucide-react';

export function reconcileSelectedHostKeys(selectedKeys, services = []) {
  const availableKeys = services.map((service) => service.key);

  if (availableKeys.length === 0) {
    return [];
  }

  const selected = Array.isArray(selectedKeys)
    ? selectedKeys.filter((key) => availableKeys.includes(key))
    : [];

  return selected.length > 0 ? selected : availableKeys;
}

export default function UploadHostSelector({
  services = [],
  selectedKeys = [],
  onChange,
  disabled = false,
  emptyMessage = 'No configured hosts. Add host API keys in Settings.',
}) {
  const selectedSet = new Set(selectedKeys);
  const allSelected = services.length > 0 && services.every((service) => selectedSet.has(service.key));

  const updateSelection = (nextKeys) => {
    if (disabled || !onChange) return;
    onChange(reconcileSelectedHostKeys(nextKeys, services));
  };

  const toggleHost = (hostKey) => {
    if (disabled) return;

    if (selectedSet.has(hostKey)) {
      if (selectedSet.size <= 1) return;
      updateSelection(selectedKeys.filter((key) => key !== hostKey));
      return;
    }

    updateSelection([...selectedKeys, hostKey]);
  };

  return (
    <section className="rounded-[var(--radius-box)] border border-base-300 bg-base-200/60 p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-base-content">
            <Server className="h-4 w-4 text-primary" />
            Upload hosts
          </div>
          <p className="mt-1 text-xs text-base-content/60">
            All configured hosts are selected by default.
          </p>
        </div>

        {services.length > 1 && (
          <button
            type="button"
            onClick={() => updateSelection(services.map((service) => service.key))}
            disabled={disabled || allSelected}
            className="rounded-[var(--radius-box)] border border-base-300 bg-base-100 px-3 py-1.5 text-xs font-semibold text-base-content/75 transition-colors hover:bg-base-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Select all
          </button>
        )}
      </div>

      {services.length === 0 ? (
        <div className="rounded-[var(--radius-box)] border border-warning/30 bg-warning/10 px-3 py-2 text-xs font-medium text-warning">
          {emptyMessage}
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {services.map((service) => {
            const selected = selectedSet.has(service.key);
            const isLastSelected = selected && selectedSet.size <= 1;

            return (
              <button
                key={service.key}
                type="button"
                aria-pressed={selected}
                onClick={() => toggleHost(service.key)}
                disabled={disabled || isLastSelected}
                className={`group/host flex items-center justify-between gap-3 rounded-[var(--radius-box)] border px-3 py-2 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-base-100 ${
                  selected
                    ? 'border-primary-500/65 bg-gradient-to-br from-primary-50 via-base-100 to-secondary-400/10 text-base-content shadow-sm ring-1 ring-primary-500/15'
                    : 'border-base-300 bg-base-100 text-base-content/75 hover:border-primary-400/50 hover:bg-primary-50/45'
                } disabled:cursor-not-allowed`}
                title={isLastSelected ? 'At least one host must stay selected' : service.label}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{service.label}</span>
                  <span className="block truncate text-[11px] text-base-content/55">
                    {service.sourceLabel || service.label}
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  className={`flex h-7 w-7 flex-none items-center justify-center rounded-[0.65rem] border transition-all duration-200 ${
                    selected
                      ? 'border-transparent bg-gradient-to-br from-primary-500 to-secondary-500 text-white shadow-lg shadow-primary-500/25'
                      : 'border-base-content/20 bg-base-100 text-transparent group-hover/host:border-primary-400 group-hover/host:bg-primary-50'
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
  );
}
