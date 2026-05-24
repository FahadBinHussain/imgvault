# Media Format V2 Migration

This migration moves older media rows into the canonical ImgVault field shape without dropping legacy information.

## What It Normalizes

- Legacy image host fields such as `pixvidUrl`, `imgbbUrl`, and delete/thumb URLs.
- Legacy video host fields such as Filemoon and UDrop watch/direct URLs.
- Stable media fields that older imports stored at the root of `extra_metadata`.
- AI metadata that belongs under `extra_metadata.ai`, separate from original/user metadata.

## Preservation Rules

- Dry-run is the default. Nothing is written unless `--apply` is passed.
- Apply mode writes a local JSONL backup before updating any row.
- The full previous DB row is preserved inside the row at `extra_metadata._migrations.mediaFormatV2.originalRow`.
- The full previous `extra_metadata` object is preserved inside the row at `extra_metadata._migrations.mediaFormatV2.originalExtraMetadata`.
- Conflicting column-vs-extra values are recorded at `extra_metadata._migrations.mediaFormatV2.conflicts`.
- Unknown/source-specific metadata stays in `extra_metadata` and is not flattened away.
- System rows keep their system metadata in `extra_metadata`, while the DB `kind` column remains a DB-safe media kind.

## Commands

Run these from `nextgen-extension`.

Set either `NEON_DATABASE_URL` or `DATABASE_URL` before connecting to Neon.

```powershell
pnpm db:migrate:media-format:dry-run
```

Dry-run a smaller batch:

```powershell
node ./scripts/migrate-media-format-v2.mjs --batch-size=10
```

Continue from the previous summary's `nextCursor`:

```powershell
node ./scripts/migrate-media-format-v2.mjs --cursor=<last_scanned_id> --batch-size=25
```

Apply one batch after reviewing the dry-run:

```powershell
pnpm db:migrate:media-format -- --batch-size=25
```

Migrate exact IDs:

```powershell
node ./scripts/migrate-media-format-v2.mjs --ids=id1,id2 --apply
```

## Output

The script prints summary JSON only. It intentionally avoids printing media URLs or metadata values.

Key fields:

- `scanned`: rows read in this batch.
- `migrateCandidates`: rows that would be changed.
- `clean`: rows already in canonical format.
- `nextCursor`: pass this into `--cursor` for the next batch.
- `reasonCounts`: why rows were selected.
- `changedFieldCounts`: which DB fields would change.
- `conflictCount`: number of preserved value conflicts.
- `backupFile`: local JSONL backup path, only populated in apply mode.

## Safety Check

Before touching real data, run:

```powershell
node ./scripts/migrate-media-format-v2.mjs --self-test
```
