-- ImgVault Extension (Neon/Postgres) schema
-- Scope: separate database + separate schema for extension storage
-- Date: 2026-04-06

create schema if not exists public;

-- Optional but useful if you later switch id generation to UUID.
create extension if not exists pgcrypto;

-- ============================================================
-- Collections
-- ============================================================
create table if not exists public.collections (
  id text primary key,
  name text not null,
  description text not null default '',
  color text not null default '',
  image_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_collections_name
  on public.collections (name);

-- ============================================================
-- Media Items (single feed table for image/video/link)
-- ============================================================
create table if not exists public.media_items (
  id text primary key,

  -- Record kind for unified gallery and type-specific logic
  kind text not null check (kind in ('image', 'video', 'link')),
  is_video boolean not null default false,
  is_link boolean not null default false,

  -- Shared user-visible fields
  page_title text not null default '',
  description text not null default '',
  tags jsonb not null default '[]'::jsonb,
  collection_id text null references public.collections(id) on delete set null,
  internal_added_timestamp timestamptz not null default now(),

  -- Source fields
  source_image_url text not null default '',
  source_page_url text not null default '',

  -- Core file/media fields
  file_name text not null default '',
  file_size bigint null,
  width integer null,
  height integer null,
  duration numeric(12,3) null,
  file_type text not null default '',
  file_type_source text not null default '',
  creation_date timestamptz null,
  creation_date_source text not null default '',

  -- Guaranteed image nerd fields (4)
  sha256 text not null default '',
  p_hash text not null default '',
  a_hash text not null default '',
  d_hash text not null default '',

  -- Variable/extended metadata
  exif_metadata jsonb null,
  extra_metadata jsonb null,

  -- Image hosting URLs
  pixvid_url text not null default '',
  pixvid_delete_url text not null default '',
  imgbb_url text not null default '',
  imgbb_delete_url text not null default '',
  imgbb_thumb_url text not null default '',

  -- Video hosting URLs
  filemoon_watch_url text not null default '',
  filemoon_direct_url text not null default '',
  udrop_watch_url text not null default '',
  udrop_direct_url text not null default '',

  -- Link fields (10 stable link model includes these + shared)
  link_url text not null default '',
  link_url_canonical text not null default '',
  link_preview_image_url text not null default '',
  favicon_url text not null default '',
  last_visited_at timestamptz null,

  -- Soft delete for trash behavior
  deleted_at timestamptz null,

  -- Audit timestamps
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_media_items_added
  on public.media_items (internal_added_timestamp desc);

create index if not exists idx_media_items_deleted
  on public.media_items (deleted_at);

create index if not exists idx_media_items_collection
  on public.media_items (collection_id);

create index if not exists idx_media_items_kind
  on public.media_items (kind);

create index if not exists idx_media_items_is_video
  on public.media_items (is_video);

create index if not exists idx_media_items_is_link
  on public.media_items (is_link);

create index if not exists idx_media_items_sha256
  on public.media_items (sha256);

create index if not exists idx_media_items_phash
  on public.media_items (p_hash);

create index if not exists idx_media_items_link_canonical
  on public.media_items (link_url_canonical);

-- Query helper indexes for active and trash views
create index if not exists idx_media_items_active_feed
  on public.media_items (internal_added_timestamp desc)
  where deleted_at is null;

create index if not exists idx_media_items_trash_feed
  on public.media_items (deleted_at desc)
  where deleted_at is not null;

-- ============================================================
-- Extension Settings (equivalent to userSettings/config)
-- ============================================================
create table if not exists public.settings (
  id text primary key default 'config',
  pixvid_api_key text not null default '',
  imgbb_api_key text not null default '',
  filemoon_api_key text not null default '',
  udrop_key1 text not null default '',
  udrop_key2 text not null default '',
  default_gallery_source text not null default 'imgbb',
  default_video_source text not null default 'filemoon',
  updated_at timestamptz not null default now()
);

-- Seed config row once
insert into public.settings (id)
values ('config')
on conflict (id) do nothing;

-- ============================================================
-- Optional: Upload run history (currently local storage in extension)
-- ============================================================
create table if not exists public.upload_runs (
  id text primary key,
  status text not null check (status in ('success', 'warning', 'error')),
  summary text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.upload_run_logs (
  id bigserial primary key,
  run_id text not null references public.upload_runs(id) on delete cascade,
  log_type text not null default 'info',
  message text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_upload_run_logs_run_created
  on public.upload_run_logs (run_id, created_at asc);

-- ============================================================
-- Notes:
-- - Image "24 stable fields": 20 noobs + 4 guaranteed hashes
-- - Video "21 stable fields": represented by shared + video URL columns
-- - Link "10 stable fields": shared + link-specific columns above
-- - Variable metadata remains in JSONB (exif_metadata, extra_metadata)
-- ============================================================
