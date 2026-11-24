// probe-upload-state.js - read-only probe behind probe-upload-state.html
// (opened by tools/probe-upload-state.py before a reload). No side effects:
// it never writes storage, never sends messages, never touches the DOM
// beyond its own #result node — so probing cannot disturb a live upload.
// The result lands in #result text AND document.title so the probe script
// can read it either way.
(async () => {
  const el = document.getElementById('result');
  try {
    const state = await chrome.storage.local.get(['uploadActive', 'uploadStatus', 'uploadRun']);
    const payload = {
      uploadActive: Boolean(state.uploadActive),
      uploadStatus: String(state.uploadStatus || ''),
      runFileName: state.uploadRun?.fileName || '',
      runKind: state.uploadRun?.kind || '',
      runStatus: state.uploadRun?.status || '',
    };
    const text = JSON.stringify(payload);
    if (el) el.textContent = text;
    document.title = `probe:${text}`;
  } catch (error) {
    const text = JSON.stringify({ error: String(error && error.message ? error.message : error) });
    if (el) el.textContent = text;
    document.title = `probe:${text}`;
  }
})();
