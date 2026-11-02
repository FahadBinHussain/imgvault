// integration test: a resumed terabox upload must never create a second copy
// of the file.
// run:  node test-terabox-resume-create.mjs
// why this exists: an interrupted upload (telegram failed, terabox had
// already finished) was resumed, and the resume called the pcs `create` call
// again - which made a SECOND copy of the video on the account.
//
// providerCatalog.js is imported FIRST on purpose: uploaders.js and
// providerCatalog.js import each other, and loading the catalog first
// resolves the cycle so the uploader can be imported in plain node.
import './src/config/providerCatalog.js';
const { TeraBoxUploader } = await import('./src/utils/uploaders.js');

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

// --- chrome stub --------------------------------------------------------
const store = new Map();
globalThis.chrome = {
  storage: {
    local: {
      get: async (keys) => {
        const wanted = Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : [...store.keys()]);
        const out = {};
        for (const key of wanted) {
          if (store.has(key)) out[key] = store.get(key);
        }
        return out;
      },
      set: async (obj) => {
        for (const [k, v] of Object.entries(obj)) store.set(k, v);
      },
      remove: async (key) => { store.delete(key); },
    },
    sync: { get: async () => ({}), set: async () => {} },
  },
  tabs: {
    create: async () => ({ id: 1 }),
    get: (id, cb) => cb({ id, status: 'complete', url: 'https://www.terabox.com/' }),
    remove: async () => {},
  },
  scripting: { executeScript: async () => [{ result: '' }] },
  cookies: { getAll: async () => [] },
};

const TOKEN_HTML = 'function%20fn%28a%29%7Bwindow.jsToken%20%3D%20a%7D%3Bfn%28%22TESTTOKEN1234567890%22%29';

const makeFetch = ({ existingFile = null } = {}) => {
  const calls = { create: 0, uploadChunk: 0, precreate: 0, filemetas: 0 };
  globalThis.fetch = async (url) => {
    const u = String(url);
    const json = (payload) => ({ ok: true, status: 200, url: u, json: async () => payload });
    const text = (payload) => ({ ok: true, status: 200, url: u, text: async () => payload, json: async () => ({}) });
    if (u.includes('/api/create')) { calls.create += 1; return json({ errno: 0, fs_id: 'NEWFSID', path: '/movie.mp4' }); }
    if (u.includes('/api/precreate')) { calls.precreate += 1; return json({ errno: 0, uploadid: 'NEWUPLOADID' }); }
    // the chunk upload goes to the host returned by locateupload, as
    // .../rest/2.0/pcs/file?method=upload
    if (u.includes('method=upload') || u.includes('/api/upload')) { calls.uploadChunk += 1; return json({ errno: 0, md5: 'x'.repeat(32) }); }
    if (u.includes('/api/filemetas')) {
      calls.filemetas += 1;
      return json(existingFile ? { errno: 0, info: [existingFile] } : { errno: 0, info: [] });
    }
    if (u.includes('locateupload')) { return json({ host: 'https://d.pcs.terabox.com' }); }
    if (u.startsWith('https://www.terabox.com/')) { return text(TOKEN_HTML); }
    return json({ errno: 0 });
  };
  return calls;
};

const MB = 1024 * 1024;
const SIZE = 20 * MB;
const CHUNK = 4 * MB;
const CHUNKS = 5;
const fullBlockList = Array.from({ length: CHUNKS }, (_, i) => String(i).repeat(32));

const run = async ({ existingFile, resumeState }) => {
  const calls = makeFetch({ existingFile });
  const uploader = new TeraBoxUploader();
  const blob = new Blob([new Uint8Array(SIZE)]);
  const sessionStates = [];
  let result = null;
  let error = null;
  try {
    result = await uploader.uploadWithProgress(
      blob,
      'ndus=test-session',
      'movie.mp4',
      () => {},
      undefined,
      {
        resumeState,
        onSessionState: async (state) => { sessionStates.push(state); },
      }
    );
  } catch (err) {
    error = err;
  }
  return { calls, result, error, sessionStates };
};

// --- 1. the file is already on the account: never create it again -------
const existing = {
  fs_id: 'EXISTINGFSID',
  path: '/movie.mp4',
  server_filename: 'movie.mp4',
  size: SIZE,
  dlink: 'https://d.pcs.terabox.com/existing-dlink',
};
const reuse = await run({
  existingFile: existing,
  resumeState: {
    uploadid: 'session-1', path: '/movie.mp4', size: SIZE, chunkSize: CHUNK,
    blockList: fullBlockList, created: true, createdPath: '/movie.mp4',
  },
});
check('a resume does not fail', !reuse.error, reuse.error?.message || '');
check('the pcs create call is NOT made again', reuse.calls.create === 0, `create calls: ${reuse.calls.create}`);
check('no chunk is uploaded again', reuse.calls.uploadChunk === 0, `chunk calls: ${reuse.calls.uploadChunk}`);
check('the existing file is reused', reuse.result?.fileId === 'EXISTINGFSID', reuse.result?.fileId);
check('the reused result points at the existing download link',
  reuse.result?.directUrl === existing.dlink, reuse.result?.directUrl);
check('the session state records that the file exists',
  reuse.sessionStates.some((s) => s.created === true), JSON.stringify(reuse.sessionStates.map((s) => s.created)));

// --- 2. the blocks are there but create() never ran: create it once -----
const create = await run({
  existingFile: null,
  resumeState: {
    uploadid: 'session-2', path: '/movie.mp4', size: SIZE, chunkSize: CHUNK,
    blockList: fullBlockList,
  },
});
check('a resume that never created the file creates it exactly once',
  create.calls.create === 1, `create calls: ${create.calls.create}`);
check('still no chunk is uploaded', create.calls.uploadChunk === 0, `chunk calls: ${create.calls.uploadChunk}`);

// --- 3. it was created but is gone: refuse, never guess ------------------
const gone = await run({
  existingFile: null,
  resumeState: {
    uploadid: 'session-3', path: '/movie.mp4', size: SIZE, chunkSize: CHUNK,
    blockList: fullBlockList, created: true, createdPath: '/movie.mp4',
  },
});
check('a created-but-missing file fails loudly', Boolean(gone.error), gone.error?.message || 'no error');
check('a created-but-missing file is NOT created again', gone.calls.create === 0, `create calls: ${gone.calls.create}`);
check('the error says the file was already created',
  /already created/i.test(String(gone.error?.message || '')), gone.error?.message || '');

// --- 4. a normal (non-resume) upload still creates exactly one file ------
const fresh = await run({ existingFile: null, resumeState: null });
check('a fresh upload creates the file once', fresh.calls.create === 1, `create calls: ${fresh.calls.create}${fresh.error ? ` err=${fresh.error.message}` : ''}`);
check('a fresh upload sends every chunk', fresh.calls.uploadChunk === CHUNKS, `chunk calls: ${fresh.calls.uploadChunk}${fresh.error ? ` err=${fresh.error.message}` : ''}`);
check('a fresh upload precreates a session', fresh.calls.precreate === 1, `precreate calls: ${fresh.calls.precreate}`);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} pass`);
process.exit(failed.length ? 1 : 0);
