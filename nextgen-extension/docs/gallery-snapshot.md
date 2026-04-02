# Gallery Snapshot

The gallery does not load full Firestore documents up front. It uses a lightweight snapshot field set for fast gallery rendering, filtering, and correct image/video modal routing.

## Current Snapshot Fields

The gallery currently fetches these fields in its lightweight snapshot:

- `pixvidUrl`
- `imgbbUrl`
- `imgbbThumbUrl`
- `filemoonWatchUrl`
- `filemoonDirectUrl`
- `udropWatchUrl`
- `udropDirectUrl`
- `sourcePageUrl`
- `pageTitle`
- `tags`
- `description`
- `internalAddedTimestamp`
- `collectionId`
- `fileType`
- `isVideo`

## Why These Fields Stay In The Snapshot

- `pageTitle`, `tags`, `description`, `internalAddedTimestamp`, and `collectionId` support the gallery UI, sorting, and filtering.
- `pixvidUrl`, `imgbbUrl`, and `imgbbThumbUrl` support image cards and image modal actions.
- `filemoonWatchUrl`, `filemoonDirectUrl`, `udropWatchUrl`, and `udropDirectUrl` support video cards and video modal actions.
- `fileType` and `isVideo` let the modal choose the correct media UI without waiting on a full lazy-load.

## What Is Not In The Snapshot

Heavier or less frequently needed fields are lazy-loaded on demand, especially for the nerds tab and detailed inspection.

Examples:

- `fileName`
- `fileSize`
- `width`
- `height`
- hashes such as `sha256`, `pHash`, `aHash`, and `dHash`
- extra metadata or host-specific details not needed for initial gallery rendering

## Practical Split

Images mainly rely on:

- `pixvidUrl`
- `imgbbUrl`
- `imgbbThumbUrl`
- `pageTitle`
- `tags`
- `description`
- `internalAddedTimestamp`
- `collectionId`

Videos mainly rely on:

- `isVideo`
- `fileType`
- `filemoonWatchUrl`
- `filemoonDirectUrl`
- `udropWatchUrl`
- `udropDirectUrl`
- `pageTitle`
- `tags`
- `description`
- `internalAddedTimestamp`
- `collectionId`

## Maintenance Rule

If a new gallery card or modal behavior depends on a field during initial render, that field should be explicitly justified before adding it to the snapshot.

If a field is only needed for deep inspection, editing, or debugging, prefer keeping it in the lazy-loaded full record instead.
