// Drift catch for the web re-export shims: the logic lives once in
// packages/shared, so each shim must import cleanly and re-export the SAME
// functions (identical references, identical key set). The shared logic
// itself is NOT re-tested here.
import test from 'node:test'
import assert from 'node:assert/strict'

import * as imageShim from '../src/lib/image-provider-links.js'
import * as imageShared from 'imgvault-shared/imageProviderLinks.js'
import * as videoShim from '../src/lib/video-provider-links.js'
import * as videoShared from 'imgvault-shared/videoProviderLinks.js'
import * as catalogShim from '../src/lib/providerCatalog.js'
import * as catalogShared from 'imgvault-shared/providerCatalog.js'
import * as limitsShim from '../src/lib/hostUploadLimits.js'
import * as limitsShared from 'imgvault-shared/hostUploadLimits.js'

function checkShim(t, name, shim, shared) {
  t.test(`${name}: exports the same key set as shared`, () => {
    assert.deepEqual(Object.keys(shim).sort(), Object.keys(shared).sort())
  })
  t.test(`${name}: every export is the identical shared reference`, () => {
    for (const key of Object.keys(shared)) {
      assert.equal(shim[key], shared[key], `${name}.${key} drifted from shared`)
    }
  })
}

test('web re-export shims mirror packages/shared', async (t) => {
  checkShim(t, 'image-provider-links', imageShim, imageShared)
  checkShim(t, 'video-provider-links', videoShim, videoShared)
  checkShim(t, 'providerCatalog', catalogShim, catalogShared)
  checkShim(t, 'hostUploadLimits', limitsShim, limitsShared)
})

test('shims expose the exports the web lib files actually import', () => {
  assert.equal(typeof imageShim.getStrictImageProviderLink, 'function')
  assert.equal(typeof imageShim.getImageProviderLabel, 'function')
  assert.equal(typeof imageShim.getImageProviderLinks, 'function')
  assert.equal(typeof videoShim.getStrictVideoProviderLink, 'function')
  assert.equal(typeof videoShim.getVideoProviderLabel, 'function')
  assert.equal(typeof videoShim.getVideoProviderLinks, 'function')
  assert.equal(typeof videoShim.getPlayableVideoProviderLink, 'function')
  assert.equal(typeof catalogShim.DEFAULT_VAULT_BLOB_HOST, 'string')
  assert.equal(typeof limitsShim.describeHostUploadLimit, 'function')
  assert.equal(typeof limitsShim.partitionHostsByUploadLimit, 'function')
})
