-- Backfill generic video host metadata from the legacy Filemoon/UDrop columns.
-- This is intentionally additive: legacy columns stay populated for rollback
-- and older clients, while new code reads extra_metadata.videoHosts first.

update public.media_items
set
  extra_metadata = jsonb_set(
    coalesce(extra_metadata, '{}'::jsonb),
    '{videoHosts}',
    coalesce(extra_metadata->'videoHosts', '{}'::jsonb)
      || case
        when coalesce(filemoon_watch_url, '') <> '' or coalesce(filemoon_direct_url, '') <> ''
          then jsonb_build_object(
            'filemoon',
            jsonb_strip_nulls(jsonb_build_object(
              'watchUrl', nullif(filemoon_watch_url, ''),
              'directUrl', nullif(filemoon_direct_url, '')
            ))
          )
        else '{}'::jsonb
      end
      || case
        when coalesce(udrop_watch_url, '') <> '' or coalesce(udrop_direct_url, '') <> ''
          then jsonb_build_object(
            'udrop',
            jsonb_strip_nulls(jsonb_build_object(
              'watchUrl', nullif(udrop_watch_url, ''),
              'directUrl', nullif(udrop_direct_url, '')
            ))
          )
        else '{}'::jsonb
      end,
    true
  ),
  updated_at = now()
where
  is_video = true
  and (
    coalesce(filemoon_watch_url, '') <> ''
    or coalesce(filemoon_direct_url, '') <> ''
    or coalesce(udrop_watch_url, '') <> ''
    or coalesce(udrop_direct_url, '') <> ''
  );
