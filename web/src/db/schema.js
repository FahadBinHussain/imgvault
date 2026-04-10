import { pgTable, text, timestamp, varchar, uuid, json, jsonb, integer, bigint, numeric, boolean, bigserial } from 'drizzle-orm/pg-core'

// NextAuth required tables
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }),
  email: varchar('email', { length: 255 }).unique(),
  emailVerified: timestamp('emailVerified', { mode: 'date' }),
  image: text('image'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const accounts = pgTable('accounts', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: varchar('type', { length: 255 }).notNull(),
  provider: varchar('provider', { length: 255 }).notNull(),
  providerAccountId: varchar('providerAccountId', { length: 255 }).notNull(),
  refresh_token: text('refresh_token'),
  access_token: text('access_token'),
  expires_at: text('expires_at'),
  token_type: varchar('token_type', { length: 255 }),
  scope: varchar('scope', { length: 255 }),
  id_token: text('id_token'),
  session_state: varchar('session_state', { length: 255 }),
})

export const sessions = pgTable('sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  sessionToken: varchar('sessionToken', { length: 255 }).unique().notNull(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { mode: 'date' }).notNull(),
})

// User's Firebase configuration
export const userConfigs = pgTable('user_configs', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().unique().references(() => users.id, { onDelete: 'cascade' }),
  firebaseConfig: json('firebase_config').notNull(),
  appSettings: json('app_settings'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const shareLinks = pgTable('share_links', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  imageId: varchar('image_id', { length: 255 }).notNull(),
  token: varchar('token', { length: 255 }).notNull().unique(),
  imageData: json('image_data').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  revokedAt: timestamp('revoked_at'),
})

// Extension media tables (shared DB)
export const collections = pgTable('collections', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  color: text('color').notNull().default(''),
  imageCount: integer('image_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const mediaItems = pgTable('media_items', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  isVideo: boolean('is_video').notNull().default(false),
  isLink: boolean('is_link').notNull().default(false),

  pageTitle: text('page_title').notNull().default(''),
  description: text('description').notNull().default(''),
  tags: jsonb('tags').notNull().default([]),
  collectionId: text('collection_id').references(() => collections.id, { onDelete: 'set null' }),
  internalAddedTimestamp: timestamp('internal_added_timestamp', { withTimezone: true }).defaultNow().notNull(),

  sourceImageUrl: text('source_image_url').notNull().default(''),
  sourcePageUrl: text('source_page_url').notNull().default(''),

  fileName: text('file_name').notNull().default(''),
  fileSize: bigint('file_size', { mode: 'number' }),
  width: integer('width'),
  height: integer('height'),
  duration: numeric('duration', { precision: 12, scale: 3 }),
  fileType: text('file_type').notNull().default(''),
  fileTypeSource: text('file_type_source').notNull().default(''),
  creationDate: timestamp('creation_date', { withTimezone: true }),
  creationDateSource: text('creation_date_source').notNull().default(''),

  sha256: text('sha256').notNull().default(''),
  pHash: text('p_hash').notNull().default(''),
  aHash: text('a_hash').notNull().default(''),
  dHash: text('d_hash').notNull().default(''),

  exifMetadata: jsonb('exif_metadata'),
  extraMetadata: jsonb('extra_metadata'),

  pixvidUrl: text('pixvid_url').notNull().default(''),
  pixvidDeleteUrl: text('pixvid_delete_url').notNull().default(''),
  imgbbUrl: text('imgbb_url').notNull().default(''),
  imgbbDeleteUrl: text('imgbb_delete_url').notNull().default(''),
  imgbbThumbUrl: text('imgbb_thumb_url').notNull().default(''),

  filemoonWatchUrl: text('filemoon_watch_url').notNull().default(''),
  filemoonDirectUrl: text('filemoon_direct_url').notNull().default(''),
  udropWatchUrl: text('udrop_watch_url').notNull().default(''),
  udropDirectUrl: text('udrop_direct_url').notNull().default(''),

  linkUrl: text('link_url').notNull().default(''),
  linkUrlCanonical: text('link_url_canonical').notNull().default(''),
  linkPreviewImageUrl: text('link_preview_image_url').notNull().default(''),
  faviconUrl: text('favicon_url').notNull().default(''),
  lastVisitedAt: timestamp('last_visited_at', { withTimezone: true }),

  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const settings = pgTable('settings', {
  id: text('id').primaryKey().default('config'),
  pixvidApiKey: text('pixvid_api_key').notNull().default(''),
  imgbbApiKey: text('imgbb_api_key').notNull().default(''),
  filemoonApiKey: text('filemoon_api_key').notNull().default(''),
  udropKey1: text('udrop_key1').notNull().default(''),
  udropKey2: text('udrop_key2').notNull().default(''),
  defaultGallerySource: text('default_gallery_source').notNull().default('imgbb'),
  defaultVideoSource: text('default_video_source').notNull().default('filemoon'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const uploadRuns = pgTable('upload_runs', {
  id: text('id').primaryKey(),
  status: text('status').notNull(),
  summary: text('summary').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const uploadRunLogs = pgTable('upload_run_logs', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  runId: text('run_id').notNull().references(() => uploadRuns.id, { onDelete: 'cascade' }),
  logType: text('log_type').notNull().default('info'),
  message: text('message').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})
