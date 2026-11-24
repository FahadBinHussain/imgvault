# Probe the extension's upload state before a reload (2.19.40 guard).
# Opens a read-only probe in a BACKGROUND tab, reads chrome.storage.local
# (uploadActive / uploadStatus / uploadRun), closes the tab, prints exactly
# one line:
#   UPLOAD_STATE:<json>         — the storage snapshot
#   UPLOAD_STATE_ERROR:<msg>    — the probe itself could not run
# Never focuses a tab, never touches the user's tabs, never writes storage.
# Two probe paths: the dedicated probe page (2.19.40+), falling back to the
# app shell (index.html, every version) so the guard also works while an
# older version is still loaded.
import time

EXT_ID = "cjialghkacooiecjckibhcifilfiibnn"
PROBE_URL = "chrome-extension://%s/probe-upload-state.html" % EXT_ID
APP_URL = "chrome-extension://%s/index.html" % EXT_ID


def _field(item, name):
    if isinstance(item, dict):
        return item.get(name)
    return getattr(item, name, None)


def _open_probe_tab(url):
    """Open a background tab and attach the daemon to it. Returns targetId."""
    created = cdp("Target.createTarget", url=url, background=True)
    target_id = created.get("targetId") if isinstance(created, dict) else None
    tab = None
    try:
        for candidate in list_tabs():
            if _field(candidate, "id") == target_id or _field(candidate, "url") == url:
                tab = candidate
                break
    except Exception:
        tab = None
    if tab is not None:
        switch_tab(tab)
    elif target_id:
        switch_tab(target_id)
    return target_id


def _close_tab(target_id):
    if not target_id:
        return
    try:
        cdp("Target.closeTarget", targetId=target_id)
    except Exception:
        pass


def _poll_js(expression, seconds):
    deadline = time.time() + seconds
    while time.time() < deadline:
        try:
            value = js(expression)
        except Exception:
            value = ""
        if value:
            return str(value).strip()
        time.sleep(0.5)
    return ""


def _probe_via_page():
    target_id = _open_probe_tab(PROBE_URL)
    try:
        return _poll_js(
            "document.getElementById('result') ? document.getElementById('result').textContent : ''",
            6,
        )
    finally:
        _close_tab(target_id)


def _probe_via_app():
    target_id = _open_probe_tab(APP_URL)
    try:
        js("chrome.storage.local.get(['uploadActive','uploadStatus','uploadRun'], function(r){ window.__imgvaultProbe = JSON.stringify({uploadActive: !!r.uploadActive, uploadStatus: String(r.uploadStatus||''), runFileName: (r.uploadRun&&r.uploadRun.fileName)||'', runKind: (r.uploadRun&&r.uploadRun.kind)||'', runStatus: (r.uploadRun&&r.uploadRun.status)||''}); })")
        return _poll_js("window.__imgvaultProbe || ''", 8)
    finally:
        _close_tab(target_id)


try:
    result = _probe_via_page()
    if not result:
        # The loaded version has no probe page yet (pre-2.19.40) or the page
        # failed to report — read storage through the app shell instead.
        result = _probe_via_app()
    if result:
        print("UPLOAD_STATE:" + result)
    else:
        print("UPLOAD_STATE_ERROR:neither probe page nor app shell reported within the timeout")
except Exception as exc:
    print("UPLOAD_STATE_ERROR:" + str(exc))
