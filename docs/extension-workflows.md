# Extension Workflows

## Main Pages

- `GalleryPage.jsx`: primary save/upload/browse modal workflow
- `HostPage.jsx`: native host diagnostics and video download trigger
- `SettingsPage.jsx`: provider keys, Firebase config, default providers, download folder
- `TrashPage.jsx` and `CollectionsPage.jsx`: organization/recovery paths

## Background Worker

`src/background/background.js` handles:

- context menu setup
- pending media state transfer
- upload status logging
- native host messaging (`download`, `get_default_video_directory`, etc.)

## YouTube Icon Detection Rule

The action icon now switches to the supported-video icon only for direct video URL patterns:

- `https://youtu.be/<id>`
- `https://youtube.com/watch?v=<id>` (including `www.youtube.com` and `m.youtube.com`)

Non-watch YouTube URLs (for example channel pages, home, playlists, or `/shorts/...`) no longer trigger the video icon.

## UDrop Direct URL Rule

Use:

- `https://www.udrop.com/file/<shortId>/<filename>`

Where `<shortId>` is the short segment like `OqQc` (not the numeric id).

## Gallery Auto-Load After Native Download

Current behavior:

- attempt saved folder handle first
- derive filename from path with both separators supported (`/` and `\`)
- if exact filename is missing, fallback search by media id token pattern like `[1590020675474870]`
- choose newest matching file and open modal

This reduces failures from title/encoding differences between expected and actual filename.

## Persisted Folder Handle

Directory handle is stored in IndexedDB object store `handles` with key `downloadFolder`.

Important behavior:

- avoid clearing saved handle on simple `NotFoundError`
- do not aggressively invalidate handle on transient lookup misses
- permission retry is done on saved handle when needed

## Modal Field Model

- Noobs tab: stable base fields for current media type + Firestore document id block
- Nerds tab: all remaining fields from record, including technical metadata
- Shared view: sensitive delete URLs are shown as `REDACTED` (not omitted)
- Upload modal for videos now mirrors this split:
  - `For Noobs`: numbered stable fields that will be saved
  - `For Nerds`: extra detected metadata fields, shown only when present
- The old `Total Firestore Fields` summary panel was removed from upload modal to avoid stale counts.

## Theme Rules

- prefer theme tokens and DaisyUI variables (not hardcoded text/background colors)
- radius should use `var(--radius-box)` for theme-driven corners

## Notification Behavior

- Toast/notification messages now wrap and stay within viewport bounds on long titles/messages.
