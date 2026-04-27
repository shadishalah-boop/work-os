/* global React, ReactDOM, SEED, Icon, Module, Top3, TasksMod, CalendarMod, MeetingLoad, InboxMod,
          SlackMod, ProjectsMod, KpiMod, TeamMod, BlockersMod, ShippedMod, PinsMod, WellnessMod,
          DraggableBox, FindModal, AddTaskModal, AddMeetingModal, VoiceSummaryModal */

const { useState: uS, useEffect: uE, useMemo: uM } = React;

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
  return (
    <aside className="rail">
      <div className="rail-logo">S</div>
      {items.map((it, i) => (
        <div key={i} className="rail-item" data-active={it.active}>
          <Icon name={it.icon} size={22}/>
          {it.dot && <span className="dot"/>}
        </div>
      ))}
      <div className="rail-spacer"/>
      <div className="rail-item"><Icon name="settings" size={22}/></div>
      <div style={{marginTop:8}}>
        <span className="pds-avatar size-32"><img src="ds/assets/shadi.jpg?v=1" alt="Shadi"/></span>
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

function Hero({ timeOfDay, data, capacityPct, state }) {
  const openFind    = () => window.dispatchEvent(new Event('dash:open-find'));
  const openAddTask = () => window.dispatchEvent(new Event('dash:open-add-task'));
  const g = (window.SEED && window.SEED.greeting) || {};
  const greeting =
    timeOfDay === 'morning'   ? (g.morning   || 'Morning, <em>Alex</em>.')   :
    timeOfDay === 'afternoon' ? (g.afternoon || 'Afternoon, <em>Alex</em>.') :
                                (g.evening   || 'Evening, <em>Alex</em>.');
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
const DONE_TTL_MS    = 12 * 60 * 60 * 1000;
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
const OKR_LINKS_KEY = 'dashboard.okrLinks.v1';
const OKR_META = {
  k1: { short: 'AI',  color: 'var(--pink-400)', bg: 'var(--pink-100)', ink: 'var(--pink-700)' },
  k2: { short: 'Fin', color: 'var(--teal-500)', bg: 'var(--teal-100)', ink: 'var(--teal-700)' },
  k3: { short: 'CEO', color: 'var(--blue-400)', bg: 'var(--blue-100)', ink: 'var(--blue-700)' },
};
const OKR_KEYWORDS = {
  k1: ['ai ', 'claude', ' mcp', 'skill', 'plugin', 'agent', 'workflow', 'automation', 'dashboard', 'work os', 'template', 'export', 'personal os', 'content creation', 'kb updater'],
  k2: ['payment', 'fintech', 'payout', 'paypal', 'tipalti', ' fx', 'treasury', 'checkout', 'bin ', 'corridor', 'currency', 'mor ', 'provider', 'rogan', 'charlie', 'konstantinos', 'sagat', 'ezequiel', 'paula', 'pablo', 'mathew', 'jarl', 'craig', 'merchant', 'fintech', 'compliance', 'float', 'wise'],
  k3: ['france', 'b2b', 'fr ', 'ceo', 'corp dev', 'm&a', 'acquisition', 'hendrix', 'flexi', 'mirjam', 'bertrand', 'tristan', 'onetoone', 'alejo', 'ken kubec', 'fe international'],
};
function loadOkrLinks() {
  try {
    const raw = JSON.parse(localStorage.getItem(OKR_LINKS_KEY) || '{}');
    const fresh = {};
    Object.entries(raw).forEach(([k, v]) => { if (v === 'k1' || v === 'k2' || v === 'k3') fresh[k] = v; });
    return fresh;
  } catch { return {}; }
}
function suggestOkrFromText(title, meta) {
  const text = ' ' + (title || '').toLowerCase() + ' ' + (meta || '').toLowerCase() + ' ';
  const scores = { k1: 0, k2: 0, k3: 0 };
  for (const [okr, kws] of Object.entries(OKR_KEYWORDS)) {
    for (const kw of kws) if (text.includes(kw)) scores[okr] += 1;
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
    [[top3, setTop3], [overdue, setOverdue], [dueSoon, setDueSoon], [blocked, setBlocked]].forEach(([l, s]) => {
      const task = l.find(t => t.id === id);
      if (task) {
        label = task.label;
        willBeDone = !task.done;
        s(l.map(t => t.id === id ? {...t, done: !t.done} : t));
      }
    });

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
    window.addEventListener('dash:task-added', onTaskAdded);
    window.addEventListener('dash:meeting-added', onMeetingAdded);
    return () => {
      window.removeEventListener('dash:task-added', onTaskAdded);
      window.removeEventListener('dash:meeting-added', onMeetingAdded);
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

        {/* Right — projects, KPIs, blockers, team, pins */}
        <div className="c-span-3" style={{display:'flex', flexDirection:'column', gap:16}}>
          <ProjectsMod data={SEED.projects} okrs={SEED.okrs} decisions={SEED.decisions} okrApi={state.okrApi}/>
          <KpiMod data={SEED.kpis}/>
          <BlockersMod data={SEED.blockers}/>
          <TeamMod data={SEED.team}/>
          <PinsMod data={SEED.pins}/>
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
          <PinsMod data={SEED.pins}/>
        </div>
      </div>
    </>
  );
}

// =============================================================================
// LAYOUT D — Modern SaaS · expanded sidebar, top bar with search, polished cards
// =============================================================================
function ModernRail({ active = 'home' }) {
  const sections = [
    { label: 'Workspace', items: [
      { key: 'home',     icon: 'home',         label: 'Dashboard' },
      { key: 'tasks',    icon: 'check-circle', label: 'Tasks',    pill: 11 },
      { key: 'calendar', icon: 'calendar',     label: 'Calendar' },
      { key: 'messages', icon: 'messages',     label: 'Messages', pill: 3 },
    ]},
    { label: 'Insights', items: [
      { key: 'projects', icon: 'progress',   label: 'Projects' },
      { key: 'metrics',  icon: 'insights',   label: 'Metrics' },
      { key: 'people',   icon: 'user-group', label: 'People' },
      { key: 'library',  icon: 'library',    label: 'Library' },
    ]},
  ];
  return (
    <aside className="d-rail">
      <div className="d-rail-logo">
        <div className="d-rail-logo-mark">S</div>
        <div className="d-rail-logo-text">
          Shadi
          <small>Strategy & Planning</small>
        </div>
      </div>
      {sections.map((s, i) => (
        <React.Fragment key={i}>
          <div className="d-rail-section">{s.label}</div>
          {s.items.map(it => (
            <div key={it.key} className="d-rail-item" data-active={it.key === active}>
              <Icon name={it.icon} size={16}/>
              <span>{it.label}</span>
              {it.pill != null && <span className="pill">{it.pill}</span>}
            </div>
          ))}
        </React.Fragment>
      ))}
      <div className="d-rail-user">
        <span className="pds-avatar size-32"><img src="ds/assets/shadi.jpg?v=1" alt="Shadi"/></span>
        <div className="d-rail-user-meta">
          <div className="d-rail-user-name">Shadi Shalah</div>
          <div className="d-rail-user-role">Reports to Jose Ferreira</div>
        </div>
        <button className="icon-btn" title="Settings"><Icon name="settings" size={14}/></button>
      </div>
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
        if (/^slack$/.test(what))                     return { url: 'https://preply.slack.com', label: 'Slack' };
        if (/^granola$/.test(what))                   return { url: 'https://app.granola.ai', label: 'Granola' };
        if (/^(okrs?|okr\s+sheet)$/.test(what))       return { url: 'https://docs.google.com/spreadsheets/d/1JCV36oLjUwu0orX2ZVxGN-jJe5DodNiwPkc2e_ofGX0/edit', label: 'Q2 OKRs sheet' };
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

function ModernTopbar() {
  const openFind = () => window.dispatchEvent(new Event('dash:open-find'));
  return (
    <div className="d-topbar">
      <div className="d-search" onClick={openFind} role="button" tabIndex={0}>
        <Icon name="search" size={14}/>
        <span className="d-search-placeholder">Search tasks, people, files, meetings…</span>
        <kbd>⌘K</kbd>
      </div>
      <div style={{flex: 1}}/>
      <VoiceButton/>
      <button className="d-topbar-icon" title="Filter"><Icon name="filter" size={16}/></button>
      <button className="d-topbar-icon" title="Notifications">
        <Icon name="bell" size={16}/>
        <span className="dot"/>
      </button>
      <div className="d-topbar-divider"/>
      <LiveClock/>
    </div>
  );
}

// Default layout D — two-column balanced (left: priority work, right: live feed)
// Heights tuned to module content; left/right end near same bottom for clean scrolling.
const DEFAULT_D_BOXES = [
  // Left column (720 wide) — priority work
  { id: 'top3',     left: 0,   top: 0,    width: 720, height: 400 },
  { id: 'tasks',    left: 0,   top: 416,  width: 720, height: 600 },
  { id: 'projects', left: 0,   top: 1032, width: 720, height: 700 },
  { id: 'kpi',      left: 0,   top: 1748, width: 720, height: 320 },
  { id: 'wellness', left: 0,   top: 2084, width: 720, height: 320 },
  // Right column (400 wide) — live feed
  { id: 'calendar', left: 736, top: 0,    width: 400, height: 460 },
  { id: 'slack',    left: 736, top: 476,  width: 400, height: 600 },
  { id: 'inbox',    left: 736, top: 1092, width: 400, height: 400 },
  { id: 'blockers', left: 736, top: 1508, width: 400, height: 280 },
  { id: 'team',     left: 736, top: 1804, width: 400, height: 320 },
  { id: 'pins',     left: 736, top: 2140, width: 400, height: 340 },
];
const LAYOUT_D_KEY = 'wdash-layout-d-freeform';

function loadLayoutD() {
  try {
    const raw = localStorage.getItem(LAYOUT_D_KEY);
    if (!raw) return DEFAULT_D_BOXES;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_D_BOXES;
    const valid = parsed.filter(x => x && typeof x.id === 'string'
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

  // Explicit save (no auto-save) — the user's button click is what persists.
  const currentJson = JSON.stringify(boxes);
  const isDirty = currentJson !== savedSnapshot;

  const saveLayout = () => {
    try { localStorage.setItem(LAYOUT_D_KEY, currentJson); } catch {}
    setSavedSnapshot(currentJson);
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 1800);
  };

  const onBoxChange    = (id, next) => setBoxes(prev => prev.map(b => b.id === id ? { ...b, ...next } : b));
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

  const canvasH = boxes.reduce((acc, b) => Math.max(acc, b.top + b.height), 0) + 32;
  const canvasW = boxes.reduce((acc, b) => Math.max(acc, b.left + b.width), 0);
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
      case 'pins':     return <PinsMod data={SEED.pins}/>;
      default: return null;
    }
  };

  const g = (window.SEED && window.SEED.greeting) || {};
  const greetingRaw =
    tod === 'morning'   ? (g.morning   || 'Morning, <em>Shadi</em>.')   :
    tod === 'afternoon' ? (g.afternoon || 'Afternoon, <em>Shadi</em>.') :
                          (g.evening   || 'Evening, <em>Shadi</em>.');
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
      <div className="app-d">
        <ModernRail active="home"/>
        <div className="d-main">
          <ModernTopbar/>
          <div className="d-content">

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
                              onChange={onBoxChange}
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
  { id: 'pins',     left: 796, top: 1864, width: 520, height: 400 },
];
const LAYOUT_C_KEY = 'wdash-layout-c-freeform';

function loadLayoutC() {
  try {
    const raw = localStorage.getItem(LAYOUT_C_KEY);
    if (!raw) return DEFAULT_C_BOXES;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_C_BOXES;
    const valid = parsed.filter(x => x && typeof x.id === 'string'
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
      case 'pins':     return <PinsMod data={SEED.pins}/>;
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
    const setLay   = (e) => { const k = e && e.detail && e.detail.layout; if (k) setLayout(k); };
    const setFoc   = (e) => { const on = !!(e && e.detail && e.detail.on); setFocus(on); };
    window.addEventListener('dash:open-find', openFind);
    window.addEventListener('dash:open-add-task', openAdd);
    window.addEventListener('dash:open-add-meeting', openMeet);
    window.addEventListener('dash:open-summary', openSum);
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
      <GlobalToast/>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<DashboardApp/>);
