/**
 * Shared collections logic — id format, row normalization, update merge,
 * and item-move count deltas. Single source of truth for the extension
 * storage layer and the web /api/collections route.
 *
 * runtime bindings (DB access) stay app-side, same rule as providerCatalog.
 */

export const COLLECTION_ID_PREFIX = 'collection_';

export function createCollectionId(now = Date.now()) {
  return `${COLLECTION_ID_PREFIX}${now}`;
}

// mirrors the extension's createCollectionNeon validation: non-empty trimmed name.
export function normalizeCollectionName(name) {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed) throw new Error('Collection name is required');
  return trimmed;
}

// accepts an extension storage row (snake_case) or a web drizzle row (camelCase)
export function normalizeCollection(row) {
  if (!row) return null;

  return {
    id: row.id,
    name: row.name || '',
    description: row.description || '',
    color: row.color || '',
    imageCount: Number(row.imageCount ?? row.image_count ?? 0) || 0,
    createdAt: row.createdAt || row.created_at || '',
    updatedAt: row.updatedAt || row.updated_at || '',
  };
}

// merge semantics mirror the extension's updateCollectionNeon (?? wins)
export function mergeCollectionUpdates(current, updates = {}) {
  return {
    name: updates.name ?? current.name,
    description: updates.description ?? current.description,
    color: updates.color ?? current.color,
    imageCount: updates.imageCount ?? current.imageCount,
  };
}

// an item moving between collections: which stored counts must change
// (null = leave that count alone). clamping to >= 0 is the caller's job
// (the web API uses SQL `greatest(0, ...)`; the extension clamps client-side).
export function collectionCountDeltas(oldCollectionId, newCollectionId) {
  const changed = (oldCollectionId || null) !== (newCollectionId || null);

  return {
    decrement: changed && oldCollectionId ? oldCollectionId : null,
    increment: changed && newCollectionId ? newCollectionId : null,
  };
}
