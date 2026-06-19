/* global React, ReactDOM, SEED, Icon, Module, Top3, TasksMod, CalendarMod, MeetingLoad, InboxMod,
          SlackMod, ProjectsMod, KpiMod, TeamMod, BlockersMod, ShippedMod, PinsMod, WellnessMod, CommitmentsMod,
          DraggableBox, FindModal, AddTaskModal, AddMeetingModal, VoiceSummaryModal */

const { useState: uS, useEffect: uE, useMemo: uM } = React;

// Read-only view mode — append ?view=read to the dashboard URL to share a clean
// snapshot. Hides edit/drag affordances; the data, lens, and what-changed strip
// remain visible. The body attribute is read by CSS rules in dashboard-d.css.
(function detectReadOnlyMode() {
  try {
    const url = new URL(window.location.href);
    const isRead = url.searchParams.get('view') === 'read';
    if (!isRead) return;
    document.body.dataset.readonly = 'true';
    window.__DASHBOARD_READ_ONLY__ = true;

    // Inject a banner so the viewer always knows they're in a read-only snapshot
    // and has a one-click escape back to the live dashboard.
    const exitUrl = (() => {
      const u = new URL(window.location.href);
      u.searchParams.delete('view');
      return u.pathname + (u.search ? u.search : '');
    })();
    const banner = document.createElement('div');
    banner.className = 'readonly-banner';
    banner.innerHTML = '<span>Read-only view · shared snapshot of this dashboard</span><a href="' + exitUrl + '">Exit read-only →</a>';
    document.body.insertBefore(banner, document.body.firstChild);
  } catch (e) { /* no-op */ }
})();

// Test mode for the meeting-prep card: append ?prep-test=1 to the dashboard URL
// to inject a synthetic event 15 min from now. Uses attendee first-names that
// appear in the live data so the prep columns populate. Zero impact when off.
(function maybeInjectTestMeeting() {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('prep-test')) return;
    const now = new Date();
    const start = new Date(now.getTime() + 15 * 60 * 1000);
    const time = `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`;
    window.SEED = window.SEED || {};
    window.SEED.calendar = window.SEED.calendar || [];
    window.SEED.calendar.unshift({
      id: 'test-prep',
      time,
      duration: 30,
      title: 'Test prep · imminent meeting',
      type: 'meeting',
      who: ['Sam', 'Priya', 'Theo'],
    });
    console.log('[prep-test] injected synthetic meeting at', time, '— remove ?prep-test=1 to clear');
  } catch (e) { /* no-op */ }
})();

// =============================================================================
// Sidebar rail (shared)
// =============================================================================
function Rail() {
  const items = [
    { icon: 'home', active: true },
    { icon: 'check-circle', dot: true },
    { icon: 'calendar' },
    { icon: 'messages', dot: true },
    { icon: 'progress' },
    { icon: 'user-group' },
    { icon: 'insights' },
    { icon: 'library' },
  ];
  const _av = window.SEED && window.SEED.user && (window.SEED.user.avatar || window.SEED.user.avatarUrl);
  return (
    <aside className="rail">
      {_av
        ? <img className="rail-logo" src={_av} alt="" style={{width:36,height:36,borderRadius:10,objectFit:'cover'}}/>
        : <div className="rail-logo">{((window.SEED && window.SEED.user && window.SEED.user.name) || 'W')[0].toUpperCase()}</div>}
      {items.map((it, i) => (
        <div key={i} className="rail-item" data-active={it.active}>
          <Icon name={it.icon} size={22}/>
          {it.dot && <span className="dot"/>}
        </div>
      ))}
      <div className="rail-spacer"/>
      <div className="rail-item"><Icon name="settings" size={22}/></div>
      <div style={{marginTop:8}}>
        <span className="pds-avatar size-32"><img src={_av || 'ds/assets/avatar-default.svg'} alt="You"/></span>
      </div>
    </aside>
  );
}

// =============================================================================
// Live wall clock — ticks every 15s, shows HH:MM + weekday/date
// =============================================================================
function LiveClock() {
  const [now, setNow] = uS(new Date());
  uE(() => {
    const t = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(t);
  }, []);
  const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  const date = now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  return (
    <div style={{
      display:'flex', flexDirection:'column', alignItems:'flex-end',
      justifyContent:'center', padding:'2px 10px', lineHeight:1.1,
      borderRight:'1px solid var(--border-default)', marginRight:4,
    }}>
      <span style={{
        fontFamily:'JetBrains Mono, ui-monospace, monospace',
        fontSize:18, fontWeight:600, color:'var(--fg-1)',
        fontFeatureSettings:'"tnum"', letterSpacing:'-0.01em',
      }}>{time}</span>
      <span style={{
        fontSize:10, color:'var(--fg-2)',
        textTransform:'uppercase', letterSpacing:'0.06em', fontWeight:600,
      }}>{date}</span>
    </div>
  );
}

// =============================================================================
// Time-aware greeting hero
// =============================================================================

// Auto-detect time of day from the current hour.
// 5am–12pm = morning · 12pm–6pm = afternoon · 6pm–5am = evening
function detectTimeOfDay() {
  const h = new Date().getHours();
  if (h >= 5  && h < 12) return 'morning';
  if (h >= 12 && h < 18) return 'afternoon';
  return 'evening';
}

// Build a live subtitle from state — picks the most relevant 1–3 stats for the
// time of day. Updates as state changes (priorities checked off, etc).
function buildHeroSubtitle(tod, state) {
  const top3       = (state && state.top3) || [];
  const overdue    = (state && state.overdue) || [];
  const shipped    = (state && state.shipped) || [];
  const calendar   = (state && state.calendar) || [];
  const decisions  = (window.SEED && window.SEED.decisions) || [];
  const slackTabs  = (window.SEED && window.SEED.slack && window.SEED.slack.tabs) || [];
  const blockers   = (window.SEED && window.SEED.blockers) || [];
  const mentions   = (slackTabs.find(t => t.id === 'mentions') || {}).count || 0;
  const repliesOwed= (slackTabs.find(t => t.id === 'owed') || {}).count || 0;
  const highBlock  = blockers.filter(b => b.sev === 'high').length;
  const remaining  = top3.filter(t => !t.done).length;
  const shippedToday = shipped.length;
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const meetingsLeft = calendar.filter(e => {
    if (e.type === 'focus') return false;
    const [h, m] = (e.time || '00:00').split(':').map(Number);
    return (h * 60 + m) > nowMin;
  }).length;

  const parts = [];
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  if (tod === 'morning') {
    if (remaining > 0)         parts.push(`${plural(remaining, 'priority').replace('prioritys','priorities')} for today`);
    if (overdue.length > 0)    parts.push(`${overdue.length} overdue carrying over`);
    else if (meetingsLeft > 0) parts.push(`${plural(meetingsLeft, 'meeting')} ahead`);
    if (parts.length === 0)    parts.push("Calendar's clear — pick one big thing and ship it.");
  } else if (tod === 'afternoon') {
    if (remaining > 0)        parts.push(`${plural(remaining, 'priority').replace('prioritys','priorities')} left`);
    if (decisions.length > 0) parts.push(`${plural(decisions.length, 'decision')} pending`);
    else if (highBlock > 0)   parts.push(`${plural(highBlock, 'blocker')} stalled`);
    else if (mentions > 0)    parts.push(`${plural(mentions, 'Slack mention')}`);
    if (parts.length === 0)   parts.push("On top of it. Push one stretch goal.");
  } else {
    if (shippedToday > 0)     parts.push(`${shippedToday} shipped`);
    if (overdue.length > 0)   parts.push(`${overdue.length} carrying into tomorrow`);
    else if (decisions.length > 0) parts.push(`${plural(decisions.length, 'decision')} still queued`);
    if (repliesOwed > 0)      parts.push(`${plural(repliesOwed, 'reply')} owed`);
    if (parts.length === 0)   parts.push("Clear runway — sign off and rest.");
  }
  return parts.join(' · ');
}

// Strip atop the dashboard showing deltas since last view (count-based diff).
// Click "Mark seen" → resets snapshot to current. Resets daily automatically.
function WhatChangedStrip({ state }) {
  const [snapshot, setSnapshot] = uS(loadSnapshot);
  const current = buildDashboardSnapshot(state);

  uE(() => {
    if (!snapshot) {
      // First view today → silently capture baseline.
      saveSnapshot(current);
      setSnapshot(current);
    }
    // eslint-disable-next-line
  }, []);

  if (!snapshot) return null;
  const diffs = diffSnapshots(snapshot, current);
  if (!diffs.length) return null;

  const since = new Date(snapshot.ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="what-changed-strip">
      <span className="wc-label">Since {since}</span>
      <span className="wc-dot">·</span>
      <span className="wc-diffs">{diffs.join(' · ')}</span>
      <button
        className="wc-mark-seen"
        onClick={() => { saveSnapshot(current); setSnapshot(current); }}
      >mark seen</button>
    </div>
  );
}

// Contextual card surfaced when a meeting is imminent (≤60 min away).
// Cross-references the next event's attendees against open Gmail threads,
// owed tasks (overdue + dueSoon), and pending decisions — the prep work
// you'd otherwise have to gather by tab-hopping right before joining.
function MeetingPrepCard() {
  const [now, setNow] = uS(() => new Date());
  uE(() => {
    const id = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(id);
  }, []);

  const event = uM(() => {
    const cal = (window.SEED && window.SEED.calendar) || [];
    if (!cal.length) return null;
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const toMin = (t) => { const [h, m] = (t || '0:0').split(':').map(Number); return h * 60 + m; };
    const up = cal.find(e => toMin(e.time) > nowMin);
    if (!up) return null;
    return { ...up, startsIn: toMin(up.time) - nowMin };
  }, [now]);

  if (!event || event.startsIn < 0 || event.startsIn > 60) return null;
  // Focus blocks aren't meetings — no prep needed.
  if (event.type === 'focus') return null;

  // Attendees come back as first names from the calendar agent; '+N' overflow tokens are skipped.
  const attendees = (event.who || []).filter(n => n && !/^\+\d+$/.test(n));

  const matches = (text) => {
    if (!text || !attendees.length) return false;
    const lc = text.toLowerCase();
    return attendees.some(n => lc.includes(n.toLowerCase()));
  };

  const threads = attendees.length
    ? ((window.SEED && window.SEED.inbox) || [])
        .filter(t => matches(t.from) || matches(t.title))
        .slice(0, 2)
    : [];

  const owed = attendees.length
    ? []
        .concat((window.SEED && window.SEED.overdue) || [])
        .concat((window.SEED && window.SEED.dueSoon) || [])
        .filter(t => matches(t.label) || matches(t.meta))
        .slice(0, 2)
    : [];

  const decisions = attendees.length
    ? ((window.SEED && window.SEED.decisions) || [])
        .filter(d => matches(d.label) || matches(d.meta))
        .slice(0, 2)
    : [];

  const hasContent = threads.length || owed.length || decisions.length;

  const cols = [];
  if (threads.length) {
    cols.push({
      label: 'Open with them',
      items: threads.map(t => ({
        key: t.id || t.title,
        primary: (t.from || '').split(' ')[0],
        secondary: t.title,
        href: t.href || null,
      })),
    });
  }
  if (owed.length) {
    cols.push({
      label: 'Action items',
      items: owed.map(t => ({
        key: t.id || t.label,
        primary: t.label,
        secondary: t.meta || '',
        href: t.href || null,
      })),
    });
  }
  if (decisions.length) {
    cols.push({
      label: 'Decisions pending',
      items: decisions.map(d => ({
        key: d.id || d.label,
        primary: d.label,
        secondary: d.meta || '',
        href: d.href || null,
      })),
    });
  }

  const startLabel = event.startsIn <= 0 ? 'Now' : `In ${event.startsIn}m`;
  const attendeesLabel = attendees.length
    ? `with ${attendees.slice(0, 3).join(', ')}${attendees.length > 3 ? ` +${attendees.length - 3}` : ''}`
    : 'no attendees on invite';

  return (
    <div className="meeting-prep-card">
      <div className="mp-header">
        <span className="mp-pill">{startLabel}</span>
        <span className="mp-title" title={event.title}>{event.title}</span>
        <span className="mp-attendees">{attendeesLabel}</span>
      </div>
      {hasContent ? (
        <div className="mp-grid" style={{ gridTemplateColumns: `repeat(${cols.length}, 1fr)` }}>
          {cols.map((c, i) => (
            <div key={i} className="mp-col">
              <div className="mp-col-label">{c.label}</div>
              {c.items.map(it => {
                const inner = (
                  <>
                    {it.primary && <strong>{it.primary}</strong>}
                    {it.secondary && <span className="dim">{it.primary ? ' · ' : ''}{it.secondary}</span>}
                  </>
                );
                return it.href
                  ? <a key={it.key} className="mp-item" href={it.href} target="_blank" rel="noreferrer" title={`${it.primary || ''} ${it.secondary || ''}`.trim()}>{inner}</a>
                  : <div key={it.key} className="mp-item" title={`${it.primary || ''} ${it.secondary || ''}`.trim()}>{inner}</div>;
              })}
            </div>
          ))}
        </div>
      ) : (
        <div className="mp-empty">
          {attendees.length
            ? 'No open threads, owed actions, or decisions surfaced for these attendees.'
            : 'No prep context — invite has no listed attendees in the calendar feed.'}
        </div>
      )}
    </div>
  );
}

// Side drawer that pivots the dashboard around one person — every owed action,
// open thread, decision, blocker, and today's meetings tied to them. Triggered by
// clicking a row in the Team module. Closes on backdrop click or ESC.
function StakeholderLens({ person, onClose }) {
  uE(() => {
    if (!person) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [person, onClose]);

  if (!person) return null;

  // Build a name-token list to match against task/email text (>=3 chars to skip 'a', 'an' etc.)
  const tokens = (person.name || '').split(/\s+/).filter(t => t.length >= 3);
  const matches = (text) => {
    if (!text) return false;
    const lc = text.toLowerCase();
    return tokens.some(t => lc.includes(t.toLowerCase()));
  };
  const matchesArr = (arr) => Array.isArray(arr) && arr.some(n => tokens.some(t => n && n.toLowerCase().includes(t.toLowerCase())));

  const S = window.SEED || {};

  const owedToThem = []
    .concat(S.top3 || [], S.overdue || [], S.dueSoon || [])
    .filter(t => !t.done && (matches(t.label) || matches(t.meta)));

  const waitingOn = (S.blocked || [])
    .filter(t => !t.done && (matches(t.label) || matches(t.meta)));

  const inbox = (S.inbox || [])
    .filter(i => matches(i.from) || matches(i.title));

  const decisions = (S.decisions || [])
    .filter(d => matches(d.who) || matches(d.label) || matches(d.title) || matches(d.meta));

  const blockers = (S.blockers || [])
    .filter(b => matches(b.title) || matches(b.meta));

  const meetings = (S.calendar || [])
    .filter(e => matchesArr(e.who));

  // Past meetings together — populated by the granola agent on /dashboard refresh.
  // Each entry: { date: 'YYYY-MM-DD', title: string, attendees: string[] }
  const meetingHistory = (S.meetingHistory || [])
    .filter(m => matchesArr(m.attendees) || matches(m.title))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .slice(0, 5);

  // Derive a "last met" hint from the most recent matching past meeting.
  const lastMet = meetingHistory[0] || null;

  const firstName = (person.name || '').split(' ')[0];
  const gmailHref = `https://mail.google.com/mail/u/0/#search/from%3A(${encodeURIComponent(person.name)})`;
  const _ws = (window.SEED && window.SEED.slack && window.SEED.slack.workspace) || 'app';
  const slackHref = `https://${_ws}.slack.com/search?query=${encodeURIComponent(person.name)}`;

  const Section = ({ title, items, render }) =>
    items.length === 0 ? null : (
      <section className="lens-section">
        <h3>{title} <span className="lens-count">{items.length}</span></h3>
        {items.map((it, i) => (
          <div key={it.id || i} className="lens-item">{render(it)}</div>
        ))}
      </section>
    );

  const totalCount = owedToThem.length + waitingOn.length + inbox.length + decisions.length + blockers.length + meetings.length + meetingHistory.length;

  return (
    <div className="lens-overlay" onClick={onClose}>
      <aside className="lens-drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`Stakeholder lens · ${person.name}`}>
        <header className="lens-header">
          <span className="pds-avatar size-48"><img src="ds/assets/avatar-default.svg" alt={person.name}/></span>
          <div className="lens-id">
            <div className="lens-name">{person.name}{person.manager && <span className="lens-manager">MGR</span>}</div>
            <div className="lens-role">{person.note || ''}</div>
            {lastMet && (
              <div className="lens-lastmet">
                Last met <strong>{lastMet.date}</strong> · {lastMet.title}
              </div>
            )}
          </div>
          <button className="lens-close" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className="lens-actions">
          <a className="btn btn--tertiary btn--sm" href={gmailHref} target="_blank" rel="noreferrer">
            <Icon name="mail" size={14}/>Gmail
          </a>
          <a className="btn btn--tertiary btn--sm" href={slackHref} target="_blank" rel="noreferrer">
            <Icon name="message" size={14}/>Slack
          </a>
          <span className="lens-stamp">{totalCount} item{totalCount === 1 ? '' : 's'} surfaced</span>
        </div>

        <div className="lens-body">
          <Section title="You owe them" items={owedToThem} render={t => (
            <>
              <div className="lens-item-label">{t.label}</div>
              {t.meta && <div className="lens-item-meta">{t.meta}</div>}
            </>
          )}/>

          <Section title="Waiting on them" items={waitingOn} render={t => (
            <>
              <div className="lens-item-label">{t.label}</div>
              {t.meta && <div className="lens-item-meta">{t.meta}</div>}
            </>
          )}/>

          <Section title="Decisions" items={decisions} render={d => (
            <>
              <div className="lens-item-label">{d.label || d.title}</div>
              {d.meta && <div className="lens-item-meta">{d.meta}</div>}
              {d.href && <a className="lens-item-link" href={d.href} target="_blank" rel="noreferrer">Open →</a>}
            </>
          )}/>

          <Section title="Inbox threads" items={inbox} render={i => (
            <>
              <div className="lens-item-label">{i.title}</div>
              <div className="lens-item-meta">from {i.from}</div>
              {i.href && <a className="lens-item-link" href={i.href} target="_blank" rel="noreferrer">Open →</a>}
            </>
          )}/>

          <Section title="Blockers involving them" items={blockers} render={b => (
            <>
              <div className="lens-item-label">{b.title}</div>
              {b.meta && <div className="lens-item-meta">{b.meta}</div>}
            </>
          )}/>

          <Section title="Today's meetings" items={meetings} render={m => (
            <>
              <div className="lens-item-label">{m.time} · {m.title}</div>
              <div className="lens-item-meta">with {(m.who || []).filter(n => !/^\+\d+$/.test(n)).join(', ')}</div>
            </>
          )}/>

          <Section title="Recent meetings together" items={meetingHistory} render={m => (
            <>
              <div className="lens-item-label">{m.date} · {m.title}</div>
              {m.attendees && m.attendees.length > 0 && (
                <div className="lens-item-meta">with {m.attendees.filter(n => !/^\+\d+$/.test(n)).slice(0, 5).join(', ')}</div>
              )}
            </>
          )}/>

          {totalCount === 0 && meetingHistory.length === 0 && (
            <div className="lens-empty">
              Nothing tied to {firstName} in the current data.<br/>
              <span style={{fontSize:11, opacity:0.7}}>If that feels wrong, try refreshing with /dashboard.</span>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

// Log decision modal — captures what was decided + why for future traceability.
// Triggered via 'dash:log-decision' event with detail = { title, who?, source?, sourceMeta? }.
// Stores to localStorage.dashboard.decisionArchive.v1; also fires task-added if
// the originating decision had an attached pending-decisions id (so the row can
// be removed from the pending list).
function LogDecisionModal({ open, prefill, onClose }) {
  const [title, setTitle] = uS('');
  const [reasoning, setReasoning] = uS('');
  const [outcome, setOutcome] = uS('approved'); // approved | declined | deferred

  uE(() => {
    if (!open) return;
    setTitle(prefill ? (prefill.title || '') : '');
    setReasoning('');
    setOutcome('approved');
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, prefill, onClose]);

  if (!open) return null;

  const submit = () => {
    const t = title.trim();
    if (!t) return;
    const dec = {
      id: 'da-' + Date.now(),
      ts: new Date().toISOString(),
      title: t,
      reasoning: reasoning.trim(),
      outcome,
      who: prefill && prefill.who || null,
      source: prefill && prefill.source || 'manual',
      sourceMeta: prefill && prefill.sourceMeta || null,
      sourceId: prefill && prefill.sourceId || null,
    };
    saveArchivedDecision(dec);
    window.dispatchEvent(new CustomEvent('dash:toast', { detail: {
      msg: '✓ Decision logged: ' + (t.length > 50 ? t.slice(0, 47) + '…' : t),
      kind: 'success',
    }}));
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel log-decision-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-search">
          <Icon name="check" size={16}/>
          <span style={{flex: 1, fontSize: 14, fontWeight: 600}}>Log decision</span>
          <button className="btn btn--ghost btn--sm" onClick={onClose}>ESC</button>
        </div>
        <div className="log-dec-body">
          <label className="log-dec-field">
            <span className="log-dec-label">What was decided</span>
            <input
              autoFocus
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Approve the vendor contract"
            />
          </label>
          <label className="log-dec-field">
            <span className="log-dec-label">Outcome</span>
            <div className="log-dec-radios">
              <label><input type="radio" checked={outcome==='approved'} onChange={()=>setOutcome('approved')}/> Approved</label>
              <label><input type="radio" checked={outcome==='declined'} onChange={()=>setOutcome('declined')}/> Declined</label>
              <label><input type="radio" checked={outcome==='deferred'} onChange={()=>setOutcome('deferred')}/> Deferred</label>
            </div>
          </label>
          <label className="log-dec-field">
            <span className="log-dec-label">Reasoning <span className="log-dec-hint">(why this call — for future you)</span></span>
            <textarea
              value={reasoning}
              onChange={e => setReasoning(e.target.value)}
              placeholder="Key tradeoff, who pushed for it, what changed your mind…"
              rows={5}
            />
          </label>
          {prefill && prefill.who && (
            <div className="log-dec-context">Stakeholder: <strong>{prefill.who}</strong></div>
          )}
          {prefill && prefill.sourceMeta && (
            <div className="log-dec-context">Source: <em>{prefill.sourceMeta}</em></div>
          )}
          <div className="log-dec-footer">
            <button className="btn btn--ghost btn--sm" onClick={onClose}>Cancel</button>
            <button className="btn btn--primary btn--sm" onClick={submit} disabled={!title.trim()}>Log it</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Share modal — generates a paste-ready text digest of selected sections.
// Reads from window.SEED so it works at DashboardApp level without context wiring.
// The read-only URL is intentionally NOT a primary action since it's local-only;
// it's tucked into a small Preview link for screenshot/screen-share use.
const SHARE_SECTIONS = [
  { key: 'top3',      label: 'Top 3 today',         defaultOn: true  },
  { key: 'overdue',   label: 'Overdue',             defaultOn: true  },
  { key: 'dueSoon',   label: 'Due soon',            defaultOn: true  },
  { key: 'blocked',   label: 'Blocked',             defaultOn: false },
  { key: 'decisions', label: 'Decisions pending',   defaultOn: true  },
  { key: 'blockers',  label: 'Risks & blockers',    defaultOn: false },
  { key: 'projects',  label: 'Active projects',     defaultOn: false },
  { key: 'okrs',      label: 'OKRs (summary per OKR)', defaultOn: true  },
];

function ShareModal({ open, onClose }) {
  const [selected, setSelected] = uS(() => {
    const map = {};
    SHARE_SECTIONS.forEach(s => { map[s.key] = s.defaultOn; });
    return map;
  });
  const [format, setFormat] = uS('markdown'); // 'markdown' | 'plain'

  uE(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const toggle = (k) => setSelected(prev => ({ ...prev, [k]: !prev[k] }));
  const allOn  = () => setSelected(Object.fromEntries(SHARE_SECTIONS.map(s => [s.key, true])));
  const allOff = () => setSelected(Object.fromEntries(SHARE_SECTIONS.map(s => [s.key, false])));

  const readOnlyUrl = (() => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('view', 'read');
      url.searchParams.delete('prep-test');
      url.searchParams.delete('capture');
      return url.toString();
    } catch { return window.location.href; }
  })();

  const buildDigest = () => {
    const S = window.SEED || {};
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    const md = format === 'markdown';
    const lines = [];
    const h1 = (s) => md ? `# ${s}` : s.toUpperCase();
    const h2 = (s) => md ? `## ${s}` : `\n${s}\n${'-'.repeat(s.length)}`;
    const bul = (s) => md ? `- ${s}` : `• ${s}`;
    const bold = (s) => md ? `**${s}**` : s;
    const em = (s) => md ? `_${s}_` : s;

    // Read live user-toggled state from localStorage so the digest reflects
    // your current view, not the static SEED. doneStore = locally-marked-done,
    // dismissed = items you swiped/hid. Both keyed by normalized task label.
    const doneStore = loadDoneTasks();
    const dismissed = loadDismissedTasks();
    const isArchived = (label) => normalizeTaskKey(label) in doneStore;
    const isDismissed = (label) => normalizeTaskKey(label) in dismissed;
    const isOpen = (t) => t && !t.done && !isArchived(t.label || t.title) && !isDismissed(t.label || t.title);

    lines.push(h1(`${((window.SEED && window.SEED.user && window.SEED.user.name) || 'My')}'s dashboard · ${today}`));
    lines.push('');

    if (selected.top3) {
      const top3 = (S.top3 || []).filter(isOpen);
      if (top3.length) {
        lines.push(h2('Top 3 today'));
        top3.forEach(t => lines.push(bul(`${bold(t.label)} — ${em(t.meta || '')}`)));
        lines.push('');
      }
    }
    if (selected.overdue) {
      const overdue = (S.overdue || []).filter(isOpen);
      if (overdue.length) {
        lines.push(h2(`Overdue (${overdue.length})`));
        overdue.forEach(t => lines.push(bul(`${t.label} — ${em(t.meta || '')}`)));
        lines.push('');
      }
    }
    if (selected.dueSoon) {
      const dueSoon = (S.dueSoon || []).filter(isOpen);
      if (dueSoon.length) {
        lines.push(h2(`Due soon (${dueSoon.length})`));
        dueSoon.slice(0, 8).forEach(t => lines.push(bul(`${t.label} — ${em(t.meta || '')}`)));
        lines.push('');
      }
    }
    if (selected.blocked) {
      const blocked = (S.blocked || []).filter(isOpen);
      if (blocked.length) {
        lines.push(h2(`Blocked (${blocked.length})`));
        blocked.forEach(t => lines.push(bul(`${t.label} — ${em(t.meta || '')}`)));
        lines.push('');
      }
    }
    if (selected.decisions) {
      const decisions = S.decisions || [];
      if (decisions.length) {
        lines.push(h2(`Decisions pending (${decisions.length})`));
        decisions.forEach(d => lines.push(bul(`${d.title || d.label} — ${em(d.meta || '')}`)));
        lines.push('');
      }
    }
    if (selected.blockers) {
      const blockers = S.blockers || [];
      if (blockers.length) {
        lines.push(h2(`Risks & blockers (${blockers.length})`));
        blockers.forEach(b => lines.push(bul(`${bold('[' + (b.sev || 'med') + ']')} ${b.title} — ${em(b.meta || '')}`)));
        lines.push('');
      }
    }
    if (selected.projects) {
      const projects = S.projects || [];
      if (projects.length) {
        lines.push(h2(`Active projects (${projects.length})`));
        projects.forEach(p => lines.push(bul(`${bold(p.name)} · ${p.status} · ${p.pct}% — ${em(p.meta || '')}`)));
        lines.push('');
      }
    }
    if (selected.okrs) {
      const okrs = S.okrs || [];
      if (okrs.length) {
        // Build the OKR → items map by combining manual tags + keyword suggestions.
        // Items locally marked done get promoted to the 'done' bucket regardless of
        // their source list. Dismissed items are skipped entirely.
        const links = loadOkrLinks();
        const classify = (items, defaultKind) =>
          (items || []).map(it => {
            const label = it.label || it.title || '';
            const meta  = it.meta || '';
            if (isDismissed(label)) return null;
            const tag   = links[normalizeTaskKey(label)] || suggestOkrFromText(label, meta);
            if (!tag) return null;
            const done  = it.done || isArchived(label);
            const kind  = done ? 'done' : defaultKind;
            return { tag, label, meta, kind };
          }).filter(Boolean);

        const tagged = []
          .concat(classify(S.top3,      'in-progress'))
          .concat(classify(S.overdue,   'in-progress'))
          .concat(classify(S.dueSoon,   'in-progress'))
          .concat(classify(S.blocked,   'blocked'))
          .concat(classify(S.shipped,   'done'))
          .concat(classify(S.decisions, 'decision'));

        const byOkr = {};
        okrs.forEach(k => { byOkr[k.id] = { done: [], 'in-progress': [], blocked: [], decision: [] }; });
        tagged.forEach(t => { if (byOkr[t.tag]) byOkr[t.tag][t.kind].push(t); });

        // --- Synthesis helpers — turn item lists into a one-paragraph narrative ---
        // condense: drop parenthetical clauses, hard-trim very long labels.
        // Keep original casing so proper nouns (names, product names, etc.) stay correct.
        const condense = (label) => {
          let t = (label || '').replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
          if (t.length > 80) t = t.slice(0, 77) + '…';
          return t;
        };
        const joinClauses = (items, max = 3) => {
          const top = items.slice(0, max).map(it => condense(it.label));
          const extra = items.length - top.length;
          if (!top.length) return '';
          let s = top.join('; ');
          if (extra > 0) s += `; +${extra} more`;
          return s;
        };
        const synthesize = (g) => {
          const parts = [];
          if (g.done.length)            parts.push(`${bold('Done this week:')} ${joinClauses(g.done)}.`);
          if (g['in-progress'].length)  parts.push(`${bold('In progress:')} ${joinClauses(g['in-progress'])}.`);
          if (g.blocked.length)         parts.push(`${bold('Blocked:')} ${joinClauses(g.blocked)}.`);
          if (g.decision.length)        parts.push(`${bold('Decisions pending:')} ${joinClauses(g.decision)}.`);
          return parts.join(' ');
        };

        lines.push(h2('OKRs'));
        okrs.forEach(k => {
          lines.push('');
          lines.push(`${bold(k.id)} · ${k.name} · ${k.pct}% · ${k.trend}`);
          const groups = byOkr[k.id] || { done: [], 'in-progress': [], blocked: [], decision: [] };
          const totalCount = groups.done.length + groups['in-progress'].length + groups.blocked.length + groups.decision.length;
          if (totalCount === 0) {
            lines.push(em('No items tagged or matched this week.'));
            return;
          }
          lines.push(synthesize(groups));
        });
        lines.push('');
      }
    }

    return lines.join('\n').trimEnd();
  };

  const digest = buildDigest();
  const sectionCount = Object.values(selected).filter(Boolean).length;
  const hasContent = digest.split('\n').length > 2; // more than just title + blank

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(digest);
      window.dispatchEvent(new CustomEvent('dash:toast', { detail: { msg: `Copied (${sectionCount} section${sectionCount === 1 ? '' : 's'})`, kind: 'success' } }));
    } catch {
      window.dispatchEvent(new CustomEvent('dash:toast', { detail: { msg: 'Clipboard blocked — try selecting the preview text manually', kind: 'error' } }));
    }
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel share-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-search">
          <Icon name="share" size={16}/>
          <span style={{flex: 1, fontSize: 14, fontWeight: 600}}>Share dashboard snapshot</span>
          <button className="btn btn--ghost btn--sm" onClick={onClose}>ESC</button>
        </div>

        <div className="share-body">
          <div className="share-toolbar">
            <span className="share-toolbar-label">Sections</span>
            <button className="btn btn--ghost btn--xs" onClick={allOn}>All</button>
            <button className="btn btn--ghost btn--xs" onClick={allOff}>None</button>
            <span style={{flex: 1}}/>
            <span className="share-format">
              <label><input type="radio" name="fmt" checked={format==='markdown'} onChange={() => setFormat('markdown')}/> Markdown</label>
              <label><input type="radio" name="fmt" checked={format==='plain'}    onChange={() => setFormat('plain')}/> Plain</label>
            </span>
          </div>

          <div className="share-sections">
            {SHARE_SECTIONS.map(s => (
              <label key={s.key} className="share-section-row">
                <input type="checkbox" checked={!!selected[s.key]} onChange={() => toggle(s.key)}/>
                <span>{s.label}</span>
              </label>
            ))}
          </div>

          <div className="share-preview-h">
            <span>Preview</span>
            <span className="share-preview-stamp">{digest.split('\n').length} lines · ~{digest.length} chars</span>
          </div>
          <textarea
            className="share-preview"
            value={hasContent ? digest : 'Pick at least one section to preview the digest.'}
            readOnly
            rows={10}
          />

          <div className="share-footer">
            <a className="share-footer-link" href={readOnlyUrl} target="_blank" rel="noreferrer" title="Local-only — for screenshots / screen share">
              <Icon name="eye" size={12}/> Preview read-only view (local)
            </a>
            <span style={{flex: 1}}/>
            <button className="btn btn--ghost btn--sm" onClick={onClose}>Cancel</button>
            <button className="btn btn--primary btn--sm" onClick={copy} disabled={!hasContent}>
              <Icon name="copy" size={14}/> Copy to clipboard
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Hero({ timeOfDay, data, capacityPct, state }) {
  const openFind    = () => window.dispatchEvent(new Event('dash:open-find'));
  const openAddTask = () => window.dispatchEvent(new Event('dash:open-add-task'));
  const g = (window.SEED && window.SEED.greeting) || {};
  const who = (window.SEED && window.SEED.user && window.SEED.user.name) || 'there';
  const greeting =
    timeOfDay === 'morning'   ? (g.morning   || `Morning, <em>${who}</em>.`)   :
    timeOfDay === 'afternoon' ? (g.afternoon || `Afternoon, <em>${who}</em>.`) :
                                (g.evening   || `Evening, <em>${who}</em>.`);
  const sub = buildHeroSubtitle(timeOfDay, state);
  const w = (window.SEED && window.SEED.weather) || null;
  return (
    <div className="hero">
      <div>
        <h1 dangerouslySetInnerHTML={{__html: greeting}}/>
        <div className="hero-meta">
          <span>{sub}</span>
        </div>
        {w && (
          <div className="weather-strip" style={{
            display: 'flex', alignItems: 'center', gap: 12,
            marginTop: 10, fontSize: 12, color: 'var(--fg-2)',
            fontFeatureSettings: '"tnum"',
          }}>
            <span style={{
              textTransform: 'uppercase', letterSpacing: '0.06em',
              fontWeight: 600, color: 'var(--fg-3, var(--fg-2))',
            }}>{w.city}</span>
            {w.days.map((d, i) => (
              <React.Fragment key={i}>
                <span style={{color: 'var(--border-default)'}}>·</span>
                <span>
                  <strong style={{color: 'var(--fg-1)', fontWeight: 600}}>{d.label}</strong>
                  <span style={{margin: '0 6px', fontFamily: 'JetBrains Mono, ui-monospace, monospace'}}>
                    {d.high}°/{d.low}°
                  </span>
                  <span style={{color: 'var(--fg-2)'}}>{d.cond.toLowerCase()}</span>
                </span>
              </React.Fragment>
            ))}
          </div>
        )}
      </div>
      <div className="hero-right">
        <LiveClock/>
        <div className="capacity-pill">
          <span>Capacity</span>
          <div className="bar" style={{'--pct': capacityPct + '%'}}/>
          <span style={{color: capacityPct > 85 ? 'var(--red-600)' : 'var(--fg-1)'}}>{capacityPct}%</span>
        </div>
        <button className="btn btn--secondary btn--sm" onClick={openFind}><Icon name="search" size={14}/>Find anything</button>
        <button className="btn btn--primary btn--sm" onClick={openAddTask}><Icon name="plus" size={14}/>Add task</button>
      </div>
    </div>
  );
}

// =============================================================================
// Tweaks panel
// =============================================================================
function TweaksPanel({ open, setOpen, accent, setAccent, density, setDensity, focus, setFocus, tod, setTod }) {
  return (
    <div className="tweaks-panel" data-open={open}>
      <div className="tweaks-h">
        Tweaks
        <button className="icon-btn" style={{color:'var(--grey-0)'}} onClick={()=>setOpen(false)}><Icon name="close" size={14} style={{filter:'invert(1)'}}/></button>
      </div>
      <div className="tweaks-row">
        <div className="tweaks-label">Accent</div>
        <div className="tweaks-seg swatches">
          <button className="tweaks-swatch tweaks-swatch-pink" data-active={accent==='pink'} onClick={()=>setAccent('pink')} aria-label="Pink"/>
          <button className="tweaks-swatch tweaks-swatch-blue" data-active={accent==='blue'} onClick={()=>setAccent('blue')} aria-label="Blue"/>
          <button className="tweaks-swatch tweaks-swatch-teal" data-active={accent==='teal'} onClick={()=>setAccent('teal')} aria-label="Teal"/>
        </div>
      </div>
      <div className="tweaks-row">
        <div className="tweaks-label">Density</div>
        <div className="tweaks-seg">
          <button data-active={density==='compact'} onClick={()=>setDensity('compact')}>Compact</button>
          <button data-active={density==='comfortable'} onClick={()=>setDensity('comfortable')}>Comfortable</button>
        </div>
      </div>
      <div className="tweaks-row">
        <div className="tweaks-label">Time of day</div>
        <div className="tweaks-seg">
          <button data-active={tod==='morning'}   onClick={()=>setTod('morning')}>AM</button>
          <button data-active={tod==='afternoon'} onClick={()=>setTod('afternoon')}>PM</button>
          <button data-active={tod==='evening'}   onClick={()=>setTod('evening')}>Eve</button>
        </div>
      </div>
      <div className="tweaks-row">
        <div className="tweaks-label">Focus mode (top 3 only)</div>
        <div className="tweaks-seg">
          <button data-active={!focus} onClick={()=>setFocus(false)}>Full</button>
          <button data-active={focus}  onClick={()=>setFocus(true)}>Focus</button>
        </div>
      </div>
      <div style={{fontSize:11, color:'var(--grey-400)', marginTop:12, lineHeight:1.5}}>
        Toggle the ✦ button in the toolbar to show/hide this panel.
      </div>
    </div>
  );
}

// =============================================================================
// Hidden-task stores (localStorage · per-store TTL)
// Two stores, both keyed on normalized task title so they survive /dashboard
// refreshes (which re-id every run):
//   • dismissed — user hit the × · 14-day TTL
//   • done      — user checked it off · auto-archives 4s after click · 12h TTL
// =============================================================================
const DISMISS_KEY = 'dashboard.dismissedTasks.v1';
const DONE_KEY = 'dashboard.doneTasks.v1';
const DISMISS_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const DONE_TTL_MS    = 7 * 24 * 60 * 60 * 1000; // 7 days — agents re-suggest
                                                 // tasks that aren't crossed
                                                 // off in their source (Granola etc.),
                                                 // so 12h was way too short.
const DONE_LINGER_MS = 4000; // how long a done task stays visible before auto-archiving
function normalizeTaskKey(s) {
  return (s || '').toString().toLowerCase().replace(/\s+/g, ' ').trim();
}
function loadStore(key, ttl) {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || '{}');
    const now = Date.now();
    const fresh = {};
    Object.entries(raw).forEach(([k, ts]) => {
      if (typeof ts === 'number' && now - ts < ttl) fresh[k] = ts;
    });
    if (Object.keys(fresh).length !== Object.keys(raw).length) {
      try { localStorage.setItem(key, JSON.stringify(fresh)); } catch {}
    }
    return fresh;
  } catch { return {}; }
}
const loadDismissedTasks = () => loadStore(DISMISS_KEY, DISMISS_TTL_MS);
const loadDoneTasks      = () => loadStore(DONE_KEY,    DONE_TTL_MS);

// =============================================================================
// What-changed snapshot — small "since you last looked" diff strip atop the dashboard.
// Stores a count snapshot in localStorage and surfaces deltas on subsequent loads.
// =============================================================================
const SNAPSHOT_KEY = 'dashboard.lastSnapshot.v1';
function loadSnapshot() {
  try {
    const raw = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || 'null');
    if (!raw || typeof raw.ts !== 'number') return null;
    // Auto-reset if the snapshot is from a different calendar day (Madrid).
    const prevDay = new Date(raw.ts).toDateString();
    const today   = new Date().toDateString();
    if (prevDay !== today) return null;
    return raw;
  } catch { return null; }
}
function saveSnapshot(snap) {
  try { localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snap)); } catch {}
}
function buildDashboardSnapshot(state) {
  const s = (window.SEED || {});
  const slackTabs = (s.slack && s.slack.tabs) || [];
  const findCount = (id) => (slackTabs.find(t => t.id === id) || {}).count || 0;
  return {
    ts: Date.now(),
    top3Done:        state.top3.filter(t => t.done).length,
    top3Total:       state.top3.length,
    overdueCount:    state.overdue.length,
    dueSoonCount:    state.dueSoon.length,
    blockedCount:    state.blocked.length,
    shippedCount:    state.shipped.length,
    decisionsCount:  (s.decisions || []).length,
    blockersHigh:    (s.blockers || []).filter(b => b.sev === 'high').length,
    blockersTotal:   (s.blockers || []).length,
    slackMentions:   findCount('mentions'),
    slackOwed:       findCount('owed'),
    inboxCount:      (s.inbox || []).length,
  };
}
function diffSnapshots(prev, curr) {
  if (!prev) return [];
  const out = [];
  const inc = (label, p, c) => {
    if (c > p) out.push(`+${c - p} ${label}`);
  };
  const dec = (label, p, c) => {
    if (c < p) out.push(`−${p - c} ${label}`);
  };
  if (curr.top3Done > prev.top3Done) out.push(`✓${curr.top3Done - prev.top3Done} priorit${curr.top3Done - prev.top3Done === 1 ? 'y' : 'ies'} done`);
  inc('shipped',          prev.shippedCount,    curr.shippedCount);
  inc('decisions',        prev.decisionsCount,  curr.decisionsCount);
  dec('decisions',        prev.decisionsCount,  curr.decisionsCount);
  inc('Slack mentions',   prev.slackMentions,   curr.slackMentions);
  inc('replies owed',     prev.slackOwed,       curr.slackOwed);
  dec('high blockers',    prev.blockersHigh,    curr.blockersHigh);
  inc('high blockers',    prev.blockersHigh,    curr.blockersHigh);
  inc('overdue',          prev.overdueCount,    curr.overdueCount);
  dec('overdue cleared',  prev.overdueCount,    curr.overdueCount);
  return out;
}

// =============================================================================
// User-added tasks store (localStorage · no TTL · survives /dashboard refreshes)
// "New task" button persists here so manually-added tasks don't vanish when the
// agent JSONs get rewritten. Dismissing a user-added task fully deletes it
// (vs the 14-day-TTL dismiss for agent-sourced tasks).
// =============================================================================
const USER_TASKS_KEY = 'dashboard.userAddedTasks.v1';
function loadUserAddedTasks() {
  try {
    const raw = JSON.parse(localStorage.getItem(USER_TASKS_KEY) || '{}');
    return {
      overdue: Array.isArray(raw.overdue) ? raw.overdue : [],
      dueSoon: Array.isArray(raw.dueSoon) ? raw.dueSoon : [],
      blocked: Array.isArray(raw.blocked) ? raw.blocked : [],
    };
  } catch { return { overdue: [], dueSoon: [], blocked: [] }; }
}
function saveUserAddedTasks(tasks) {
  try { localStorage.setItem(USER_TASKS_KEY, JSON.stringify(tasks)); } catch {}
}

// =============================================================================
// OKR linking — Layers 1+2+3 of the OKR-tracking system.
//   • localStorage persists manual tags across /dashboard refreshes
//   • suggestOkr() runs Layer-3 keyword auto-suggestion at render time
//   • evidenceForOkr() collects everything tied to an OKR for the expanded view
//   • generateReviewMarkdown() composes the Friday review notes
// =============================================================================
// Sidebar (rail) width persistence — user can collapse/expand via button or
// drag the right edge to resize. 56px = icon-only "collapsed" mode.
const RAIL_WIDTH_KEY = 'dashboard.railWidth.v1';
const RAIL_MIN = 56;        // collapsed (icon-only)
const RAIL_MAX = 360;       // any wider eats too much content
const RAIL_SNAP_THRESHOLD = 90; // dragging below this snaps to RAIL_MIN
const RAIL_DEFAULT_EXPANDED = 200;
function loadRailWidth() {
  const v = parseInt(localStorage.getItem(RAIL_WIDTH_KEY) || '', 10);
  if (Number.isFinite(v) && v >= RAIL_MIN && v <= RAIL_MAX) return v;
  return RAIL_DEFAULT_EXPANDED;
}
function saveRailWidth(w) {
  try { localStorage.setItem(RAIL_WIDTH_KEY, String(w)); } catch {}
}

// Decision archive — every "Log decision" submission persists here forever
// (no TTL — the whole point is traceability when a stakeholder asks "why X over Y").
// Keyed locally; export by copying clipboard via the archive view.
const DECISION_ARCHIVE_KEY = 'dashboard.decisionArchive.v1';
function loadArchivedDecisions() {
  try {
    const raw = JSON.parse(localStorage.getItem(DECISION_ARCHIVE_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch { return []; }
}
function saveArchivedDecision(dec) {
  const list = loadArchivedDecisions();
  list.unshift(dec);
  try { localStorage.setItem(DECISION_ARCHIVE_KEY, JSON.stringify(list)); } catch {}
  // Notify any listeners (Stakeholder Lens, archive view) to re-render
  window.dispatchEvent(new CustomEvent('dash:decision-archived', { detail: dec }));
}
function deleteArchivedDecision(id) {
  const list = loadArchivedDecisions().filter(d => d.id !== id);
  try { localStorage.setItem(DECISION_ARCHIVE_KEY, JSON.stringify(list)); } catch {}
  window.dispatchEvent(new CustomEvent('dash:decision-archived', { detail: { id, deleted: true } }));
}

// --- User-pasted OKRs (added from the dashboard's "Paste OKRs" UI) ------------
// Stored in localStorage and merged into SEED.okrs *before* the metadata below is
// built, so the tagger, review-notes, and Projects card all see them. Survives
// /dashboard refreshes (those only rewrite SEED.okrs from config). window.SEED
// already exists by now (data.jsx + data-override.jsx loaded before app.jsx).
const USER_OKRS_KEY = 'dashboard.userOkrs.v1';
function loadUserOkrs() {
  try { const a = JSON.parse(localStorage.getItem(USER_OKRS_KEY) || '[]'); return Array.isArray(a) ? a : []; }
  catch { return []; }
}
// Parse pasted text → OKR objects. One per line: "name | percent | trend"
// (percent and trend optional; trend = on-pace | behind | ahead).
function parseOkrs(text) {
  const out = [];
  (text || '').split(/\r?\n/).forEach((raw) => {
    const line = raw.trim();
    if (!line) return;
    const parts = line.split('|').map(s => s.trim());
    const name = parts[0];
    if (!name) return;
    let pct = 0, trend = 'on-pace';
    if (parts[1]) { const m = parts[1].match(/\d{1,3}/); if (m) pct = Math.max(0, Math.min(100, parseInt(m[0], 10))); }
    if (parts[2]) { const t = parts[2].toLowerCase(); trend = (t.includes('behind') || t.includes('risk')) ? 'behind' : t.includes('ahead') ? 'ahead' : 'on-pace'; }
    const short = ((name.match(/[A-Za-z][A-Za-z0-9]*/g) || []).slice(0, 3).map(w => w[0]).join('').toUpperCase().slice(0, 4)) || 'OKR';
    const keywords = Array.from(new Set(name.toLowerCase().match(/[a-z]{4,}/g) || [])).slice(0, 8);
    out.push({ name, pct, trend, short, keywords });
  });
  return out;
}
function saveUserOkrs(list) {
  const withIds = (list || []).map((o, i) => ({ ...o, id: 'uk' + (i + 1) }));  // uk* never collides with config k1..kN
  try { localStorage.setItem(USER_OKRS_KEY, JSON.stringify(withIds)); } catch { /* quota */ }
  return withIds;
}
window.DashboardOkrs = { KEY: USER_OKRS_KEY, load: loadUserOkrs, parse: parseOkrs, save: saveUserOkrs };
(function mergeUserOkrs() {
  window.SEED = window.SEED || {};
  const base = Array.isArray(window.SEED.okrs) ? window.SEED.okrs : [];
  const ids = new Set(base.map(o => o.id));
  const user = loadUserOkrs().filter(o => !ids.has(o.id));
  if (user.length) window.SEED.okrs = base.concat(user);
})();

const OKR_LINKS_KEY = 'dashboard.okrLinks.v1';
// META + KEYWORDS are derived from the user's OKRs (SEED.okrs, config + pasted) —
// any number, any ids. Per-OKR fields:
//   `short`    — optional 2-4 char pill label (defaults to K1, K2, …)
//   `keywords` — optional lowercase substrings that auto-suggest tags for
//                matching tasks/decisions (empty = manual tagging only)
const OKR_PALETTE = [
  { color: 'var(--pink-400)', bg: 'var(--pink-100)', ink: 'var(--pink-700)' },
  { color: 'var(--teal-500)', bg: 'var(--teal-100)', ink: 'var(--teal-700)' },
  { color: 'var(--blue-400)', bg: 'var(--blue-100)', ink: 'var(--blue-700)' },
  { color: 'var(--yellow-400)', bg: 'var(--yellow-100)', ink: 'var(--grey-900)' },
];
const OKR_META = {};
const OKR_KEYWORDS = {};
((window.SEED && window.SEED.okrs) || []).forEach((o, i) => {
  OKR_META[o.id] = { short: o.short || `K${i + 1}`, ...OKR_PALETTE[i % OKR_PALETTE.length] };
  OKR_KEYWORDS[o.id] = (o.keywords || []).map(k => String(k).toLowerCase());
});
function loadOkrLinks() {
  try {
    const raw = JSON.parse(localStorage.getItem(OKR_LINKS_KEY) || '{}');
    const fresh = {};
    Object.entries(raw).forEach(([k, v]) => { if (OKR_META[v]) fresh[k] = v; });
    return fresh;
  } catch { return {}; }
}
function suggestOkrFromText(title, meta) {
  const text = ' ' + (title || '').toLowerCase() + ' ' + (meta || '').toLowerCase() + ' ';
  const scores = {};
  for (const [okr, kws] of Object.entries(OKR_KEYWORDS)) {
    scores[okr] = 0;
    for (const kw of kws) if (kw && text.includes(kw)) scores[okr] += 1;
  }
  let best = null, bestScore = 0;
  for (const [okr, sc] of Object.entries(scores)) if (sc > bestScore) { best = okr; bestScore = sc; }
  return best;
}

// =============================================================================
// Shared state — single source of truth for the dashboard
// =============================================================================
function useDashboardState() {
  // Initialize task buckets with localStorage user-added tasks merged in front
  // of the agent-sourced SEED tasks. This ensures hand-added tasks survive
  // both page reloads and /dashboard refreshes (which rewrite SEED).
  const _userTasks = loadUserAddedTasks();
  const [top3, setTop3] = uS(SEED.top3);
  const [overdue, setOverdue] = uS([..._userTasks.overdue, ...(SEED.overdue || [])]);
  const [dueSoon, setDueSoon] = uS([..._userTasks.dueSoon, ...(SEED.dueSoon || [])]);
  const [blocked, setBlocked] = uS([..._userTasks.blocked, ...(SEED.blocked || [])]);
  const [calendar, setCalendar] = uS(SEED.calendar);
  const [dismissed, setDismissed] = uS(loadDismissedTasks);
  const [doneStore, setDoneStore] = uS(loadDoneTasks);
  const [okrLinks, setOkrLinks]   = uS(loadOkrLinks);
  const pendingArchiveTimers = React.useRef({});

  const isDismissed = (s) => normalizeTaskKey(s) in dismissed;
  const isArchived  = (s) => normalizeTaskKey(s) in doneStore;
  const isHidden    = (s) => isDismissed(s) || isArchived(s);

  const writeStore = (key, setFn, label) => {
    const k = normalizeTaskKey(label);
    if (!k) return;
    setFn(prev => {
      const next = { ...prev, [k]: Date.now() };
      try { localStorage.setItem(key, JSON.stringify(next)); } catch {}
      return next;
    });
  };
  const dismissTask = (s) => {
    const k = normalizeTaskKey(s);
    if (!k) return;
    // If this is a user-added task, fully delete it from the localStorage store
    // (no point hiding it for 14 days when the user explicitly wants it gone).
    const stored = loadUserAddedTasks();
    let foundInUserStore = false;
    ['overdue', 'dueSoon', 'blocked'].forEach(bucket => {
      const before = stored[bucket].length;
      stored[bucket] = stored[bucket].filter(t => normalizeTaskKey(t.label) !== k);
      if (stored[bucket].length !== before) foundInUserStore = true;
    });
    if (foundInUserStore) {
      saveUserAddedTasks(stored);
      // Also remove from React state for immediate UI feedback
      setOverdue(prev => prev.filter(t => normalizeTaskKey(t.label) !== k));
      setDueSoon(prev => prev.filter(t => normalizeTaskKey(t.label) !== k));
      setBlocked(prev => prev.filter(t => normalizeTaskKey(t.label) !== k));
      return;
    }
    // Otherwise: regular dismiss (14-day TTL, can resurface)
    writeStore(DISMISS_KEY, setDismissed, s);
  };
  const archiveDoneTask = (s) => {
    const k = normalizeTaskKey(s);
    // If it's a user-added task, fully delete it from the user store (so it
    // doesn't resurface in 12h when DONE_KEY expires).
    const stored = loadUserAddedTasks();
    let touchedUserStore = false;
    ['overdue', 'dueSoon', 'blocked'].forEach(bucket => {
      const before = stored[bucket].length;
      stored[bucket] = stored[bucket].filter(t => normalizeTaskKey(t.label) !== k);
      if (stored[bucket].length !== before) touchedUserStore = true;
    });
    if (touchedUserStore) saveUserAddedTasks(stored);
    writeStore(DONE_KEY, setDoneStore, s);
  };
  const restoreHidden = () => {
    try {
      localStorage.removeItem(DISMISS_KEY);
      localStorage.removeItem(DONE_KEY);
    } catch {}
    setDismissed({});
    setDoneStore({});
    Object.values(pendingArchiveTimers.current).forEach(clearTimeout);
    pendingArchiveTimers.current = {};
  };

  const toggleAny = (id) => {
    let label = null;
    let willBeDone = false;
    let syncKey = null, notionId = null;
    [[top3, setTop3], [overdue, setOverdue], [dueSoon, setDueSoon], [blocked, setBlocked]].forEach(([l, s]) => {
      const task = l.find(t => t.id === id);
      if (task) {
        label = task.label;
        willBeDone = !task.done;
        syncKey = task.sync_key || null;
        notionId = task.notion_id || null;
        s(l.map(t => t.id === id ? {...t, done: !t.done} : t));
      }
    });

    // Optional Notion task backend: when a task carries a sync_key/notion_id, push the
    // status change to Notion (source of truth) via the local server's /task-status
    // endpoint. No-op for non-Notion tasks; reconciles via dashboard-notion-sync anyway.
    if (syncKey || notionId) {
      try {
        fetch('/task-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sync_key: syncKey, notion_id: notionId, done: willBeDone }),
        }).catch(() => {});
      } catch (e) { /* file:// or offline — reconciles on next sync */ }
    }

    if (willBeDone && label) {
      // Schedule auto-archive after the linger window. Cancel if user un-toggles before then.
      if (pendingArchiveTimers.current[id]) clearTimeout(pendingArchiveTimers.current[id]);
      pendingArchiveTimers.current[id] = setTimeout(() => {
        archiveDoneTask(label);
        delete pendingArchiveTimers.current[id];
      }, DONE_LINGER_MS);
    } else if (!willBeDone && pendingArchiveTimers.current[id]) {
      clearTimeout(pendingArchiveTimers.current[id]);
      delete pendingArchiveTimers.current[id];
    }
  };
  const addTask = (task) => {
    const bucket = task.bucket || 'dueSoon';
    const validBucket = (bucket === 'overdue' || bucket === 'blocked') ? bucket : 'dueSoon';
    const entry = {
      id: task.id || ('user-task-' + Date.now()),
      label: task.label,
      meta: task.meta || 'Just added',
      p: task.p || 2,
      project: task.project || 'ops',
      done: false,
      _user: true, // marker so dismiss can fully delete vs hide
    };
    // Persist to localStorage so it survives /dashboard refreshes
    const stored = loadUserAddedTasks();
    stored[validBucket].unshift(entry);
    saveUserAddedTasks(stored);
    // Also update React state for immediate UI feedback
    if (validBucket === 'overdue') setOverdue(prev => [entry, ...prev]);
    else if (validBucket === 'blocked') setBlocked(prev => [entry, ...prev]);
    else setDueSoon(prev => [entry, ...prev]);
  };
  const addMeeting = (m) => {
    const toMin = (t) => { const [h,mm] = (t || '00:00').split(':').map(Number); return h*60+mm; };
    const pad = (n) => String(n).padStart(2, '0');
    const d = new Date();
    const todayISO = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
    const entry = {
      id: m.id || ('cal-' + Date.now()),
      date: m.date || todayISO,
      time: m.time || '09:00',
      duration: Number(m.duration) || 30,
      title: m.title || 'Untitled meeting',
      type: m.type || 'event',
      who: Array.isArray(m.who) ? m.who : (m.who ? [m.who] : []),
    };
    // Only today's meetings show in the dashboard's today view; others are noted but not rendered inline.
    if (entry.date !== todayISO) return;
    setCalendar(prev => [...prev, entry].sort((a,b) => toMin(a.time) - toMin(b.time)));
  };
  uE(() => {
    const onTaskAdded    = (e) => addTask(e.detail || {});
    const onMeetingAdded = (e) => addMeeting(e.detail || {});
    // Cross-tab sync: when another tab (e.g. Hammerspoon Quick Capture)
    // writes to localStorage, refresh user-added tasks from disk.
    const onStorage = (e) => {
      if (e.key !== USER_TASKS_KEY) return;
      const fresh = loadUserAddedTasks();
      // Replace user-added portion of each bucket (keep agent-sourced items as-is)
      const merge = (current, freshUser) => {
        const userKeys = new Set(freshUser.map(t => t.id));
        const nonUser = current.filter(t => !t._user);
        return [...freshUser, ...nonUser];
      };
      setOverdue(prev => merge(prev, fresh.overdue));
      setDueSoon(prev => merge(prev, fresh.dueSoon));
      setBlocked(prev => merge(prev, fresh.blocked));
    };
    window.addEventListener('dash:task-added', onTaskAdded);
    window.addEventListener('dash:meeting-added', onMeetingAdded);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('dash:task-added', onTaskAdded);
      window.removeEventListener('dash:meeting-added', onMeetingAdded);
      window.removeEventListener('storage', onStorage);
    };
  }, []);
  // --- OKR linking API ---------------------------------------------------
  const getTag = (label) => okrLinks[normalizeTaskKey(label)] || null;
  const getSuggestion = (label, meta) => suggestOkrFromText(label, meta);
  const setTag = (label, okrId) => {
    const k = normalizeTaskKey(label);
    if (!k) return;
    setOkrLinks(prev => {
      const next = { ...prev };
      if (okrId) next[k] = okrId;
      else delete next[k];
      try { localStorage.setItem(OKR_LINKS_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  };
  const collectEvidence = (okrId) => {
    const visibleOverdue = overdue.filter(t => !isHidden(t.label));
    const visibleDueSoon = dueSoon.filter(t => !isHidden(t.label));
    const visibleBlocked = blocked.filter(t => !isHidden(t.label));
    const visibleTop3    = top3.filter(t => !isHidden(t.label));
    const visibleShipped = (SEED.shipped || []).filter(s => !isHidden(s.title));
    const allItems = [
      ...visibleTop3.map(t    => ({ label: t.label, meta: t.meta, _kind: 'Top-3'    })),
      ...visibleOverdue.map(t => ({ label: t.label, meta: t.meta, _kind: 'Overdue'  })),
      ...visibleDueSoon.map(t => ({ label: t.label, meta: t.meta, _kind: 'Due soon' })),
      ...visibleBlocked.map(t => ({ label: t.label, meta: t.meta, _kind: 'Blocked'  })),
      ...visibleShipped.map(s => ({ label: s.title, meta: s.meta, _kind: 'Shipped'  })),
      ...(SEED.decisions || []).map(d => ({ label: d.title, meta: d.meta, _kind: 'Decision' })),
    ];
    const confirmed = [];
    const suggested = [];
    for (const it of allItems) {
      const tag = getTag(it.label);
      if (tag === okrId) confirmed.push(it);
      else if (!tag && suggestOkrFromText(it.label, it.meta) === okrId) suggested.push(it);
    }
    return { confirmed, suggested };
  };
  const generateReviewMarkdown = () => {
    const okrs = SEED.okrs || [];
    const lines = [];
    const today = new Date();
    const monday = new Date(today);
    monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    const fmt = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    lines.push(`## OKR Review · Week of ${fmt(monday)}–${fmt(today)}`);
    lines.push('');
    okrs.forEach(o => {
      const meta = OKR_META[o.id] || { short: o.id };
      const ev = collectEvidence(o.id);
      lines.push(`### ${o.id} · ${o.name} · ${o.pct}% · ${o.trend}`);
      if (ev.confirmed.length === 0 && ev.suggested.length === 0) {
        lines.push('_(no linked items yet — tag tasks to this OKR throughout the week)_');
      } else {
        ev.confirmed.forEach(it => lines.push(`- ${it.label} _(${it._kind})_`));
        if (ev.suggested.length > 0) {
          lines.push('');
          lines.push('_Auto-suggested (review and confirm):_');
          ev.suggested.forEach(it => lines.push(`- ${it.label} _(${it._kind} · auto)_`));
        }
      }
      lines.push('');
    });
    return lines.join('\n');
  };
  const okrApi = {
    getTag, getSuggestion, setTag,
    collectEvidence, generateReviewMarkdown,
    META: OKR_META,
  };

  // Hidden tasks (dismissed or archived-done) — surfaced in the Tasks "Open list" popup
  // so they can be seen and individually restored.
  const hiddenTasks = [];
  [['overdue', overdue], ['dueSoon', dueSoon], ['blocked', blocked]].forEach(([bucket, list]) => {
    list.forEach(t => { if (isHidden(t.label)) hiddenTasks.push({ ...t, bucket }); });
  });
  (SEED.shipped || []).forEach(s => { if (isHidden(s.title)) hiddenTasks.push({ id: s.id, label: s.title, meta: s.meta, bucket: 'shipped' }); });
  const unhideTask = (label) => {
    const k = normalizeTaskKey(label);
    setDismissed(prev => { const n = { ...prev }; delete n[k]; try { localStorage.setItem(DISMISS_KEY, JSON.stringify(n)); } catch {} return n; });
    setDoneStore(prev => { const n = { ...prev }; delete n[k]; try { localStorage.setItem(DONE_KEY, JSON.stringify(n)); } catch {} return n; });
  };

  return {
    top3:    top3.filter(t => !isHidden(t.label)),
    overdue: overdue.filter(t => !isHidden(t.label)),
    dueSoon: dueSoon.filter(t => !isHidden(t.label)),
    blocked: blocked.filter(t => !isHidden(t.label)),
    calendar,
    shipped: (SEED.shipped || []).filter(s => !isHidden(s.title)),
    setTop3, toggleAny, addTask, addMeeting,
    dismissTask,
    restoreHidden,
    // backward-compat alias used by existing callers
    restoreDismissed: restoreHidden,
    hiddenTasks, unhideTask,
    hiddenCount: Object.keys(dismissed).length + Object.keys(doneStore).length,
    dismissedCount: Object.keys(dismissed).length + Object.keys(doneStore).length,
    okrApi,
  };
}

// =============================================================================
// VARIATION A — "Command Center" · bento grid
// Dense, info-rich. Top priorities strip on top, 3-col grid below.
// =============================================================================
function LayoutCommandCenter({ tod }) {
  const state = useDashboardState();
  const capacity = 78;
  return (
    <>
      <Hero timeOfDay={tod} data={SEED} capacityPct={capacity} state={state}/>

      <div className="grid g-cols-12" style={{marginBottom:16}}>
        <div className="c-span-8">
          <Top3 data={state.top3} onToggle={state.toggleAny} okrApi={state.okrApi}/>
        </div>
        <div className="c-span-4" style={{display:'flex', flexDirection:'column', gap:12}}>
          <WellnessMod data={SEED.personalSignals}/>
        </div>
      </div>

      <div className="grid g-cols-12">
        {/* Left col — tasks + inbox */}
        <div className="c-span-4" style={{display:'flex', flexDirection:'column', gap:16}}>
          <TasksMod state={state} onToggle={state.toggleAny}/>
          <InboxMod data={SEED.inbox}/>
        </div>

        {/* Middle — calendar + slack */}
        <div className="c-span-5" style={{display:'flex', flexDirection:'column', gap:16}}>
          <CalendarMod data={state.calendar} next={SEED.nextMeeting}/>
          <SlackMod data={SEED.slack}/>
        </div>

        {/* Right — projects, KPIs, blockers, team */}
        <div className="c-span-3" style={{display:'flex', flexDirection:'column', gap:16}}>
          <ProjectsMod data={SEED.projects} okrs={SEED.okrs} decisions={SEED.decisions} okrApi={state.okrApi}/>
          <KpiMod data={SEED.kpis}/>
          <BlockersMod data={SEED.blockers}/>
          <TeamMod data={SEED.team}/>
        </div>
      </div>
    </>
  );
}

// =============================================================================
// VARIATION B — "Focus Flow" · priority-ordered single column
// Reads top-to-bottom by urgency. Slack is second-rate in chrome.
// =============================================================================
function LayoutFocusFlow({ tod }) {
  const state = useDashboardState();
  return (
    <>
      <Hero timeOfDay={tod} data={SEED} capacityPct={78} state={state}/>
      <div className="grid g-cols-12">
        <div className="c-span-8" style={{display:'flex', flexDirection:'column', gap:20}}>
          <Top3 data={state.top3} onToggle={state.toggleAny} okrApi={state.okrApi}/>
          <SlackMod data={SEED.slack}/>
          <TasksMod state={state} onToggle={state.toggleAny}/>
          <CalendarMod data={state.calendar} next={SEED.nextMeeting}/>
          <ProjectsMod data={SEED.projects} okrs={SEED.okrs} decisions={SEED.decisions} okrApi={state.okrApi}/>
          <KpiMod data={SEED.kpis}/>
        </div>
        <div className="c-span-4" style={{display:'flex', flexDirection:'column', gap:16, position:'sticky', top:16, alignSelf:'flex-start'}}>
          <BlockersMod data={SEED.blockers}/>
          <InboxMod data={SEED.inbox}/>
          <TeamMod data={SEED.team}/>
          <WellnessMod data={SEED.personalSignals}/>
        </div>
      </div>
    </>
  );
}

// =============================================================================
// LAYOUT D — Modern SaaS · expanded sidebar, top bar with search, polished cards
// =============================================================================
// Left-rail "Skills" section: users add their own Claude skills and launch them with one
// click — run headlessly via the local server, EXACTLY like the refresh button
// (POST /run-skill → claude -p, poll /run-skill-status). Definitions persist to
// ~/.claude/dashboard-skills.local.json (with a localStorage fallback when not served).
function SkillsRailSection({ collapsed }) {
  const [items, setItems] = uS(null);       // null = still loading
  const [adding, setAdding] = uS(false);
  const [form, setForm] = uS({ label: '', command: '' });
  const [status, setStatus] = uS(null);     // {running,label,ok,last,elapsed}
  const [result, setResult] = uS(null);     // {label,ok,output} → shown in the popup
  const [modalOpen, setModalOpen] = uS(false);
  const pollRef = React.useRef(null);

  uE(() => {
    let alive = true;
    fetch('/skills-config', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : { items: null })
      .then(d => {
        if (!alive) return;
        if (Array.isArray(d.items)) { setItems(d.items); return; }
        throw new Error('no server list');
      })
      .catch(() => {
        try { const ls = JSON.parse(localStorage.getItem('dashboard.skills.v1') || '[]'); setItems(Array.isArray(ls) ? ls : []); }
        catch { setItems([]); }
      });
    return () => { alive = false; };
  }, []);
  uE(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const persist = async (next) => {
    setItems(next);
    try { localStorage.setItem('dashboard.skills.v1', JSON.stringify(next)); } catch {}
    try { await fetch('/skills-config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: next }) }); } catch {}
  };
  const addSkill = async () => {
    const label = (form.label || '').trim();
    let command = (form.command || '').trim();
    if (!label || !command) return;
    if (!command.startsWith('/')) command = '/' + command;   // normalize to a slash command
    await persist([...(items || []), { id: 's' + Date.now(), label, command }]);
    setForm({ label: '', command: '' }); setAdding(false);
  };
  const removeSkill = (id) => persist((items || []).filter(s => s.id !== id));

  const poll = async () => {
    try {
      const s = await (await fetch('/run-skill-status', { cache: 'no-store' })).json();
      setStatus(s);
      if (!s.running) {
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        // Surface the full result in a readable popup.
        setResult({ label: s.label, ok: s.ok !== false, output: s.output || s.last || '(no output)' });
        setModalOpen(true);
      }
    } catch {}
  };
  const runSkill = async (sk) => {
    setStatus({ running: true, label: sk.label, elapsed: 0 });
    setResult(null);
    try {
      const r = await fetch('/run-skill', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command: sk.command, label: sk.label }) });
      if (r.status !== 202 && !r.ok) throw new Error('bad');
      if (!pollRef.current) pollRef.current = setInterval(poll, 2000);
    } catch {
      setStatus({ running: false, ok: false, last: 'Skills run via the dashboard server — open over http://localhost, not as a file.' });
      setResult({ label: sk.label, ok: false, output: 'This skill runs via the dashboard server. Open the dashboard over http://localhost (not as a file://), then try again.' });
      setModalOpen(true);
    }
  };

  if (items === null) return null;

  return (
    <>
      <div className="d-rail-section">Skills</div>
      {items.map(sk => (
        <div key={sk.id} className="d-rail-item d-rail-skill" title={collapsed ? sk.label : sk.command}
             onClick={() => runSkill(sk)}>
          <Icon name="sparkle" size={16}/>
          <span>{sk.label}</span>
          <button className="d-rail-skill-x" aria-label="Remove skill" title="Remove"
                  onClick={(e) => { e.stopPropagation(); removeSkill(sk.id); }}>×</button>
        </div>
      ))}
      {!collapsed && status && (
        <div className={'d-rail-skill-status ' + (status.running ? 'run' : (status.ok === false ? 'err' : 'ok'))}
             onClick={() => { if (!status.running && result) setModalOpen(true); }}
             style={!status.running && result ? { cursor: 'pointer', textDecoration: 'underline' } : null}
             title={!status.running && result ? 'View full result' : undefined}>
          {status.running
            ? `▶ ${status.label || 'Running'}… (${status.elapsed || 0}s)`
            : (status.ok === false ? `✗ ${status.label || 'Skill'} failed — view` : `✓ ${status.label || 'Skill'} done — view result`)}
        </div>
      )}
      {!collapsed && (adding ? (
        <div className="d-rail-skill-add" onClick={e => e.stopPropagation()}>
          <input className="metric-in" placeholder="Label (e.g. Weekly report)" value={form.label}
                 onChange={e => setForm({ ...form, label: e.target.value })}/>
          <input className="metric-in" placeholder="/command" value={form.command}
                 onChange={e => setForm({ ...form, command: e.target.value })}
                 onKeyDown={e => { if (e.key === 'Enter') addSkill(); }}/>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn--primary btn--sm" onClick={addSkill}>Add</button>
            <button className="btn btn--ghost btn--sm" onClick={() => { setAdding(false); setForm({ label: '', command: '' }); }}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="d-rail-item d-rail-skill-addbtn" onClick={() => setAdding(true)} title="Add a skill">
          <Icon name="plus" size={16}/><span>Add skill</span>
        </div>
      ))}

      {modalOpen && result && (
        <div className="skill-result-overlay" onClick={() => setModalOpen(false)}>
          <div className="skill-result-modal" onClick={e => e.stopPropagation()}>
            <div className="skill-result-head">
              <span className={'skill-result-badge ' + (result.ok ? 'ok' : 'err')}>{result.ok ? '✓' : '✗'}</span>
              <span className="skill-result-title">{result.label || 'Skill result'}</span>
              <button className="skill-result-close" aria-label="Close" onClick={() => setModalOpen(false)}>×</button>
            </div>
            <pre className="skill-result-body">{result.output}</pre>
            <div className="skill-result-foot">
              <button className="btn btn--ghost btn--sm" onClick={() => { try { navigator.clipboard.writeText(result.output || ''); } catch {} }}>Copy</button>
              <button className="btn btn--primary btn--sm" onClick={() => setModalOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ModernRail({ active = 'home', collapsed, onToggle, onResize }) {
  const [comingSoon, setComingSoon] = uS(null);
  const comingSoonTimer = React.useRef(null);
  const showComingSoon = (label) => {
    if (comingSoonTimer.current) clearTimeout(comingSoonTimer.current);
    setComingSoon(label);
    comingSoonTimer.current = setTimeout(() => setComingSoon(null), 2000);
  };
  const sections = [
    { label: 'Workspace', items: [
      { key: 'home',     icon: 'home',         label: 'Dashboard' },
      { key: 'tasks',    icon: 'check-circle', label: 'Tasks',    pill: 11, soon: true },
      { key: 'calendar', icon: 'calendar',     label: 'Calendar', soon: true },
      { key: 'messages', icon: 'messages',     label: 'Messages', pill: 3,  soon: true },
    ]},
    { label: 'Insights', items: [
      { key: 'projects', icon: 'progress',   label: 'Projects', soon: true },
      { key: 'metrics',  icon: 'insights',   label: 'Metrics',  soon: true },
      { key: 'people',   icon: 'user-group', label: 'People',   soon: true },
      { key: 'library',  icon: 'library',    label: 'Library',  soon: true },
    ]},
  ];
  // Drag the right edge to resize the rail freely. Live updates via onResize;
  // pointermove tracking + capture so we keep getting events even when the cursor
  // leaves the handle.
  const beginResize = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const aside = e.currentTarget.closest('.d-rail');
    const startWidth = aside ? aside.getBoundingClientRect().width : 200;
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
    const onMove = (ev) => {
      if (typeof onResize === 'function') onResize(startWidth + (ev.clientX - startX));
    };
    const onUp = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  };
  return (
    <aside className="d-rail" data-collapsed={collapsed ? 'true' : 'false'}>
      <button
        className="d-rail-toggle"
        onClick={onToggle}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >{collapsed ? '›' : '‹'}</button>
      <div className="d-rail-logo">
        {(() => {
          const av = window.SEED && window.SEED.user && (window.SEED.user.avatar || window.SEED.user.avatarUrl);
          return av
            ? <img className="d-rail-logo-mark d-rail-logo-avatar" src={av} alt="" />
            : <div className="d-rail-logo-mark">{((window.SEED && window.SEED.user && window.SEED.user.name) || 'W')[0].toUpperCase()}</div>;
        })()}
        <div className="d-rail-logo-text">
          {(window.SEED && window.SEED.user && window.SEED.user.name) || 'You'}
          <small>{(window.SEED && window.SEED.user && window.SEED.user.role) || 'Work OS'}</small>
        </div>
      </div>
      {sections.map((s, i) => (
        <React.Fragment key={i}>
          <div className="d-rail-section">{s.label}</div>
          {s.items.map(it => (
            <div key={it.key} className={'d-rail-item' + (it.soon && it.key !== active ? ' d-rail-soon' : '')}
                 data-active={it.key === active}
                 title={collapsed ? it.label : undefined}
                 onClick={it.soon && it.key !== active ? () => showComingSoon(it.label) : undefined}
                 style={it.soon && it.key !== active ? {cursor:'default'} : undefined}>
              <Icon name={it.icon} size={16}/>
              <span>{it.label}</span>
              {it.pill != null && <span className="pill">{it.pill}</span>}
              {it.soon && it.key !== active && !collapsed && <span className="d-rail-soon-tag">soon</span>}
            </div>
          ))}
        </React.Fragment>
      ))}
      {comingSoon && (
        <div className="d-rail-coming-soon-toast">
          {comingSoon} — coming soon
        </div>
      )}
      <SkillsRailSection collapsed={collapsed}/>
      <div className="d-rail-user">
        <span className="pds-avatar size-32">
          <img src={(window.SEED && window.SEED.user && (window.SEED.user.avatar || window.SEED.user.avatarUrl)) || 'ds/assets/avatar-default.svg'} alt={(window.SEED && window.SEED.user && window.SEED.user.name) || 'You'}/>
        </span>
        <div className="d-rail-user-meta">
          <div className="d-rail-user-name">{(window.SEED && window.SEED.user && window.SEED.user.fullName) || (window.SEED && window.SEED.user && window.SEED.user.name) || 'You'}</div>
          <div className="d-rail-user-role">{(window.SEED && window.SEED.user && window.SEED.user.role) || 'Add user info to data-override.jsx'}</div>
        </div>
        <button className="icon-btn" title="Settings"><Icon name="settings" size={14}/></button>
      </div>
      <div
        className="d-rail-resize-handle"
        onPointerDown={beginResize}
        title="Drag to resize · click toggle for one-tap collapse"
      />
    </aside>
  );
}

// =============================================================================
// Voice command button — uses browser SpeechRecognition API
// Parses first-word intent and routes to Find / Add Task / New Meeting modals.
// =============================================================================
function VoiceButton() {
  const [listening, setListening] = uS(false);
  const [transcript, setTranscript] = uS('');
  const [toast, setToast] = uS(null);
  const recRef = React.useRef(null);

  const supported = typeof window !== 'undefined'
    && (window.SpeechRecognition || window.webkitSpeechRecognition);

  const showToast = (msg, kind = 'info') => {
    setToast({ msg, kind, at: Date.now() });
    setTimeout(() => setToast(t => (t && t.msg === msg) ? null : t), 3600);
  };

  const handleCommand = (raw) => {
    const text = (raw || '').trim();
    if (!text) return;
    // Strip trailing punctuation to simplify patterns.
    const clean = text.replace(/[.?!,]+$/g, '').trim();
    const lower = clean.toLowerCase();

    const openUrl = (url, label) => {
      try { window.open(url, '_blank', 'noopener,noreferrer'); } catch {}
      showToast(label ? `Opening ${label}` : `Opening…`, 'success');
    };

    // ---- Date-aware calendar query ("first meeting tomorrow", "monday's schedule") ----
    const dateTarget = parseDateTarget(lower);
    const asksAboutSchedule = /\b(meeting|meetings|schedule|calendar|agenda|event(s)?|appointment(s)?|what.+(on|have|got|doing))\b/.test(lower);
    const wantsFirst = /\bfirst\b/.test(lower);
    const wantsLast  = /\blast\b/.test(lower);
    // If user gave a non-today date and is asking about calendar contents, hit the live API.
    if (dateTarget && dateTarget.label !== 'today' && asksAboutSchedule) {
      showToast(`Checking calendar for ${dateTarget.label}…`, 'info');
      (async () => {
        if (!window.gcalList || !(window.gcalHasClientId && window.gcalHasClientId())) {
          showToast('Connect Google Calendar in the meeting modal to read other days.', 'error');
          return;
        }
        const res = await window.gcalList({
          timeMin: dateTarget.start.toISOString(),
          timeMax: dateTarget.end.toISOString(),
          maxResults: 50,
        });
        if (!res.ok) {
          showToast('Calendar read failed: ' + (res.reason || res.mode || 'unknown'), 'error');
          return;
        }
        window.dispatchEvent(new CustomEvent('dash:open-summary', { detail: {
          topic: wantsFirst ? 'first' : (wantsLast ? 'last' : 'schedule'),
          payload: { events: res.items, label: dateTarget.label },
        }}));
      })();
      return;
    }

    // ---- Summary / readout intents (speak + show a card) --------------------
    const summaryTopic = (() => {
      if (/\b(priorit(y|ies)|top\s*3|top\s*three|what.+(to\s*)?(focus|work)\s*on)\b/.test(lower)) return 'priorities';
      if (/\b(next\s*meeting|what('?s|\s+is)\s+next|up\s*next)\b/.test(lower)) return 'next';
      if (/\b(meeting(s)?\s*(today|now|scheduled)?|schedule(\s+today)?|today'?s?\s+calendar|my\s+day|agenda)\b/.test(lower)) return 'meetings';
      if (/\b(blocker(s)?|block(ing|ed)\s+me|risk(s)?)\b/.test(lower)) return 'blockers';
      if (/\b(inbox|unread\s+email(s)?|email(s)?\s+need|mail\s+summary)\b/.test(lower)) return 'inbox';
      if (/\b(team|who\s+is\s+(working|on|onboarding)|team\s+status|peers|reports)\b/.test(lower)) return 'team';
      if (/\b(projects?|workstreams?|initiatives?)\b/.test(lower) && /(status|summary|show|list|what)/.test(lower)) return 'projects';
      if (/\b(brief(\s+me)?|daily\s+brief|summary|digest|recap|catch\s+me\s+up)\b/.test(lower)) return 'brief';
      return null;
    })();
    if (summaryTopic) {
      window.dispatchEvent(new CustomEvent('dash:open-summary', { detail: { topic: summaryTopic } }));
      showToast(`Summarizing ${summaryTopic === 'brief' ? 'your day' : summaryTopic}…`, 'success');
      return;
    }

    // ---- Shortcut destinations: open drive / gmail / calendar / slack -------
    const openDest = lower.match(/^(?:open|go\s+to|launch|take\s+me\s+to)\s+(.+)$/);
    if (openDest) {
      const what = openDest[1].trim();
      const dest = (() => {
        if (/^(google\s+)?drive$/.test(what))         return { url: 'https://drive.google.com', label: 'Drive' };
        if (/^(gmail|email|inbox|mail)$/.test(what))  return { url: 'https://mail.google.com/mail/u/0/#inbox', label: 'Gmail' };
        if (/^(google\s+)?calendar$/.test(what))      return { url: 'https://calendar.google.com/calendar/u/0/r/week', label: 'Google Calendar' };
        if (/^slack$/.test(what))                     { const w=(window.SEED&&window.SEED.slack&&window.SEED.slack.workspace)||'app'; return { url: `https://${w}.slack.com`, label: 'Slack' }; }
        if (/^granola$/.test(what))                   return { url: 'https://app.granola.ai', label: 'Granola' };
        if (/^(okrs?|okr\s+sheet)$/.test(what))       { const p=((window.SEED&&window.SEED.pins)||[]).find(x=>/okr/i.test(x.label||'')); return (p&&p.href)?{ url:p.href, label:(p.label||'OKRs') }:null; }
        return null;
      })();
      if (dest) { openUrl(dest.url, dest.label); return; }

      // Layout switching ("open layout D", "switch to C")
      const layoutMatch = what.match(/^(?:layout\s+)?([abcd])$/i)
                       || what.match(/^(?:layout\s+)?(command|focus|split|modern|saas)\b/i);
      if (layoutMatch) {
        const ch = layoutMatch[1].toLowerCase();
        const code = /^[abcd]$/.test(ch) ? ch.toUpperCase()
                   : (ch === 'command' ? 'A' : ch === 'focus' ? 'B' : ch === 'split' ? 'C' : 'D');
        window.dispatchEvent(new CustomEvent('dash:set-layout', { detail: { layout: code } }));
        showToast(`Switched to layout ${code}`, 'success');
        return;
      }

      // Fuzzy-match a Google Drive file by title.
      const driveHit = fuzzyDrive(what);
      if (driveHit) {
        openUrl(driveHit.viewUrl, driveHit.title);
        return;
      }

      // Fallback: open Find palette prefilled with the phrase.
      window.dispatchEvent(new CustomEvent('dash:open-find', { detail: { prefill: what } }));
      showToast(`No direct match for "${what}" — search palette opened.`, 'info');
      return;
    }

    // ---- Web research intent ------------------------------------------------
    const webMatch = lower.match(/^(?:research|google|look\s+up\s+(?:online|on\s+the\s+web)|web\s+search(?:\s+for)?|search\s+(?:the\s+)?(?:web|internet|online)(?:\s+for)?)\s+(.+)$/)
                  || lower.match(/^(?:what\s+is|who\s+is|tell\s+me\s+about|explain)\s+(.+)$/);
    if (webMatch) {
      const q = webMatch[1].trim();
      openUrl(`https://www.google.com/search?q=${encodeURIComponent(q)}`, `web search: "${q}"`);
      return;
    }

    // ---- Meeting intent -----------------------------------------------------
    const meetingMatch = lower.match(/^(?:create|add|new|schedule|make|set\s*up|book)\s+(?:a\s+)?meeting(?:\s+(?:about|to|for|with|on)?\s+)?(.*)$/)
                      || lower.match(/^meeting(?:\s+(?:about|to|for|with|on)?\s+)?(.*)$/);
    if (meetingMatch) {
      const subject = (meetingMatch[1] || '').trim();
      window.dispatchEvent(new CustomEvent('dash:open-add-meeting', { detail: { prefill: subject } }));
      showToast(`Creating meeting${subject ? ': "' + subject + '"' : '…'}`, 'success');
      return;
    }

    // ---- Task intent --------------------------------------------------------
    const taskMatch = lower.match(/^(?:add|create|new)\s+(?:a\s+)?task(?:\s+(?:to|for)?\s+)?(.*)$/)
                   || lower.match(/^task\s+(.*)$/)
                   || lower.match(/^(?:remind\s+me\s+(?:to|about)|i\s+need\s+to|todo)\s+(.+)$/);
    if (taskMatch) {
      const subject = (taskMatch[1] || '').trim();
      window.dispatchEvent(new CustomEvent('dash:open-add-task', { detail: { prefill: subject } }));
      showToast(`Adding task${subject ? ': "' + subject + '"' : '…'}`, 'success');
      return;
    }

    // ---- In-dashboard find (Drive / people / meetings) ----------------------
    const findMatch = lower.match(/^(?:find|search(?:\s+for)?|look\s+up)\s+(.+)$/);
    if (findMatch) {
      const q = findMatch[1].trim();
      // If it's clearly a Drive file title, open it directly.
      const hit = fuzzyDrive(q);
      if (hit) { openUrl(hit.viewUrl, hit.title); return; }
      window.dispatchEvent(new CustomEvent('dash:open-find', { detail: { prefill: q } }));
      showToast(`Searching: "${q}"`, 'success');
      return;
    }

    // ---- Focus mode ---------------------------------------------------------
    if (/^focus\s+mode\s+(on|enable|start)/.test(lower)) {
      window.dispatchEvent(new CustomEvent('dash:set-focus', { detail: { on: true } }));
      showToast('Focus mode on', 'success');
      return;
    }
    if (/^focus\s+mode\s+(off|disable|stop)/.test(lower) || /^exit\s+focus/.test(lower)) {
      window.dispatchEvent(new CustomEvent('dash:set-focus', { detail: { on: false } }));
      showToast('Focus mode off', 'success');
      return;
    }

    // ---- Layout save/reset --------------------------------------------------
    if (/^save(\s+layout)?$/.test(lower)) {
      window.dispatchEvent(new Event('dash:save-layout'));
      showToast('Saved layout', 'success');
      return;
    }
    if (/^reset(\s+layout)?$/.test(lower)) {
      window.dispatchEvent(new Event('dash:reset-layout'));
      showToast('Layout reset', 'success');
      return;
    }

    // ---- Fallback: try Drive by bare phrase, else web search ----------------
    const bareHit = fuzzyDrive(clean);
    if (bareHit && bareHit._score >= 2) {
      openUrl(bareHit.viewUrl, bareHit.title);
      return;
    }
    openUrl(`https://www.google.com/search?q=${encodeURIComponent(clean)}`, `web search: "${clean}"`);
  };

  // Parse natural-language date target from a voice phrase.
  // Returns { start: Date (local midnight), end: Date (next midnight), label: string } or null.
  function parseDateTarget(lower) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const add = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
    const days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];

    if (/\btoday\b/.test(lower))     return { start: today, end: add(today, 1), label: 'today' };
    if (/\btomorrow\b/.test(lower))  { const t = add(today, 1); return { start: t, end: add(t, 1), label: 'tomorrow' }; }
    if (/\byesterday\b/.test(lower)) { const t = add(today, -1); return { start: t, end: add(t, 1), label: 'yesterday' }; }

    // "next monday", "next week"
    const nextDay = lower.match(/\bnext\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
    if (nextDay) {
      const target = days.indexOf(nextDay[1]);
      const dow = today.getDay();
      let diff = ((target - dow + 7) % 7) || 7;
      // "next X" on English usage: the upcoming X in the following week if that X has already occurred this week,
      // otherwise this coming X. We use the "strictly future X, jump a week if today is same day" convention.
      const d = add(today, diff);
      return { start: d, end: add(d, 1), label: 'next ' + nextDay[1] };
    }
    if (/\bnext\s+week\b/.test(lower)) {
      const dow = today.getDay();
      const monday = add(today, ((8 - dow) % 7) || 7);
      return { start: monday, end: add(monday, 7), label: 'next week' };
    }
    if (/\bthis\s+week\b/.test(lower)) {
      const dow = today.getDay();
      const monday = add(today, ((1 - dow) + 7) % 7 === 0 && dow !== 1 ? -6 : (1 - dow));
      return { start: monday, end: add(monday, 7), label: 'this week' };
    }

    // Bare "monday", "on friday", "this friday" → next occurrence (today if today)
    const dayMatch = lower.match(/\b(?:on\s+|this\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
    if (dayMatch) {
      const target = days.indexOf(dayMatch[1]);
      const dow = today.getDay();
      const diff = (target - dow + 7) % 7;
      const d = add(today, diff);
      return { start: d, end: add(d, 1), label: diff === 0 ? dayMatch[1] + ' (today)' : dayMatch[1] };
    }

    return null;
  }

  // Fuzzy-match a phrase against window.DRIVE_INDEX titles.
  // Returns the best hit with `_score` (word overlap) if ≥2 words match; else null.
  function fuzzyDrive(query) {
    const idx = (typeof window !== 'undefined' && window.DRIVE_INDEX) || [];
    if (!idx.length || !query) return null;
    const stop = new Set(['the','a','an','of','to','for','on','in','and','or','my','your','file','document','doc','sheet','slide','deck','pdf','google']);
    const words = String(query).toLowerCase().match(/[a-z0-9]+/g) || [];
    const keys = words.filter(w => w.length > 1 && !stop.has(w));
    if (!keys.length) return null;
    let best = null, bestScore = 0;
    for (const f of idx) {
      const title = (f.title || '').toLowerCase();
      let score = 0;
      for (const k of keys) if (title.includes(k)) score++;
      // Bonus for matching file kind keyword (doc/sheet/slide/pdf) in original query
      const kindHit = (f.kind || '').toLowerCase();
      if (kindHit && words.includes(kindHit)) score += 0.5;
      if (score > bestScore) { best = f; bestScore = score; }
    }
    if (!best) return null;
    // Need at least 2 matching keywords (or 1 if the query is 1 keyword)
    const minNeeded = keys.length === 1 ? 1 : 2;
    if (bestScore < minNeeded) return null;
    return { ...best, _score: bestScore };
  }

  const start = () => {
    if (!supported) {
      showToast('Voice is not supported in this browser', 'error');
      return;
    }
    try {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      const rec = new SR();
      rec.lang = 'en-US';
      rec.interimResults = true;
      rec.continuous = false;
      rec.maxAlternatives = 1;
      let finalText = '';
      rec.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t = e.results[i][0].transcript;
          if (e.results[i].isFinal) finalText += t;
          else interim += t;
        }
        setTranscript((finalText || interim).trim());
      };
      rec.onerror = (e) => {
        setListening(false);
        showToast(`Voice error: ${e.error || 'unknown'}`, 'error');
      };
      rec.onend = () => {
        setListening(false);
        const spoken = (finalText || transcript || '').trim();
        setTranscript('');
        if (spoken) handleCommand(spoken);
      };
      rec.start();
      recRef.current = rec;
      setListening(true);
    } catch (err) {
      setListening(false);
      showToast('Could not start voice input', 'error');
    }
  };

  const stop = () => {
    if (recRef.current) { try { recRef.current.stop(); } catch {} }
    setListening(false);
  };

  const toggle = () => (listening ? stop() : start());

  return (
    <>
      <button
        className={'d-topbar-icon d-mic' + (listening ? ' d-mic-on' : '')}
        onClick={toggle}
        title={supported ? (listening ? 'Listening… click to stop' : 'Voice command (⌘/)') : 'Voice not supported in this browser'}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="9" y="3" width="6" height="12" rx="3"/>
          <path d="M5 11a7 7 0 0 0 14 0"/>
          <line x1="12" y1="18" x2="12" y2="22"/>
          <line x1="9" y1="22" x2="15" y2="22"/>
        </svg>
      </button>
      {listening && (
        <div className="d-voice-live" aria-live="polite">
          <span className="d-voice-pulse"/>
          <span>Listening…{transcript ? ` "${transcript}"` : ''}</span>
        </div>
      )}
      {toast && (
        <div className={'d-voice-toast d-voice-toast-' + toast.kind} role="status">
          {toast.msg}
        </div>
      )}
    </>
  );
}

// Pinned senior collaborators — click any avatar → opens Stakeholder Lens.
// Configured per-user via window.SEED.pinnedPeople (set by data-override.jsx,
// generated by the dashboard skill from your config). Each entry:
//   { name: '<full name>', note: '<role>', manager?: true, bg?: '<css gradient>' }
// If empty, the topbar strip is hidden entirely.
const PINNED_PEOPLE = (window.SEED && Array.isArray(window.SEED.pinnedPeople)) ? window.SEED.pinnedPeople : [];

function PinnedPeopleStrip() {
  if (!PINNED_PEOPLE.length) return null;
  return (
    <div className="d-pinned-people" role="group" aria-label="Pinned people">
      {PINNED_PEOPLE.map((p, i) => {
        const initials = p.name.split(/\s+/).filter(Boolean).map(s => s[0]).slice(0, 2).join('').toUpperCase();
        return (
          <button
            key={i}
            className="d-pinned-avatar"
            style={{ background: p.bg }}
            title={`${p.name} · ${p.note}`}
            aria-label={`Open stakeholder lens for ${p.name}`}
            onClick={() => window.dispatchEvent(new CustomEvent('dash:open-lens', { detail: { person: p } }))}
          >{initials}</button>
        );
      })}
    </div>
  );
}

// One-press data refresh. POSTs /refresh to the local server (serve.py), which runs a
// headless refresh in the background — works without an interactive Claude Code session.
// The RefreshBanner (below) shows all progress/result; this button just triggers it.
function RefreshButton() {
  const [glyph, setGlyph] = React.useState('↻');
  const start = async () => {
    if (glyph === '⏳') return;
    setGlyph('⏳');
    window.dispatchEvent(new Event('dash:refresh-started'));
    try {
      const r = await fetch('/refresh', { method: 'POST' });
      if (r.status !== 202 && !r.ok) throw new Error('bad status');
      setTimeout(() => setGlyph('↻'), 3000);
    } catch {
      setGlyph('⚠');
      window.dispatchEvent(new Event('dash:refresh-unavailable'));
      setTimeout(() => setGlyph('↻'), 5000);
    }
  };
  return (
    <button className="d-topbar-icon" title="Refresh dashboard data now" onClick={start}
            style={{ fontSize: 15, lineHeight: 1 }} aria-label="Refresh dashboard data">
      <span style={glyph === '⏳' ? { display: 'inline-block', animation: 'dash-spin 1s linear infinite' } : null}>{glyph}</span>
    </button>
  );
}

// Prominent banner that ALWAYS resolves. Polls the server's /refresh-status, so it
// shows progress (with elapsed seconds), a "taking longer" note, and the final result
// line (success or the timeout/error message) — and it's dismissible. This is what
// guarantees you can tell whether a refresh worked, instead of a banner that hangs.
function RefreshBanner() {
  const [st, setSt] = React.useState(null);   // null=hidden | {phase:'running'|'done', ...}
  const [dismissed, setDismissed] = React.useState(false);
  const dismissTimer = React.useRef(null);
  // Auto-dismiss the "done" state after a few seconds (and on data-fresh reload).
  const finish = (ok, last, tokens, cost) => {
    setSt({ phase: 'done', ok, last, tokens, cost });
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    dismissTimer.current = setTimeout(() => setDismissed(true), 6000);
  };
  React.useEffect(() => {
    // If the page just auto-reloaded because fresh data landed, the refresh DID
    // complete — resolve the banner instead of showing a lingering "Refreshing…".
    // The in-memory state was wiped by the reload, so fetch the server's final
    // status once to recover the result line + token count (v0.14).
    let freshlyReloaded = false;
    try {
      const ts = Number(sessionStorage.getItem('dash:freshReload') || 0);
      if (ts && Date.now() - ts < 20000) { freshlyReloaded = true; }
      sessionStorage.removeItem('dash:freshReload');
    } catch {}
    if (freshlyReloaded) {
      fetch('/refresh-status', { cache: 'no-store' })
        .then(r => r.json())
        .then(s => { if (!s.running) finish(s.ok !== false, s.last || 'Updated just now', s.tokens, s.cost); else finish(true, 'Updated just now'); })
        .catch(() => finish(true, 'Updated just now'));
    }

    let wasRunning = false;
    const poll = async () => {
      try {
        const s = await (await fetch('/refresh-status', { cache: 'no-store' })).json();
        if (s.running) { wasRunning = true; setDismissed(false); setSt({ phase: 'running', elapsed: s.elapsed || 0 }); }
        else if (wasRunning) { wasRunning = false; finish(s.ok !== false, s.last, s.tokens, s.cost); }
      } catch { /* server has no /refresh-status (file:// or plain server) — ignore */ }
    };
    if (!freshlyReloaded) poll();
    const id = setInterval(poll, 3000);
    const onStart = () => { if (dismissTimer.current) clearTimeout(dismissTimer.current); setDismissed(false); setSt({ phase: 'running', elapsed: 0 }); };
    const onUnavail = () => { setDismissed(false); finish(false, 'Refresh needs the dashboard server — open the dashboard via http://localhost (run schedule.sh serve), not as a file.'); };
    window.addEventListener('dash:refresh-started', onStart);
    window.addEventListener('dash:refresh-unavailable', onUnavail);
    return () => { clearInterval(id); if (dismissTimer.current) clearTimeout(dismissTimer.current); window.removeEventListener('dash:refresh-started', onStart); window.removeEventListener('dash:refresh-unavailable', onUnavail); };
  }, []);

  if (!st || dismissed) return null;
  const running = st.phase === 'running';
  const ok = st.ok;
  const slow = running && st.elapsed > 150;   // > ~2.5 min
  const accent = running ? 'var(--blue-500, #2f6df6)' : ok ? 'var(--green-600, #1a7f4b)' : 'var(--red-600, #d23f3f)';
  const icon = running ? '↻' : ok ? '✓' : '⚠';
  const title = running ? 'Refreshing your dashboard…' : (ok ? 'Dashboard refreshed' : 'Refresh didn’t finish');
  // Compact cost/token readout for the done state. COST is the headline — it's
  // billing-correct and covers the whole run incl. sub-agents. tokens (when shown)
  // are NEW tokens only (input+output); we deliberately exclude cache-read tokens,
  // which dominate the raw usage sum (~10× inflation, billed at ~0.1×) and would
  // otherwise make a refresh look like 350k+ "tokens" when the real new work is far less.
  const fmtTokens = (n) => n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : `${n}`;
  const hasCost = typeof st.cost === 'number' && st.cost > 0;
  const usage = (!running && ok && (hasCost || st.tokens))
    ? [hasCost ? `$${st.cost.toFixed(2)}` : '', st.tokens ? `${fmtTokens(st.tokens)} new tokens` : '']
        .filter(Boolean).join(' · ')
    : '';
  const detail = running
    ? `Usually about 2 minutes${st.elapsed ? ` · ${st.elapsed}s` : ''}${slow ? ' · almost there' : ''} — you can keep working`
    : (st.last || (ok ? 'Done.' : 'It may need an interactive session — run /dashboard in Claude Code.'));
  return (
    <div style={{
      position: 'fixed', bottom: 18, right: 18, zIndex: 10000,
      width: 'min(360px, calc(100vw - 36px))',
      background: 'var(--bg-surface, #fff)', color: 'var(--fg-1, #1a1a1a)',
      borderRadius: 12, border: '1px solid var(--border-subtle, #e6e6e6)', borderLeft: `4px solid ${accent}`,
      boxShadow: '0 8px 28px rgba(0,0,0,.16)',
      font: '500 13px/1.45 system-ui, -apple-system, sans-serif',
      padding: '12px 34px 12px 14px', display: 'flex', gap: 10, alignItems: 'flex-start',
    }}>
      <span style={{ fontSize: 15, color: accent, lineHeight: 1.2, ...(running ? { display: 'inline-block', animation: 'dash-spin 1s linear infinite' } : null) }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, marginBottom: 2 }}>{title}</div>
        <div style={{ color: 'var(--fg-2, #5a5a5a)', fontSize: 12, maxHeight: 60, overflow: 'hidden' }}>{detail}</div>
        {usage ? <div style={{ color: 'var(--fg-3, #999)', fontSize: 11, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>⚡ {usage}</div> : null}
      </div>
      <button onClick={() => setDismissed(true)} aria-label="Dismiss"
              style={{ position: 'absolute', right: 10, top: 8, background: 'none', border: 'none', color: 'var(--fg-3, #999)', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>×</button>
    </div>
  );
}

// Quick links to the source apps, in the topbar (replaced the old "Quick access"
// pinned card). Official brand icons live in ds/assets/. Slack uses the configured
// workspace slug; the rest are standard URLs.
function AppLinks() {
  const ws = (window.SEED && window.SEED.slack && window.SEED.slack.workspace) || 'app';
  const links = [
    { id: 'calendar', label: 'Google Calendar', icon: 'ds/assets/app-google-calendar.svg', href: 'https://calendar.google.com/calendar/u/0/r/week' },
    { id: 'gmail',    label: 'Gmail',           icon: 'ds/assets/app-gmail.svg',           href: 'https://mail.google.com/mail/u/0/#inbox' },
    { id: 'slack',    label: 'Slack',           icon: 'ds/assets/app-slack.svg',           href: `https://${ws}.slack.com` },
    { id: 'drive',    label: 'Google Drive',    icon: 'ds/assets/app-google-drive.svg',    href: 'https://drive.google.com/drive/u/0/my-drive' },
  ];
  return (
    <div className="d-app-links" role="group" aria-label="Open apps">
      {links.map(l => (
        <a key={l.id} className="d-app-link" href={l.href} target="_blank" rel="noreferrer"
           title={`Open ${l.label}`} aria-label={`Open ${l.label}`}>
          <img className="d-app-link-icon" src={l.icon} alt={l.label} width="22" height="22"/>
        </a>
      ))}
    </div>
  );
}

// Collect the dashboard's current trackable items (tasks, decisions, Slack) for the
// "what changed since last refresh" bell. Each has a stable key + a human label.
function currentNotifItems() {
  const S = window.SEED || {};
  const out = [];
  (S.overdue || []).forEach(t => out.push({ k: 'task:' + t.label, type: 'Overdue task', label: t.label }));
  (S.dueSoon || []).forEach(t => out.push({ k: 'task:' + t.label, type: 'Task due soon', label: t.label }));
  (S.blocked || []).forEach(t => out.push({ k: 'task:' + t.label, type: 'Now blocked', label: t.label }));
  (S.decisions || []).forEach(d => out.push({ k: 'dec:' + (d.id || d.title), type: 'Decision to make', label: d.title }));
  const sl = S.slack || {};
  [...(sl.needsReply || []), ...(sl.dms || []), ...(sl.channels || [])].forEach(x =>
    out.push({ k: 'slk:' + (x.permalink || x.id || x.who || x.person || x.channel), type: 'Slack', label: (x.who || x.person || x.channel || 'message') }));
  const seen = new Set();
  return out.filter(i => i.k && !seen.has(i.k) && seen.add(i.k));
}

function NotificationsBell() {
  const [open, setOpen] = React.useState(false);
  const [changes, setChanges] = React.useState([]);
  React.useEffect(() => {
    let last = {};
    try { last = JSON.parse(localStorage.getItem('dash:lastSeen.v1') || '{}'); } catch {}
    const cur = currentNotifItems();
    const first = !Object.keys(last).length;
    const added = first ? [] : cur.filter(i => !last[i.k]);
    setChanges(added);
    const next = {}; cur.forEach(i => next[i.k] = 1);
    try { localStorage.setItem('dash:lastSeen.v1', JSON.stringify(next)); } catch {}
  }, []);
  const dismiss = (idx) => setChanges(prev => prev.filter((_, i) => i !== idx));
  const clearAll = () => setChanges([]);
  return (
    <>
      <button className="d-topbar-icon" title="What changed since last refresh" onClick={() => setOpen(o => !o)}>
        <Icon name="bell" size={16}/>
        {changes.length > 0 && <span className="dot"/>}
      </button>
      {open && (
        <div className="notif-overlay" onClick={() => setOpen(false)}>
          <div className="notif-panel" onClick={e => e.stopPropagation()}>
            <div className="notif-head">
              <Icon name="bell" size={14}/>
              <span className="notif-title">Since last refresh</span>
              <span className="notif-count">{changes.length}</span>
              {changes.length > 0 && (
                <button className="notif-clear" onClick={clearAll} title="Clear all">Clear all</button>
              )}
              <button className="notif-close" aria-label="Close" onClick={() => setOpen(false)}>×</button>
            </div>
            <div className="notif-body">
              {changes.length === 0
                ? <div className="notif-empty">Nothing new since you last looked.</div>
                : changes.map((c, i) => (
                    <div key={i} className="notif-row">
                      <span className="notif-type">{c.type}</span>
                      <span className="notif-label">{c.label}</span>
                      <button className="notif-dismiss" aria-label="Dismiss" title="Dismiss"
                              onClick={() => dismiss(i)}>×</button>
                    </div>
                  ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const SETTABLE_MODULES = ['top3', 'tasks', 'projects', 'commitments', 'kpi', 'calendar', 'inbox', 'slack', 'blockers', 'team', 'wellness'];
const MODULE_LABELS = { top3: 'Top 3', tasks: 'Tasks', projects: 'Projects', commitments: 'Commitments', kpi: 'Metrics', calendar: 'Calendar', inbox: 'Inbox', slack: 'Slack', blockers: 'Blockers', team: 'People', wellness: 'Wellness' };

// Settings ⚙ — theme / density / accent / show-hide modules. Theme/density/accent apply
// instantly via window.applyDashSetting (CSS attributes on <html>); module visibility
// dispatches dash:settings-changed which the layout listens to.
function SettingsButton() {
  const [open, setOpen] = React.useState(false);
  const [s, setS] = React.useState(() => (window.getDashSettings ? window.getDashSettings() : {}));
  const set = (k, v) => { if (window.applyDashSetting) window.applyDashSetting(k, v); setS(p => ({ ...p, [k]: v })); };
  const hidden = s.hiddenModules || [];
  const toggleModule = (id) => set('hiddenModules', hidden.includes(id) ? hidden.filter(x => x !== id) : [...hidden, id]);
  return (
    <>
      <button className="d-topbar-icon" title="Settings" aria-label="Dashboard settings" onClick={() => setOpen(true)}>
        <Icon name="filter" size={16}/>
      </button>
      {open && (
        <div className="settings-overlay" onClick={() => setOpen(false)}>
          <div className="settings-modal" onClick={e => e.stopPropagation()}>
            <div className="settings-head">
              <Icon name="filter" size={15}/><span className="settings-title">Dashboard settings</span>
              <button className="settings-close" aria-label="Close" onClick={() => setOpen(false)}>×</button>
            </div>
            <div className="settings-body">
              <div className="settings-group">
                <div className="settings-label">Theme</div>
                <div className="settings-seg">
                  {[['auto','Auto (day/night)'],['light','Light'],['dark','Dark']].map(([v,l]) => (
                    <button key={v} className={'seg-btn' + ((s.theme || 'auto') === v ? ' on' : '')} onClick={() => set('theme', v)}>{l}</button>
                  ))}
                </div>
              </div>
              <div className="settings-group">
                <div className="settings-label">Density</div>
                <div className="settings-seg">
                  {[['comfortable', 'Comfortable'], ['compact', 'Compact']].map(([v, l]) => (
                    <button key={v} className={'seg-btn' + ((s.density || 'comfortable') === v ? ' on' : '')} onClick={() => set('density', v)}>{l}</button>
                  ))}
                </div>
              </div>
              <div className="settings-group">
                <div className="settings-label">Accent</div>
                <div className="settings-swatches">
                  {[['pink', 'var(--pink-400)'], ['blue', 'var(--blue-400)'], ['teal', 'var(--teal-400)'], ['yellow', 'var(--yellow-400)']].map(([v, c]) => (
                    <button key={v} className={'swatch' + ((s.accent || 'pink') === v ? ' on' : '')} style={{ background: c }} title={v} aria-label={v} onClick={() => set('accent', v)}/>
                  ))}
                </div>
              </div>
              <div className="settings-group">
                <div className="settings-label-row">
                  <span className="settings-label">Show modules</span>
                  <button className="settings-mini-btn" onClick={() => set('hiddenModules', [])}>Select all</button>
                  <button className="settings-mini-btn" onClick={() => set('hiddenModules', SETTABLE_MODULES.slice())}>Select none</button>
                </div>
                <div className="settings-modules">
                  {SETTABLE_MODULES.map(id => (
                    <label key={id} className="settings-check">
                      <input type="checkbox" checked={!hidden.includes(id)} onChange={() => toggleModule(id)}/>
                      <span>{MODULE_LABELS[id]}</span>
                    </label>
                  ))}
                </div>
                <div className="settings-hint">Hidden modules reflow the remaining cards to the top — no gaps left behind.</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ModernTopbar() {
  const openFind = () => window.dispatchEvent(new Event('dash:open-find'));
  return (
    <div className="d-topbar">
      <RefreshBanner/>
      <div className="d-search" onClick={openFind} role="button" tabIndex={0}>
        <Icon name="search" size={14}/>
        <span className="d-search-placeholder">Search tasks, people, files, meetings…</span>
        <kbd>⌘K</kbd>
      </div>
      <PinnedPeopleStrip/>
      <div style={{flex: 1}}/>
      <AppLinks/>
      <RefreshButton/>
      <VoiceButton/>
      <button className="d-topbar-icon hide-when-readonly" title="Share snapshot"
              onClick={() => window.dispatchEvent(new Event('dash:open-share'))}>
        <Icon name="share" size={16}/>
      </button>
      <SettingsButton/>
      <NotificationsBell/>
      <div className="d-topbar-divider"/>
      <LiveClock/>
    </div>
  );
}

// Default layout D — two-column balanced (left: priority work, right: live feed).
// Source-app quick links live in the topbar (see AppLinks), not as a module.
//
// Layout principles:
//  · Above-fold: top3 + calendar + inbox visible without scrolling
//  · Text-heavy modules → LEFT (720px gives them room to breathe)
//  · List-style modules → RIGHT (400px is plenty for compact rows)
//  · Both columns end at ~y=2320 so the canvas feels symmetric
//
// To apply this layout to an existing custom layout, click "Reset layout" in
// the toolbar. Otherwise loadLayoutD() merges saved positions with these
// defaults, only adding modules that weren't previously placed.
const DEFAULT_D_BOXES = [
  // ── LEFT column · priority work (720px wide) ─────────────────────
  { id: 'top3',        left: 0,   top: 0,    width: 720, height: 300 },
  { id: 'tasks',       left: 0,   top: 316,  width: 720, height: 620 },
  { id: 'projects',    left: 0,   top: 952,  width: 720, height: 580 },
  { id: 'commitments', left: 0,   top: 1548, width: 720, height: 460 },
  { id: 'kpi',         left: 0,   top: 2024, width: 720, height: 300 },

  // ── RIGHT column · live feed (400px wide) ────────────────────────
  { id: 'calendar',    left: 736, top: 0,    width: 400, height: 440 },
  { id: 'inbox',       left: 736, top: 456,  width: 400, height: 380 },
  { id: 'slack',       left: 736, top: 852,  width: 400, height: 540 },
  { id: 'blockers',    left: 736, top: 1408, width: 400, height: 260 },
  { id: 'team',        left: 736, top: 1684, width: 400, height: 320 },
  { id: 'wellness',    left: 736, top: 2020, width: 400, height: 300 },
];
const LAYOUT_D_KEY = 'wdash-layout-d-freeform';

function loadLayoutD() {
  try {
    const raw = localStorage.getItem(LAYOUT_D_KEY);
    if (!raw) return DEFAULT_D_BOXES;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_D_BOXES;
    const valid = parsed.filter(x => x && typeof x.id === 'string' && x.id !== 'pins'
      && typeof x.left === 'number' && typeof x.top === 'number'
      && typeof x.width === 'number' && typeof x.height === 'number');
    const byId = new Map(valid.map(x => [x.id, x]));
    const merged = valid.slice();
    DEFAULT_D_BOXES.forEach(def => { if (!byId.has(def.id)) merged.push(def); });
    return merged;
  } catch { return DEFAULT_D_BOXES; }
}

function LayoutModernSaaS({ tod }) {
  const state = useDashboardState();
  const [boxes, setBoxes] = uS(loadLayoutD);
  const [activeId, setActiveId] = uS(null);
  const [savedSnapshot, setSavedSnapshot] = uS(() => JSON.stringify(loadLayoutD()));
  const [justSaved, setJustSaved] = uS(false);
  const [railWidth, setRailWidth] = uS(loadRailWidth);
  // Settings → show/hide modules (live).
  const [hiddenMods, setHiddenMods] = uS(() => (window.getDashSettings ? (window.getDashSettings().hiddenModules || []) : []));
  uE(() => {
    const onChange = (e) => setHiddenMods((e.detail && e.detail.hiddenModules) || []);
    window.addEventListener('dash:settings-changed', onChange);
    return () => window.removeEventListener('dash:settings-changed', onChange);
  }, []);

  // Persist rail width on change (debounced via ref to avoid hammering localStorage during drag)
  uE(() => { saveRailWidth(railWidth); }, [railWidth]);

  const railCollapsed = railWidth <= RAIL_MIN + 4;
  const toggleRail = () => setRailWidth(railCollapsed ? RAIL_DEFAULT_EXPANDED : RAIL_MIN);
  const handleRailResize = (next) => {
    let w = Math.max(RAIL_MIN, Math.min(RAIL_MAX, Math.round(next)));
    if (w < RAIL_SNAP_THRESHOLD) w = RAIL_MIN; // snap to collapsed when dragged close
    setRailWidth(w);
  };

  // Explicit save (no auto-save) — the user's button click is what persists.
  const currentJson = JSON.stringify(boxes);
  const isDirty = currentJson !== savedSnapshot;

  const saveLayout = () => {
    try { localStorage.setItem(LAYOUT_D_KEY, currentJson); } catch {}
    setSavedSnapshot(currentJson);
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 1800);
  };

  const onBoxDragStart = (id) => setActiveId(id);
  const onBoxDragEnd   = () => setActiveId(null);
  const resetLayout    = () => {
    const defaultJson = JSON.stringify(DEFAULT_D_BOXES);
    try { localStorage.setItem(LAYOUT_D_KEY, defaultJson); } catch {}
    setBoxes(DEFAULT_D_BOXES);
    setSavedSnapshot(defaultJson);
  };

  // Voice-command shortcuts for save/reset
  uE(() => {
    const onSave  = () => saveLayout();
    const onReset = () => resetLayout();
    window.addEventListener('dash:save-layout', onSave);
    window.addEventListener('dash:reset-layout', onReset);
    return () => {
      window.removeEventListener('dash:save-layout', onSave);
      window.removeEventListener('dash:reset-layout', onReset);
    };
  }, [boxes, savedSnapshot]);

  // Compact reflow: when modules are hidden via Settings, the remaining visible
  // ones get packed into a tight 2-column grid (left=720 wide, right=400 wide,
  // 16px gutter) in their canonical DEFAULT_D_BOXES order, instead of leaving
  // gaps where the hidden ones used to live. Skipped when nothing is hidden so
  // the user's saved arrangement is preserved.
  const reflowed = uM(() => {
    if (!hiddenMods.length) return boxes;
    const order = DEFAULT_D_BOXES.map(d => d.id);
    const visible = order
      .filter(id => !hiddenMods.includes(id))
      .map(id => boxes.find(b => b.id === id))
      .filter(Boolean);
    let leftY = 0, rightY = 0;
    return visible.map(b => {
      const def = DEFAULT_D_BOXES.find(d => d.id === b.id) || b;
      const onLeft = def.left === 0;
      if (onLeft) {
        const next = { ...b, left: 0, top: leftY, width: 720, height: def.height };
        leftY += def.height + 16;
        return next;
      }
      const next = { ...b, left: 736, top: rightY, width: 400, height: def.height };
      rightY += def.height + 16;
      return next;
    });
  }, [boxes, hiddenMods]);

  const canvasH = reflowed.reduce((acc, b) => Math.max(acc, b.top + b.height), 0) + 32;
  const canvasW = reflowed.reduce((acc, b) => Math.max(acc, b.left + b.width), 0);
  const visibleBoxes = reflowed.filter(b => !hiddenMods.includes(b.id));

  // Overlap-aware change handler: if a move/resize would overlap another visible
  // box, reject it (keep the previous position). Snap rather than freely stack —
  // dragging a card on top of another is almost always a user mistake.
  const overlaps = (a, b) => !(a.left + a.width  <= b.left || b.left + b.width  <= a.left
                            || a.top  + a.height <= b.top  || b.top  + b.height <= a.top);
  const onBoxChangeSafe = (id, next) => {
    const proposed = { ...boxes.find(b => b.id === id), ...next };
    const others = visibleBoxes.filter(b => b.id !== id);
    if (others.some(o => overlaps(proposed, o))) return;   // reject: would overlap
    setBoxes(prev => prev.map(b => b.id === id ? { ...b, ...next } : b));
  };

  const ordered = activeId
    ? [...visibleBoxes.filter(b => b.id !== activeId), visibleBoxes.find(b => b.id === activeId)].filter(Boolean)
    : visibleBoxes;

  const renderModule = (id) => {
    switch (id) {
      case 'top3':     return <Top3 data={state.top3} onToggle={state.toggleAny} okrApi={state.okrApi}/>;
      case 'calendar': return <CalendarMod data={state.calendar} next={SEED.nextMeeting}/>;
      case 'tasks':    return <TasksMod state={state} onToggle={state.toggleAny}/>;
      case 'kpi':      return <KpiMod data={SEED.kpis}/>;
      case 'projects': return <ProjectsMod data={SEED.projects} okrs={SEED.okrs} decisions={SEED.decisions} okrApi={state.okrApi}/>;
      case 'blockers': return <BlockersMod data={SEED.blockers}/>;
      case 'slack':    return <SlackMod data={SEED.slack}/>;
      case 'inbox':    return <InboxMod data={SEED.inbox}/>;
      case 'team':     return <TeamMod data={SEED.team}/>;
      case 'wellness': return <WellnessMod data={SEED.personalSignals}/>;
      case 'commitments': return <CommitmentsMod state={state}/>;
      default: return null;
    }
  };

  const g = (window.SEED && window.SEED.greeting) || {};
  const _gname = (window.SEED && window.SEED.user && window.SEED.user.name) || 'there';
  const greetingRaw =
    tod === 'morning'   ? (g.morning   || `Morning, <em>${_gname}</em>.`)   :
    tod === 'afternoon' ? (g.afternoon || `Afternoon, <em>${_gname}</em>.`) :
                          (g.evening   || `Evening, <em>${_gname}</em>.`);
  const sub = buildHeroSubtitle(tod, state);

  const top3Count     = state.top3.length;
  const top3Done      = state.top3.filter(t => t.done).length;
  const meetingsToday = (state.calendar || []).length;
  const inboxCount    = (SEED.inbox || []).length;
  const blockerCount  = (SEED.blockers || []).length;
  const openAdd     = () => window.dispatchEvent(new Event('dash:open-add-task'));
  const openMeeting = () => window.dispatchEvent(new Event('dash:open-add-meeting'));

  // Short preview lists for each stat chip — so "3" has context ("what 3?")
  const topItems     = state.top3.slice(0, 3);
  const meetingItems = (state.calendar || []).filter(e => e.type !== 'focus').slice(0, 3);
  const inboxItems   = (SEED.inbox || []).slice(0, 3);
  const blockerItems = [...(SEED.blockers || [])]
    .sort((a,b) => (a.sev === 'high' ? 0 : 1) - (b.sev === 'high' ? 0 : 1))
    .slice(0, 3);

  return (
    <div className="layout-d">
      <div className="app-d" style={{ gridTemplateColumns: `${railWidth}px 1fr` }}>
        <ModernRail active="home" collapsed={railCollapsed} onToggle={toggleRail} onResize={handleRailResize}/>
        <div className="d-main">
          <ModernTopbar/>
          <div className="d-content">

            <WhatChangedStrip state={state}/>

            <div className="d-greeting">
              <div>
                <h1 dangerouslySetInnerHTML={{__html: greetingRaw}}/>
                <div className="d-greeting-sub">{sub}</div>
              </div>
              <div className="d-greeting-actions">
                <button className="btn btn--tertiary btn--sm" onClick={()=>window.dispatchEvent(new Event('dash:open-find'))}>
                  <Icon name="search" size={14}/>Find
                </button>
                <button className="btn btn--tertiary btn--sm" onClick={openMeeting}>
                  <Icon name="calendar" size={14}/>New meeting
                </button>
                <button className="btn btn--primary btn--sm" onClick={openAdd}>
                  <Icon name="plus" size={14}/>New task
                </button>
              </div>
            </div>

            <MeetingPrepCard/>

            <div className="d-stats">
              <div className="d-stat">
                <span className="d-stat-label">Top priorities</span>
                <div className="d-stat-row">
                  <span className="d-stat-value">{top3Count}</span>
                  <span className="d-stat-delta up">{top3Done}/{top3Count} done</span>
                </div>
                <div className="d-stat-items">
                  {topItems.map(t => (
                    <div key={t.id} className="d-stat-item" title={t.label}>
                      <span className="d-stat-dot"/>{t.label}
                    </div>
                  ))}
                </div>
              </div>
              <div className="d-stat">
                <span className="d-stat-label">Meetings today</span>
                <div className="d-stat-row">
                  <span className="d-stat-value">{meetingsToday}</span>
                  <span className="d-stat-delta">Next up 14:30</span>
                </div>
                <div className="d-stat-items">
                  {meetingItems.map(m => (
                    <div key={m.id} className="d-stat-item" title={`${m.time} · ${m.title}`}>
                      <span className="d-stat-time">{m.time}</span>{m.title}
                    </div>
                  ))}
                </div>
              </div>
              <div className="d-stat">
                <span className="d-stat-label">Inbox needs reply</span>
                <div className="d-stat-row">
                  <span className="d-stat-value">{inboxCount}</span>
                  <span className="d-stat-delta">3 from leadership</span>
                </div>
                <div className="d-stat-items">
                  {inboxItems.map(i => (
                    <div key={i.id} className="d-stat-item" title={`${i.from} — ${i.title}`}>
                      <strong>{i.from.split(' ')[0]}</strong> <span className="dim">· {i.title}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="d-stat">
                <span className="d-stat-label">Blockers</span>
                <div className="d-stat-row">
                  <span className="d-stat-value">{blockerCount}</span>
                  <span className="d-stat-delta down">2 escalated</span>
                </div>
                <div className="d-stat-items">
                  {blockerItems.map((b, i) => (
                    <div key={i} className="d-stat-item" title={b.title}>
                      <span className={'d-stat-sev ' + (b.sev || 'medium')}/>{b.title}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="d-canvas-bar">
              <span className="d-canvas-hint">
                <Icon name="drag-and-drop" size={12}/>
                Drag a module header to move · drag any edge or corner to resize
                {isDirty && <span className="d-canvas-dirty">· Unsaved changes</span>}
              </span>
              <div style={{display:'flex', gap:8, alignItems:'center'}}>
                <button className="btn btn--ghost btn--sm" onClick={resetLayout}>Reset</button>
                <button
                  className={'btn btn--sm ' + (isDirty ? 'btn--primary' : 'btn--tertiary')}
                  onClick={saveLayout}
                  disabled={!isDirty && !justSaved}
                  title={isDirty ? 'Save the current arrangement' : 'Layout is saved — rearrange to enable'}>
                  <Icon name={isDirty ? 'star' : 'check'} size={14}/>
                  {justSaved ? 'Saved' : isDirty ? 'Save layout' : 'Saved'}
                </button>
              </div>
            </div>

            <div className="box-canvas" style={{ height: canvasH, minWidth: canvasW }}>
              {ordered.map(b => (
                <DraggableBox key={b.id} id={b.id} box={b}
                              onChange={onBoxChangeSafe}
                              onDragStart={onBoxDragStart}
                              onDragEnd={onBoxDragEnd}>
                  {renderModule(b.id)}
                </DraggableBox>
              ))}
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// VARIATION C — "Split Brain" · free-form canvas (drag header to move, edges to resize)
// =============================================================================
const DEFAULT_C_BOXES = [
  { id: 'top3',     left: 0,   top: 0,    width: 780, height: 280 },
  { id: 'calendar', left: 0,   top: 296,  width: 780, height: 500 },
  { id: 'tasks',    left: 0,   top: 812,  width: 780, height: 640 },
  { id: 'kpi',      left: 0,   top: 1468, width: 780, height: 360 },
  { id: 'projects', left: 0,   top: 1844, width: 780, height: 760 },
  { id: 'blockers', left: 0,   top: 2620, width: 780, height: 320 },
  { id: 'slack',    left: 796, top: 0,    width: 520, height: 640 },
  { id: 'inbox',    left: 796, top: 656,  width: 520, height: 420 },
  { id: 'team',     left: 796, top: 1092, width: 520, height: 380 },
  { id: 'wellness', left: 796, top: 1488, width: 520, height: 360 },
];
const LAYOUT_C_KEY = 'wdash-layout-c-freeform';

function loadLayoutC() {
  try {
    const raw = localStorage.getItem(LAYOUT_C_KEY);
    if (!raw) return DEFAULT_C_BOXES;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_C_BOXES;
    const valid = parsed.filter(x => x && typeof x.id === 'string' && x.id !== 'pins'
      && typeof x.left === 'number' && typeof x.top === 'number'
      && typeof x.width === 'number' && typeof x.height === 'number');
    const byId = new Map(valid.map(x => [x.id, x]));
    const merged = valid.slice();
    DEFAULT_C_BOXES.forEach(def => { if (!byId.has(def.id)) merged.push(def); });
    return merged;
  } catch { return DEFAULT_C_BOXES; }
}

function LayoutSplitBrain({ tod }) {
  const state = useDashboardState();
  const [boxes, setBoxes] = uS(loadLayoutC);
  const [activeId, setActiveId] = uS(null);

  uE(() => {
    try { localStorage.setItem(LAYOUT_C_KEY, JSON.stringify(boxes)); } catch {}
  }, [boxes]);

  const onBoxChange = (id, next) => {
    setBoxes(prev => prev.map(b => b.id === id ? { ...b, ...next } : b));
  };
  const onBoxDragStart = (id) => setActiveId(id);
  const onBoxDragEnd = () => setActiveId(null);

  const resetLayout = () => {
    try { localStorage.removeItem(LAYOUT_C_KEY); } catch {}
    setBoxes(DEFAULT_C_BOXES);
  };

  const canvasH = boxes.reduce((acc, b) => Math.max(acc, b.top + b.height), 0) + 32;
  const canvasW = boxes.reduce((acc, b) => Math.max(acc, b.left + b.width), 0) + 16;

  // Render the active box last so it stays on top (natural DOM stacking).
  const ordered = activeId
    ? [...boxes.filter(b => b.id !== activeId), boxes.find(b => b.id === activeId)].filter(Boolean)
    : boxes;

  const renderModule = (id) => {
    switch (id) {
      case 'top3':     return <Top3 data={state.top3} onToggle={state.toggleAny} okrApi={state.okrApi}/>;
      case 'calendar': return <CalendarMod data={state.calendar} next={SEED.nextMeeting}/>;
      case 'tasks':    return <TasksMod state={state} onToggle={state.toggleAny}/>;
      case 'kpi':      return <KpiMod data={SEED.kpis}/>;
      case 'projects': return <ProjectsMod data={SEED.projects} okrs={SEED.okrs} decisions={SEED.decisions} okrApi={state.okrApi}/>;
      case 'blockers': return <BlockersMod data={SEED.blockers}/>;
      case 'slack':    return <SlackMod data={SEED.slack}/>;
      case 'inbox':    return <InboxMod data={SEED.inbox}/>;
      case 'team':     return <TeamMod data={SEED.team}/>;
      case 'wellness': return <WellnessMod data={SEED.personalSignals}/>;
      case 'commitments': return <CommitmentsMod state={state}/>;
      default: return null;
    }
  };

  return (
    <>
      <Hero timeOfDay={tod} data={SEED} capacityPct={78} state={state}/>
      <div className="layout-toolbar">
        <span className="layout-toolbar-hint">
          <Icon name="drag-and-drop" size={12}/>
          Drag a module header to move · drag any edge or corner to resize
        </span>
        <button className="btn btn--ghost btn--sm" onClick={resetLayout}>Reset layout</button>
      </div>
      <div className="box-canvas" style={{ height: canvasH, minWidth: canvasW }}>
        {ordered.map(b => (
          <DraggableBox key={b.id} id={b.id} box={b}
                        onChange={onBoxChange}
                        onDragStart={onBoxDragStart}
                        onDragEnd={onBoxDragEnd}>
            {renderModule(b.id)}
          </DraggableBox>
        ))}
      </div>
    </>
  );
}

// =============================================================================
// Global toast — listens for dash:toast events from any module.
// =============================================================================
function GlobalToast() {
  const [items, setItems] = uS([]);
  uE(() => {
    const onToast = (e) => {
      const d = (e && e.detail) || {};
      const msg = d.msg || d.message || '';
      if (!msg) return;
      const id = 't-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
      const kind = d.kind || 'info';
      setItems(prev => [...prev, { id, msg, kind }]);
      setTimeout(() => setItems(prev => prev.filter(x => x.id !== id)), d.ms || 5000);
    };
    window.addEventListener('dash:toast', onToast);
    return () => window.removeEventListener('dash:toast', onToast);
  }, []);
  if (!items.length) return null;
  return (
    <div style={{
      position:'fixed', bottom:20, left:'50%', transform:'translateX(-50%)',
      zIndex: 10000, display:'flex', flexDirection:'column', gap:8,
      pointerEvents:'none', maxWidth:'min(520px, 92vw)',
    }}>
      {items.map(t => (
        <div key={t.id} className={'dash-toast dash-toast--' + t.kind}
             onClick={() => setItems(prev => prev.filter(x => x.id !== t.id))}
             style={{ pointerEvents:'auto' }}>
          {t.msg}
        </div>
      ))}
    </div>
  );
}

// =============================================================================
// App — renders a DesignCanvas with three artboards (the three layouts)
// =============================================================================

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "pink",
  "density": "comfortable",
  "timeOfDay": "afternoon",
  "focusMode": false,
  "layout": "D"
}/*EDITMODE-END*/;

function DashboardApp() {
  const [accent, setAccent]   = uS(TWEAK_DEFAULTS.accent);
  const [density, setDensity] = uS(TWEAK_DEFAULTS.density);
  const [tod, setTod]         = uS(detectTimeOfDay());
  // Re-check the wall clock every 5 min so the greeting flips morning→afternoon→evening on its own
  uE(() => {
    const interval = setInterval(() => {
      const next = detectTimeOfDay();
      setTod(prev => prev === next ? prev : next);
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // Quick-capture: URL ?capture=<text>&bucket=<overdue|dueSoon|blocked> auto-adds
  // a task on page load, then clears the query so refresh doesn't duplicate.
  // Pair with a Mac Shortcut that opens the dashboard URL with this param.
  uE(() => {
    try {
      const url = new URL(window.location.href);
      const capture = url.searchParams.get('capture');
      if (!capture) return;
      const bucket = url.searchParams.get('bucket') || 'dueSoon';
      const project = url.searchParams.get('project') || 'ops';
      const p = Number(url.searchParams.get('p')) || 2;
      window.dispatchEvent(new CustomEvent('dash:task-added', {
        detail: { label: decodeURIComponent(capture), bucket, project, p, meta: 'Quick capture' },
      }));
      url.searchParams.delete('capture');
      url.searchParams.delete('bucket');
      url.searchParams.delete('project');
      url.searchParams.delete('p');
      window.history.replaceState({}, '', url.pathname + (url.search ? '?' + url.searchParams : ''));
    } catch (e) { /* no-op */ }
  }, []);
  const [focus, setFocus]     = uS(TWEAK_DEFAULTS.focusMode);
  const [layout, setLayout]   = uS(TWEAK_DEFAULTS.layout); // 'canvas' | 'A' | 'B' | 'C'
  const [tweaksOpen, setTweaksOpen] = uS(false);
  const [findOpen, setFindOpen] = uS(false);
  const [addOpen, setAddOpen]   = uS(false);
  const [meetingOpen, setMeetingOpen] = uS(false);
  const [meetingPrefill, setMeetingPrefill] = uS('');
  const [taskPrefill, setTaskPrefill] = uS('');
  const [findPrefill, setFindPrefill] = uS('');
  const [summaryOpen, setSummaryOpen] = uS(false);
  const [summaryTopic, setSummaryTopic] = uS('brief');
  const [summaryPayload, setSummaryPayload] = uS(null);
  const [lensPerson, setLensPerson] = uS(null);
  const [shareOpen, setShareOpen] = uS(false);
  const [logDecOpen, setLogDecOpen] = uS(false);
  const [logDecPrefill, setLogDecPrefill] = uS(null);

  uE(() => {
    const openFind = (e) => { setFindPrefill((e && e.detail && e.detail.prefill) || ''); setFindOpen(true); };
    const openAdd  = (e) => { setTaskPrefill((e && e.detail && e.detail.prefill) || ''); setAddOpen(true); };
    const openMeet = (e) => { setMeetingPrefill((e && e.detail && e.detail.prefill) || ''); setMeetingOpen(true); };
    const openSum  = (e) => {
      const d = (e && e.detail) || {};
      setSummaryTopic(d.topic || 'brief');
      setSummaryPayload(d.payload || null);
      setSummaryOpen(true);
    };
    const openLens  = (e) => { const p = e && e.detail && e.detail.person; if (p) setLensPerson(p); };
    const openShare  = () => setShareOpen(true);
    const openLogDec = (e) => {
      setLogDecPrefill((e && e.detail) || null);
      setLogDecOpen(true);
    };
    const setLay   = (e) => { const k = e && e.detail && e.detail.layout; if (k) setLayout(k); };
    const setFoc   = (e) => { const on = !!(e && e.detail && e.detail.on); setFocus(on); };
    window.addEventListener('dash:open-find', openFind);
    window.addEventListener('dash:open-add-task', openAdd);
    window.addEventListener('dash:open-add-meeting', openMeet);
    window.addEventListener('dash:open-summary', openSum);
    window.addEventListener('dash:open-lens', openLens);
    window.addEventListener('dash:open-share', openShare);
    window.addEventListener('dash:log-decision', openLogDec);
    window.addEventListener('dash:set-layout', setLay);
    window.addEventListener('dash:set-focus', setFoc);
    const onKey = (e) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); setFindOpen(true); }
      if (e.key === 'm' && (e.metaKey || e.ctrlKey) && e.shiftKey) { e.preventDefault(); setMeetingOpen(true); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('dash:open-find', openFind);
      window.removeEventListener('dash:open-add-task', openAdd);
      window.removeEventListener('dash:open-add-meeting', openMeet);
      window.removeEventListener('dash:open-summary', openSum);
      window.removeEventListener('dash:open-lens', openLens);
      window.removeEventListener('dash:open-share', openShare);
      window.removeEventListener('dash:log-decision', openLogDec);
      window.removeEventListener('dash:set-layout', setLay);
      window.removeEventListener('dash:set-focus', setFoc);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  uE(() => { document.documentElement.dataset.accent  = accent;  }, [accent]);
  uE(() => { document.documentElement.dataset.density = density; }, [density]);
  uE(() => { document.body.classList.toggle('focus-mode', focus); }, [focus]);

  // Tweaks host protocol
  uE(() => {
    const onMsg = (e) => {
      const d = e.data;
      if (!d || typeof d !== 'object') return;
      if (d.type === '__activate_edit_mode')   setTweaksOpen(true);
      if (d.type === '__deactivate_edit_mode') setTweaksOpen(false);
    };
    window.addEventListener('message', onMsg);
    window.parent.postMessage({type:'__edit_mode_available'}, '*');
    return () => window.removeEventListener('message', onMsg);
  }, []);

  // persist on change
  uE(() => {
    window.parent.postMessage({type:'__edit_mode_set_keys', edits: {accent, density, timeOfDay: tod, focusMode: focus, layout}}, '*');
  }, [accent, density, tod, focus, layout]);

  // Only Layout D — Modern SaaS. Other layouts have been removed.
  // D brings its own shell (expanded sidebar + topbar), so no default chrome wrapper.

  return (
    <>
      <LayoutModernSaaS tod={tod}/>
      <TweaksPanel
        open={tweaksOpen} setOpen={setTweaksOpen}
        accent={accent} setAccent={setAccent}
        density={density} setDensity={setDensity}
        focus={focus} setFocus={setFocus}
        tod={tod} setTod={setTod}
      />
      <FindModal open={findOpen} onClose={() => setFindOpen(false)} prefillQuery={findPrefill}/>
      <AddTaskModal open={addOpen} onClose={() => setAddOpen(false)} prefillLabel={taskPrefill}/>
      <AddMeetingModal open={meetingOpen} onClose={() => setMeetingOpen(false)} prefillTitle={meetingPrefill}/>
      <VoiceSummaryModal open={summaryOpen} topic={summaryTopic} payload={summaryPayload} onClose={() => setSummaryOpen(false)}/>
      <StakeholderLens person={lensPerson} onClose={() => setLensPerson(null)}/>
      <ShareModal open={shareOpen} onClose={() => setShareOpen(false)}/>
      <LogDecisionModal open={logDecOpen} prefill={logDecPrefill} onClose={() => setLogDecOpen(false)}/>
      <GlobalToast/>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<DashboardApp/>);
