import { getImageProviderLinks } from './image-provider-links'
import { getVideoProviderLinks } from './video-provider-links'
import {
  VAULT_CONFIG_ITEM_ID,
  VAULT_CONFIG_SYSTEM_TYPE,
  getExtraMetadata,
  isSystemMediaItem as isRegistrySystemMediaItem,
  isTruthyFlag,
} from '@shared/mediaFieldRegistry.js'

export { VAULT_CONFIG_ITEM_ID, VAULT_CONFIG_SYSTEM_TYPE, getExtraMetadata, isTruthyFlag }

export function isSystemMediaItem(item) {
  return isRegistrySystemMediaItem(item)
}

export function isVaultedMediaItem(item) {
  const extra = getExtraMetadata(item)
  return isTruthyFlag(item?.isVaulted) || isTruthyFlag(extra.isVaulted)
}

const IMAGE_LIST_LINK_FIELDS = ['url', 'displayUrl', 'directUrl', 'thumbnailUrl']
const VIDEO_LIST_LINK_FIELDS = ['watchUrl', 'directUrl', 'thumbnailUrl']

function compactProviderLinks(links, allowedFields) {
  return Object.fromEntries(
    Object.entries(links || {})
      .map(([provider, link]) => {
        const compactLink = Object.fromEntries(
          allowedFields
            .map((field) => [field, link?.[field]])
            .filter(([, value]) => value !== undefined && value !== null && value !== '')
        )

        return [provider, compactLink]
      })
      .filter(([, link]) => Object.keys(link).length > 0)
  )
}

export function toClientMediaItem(item) {
  const extra = getExtraMetadata(item)
  const flatExtra = { ...extra }
  delete flatExtra.ai
  const imageHosts = getImageProviderLinks({ ...extra, ...item })
  const videoHosts = getVideoProviderLinks({ ...extra, ...item })

  return {
    ...flatExtra,
    ...item,
    imageHosts,
    videoHosts,
    tags: Array.isArray(item?.tags) ? item.tags : [],
    isVaulted: isTruthyFlag(extra.isVaulted),
    vaultMode: typeof extra.vaultMode === 'string' ? extra.vaultMode : '',
    vaultedAt: typeof extra.vaultedAt === 'string' ? extra.vaultedAt : '',
    filemoonUrl: videoHosts.filemoon?.watchUrl || item?.filemoonWatchUrl || '',
    udropUrl: videoHosts.udrop?.watchUrl || item?.udropWatchUrl || '',
    _isSummary: false,
  }
}

export function toClientMediaListItem(item) {
  const extra = getExtraMetadata(item)
  const imageHosts = compactProviderLinks(getImageProviderLinks(item), IMAGE_LIST_LINK_FIELDS)
  const videoHosts = compactProviderLinks(getVideoProviderLinks(item), VIDEO_LIST_LINK_FIELDS)

  return {
    id: item?.id || '',
    kind: item?.kind || 'image',
    isVideo: Boolean(item?.isVideo),
    isLink: Boolean(item?.isLink),
    pageTitle: item?.pageTitle || '',
    description: item?.description || '',
    tags: Array.isArray(item?.tags) ? item.tags : [],
    collectionId: item?.collectionId || null,
    internalAddedTimestamp: item?.internalAddedTimestamp || null,
    sourceImageUrl: item?.sourceImageUrl || '',
    sourcePageUrl: item?.sourcePageUrl || '',
    fileName: item?.fileName || '',
    fileSize: item?.fileSize || null,
    width: item?.width || null,
    height: item?.height || null,
    duration: item?.duration || null,
    fileType: item?.fileType || '',
    creationDate: item?.creationDate || null,
    pixvidUrl: item?.pixvidUrl || '',
    imgbbUrl: item?.imgbbUrl || '',
    imgbbThumbUrl: item?.imgbbThumbUrl || '',
    filemoonWatchUrl: item?.filemoonWatchUrl || '',
    filemoonDirectUrl: item?.filemoonDirectUrl || '',
    udropWatchUrl: item?.udropWatchUrl || '',
    udropDirectUrl: item?.udropDirectUrl || '',
    linkUrl: item?.linkUrl || '',
    linkUrlCanonical: item?.linkUrlCanonical || '',
    linkPreviewImageUrl: item?.linkPreviewImageUrl || '',
    faviconUrl: item?.faviconUrl || '',
    videoThumbnailUrl: item?.videoThumbnailUrl || '',
    lastVisitedAt: item?.lastVisitedAt || null,
    deletedAt: item?.deletedAt || null,
    imageHosts,
    videoHosts,
    isVaulted: isTruthyFlag(extra.isVaulted),
    vaultMode: typeof extra.vaultMode === 'string' ? extra.vaultMode : '',
    vaultedAt: typeof extra.vaultedAt === 'string' ? extra.vaultedAt : '',
    filemoonUrl: videoHosts.filemoon?.watchUrl || item?.filemoonWatchUrl || '',
    udropUrl: videoHosts.udrop?.watchUrl || item?.udropWatchUrl || '',
    _isSummary: true,
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
