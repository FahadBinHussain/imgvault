export const VAULT_CONFIG_ITEM_ID = '__imgvault_vault_config__'
export const VAULT_CONFIG_SYSTEM_TYPE = 'secretVaultConfig'

export function getExtraMetadata(item) {
  return item?.extraMetadata && typeof item.extraMetadata === 'object' && !Array.isArray(item.extraMetadata)
    ? item.extraMetadata
    : {}
}

export function isTruthyFlag(value) {
  if (value === true) return true
  if (typeof value === 'string') return value.trim().toLowerCase() === 'true'
  return false
}

export function isSystemMediaItem(item) {
  const extra = getExtraMetadata(item)
  return (
    item?.id === VAULT_CONFIG_ITEM_ID ||
    String(item?.id || '').startsWith('__imgvault_') ||
    extra.systemType === VAULT_CONFIG_SYSTEM_TYPE
  )
}

export function isVaultedMediaItem(item) {
  const extra = getExtraMetadata(item)
  return isTruthyFlag(item?.isVaulted) || isTruthyFlag(extra.isVaulted)
}

export function toClientMediaItem(item) {
  const extra = getExtraMetadata(item)

  return {
    ...extra,
    ...item,
    tags: Array.isArray(item?.tags) ? item.tags : [],
    isVaulted: isTruthyFlag(extra.isVaulted),
    vaultMode: typeof extra.vaultMode === 'string' ? extra.vaultMode : '',
    vaultedAt: typeof extra.vaultedAt === 'string' ? extra.vaultedAt : '',
    filemoonUrl: item?.filemoonWatchUrl || '',
    udropUrl: item?.udropWatchUrl || '',
  }
}

export function getVaultExtraMetadata(item, vaulted) {
  const extra = getExtraMetadata(item)

  return {
    ...extra,
    isVaulted: Boolean(vaulted),
    vaultMode: vaulted ? 'hidden' : '',
    vaultedAt: vaulted ? new Date().toISOString() : '',
  }
}
