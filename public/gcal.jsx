/* Google Calendar direct-send integration
 * --------------------------------------------------------------------------
 * Creates events directly on primary calendar with sendUpdates=all so
 * attendees are emailed — no redirect through calendar.google.com.
 *
 * Setup required ONCE (Google Cloud Console):
 *   1. https://console.cloud.google.com → create or pick a project
 *   2. Enable "Google Calendar API"
 *   3. APIs & Services → Credentials → Create OAuth 2.0 Client ID (Web app)
 *      Authorized JavaScript origins: http://localhost:PORT (where dashboard runs)
 *   4. Copy the Client ID and paste it in the meeting modal config panel.
 *
 * Exposes on window:
 *   gcalHasClientId() → bool
 *   gcalGetClientId() → string
 *   gcalSetClientId(id) → void (persists in localStorage)
 *   gcalCreate({title, date, time, duration, attendees, description}) → Promise<Result>
 *     Result: { ok, mode, id?, htmlLink?, invitedCount?, reason? }
 *   gcalList({timeMin, timeMax, q?, maxResults?}) → Promise<Result>
 *     Result: { ok, mode, items?, reason? }   // items = Google Calendar events
 * -------------------------------------------------------------------------- */
(function () {
  const SCOPE = [
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/contacts.readonly',
    'https://www.googleapis.com/auth/contacts.other.readonly',
  ].join(' ');
  const GIS_SRC = 'https://accounts.google.com/gsi/client';
  let contactsCache = null;

  let tokenClient    = null;
  let accessToken    = null;
  let tokenExpiresAt = 0;
  let gisLoadP       = null;

  const clientId = () => {
    if (typeof window === 'undefined') return '';
    if (window.GCAL_CLIENT_ID) return window.GCAL_CLIENT_ID;
    try { return localStorage.getItem('gcal_client_id') || ''; } catch { return ''; }
  };

  const loadGis = () => {
    if (window.google && window.google.accounts && window.google.accounts.oauth2) return Promise.resolve();
    if (gisLoadP) return gisLoadP;
    gisLoadP = new Promise((resolve, reject) => {
      let s = document.querySelector(`script[src="${GIS_SRC}"]`);
      if (s && s.dataset.loaded === '1') return resolve();
      if (!s) {
        s = document.createElement('script');
        s.src = GIS_SRC; s.async = true; s.defer = true;
        document.head.appendChild(s);
      }
      s.addEventListener('load',  () => { s.dataset.loaded = '1'; resolve(); });
      s.addEventListener('error', () => reject(new Error('Failed to load Google Identity Services')));
    });
    return gisLoadP;
  };

  const getToken = () => new Promise((resolve, reject) => {
    const id = clientId();
    if (!id) return reject(Object.assign(new Error('no-client-id'), { code: 'no-client-id' }));
    if (accessToken && Date.now() < tokenExpiresAt) return resolve(accessToken);

    const onToken = (resp) => {
      if (resp.error) return reject(new Error(resp.error_description || resp.error));
      accessToken    = resp.access_token;
      tokenExpiresAt = Date.now() + ((resp.expires_in || 3600) - 30) * 1000;
      resolve(accessToken);
    };

    if (!tokenClient || tokenClient._clientId !== id) {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: id, scope: SCOPE, callback: onToken,
      });
      tokenClient._clientId = id;
    } else {
      tokenClient.callback = onToken;
    }
    tokenClient.requestAccessToken({ prompt: accessToken ? '' : 'consent' });
  });

  const fmtIso = (date, time) => {
    const [y, m, d]  = date.split('-').map(Number);
    const [hh, mm]   = time.split(':').map(Number);
    const dt         = new Date(y, m - 1, d, hh, mm, 0);
    const tzMin      = -dt.getTimezoneOffset();
    const sign       = tzMin >= 0 ? '+' : '-';
    const abs        = Math.abs(tzMin);
    const pad        = (n) => String(n).padStart(2, '0');
    return `${y}-${pad(m)}-${pad(d)}T${pad(hh)}:${pad(mm)}:00${sign}${pad(Math.floor(abs/60))}:${pad(abs%60)}`;
  };

  window.gcalHasClientId = () => !!clientId();
  window.gcalGetClientId = () => clientId();
  window.gcalSetClientId = (id) => {
    try { localStorage.setItem('gcal_client_id', (id || '').trim()); } catch {}
    accessToken = null; tokenExpiresAt = 0; tokenClient = null;
    contactsCache = null;
  };

  window.gcalCreate = async ({ title, date, time, duration, attendees, description }) => {
    if (!clientId()) return { ok: false, mode: 'no-client' };
    try {
      await loadGis();
      const token = await getToken();
      const startIsoStr = fmtIso(date, time);
      const startDt     = new Date(startIsoStr);
      const endDt       = new Date(startDt.getTime() + (Number(duration) || 30) * 60000);
      const pad         = (n) => String(n).padStart(2, '0');
      const endIsoStr   = fmtIso(
        `${endDt.getFullYear()}-${pad(endDt.getMonth()+1)}-${pad(endDt.getDate())}`,
        `${pad(endDt.getHours())}:${pad(endDt.getMinutes())}`,
      );
      const emails = (attendees || []).filter(a => /@/.test(a));
      const names  = (attendees || []).filter(a => !/@/.test(a));
      const body = {
        summary: title,
        start: { dateTime: startIsoStr },
        end:   { dateTime: endIsoStr   },
      };
      if (emails.length) body.attendees = emails.map(e => ({ email: e }));
      const descParts = [];
      if (description) descParts.push(description);
      if (names.length) descParts.push(`Invitees (unresolved): ${names.join(', ')}`);
      if (descParts.length) body.description = descParts.join('\n\n');

      const res = await fetch(
        'https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type':  'application/json',
          },
          body: JSON.stringify(body),
        }
      );
      if (!res.ok) {
        const err = await res.text().catch(() => '');
        return { ok: false, mode: 'error', status: res.status, reason: err.slice(0, 240) };
      }
      const data = await res.json();
      return {
        ok: true, mode: 'api',
        id: data.id, htmlLink: data.htmlLink,
        invitedCount: emails.length,
      };
    } catch (e) {
      return { ok: false, mode: 'error', reason: String(e.message || e) };
    }
  };

  // List events in a time window. timeMin/timeMax are ISO strings (with TZ).
  window.gcalList = async ({ timeMin, timeMax, q, maxResults } = {}) => {
    if (!clientId()) return { ok: false, mode: 'no-client' };
    try {
      await loadGis();
      const token = await getToken();
      const params = new URLSearchParams();
      if (timeMin) params.set('timeMin', timeMin);
      if (timeMax) params.set('timeMax', timeMax);
      params.set('singleEvents', 'true');
      params.set('orderBy', 'startTime');
      params.set('maxResults', String(maxResults || 50));
      if (q) params.set('q', q);
      const res = await fetch(
        'https://www.googleapis.com/calendar/v3/calendars/primary/events?' + params.toString(),
        { headers: { 'Authorization': `Bearer ${token}` } }
      );
      if (!res.ok) {
        const err = await res.text().catch(() => '');
        return { ok: false, mode: 'error', status: res.status, reason: err.slice(0, 240) };
      }
      const data = await res.json();
      return { ok: true, mode: 'api', items: data.items || [] };
    } catch (e) {
      return { ok: false, mode: 'error', reason: String(e.message || e) };
    }
  };

  // Fetch the user's Gmail contacts (saved + "other") for autocomplete.
  // Dedupes by email, caches in memory for the session.
  // Returns { ok, items: [{name, email}] } or { ok: false, mode, reason }.
  window.gcalListContacts = async () => {
    if (contactsCache) return { ok: true, items: contactsCache };
    if (!clientId()) return { ok: false, mode: 'no-client' };
    try {
      await loadGis();
      const token = await getToken();
      const headers = { 'Authorization': `Bearer ${token}` };

      const [connectionsRes, otherRes] = await Promise.all([
        fetch('https://people.googleapis.com/v1/people/me/connections?personFields=names,emailAddresses&pageSize=1000&sortOrder=LAST_MODIFIED_DESCENDING', { headers }),
        fetch('https://people.googleapis.com/v1/otherContacts?readMask=names,emailAddresses&pageSize=1000', { headers }),
      ]);

      if (!connectionsRes.ok && !otherRes.ok) {
        const err = await connectionsRes.text().catch(() => '');
        const lowered = err.toLowerCase();
        if (lowered.includes('people api') || lowered.includes('has not been used') || lowered.includes('disabled')) {
          return { ok: false, mode: 'api-disabled', reason: 'Enable the People API at console.cloud.google.com/apis/library/people.googleapis.com' };
        }
        return { ok: false, mode: 'error', reason: err.slice(0, 240) };
      }

      const flatten = (data) => {
        const arr = (data && (data.connections || data.otherContacts)) || [];
        const out = [];
        for (const p of arr) {
          const name = p.names && p.names[0] && (p.names[0].displayName || p.names[0].unstructuredName);
          for (const ea of (p.emailAddresses || [])) {
            if (ea.value) out.push({ name: name || '', email: ea.value });
          }
        }
        return out;
      };

      const merged = [];
      const seen = new Set();
      const push = (list) => {
        for (const c of list) {
          const key = c.email.toLowerCase();
          if (!seen.has(key)) { seen.add(key); merged.push(c); }
        }
      };
      if (connectionsRes.ok) push(flatten(await connectionsRes.json()));
      if (otherRes.ok)       push(flatten(await otherRes.json()));

      contactsCache = merged;
      return { ok: true, items: merged };
    } catch (e) {
      return { ok: false, mode: 'error', reason: String(e.message || e) };
    }
  };
})();
