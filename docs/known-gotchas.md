# Known Gotchas

## 1) Repeated folder picker prompts

Symptoms:

- user asked to select folder on every native-download auto-load

Typical causes:

- saved `FileSystemDirectoryHandle` invalidated too aggressively
- exact filename mismatch between expected and actual file
- permission pre-check flow forcing fallback

Current mitigations:

- preserve handle on `NotFoundError`
- robust filename extraction (`/` and `\`)
- fallback directory scan by media id token (`[id]`)

## 2) Video downloaded but modal does not auto-load

Symptoms:

- native download succeeds, then gallery says file not found

Root pattern:

- output filename differs from path string due to title encoding/sanitization

Fix:

- fallback match by `[id]` in filename, then select newest matched file

## 3) yt-dlp failures on long Facebook titles

Symptoms:

- `unable to open for writing` / `No such file or directory`

Fix:

- two-step template strategy:
  - `%(title)s [%(id)s].%(ext)s`
  - retry with `%(title).180B [%(id)s].%(ext)s` on path/write failure

## 4) Non-UTF8 stderr/stdout breaks progress parsing

Symptoms:

- read failures for yt-dlp output streams

Fix:

- read byte buffers and decode with lossy conversion instead of strict UTF-8 lines

## 5) Firestore console deep links failing

Working pattern uses:

- `/u/1/project/<projectId>/firestore/databases/-default-/data/~2F<collection>~2F<docId>?view=panel-view`

Using `/(default)` in browser path can fail for console navigation in this setup.

## 6) Theme corners appear wrong across themes

Use:

- `var(--radius-box)` for box radius

Avoid:

- hardcoded `rounded-*` values when theme-controlled corner behavior is expected.

## 7) Hardcoded colors break theme compatibility

Use semantic theme classes/tokens (`base-*`, `primary`, etc.) and avoid fixed hex/text colors in modal/content surfaces.
