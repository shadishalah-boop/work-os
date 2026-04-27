/* global window */
// =============================================================================
// helper-client.jsx — shim that talks to ~/Documents/Claude/dashboard-helper.
//
// Provides:
//   window.DashboardHelper.send({ channel, text, thread_ts? })
//     → resolves with { ok, ts, channel, permalink } on success
//     → throws on failure (network / 4xx / 5xx)
//
//   window.DashboardHelper.delete({ channel, ts })
//     → resolves with { ok }
//
//   window.DashboardHelper.parsePermalink(url)
//     → { channel, thread_ts }
//
//   window.DashboardHelper.online (boolean) — live status
//   subscribe via: window.DashboardHelper.onStatus(fn)
//
//   window.DashboardHelper.toast(message, { kind, undo, undoLabel })
//     → shows a toast with optional undo
// =============================================================================

(function () {
  const HELPER_URL = 'http://127.0.0.1:8788';
  const STATUS_POLL_MS = 30000;

  // --- Status polling --------------------------------------------------------
  let online = false;
  const statusListeners = new Set();
  async function checkHealth() {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 2000);
      const res = await fetch(HELPER_URL + '/health', { signal: ctrl.signal });
      clearTimeout(t);
      const data = await res.json().catch(() => null);
      const next = Boolean(data && data.ok);
      if (next !== online) {
        online = next;
        statusListeners.forEach(fn => { try { fn(online); } catch {} });
      }
    } catch {
      if (online) {
        online = false;
        statusListeners.forEach(fn => { try { fn(online); } catch {} });
      }
    }
  }
  setInterval(checkHealth, STATUS_POLL_MS);
  checkHealth();

  // --- Slack URL parsing -----------------------------------------------------
  function parsePermalink(url) {
    if (!url) return { channel: null, thread_ts: null };
    const ch = url.match(/\/archives\/([A-Z0-9]+)/);
    const tt = url.match(/[?&]thread_ts=([\d.]+)/);
    return {
      channel: ch ? ch[1] : null,
      thread_ts: tt ? tt[1] : null,
    };
  }

  // --- API calls -------------------------------------------------------------
  // The helper runs in `mcp-bridge` mode: requests get queued to
  // ~/.claude/dashboard-outbox/ and processed by Claude (via Slack MCP) when
  // active. If Claude isn't around, the helper times out at ~25s and returns
  // {queued: true, id}, in which case we poll /slack/result/:id for up to
  // RESULT_POLL_MAX_MS more before giving up gracefully.
  const RESULT_POLL_INTERVAL_MS = 1500;
  const RESULT_POLL_MAX_MS = 90_000;

  async function pollForResult(id) {
    const deadline = Date.now() + RESULT_POLL_MAX_MS;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, RESULT_POLL_INTERVAL_MS));
      try {
        const res = await fetch(HELPER_URL + '/slack/result/' + encodeURIComponent(id));
        const data = await res.json().catch(() => ({}));
        if (res.status === 404) continue; // still queued
        if (!res.ok || !data.ok) {
          const err = new Error(data.error || ('helper ' + res.status));
          throw err;
        }
        return data;
      } catch (err) {
        if (err.name === 'TypeError') continue; // network blip; keep polling
        throw err;
      }
    }
    return { ok: false, queued: true, id, error: 'still queued (Claude not active)' };
  }

  async function postWithQueueAwareness(endpoint, payload) {
    const res = await fetch(HELPER_URL + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 202 && data.queued && data.id) {
      // Helper accepted but Claude wasn't around in time; keep polling.
      return await pollForResult(data.id);
    }
    if (!res.ok || !data.ok) {
      const err = new Error(data.error || ('helper ' + res.status));
      err.code = data.error;
      throw err;
    }
    return data;
  }

  const send      = (payload) => postWithQueueAwareness('/slack/send',   payload);
  const deleteMsg = (payload) => postWithQueueAwareness('/slack/delete', payload);

  // --- Toast UI --------------------------------------------------------------
  let toastEl = null;
  let toastTimer = null;
  function ensureToast() {
    if (toastEl) return toastEl;
    toastEl = document.createElement('div');
    toastEl.className = 'dh-toast';
    document.body.appendChild(toastEl);
    return toastEl;
  }
  function toast(message, opts = {}) {
    const { kind = 'info', undo = null, undoLabel = 'Undo', durationMs = 5000 } = opts;
    const el = ensureToast();
    el.className = 'dh-toast dh-toast-' + kind;
    el.innerHTML = '';
    const msg = document.createElement('span');
    msg.className = 'dh-toast-msg';
    msg.textContent = message;
    el.appendChild(msg);
    if (typeof undo === 'function') {
      const btn = document.createElement('button');
      btn.className = 'dh-toast-undo';
      btn.textContent = undoLabel;
      btn.onclick = async () => {
        clearTimeout(toastTimer);
        try { await undo(); toast('Undone', { kind: 'info', durationMs: 1800 }); }
        catch (e) { toast('Undo failed: ' + e.message, { kind: 'error', durationMs: 3000 }); }
      };
      el.appendChild(btn);
    }
    el.classList.add('dh-toast-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('dh-toast-show'), durationMs);
  }

  // --- Convenience: send with toast + undo -----------------------------------
  // Shows a "Sending…" toast immediately, then upgrades to "Sent · Undo" on
  // success, or "Queued · waiting for Claude" if Claude isn't around to
  // process the queue within ~2 minutes.
  async function sendWithUndo({ channel, text, thread_ts, where }) {
    if (!channel || !text) throw new Error('channel and text required');
    toast(`Sending${where ? ' to ' + where : ''}…`, { kind: 'info', durationMs: 90_000 });
    let result;
    try {
      result = await send({ channel, text, thread_ts });
    } catch (e) {
      toast(`Send failed: ${e.message || 'unknown'}`, { kind: 'error', durationMs: 4000 });
      throw e;
    }
    if (result.queued) {
      toast(`Queued${where ? ' for ' + where : ''} · will send when Claude is active`, { kind: 'info', durationMs: 6000 });
      return result;
    }
    // No Slack delete tool available via MCP, so "Undo" turns into "Open" —
    // a one-click jump to the sent message so you can delete or edit it
    // manually in Slack if you misclicked.
    const openSent = result.permalink
      ? () => { window.open(result.permalink, '_blank', 'noopener'); }
      : null;
    toast(`Sent${where ? ' to ' + where : ''}`, {
      kind: 'success',
      undo: openSent,
      undoLabel: 'Open',
      durationMs: 6000,
    });
    return result;
  }

  // --- Public API ------------------------------------------------------------
  window.DashboardHelper = {
    send,
    sendWithUndo,
    deleteMsg,
    parsePermalink,
    toast,
    onStatus(fn) { statusListeners.add(fn); fn(online); return () => statusListeners.delete(fn); },
    get online() { return online; },
    HELPER_URL,
  };
})();
