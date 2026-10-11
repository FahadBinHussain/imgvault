#!/usr/bin/env node
// phase-2/3b drift guard (plan-platform-parity.md): the logic twins (media field registry,
// media db payload, media item normalizer, provider links, provider catalog metadata) and
// the phase-3 ui twins (MediaDetailModal, Modal, Spinner) live ONLY in packages/ (shared
// and ui). This fails loudly when:
//   1. a pre-phase-2 twin location reappears (shared/ at repo root, web/src/shared/)
//   2. a known shim file grows anything beyond re-exports
//   3. a twin implementation filename exists anywhere outside packages/ (and is not a known shim)
//   4. the extension runtime catalog layer stops importing the shared catalog or re-defines metadata
// run locally: pnpm check:twins (root). wired into .github/workflows/nextgen-extension-crx.yml.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const problems = [];
const fail = (msg) => problems.push(msg);

// 1. banned directories (the two pre-phase-2 twin locations)
for (const banned of ['shared', 'web/src/shared']) {
  if (existsSync(join(root, banned))) {
    fail(`banned directory exists: ${banned}/ — implementations belong in packages/shared/ only`);
  }
}

// 2. known shims must contain ONLY re-export lines (comments/blank lines allowed)
const SHIM_ALLOWLIST = {
  'web/src/lib/providerCatalog.js': ['imgvault-shared/providerCatalog.js'],
  'web/src/lib/image-provider-links.js': ['imgvault-shared/imageProviderLinks.js'],
  'web/src/lib/video-provider-links.js': ['imgvault-shared/videoProviderLinks.js'],
  'nextgen-extension/src/utils/imageProviderLinks.js': [
    'imgvault-shared/imageProviderLinks.js',
    '../config/providerCatalog.js',
  ],
  'nextgen-extension/src/utils/videoProviderLinks.js': [
    'imgvault-shared/videoProviderLinks.js',
    '../config/providerCatalog.js',
  ],
  // phase 3b: extension detail modal is a re-export of the canonical packages/ui copy
  'nextgen-extension/src/components/MediaDetailModal.jsx': ['imgvault-ui'],
};
const SHIM_LINE = /^(export \* from '[^']+';|export \{[^}]+\} from '[^']+';)$/;
for (const [rel, allowedSources] of Object.entries(SHIM_ALLOWLIST)) {
  const path = join(root, rel);
  if (!existsSync(path)) {
    fail(`shim missing: ${rel}`);
    continue;
  }
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('//') || line.startsWith('/*') || line.startsWith('*')) continue;
    if (!SHIM_LINE.test(line)) {
      fail(`${rel} contains non-re-export logic: ${line}`);
      continue;
    }
    const source = line.match(/from '([^']+)'/)?.[1];
    if (source && !allowedSources.includes(source)) {
      fail(`${rel} re-exports unexpected module: ${source}`);
    }
  }
}

// 3. twin implementation filenames must not exist anywhere outside packages/
const TWIN_BASENAMES = new Set([
  'mediaFieldRegistry.js',
  'mediaDbPayload.js',
  'mediaItemNormalizer.js',
  'imageProviderLinks.js',
  'videoProviderLinks.js',
  'image-provider-links.js',
  'video-provider-links.js',
  // phase 3: canonical copies in packages/ui (imgvault-ui)
  'MediaDetailModal.jsx',
  'Modal.jsx',
  'Spinner.jsx',
]);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.next', 'artifacts', 'target', 'coverage']);
const scan = (dir) => {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      scan(full);
      continue;
    }
    if (!TWIN_BASENAMES.has(entry)) continue;
    const rel = relative(root, full).split('\\').join('/');
    if (rel.startsWith('packages/')) continue;
    if (rel in SHIM_ALLOWLIST) continue;
    fail(`twin implementation outside packages/: ${rel}`);
  }
};
scan(root);

// 4. extension runtime catalog layer: imports shared catalog, never re-defines metadata
{
  const rel = 'nextgen-extension/src/config/providerCatalog.js';
  const path = join(root, rel);
  if (!existsSync(path)) {
    fail(`${rel} missing`);
  } else {
    const src = readFileSync(path, 'utf8');
    if (!src.includes("from 'imgvault-shared/providerCatalog.js'")) {
      fail(`${rel} must import from 'imgvault-shared/providerCatalog.js'`);
    }
    for (const marker of ['sourceLabel:', 'vaultBlobHost:']) {
      if (src.includes(marker)) {
        fail(`${rel} re-defines catalog metadata (${marker}) — metadata belongs in packages/shared/providerCatalog.js`);
      }
    }
  }
}

if (problems.length > 0) {
  console.error('shared-twins guard FAILED:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('shared-twins guard OK — implementations live only in packages/');
