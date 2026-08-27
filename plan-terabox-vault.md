# Plan: TeraBox encrypted vault host

date: 2026-08-27
status: **draft — investigation phase**

## context

the vault encrypts 1 item → 1 opaque blob (`<32-hex>.bin`) stored on udrop. udrop works
but is a single-point-of-failure for all vaulted data. the TeraBox mirror bridge (AList +
rclone) already exists for the backup path; this plan extends it to the vault as a
**second encrypted host** for redundancy.

## why TeraBox, not another host

- TeraBox has 1 TB free space — no per-file caps for our sizes (<4 GB).
- the extension already has `cookies` permission + `<all_urls>` → can read the TeraBox
  session cookie (`ndus`, `browserid`, `lang`) from the user's logged-in browser.
- the route is **pure extension** (no AList, no rclone, no native host) — same design
  principle as the udrop path.
- the AList terabox driver (v3.63.0) confirmed the PCS upload protocol works.

## architecture

```
vault upload (page XHR)
  encrypt with master key → opaque Blob
  upload to BOTH udrop AND TeraBox (parallel / sequential?)

  TeraBox path:
    1. read cookie via chrome.cookies.get (ndus + browserid + lang)
    2. GET homepage → extract jsToken from the `fn("...")` inline script
    3. GET /api/home/info → sign3 + sign1 (for genSign — only needed for download)
    4. POST /api/precreate  → uploadid, return_type
    5. GET /rest/2.0/pcs/file?method=locateupload → upload host
    6. POST <host>/rest/2.0/pcs/superfile2  (chunked, 4 MB per chunk) → md5s
    7. POST /api/create  → finalize, returns fs_id

  udrop path (existing):
    existing UDropUploader.uploadWithProgress → single XHR POST
```

## cookie + jsToken management

- **cookie**: `chrome.cookies.get({url:'https://www.terabox.com', name:'ndus'})` +
  `browserid` + `lang`. the extension has `<all_urls>` host permission, so this works
  from the background service worker. the user must be logged into TeraBox in Edge.
  cookie freshness is the main auth risk (ndus expires after ~days).
- **jsToken**: extracted from the homepage HTML (`function%20fn%28a%29%7Bwindow.jsToken
  %20%3D%20a%7D%3Bfn%28%22...%22%29%60`). the driver resets the jsToken on every
  `errno 4000023` (stale token) and retries the request automatically.
- **stale token**: the driver treats 4000023 as "reget jsToken and retry" (not a
  captcha/PAM). no user interaction needed — just re-fetch the homepage.

## upload path details

### precreate (`POST /api/precreate`)
- query params: `app_id=250528, web=1, channel=dubox, clienttype=0, jsToken=...`
- body form: `{path, autoinit:1, target_path, block_list, local_mtime, file_limit_switch_v34:true}`
- `block_list` = array of md5s for each chunk (prepopulated with dummy md5s for precreate)
- response: `{uploadid, block_list, return_type}`. `return_type=2` = rapid upload (file
  already exists on server from another user) — skip upload, go straight to create.

### locateupload (`GET https://<prefix>-data.terabox.com/rest/2.0/pcs/file?method=locateupload`)
- returns `{host}` — the upload server hostname (e.g. `d1.data.terabox.com`).
- this is a **different subdomain** from the API. but the cookie is valid for
  `*.terabox.com` so it works.

### chunk upload (`POST https://<host>/rest/2.0/pcs/superfile2`)
- query params: `method=upload, path, uploadid, partseq, app_id, web, channel, clienttype`
- multipart: `file=<chunk_bytes>` with filename
- chunk size = 4 MB for files < 4 GB, 8 MB for 4-8 GB, etc.
- each chunk returns `md5` of the chunk
- for a 1.2 GB file: ~307 chunks at 4 MB each → ~307 requests

### create (`POST /api/create`)
- query params: `app_id, web, channel, clienttype, jsToken, isdir=0, rtype=1`
- body form: `{path, size, uploadid, target_path, block_list, local_mtime}`
- `block_list` = JSON array of actual md5s from the chunk uploads
- response: `{errno, fs_id, md5, server_mtime}`

## download path (restore from vault)

### list files (`GET /api/list`)
- `POST /api/list` with `dir, page, num` → `{list: [{fs_id, server_filename, ...}]}`
- find the vault item by its opaque name

### get download link
- **crack mode**: `GET /api/filemetas?target=["<path>"]&dlink=1&origin=dlna` → `{info:[{dlink}]}`.
- the dlink is a signed CDN URL. no sign-gen needed for crack mode.
- **CRITICAL THROTTLE**: TeraBox CDN caps large-file downloads at ~30 KB/s (`tsl=30` in
  the CDN redirect URL). measured during the backup bridge work. a 1.2 GB encrypted blob
  takes **~11 hours** to download. this is a server-side cap, not fixable.
- recommendation: **udrop is the primary restore source** (fast, ~3.3 MB/s). TeraBox is
  a fallback/backup only. if udrop is unavailable, the user must accept the slow restore.

## file size limits

- TeraBox free tier: 4 GB max single file via web (confirmed by AList driver's
  `initialSizeThreshold = 4 GB`). our largest encrypted blobs are ~1.2 GB + overhead,
  well under the limit.
- total storage: 1 TB free.

## changes needed

### new module
- `src/utils/teraBoxUploader.js` — `TeraBoxUploader` class implementing the PCS
  upload protocol (precreate + locateupload + chunked upload + create). similar to
  `UDropUploader` but with chunked XHR uploads (not single XHR).
- `src/utils/teraBoxApi.js` — list files, get dlink (crack mode), delete files, refresh
  jsToken. mirrors `udropApi.js`.

### SW (background.js)
- `getTeraBoxAuth` — reads cookie via `chrome.cookies.get` + fetches jsToken from
  homepage.
- `handleVaultedUploadToTeraBox` — parallel to udrop vault upload, saves
  `teraBoxUrl` + `teraBoxFileId` alongside the udrop fields.
- `saveVaultedUpload` — extended to accept a second host result (TeraBox).
- `restoreFromVault` — tries udrop first; if udrop dlink is dead, falls back to
  TeraBox dlink (with user-facing "slow download" warning).
- `decryptVaultBlob` — extended to fetch from TeraBox dlink when udrop unavailable.

### upload path (GalleryPage.jsx)
- `uploadVaultedDirectly` — extended to upload to BOTH udrop and TeraBox
  (in parallel, or sequential with TeraBox as a background post-upload sync).
- decision: **parallel uploads** for speed? or **udrop primary, TeraBox background**?
  parallelism doubles the upload bandwidth cost but the user's connection is likely
  the bottleneck. recommended: upload to udrop first (user sees progress), then
  sync to TeraBox in the background (no user-facing progress, just a status toast).

### DB / storage layer
- new fields on vaulted items: `teraBoxUrl`, `teraBoxFileId`, `teraBoxFileName`.
- or: store a `providerHosts` JSON field on the row: `[{provider:'udrop', url, fileId},
  {provider:'terabox', url, fileId}]`.

### decrypt path (VaultPage.jsx, background.js)
- when decrypting a vault item for view, try udrop dlink first. if it fails (404/dead),
  fetch from TeraBox dlink (crack mode → /api/filemetas → dlink → fetch blob).
- show a "slow" indicator when TeraBox fallback is active.

## open questions

- **upload speed**: the mirror bridge used rclone/AList WebDAV to TeraBox, which is
  slow (AList overhead). direct PCS chunked upload speed from the user's location is
  unknown. the chunked upload makes ~307 requests for 1.2 GB (at 4 MB each) — each
  request has HTTP overhead. measure before committing to parallel.
- **cookie freshness**: ndus expires. how often does the user need to re-login to
  TeraBox? if the cookie is short-lived, the vault upload fails silently. need a
  "TeraBox not logged in" error with a link to re-login.
- **parallel upload strategy**: upload to udrop and TeraBox simultaneously? or
  udrop-first + TeraBox background sync? parallel doubles bandwidth usage and
  both uploads compete for the same connection. sequential (udrop first, then
  TeraBox) is simpler but doubles the total upload time.
- **file size cap — 4 GB**: the AList driver uses 4 GB as the chunk-size threshold.
  is this the actual TeraBox free-tier max file size? if so, our 1.2 GB blobs are
  fine, but future 4+ GB items would need split.
- **download throttle**: 30 KB/s for large files on TeraBox CDN is a hard cap.
  is there a premium tier that removes it? the user's TeraBox account is free (1 TB).
  premium TeraBox (paid) may have higher download speeds. need to check.

## implementation steps

1. measure TeraBox upload speed: write a quick test script (PowerShell or Node) that
   does the full PCS upload flow (precreate → locateupload → chunk upload → create)
   for a 100 MB and 1 GB test file, recording total time and per-chunk time.
2. implement `TeraBoxUploader` class with chunked XHR upload + progress reporting
   (per-chunk completion, not byte-level within a chunk).
3. implement `teraBoxApi.js` — list, dlink (crack mode), delete, jsToken refresh.
4. SW: `getTeraBoxAuth` (cookie + jsToken) + save/handle/download messages.
5. GalleryPage: extend `uploadVaultedDirectly` to write to TeraBox after udrop.
6. VaultPage/background: decrypt fallback path (udrop → TeraBox).
7. test round-trip: upload → TeraBox appears → lock → unlock → decrypt from TeraBox
   (simulate udrop failure by removing the udrop URL from the DB row).
8. update AGENTS.md + plan.md status.

## scope / non-goals

- not replacing udrop as primary vault host — TeraBox is a secondary/backup.
- not using AList or rclone for the extension vault path — pure direct API.
- not supporting TeraBox as a restore-primary source (throttle makes it slow).
- not supporting non-vaulted uploads to TeraBox.
- not supporting TeraBox for non-vaulted images/videos (Pixvid/ImgBB/Filemoon are
  the normal upload targets).