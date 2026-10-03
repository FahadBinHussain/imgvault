// Single source of truth for every user-facing setting in imgvault.
// Both the extension SettingsPage and the web /settings page must render
// from this file — adding a field here is the ONLY way to add a setting,
// so a feature can never silently exist on one platform only.
//
// persistence split (per field):
//   table: '<column>'  -> column on public.settings (authoritative; the
//                         extension upserts these, web /api/config writes them)
//   table: null        -> stored only in user_configs.app_settings (web JSON)
//                         for web; the same key lives in chrome.storage.sync
//                         on the extension side. never a public.settings column
//                         unless a live ALTER TABLE lands first (repo schema is
//                         NOT auto-applied - see AGENTS 2.12.81).

export const IMAGE_SOURCE_SETTING_OPTIONS = [
  { value: 'imgbb', label: 'ImgBB' },
  { value: 'pixvid', label: 'Pixvid' },
]

export const VIDEO_SOURCE_SETTING_OPTIONS = [
  { value: 'filemoon', label: 'Filemoon' },
  { value: 'udrop', label: 'UDrop' },
  { value: 'terabox', label: 'TeraBox' },
]

export const THREE_D_SOURCE_SETTING_OPTIONS = [
  { value: 'udrop', label: 'UDrop' },
  { value: 'terabox', label: 'TeraBox' },
]

export const SETTINGS_SECTIONS = [
  { id: 'keys', label: 'API Keys' },
  { id: 'cloud', label: 'Cloud & Database' },
  { id: 'prefs', label: 'Preferences' },
]

export const SETTINGS_FIELDS = [
  {
    key: 'pixvidApiKey',
    label: 'Pixvid API Key',
    type: 'secret',
    section: 'keys',
    table: 'pixvid_api_key',
    default: '',
    placeholder: 'Enter your Pixvid API key',
  },
  {
    key: 'imgbbApiKey',
    label: 'ImgBB API Key',
    type: 'secret',
    section: 'keys',
    table: 'imgbb_api_key',
    default: '',
    placeholder: 'Enter your ImgBB API key',
  },
  {
    key: 'filemoonApiKey',
    label: 'Filemoon API Key',
    type: 'secret',
    section: 'keys',
    table: 'filemoon_api_key',
    default: '',
    placeholder: 'Enter your Filemoon API key',
  },
  {
    key: 'udropKey1',
    label: 'UDrop API Key 1',
    type: 'secret',
    section: 'keys',
    table: 'udrop_key1',
    default: '',
    placeholder: 'Enter UDrop API Key 1',
  },
  {
    key: 'udropKey2',
    label: 'UDrop API Key 2',
    type: 'secret',
    section: 'keys',
    table: 'udrop_key2',
    default: '',
    placeholder: 'Enter UDrop API Key 2',
  },
  {
    key: 'teraboxCookie',
    label: 'TeraBox Cookie',
    type: 'textarea',
    section: 'keys',
    table: null,
    default: '',
    placeholder: 'ndus=...; browserid=...',
    hint: 'Session cookie used by the extension for TeraBox uploads/resolves.',
  },
  {
    key: 'neonDatabaseUrl',
    label: 'Neon Database URL',
    type: 'secret',
    section: 'cloud',
    table: null,
    default: '',
    placeholder: 'postgresql://...',
    hint: 'Neon connection string used by the extension storage layer.',
  },
  {
    key: 'defaultGallerySource',
    label: 'Default Image Source',
    type: 'select',
    section: 'prefs',
    table: 'default_gallery_source',
    default: 'imgbb',
    options: IMAGE_SOURCE_SETTING_OPTIONS,
  },
  {
    key: 'defaultVideoSource',
    label: 'Default Video Source',
    type: 'select',
    section: 'prefs',
    table: 'default_video_source',
    default: 'filemoon',
    options: VIDEO_SOURCE_SETTING_OPTIONS,
  },
  {
    key: 'default3DSource',
    label: 'Default 3D Source',
    type: 'select',
    section: 'prefs',
    table: 'default_3d_source',
    default: 'udrop',
    options: THREE_D_SOURCE_SETTING_OPTIONS,
  },
  {
    key: 'downloadFolder',
    label: 'Download Folder',
    type: 'text',
    section: 'prefs',
    table: null,
    default: '',
    placeholder: 'C:\\Users\\Admin\\Videos',
    hint: 'Default folder for native-host video downloads.',
  },
]

export const SETTINGS_DEFAULTS = Object.fromEntries(
  SETTINGS_FIELDS.map((field) => [field.key, field.default]),
)

export const TABLE_SETTINGS_FIELDS = SETTINGS_FIELDS.filter((field) => field.table)

export function getSettingsSectionFields(sectionId) {
  return SETTINGS_FIELDS.filter((field) => field.section === sectionId)
}

// payload for a public.settings upsert - only table-backed fields, coerced,
// validated against their option lists. unknown select values are kept as-is
// (never silently rewritten to the default).
export function buildTableSettingsPayload(settings) {
  const payload = {}
  for (const field of TABLE_SETTINGS_FIELDS) {
    const raw = settings?.[field.key]
    const value =
      raw === undefined || raw === null || raw === ''
        ? field.default
        : String(raw)
    payload[field.key] = value
  }
  return payload
}
