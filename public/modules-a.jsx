/* global React, SEED */
// =============================================================================
// Dashboard — reusable sub-components & small modules
// =============================================================================

const { useState, useRef, useEffect, useMemo } = React;

// --- Icon helper ---
function Icon({ name, size = 16, style }) {
  return React.createElement('img', {
    src: `ds/assets/icons/${name}.svg`,
    width: size, height: size, alt: '',
    style: { display: 'inline-block', ...style },
  });
}

// --- Module shell ---
function Module({ title, count, sub, action, actionHref, onAction, right, icon, className, children, ...rest }) {
  return (
    <div className={'mod ' + (className || '')} {...rest}>
      <div className="mod-h">
        <div className="mod-h-l">
          {icon}
          <div>
            <div className="mod-title">
              {title}
              {count != null && <span className="count">{count}</span>}
            </div>
            {sub && <div className="mod-sub">{sub}</div>}
          </div>
        </div>
        <div className="mod-h-r">
          {right}
          {action && (actionHref
            ? <a className="link-all" href={actionHref} target="_blank" rel="noreferrer">{action}<Icon name="chevron-right" size={14}/></a>
            : <a className="link-all" href="#" onClick={e=>{e.preventDefault(); if (onAction) onAction(e);}}>{action}<Icon name="chevron-right" size={14}/></a>)}
        </div>
      </div>
      {children}
    </div>
  );
}

// --- Draggable task list ---
function useDraggable(initial) {
  const [items, setItems] = useState(initial);
  const dragId = useRef(null);
  const onDragStart = (id) => (e) => { dragId.current = id; e.dataTransfer.effectAllowed = 'move'; };
  const onDragOver  = (id) => (e) => { e.preventDefault(); e.currentTarget.classList.add('drag-over'); };
  const onDragLeave = (e) => { e.currentTarget.classList.remove('drag-over'); };
  const onDrop      = (id) => (e) => {
    e.preventDefault(); e.currentTarget.classList.remove('drag-over');
    const from = items.findIndex(i => i.id === dragId.current);
    const to   = items.findIndex(i => i.id === id);
    if (from < 0 || to < 0 || from === to) return;
    const next = items.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setItems(next);
  };
  return { items, setItems, onDragStart, onDragOver, onDragLeave, onDrop };
}

// --- Top-3 Today (hero priority block) ---
function Top3({ data, onToggle, density }) {
  const drag = useDraggable(data);
  useEffect(() => { drag.setItems(data); }, [data]);
  const now = new Date();
  const stamp = now.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase();
  return (
    <div className="top3 mod-focus-survivor">
      <div className="top3-h">
        <div className="top3-title">
          <span className="badge-star"><Icon name="lightning" size={14} style={{filter:'brightness(0)'}}/></span>
          What actually matters today
        </div>
        <div className="top3-stamp">{stamp} · {drag.items.filter(i=>!i.done).length} of 3 left</div>
      </div>
      <div className="top3-list">
        {drag.items.map((it, idx) => (
          <div key={it.id}
               className={'top3-item' + (it.done ? ' done' : '')}
               draggable
               onDragStart={drag.onDragStart(it.id)}
               onDragOver={drag.onDragOver(it.id)}
               onDragLeave={drag.onDragLeave}
               onDrop={drag.onDrop(it.id)}>
            <div className="top3-num">{String(idx + 1).padStart(2,'0')}</div>
            <div>
              <div className="top3-label">{it.label}</div>
              <div className="top3-meta">{it.meta}</div>
            </div>
            <div className="top3-check" onClick={() => onToggle(it.id)} role="button" aria-label={it.done ? 'Mark incomplete' : 'Mark complete'}/>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Simple task row used in tasks module (overdue / due-soon / blocked) ---
function TaskRow({ t, onToggle, projectColor }) {
  return (
    <div className={'task-row' + (t.done ? ' done' : '')}>
      <div className="task-tick" data-done={t.done} onClick={() => onToggle(t.id)} role="button" aria-label="Toggle"/>
      <div className="task-body">
        <div className="task-title">{t.label}</div>
        <div className="task-meta">
          {projectColor && <span className="proj-dot" style={{background: projectColor}}/>}
          {t.meta}
        </div>
      </div>
      <div style={{display:'flex', alignItems:'center', gap:8}}>
        <span className="priority-flag" data-p={t.p}>P{t.p}</span>
        <img className="drag-grip" src="ds/assets/icons/drag-and-drop.svg" alt=""/>
      </div>
    </div>
  );
}

// --- Tasks & priorities module ---
function TasksMod({ state, onToggle }) {
  const projColor = (id) => {
    const map = {
      hiring: 'var(--pink-400)', ops: 'var(--grey-400)', partnerships: 'var(--blue-400)',
      infra: 'var(--teal-400)', contracts: 'var(--red-400)', brand: 'var(--yellow-400)', growth: 'var(--pink-400)',
    };
    return map[id] || 'var(--grey-300)';
  };
  return (
    <Module title="Tasks" sub="Only what moves today" action="Open list"
            icon={<span className="mod-icon-dot" style={{width:28, height:28, borderRadius:8, background:'var(--grey-100)', display:'grid', placeItems:'center'}}><Icon name="check-circle" size={16}/></span>}>
      {state.overdue.length > 0 && <>
        <div className="sub-section-head"><span style={{color:'var(--red-600)'}}>Overdue</span><span className="bar"/><span>{state.overdue.length}</span></div>
        {state.overdue.map(t => <TaskRow key={t.id} t={t} onToggle={onToggle} projectColor={projColor(t.project)}/>)}
      </>}
      <div className="sub-section-head">Due soon<span className="bar"/><span>{state.dueSoon.length}</span></div>
      {state.dueSoon.map(t => <TaskRow key={t.id} t={t} onToggle={onToggle} projectColor={projColor(t.project)}/>)}
      <div className="sub-section-head">Blocked on others<span className="bar"/><span>{state.blocked.length}</span></div>
      {state.blocked.map(t => <TaskRow key={t.id} t={t} onToggle={onToggle} projectColor={projColor(t.project)}/>)}
      <div className="sub-section-head">Recently shipped<span className="bar"/><span>{state.shipped.length}</span></div>
      {state.shipped.map(s => (
        <div key={s.id} className="ship-row">
          <div className="tick"><Icon name="check" size={12}/></div>
          <div className="ship-body">
            <div className="ship-title">{s.title}</div>
          </div>
          <div className="ship-meta">{s.meta}</div>
        </div>
      ))}
    </Module>
  );
}

// --- Calendar module ---
function CalendarMod({ data, next }) {
  const _nowDate = new Date();
  const NOW = `${String(_nowDate.getHours()).padStart(2,'0')}:${String(_nowDate.getMinutes()).padStart(2,'0')}`;
  const _dateLabel = _nowDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const _eventCount = (data && data.length) || 0;
  return (
    <Module title="Today" sub={`${_dateLabel} · ${_eventCount} event${_eventCount===1?'':'s'}`}
            icon={<span style={{width:28, height:28, borderRadius:8, background:'var(--grey-100)', display:'grid', placeItems:'center'}}><Icon name="calendar" size={16}/></span>}
            action="Week view" actionHref="https://calendar.google.com/calendar/u/0/r/week">
      <div className="countdown">
        <div className="cd-l">
          <div className="cd-title">{next.title}</div>
          <div className="cd-sub">with {next.with} · {next.room}</div>
        </div>
        <div className="cd-big">{next.startsIn}m</div>
      </div>
      <div style={{marginTop:4}}>
        {data.map((e, idx) => {
          const toMin = (t) => { const [h,m] = t.split(':').map(Number); return h*60+m; };
          const nowMin = toMin(NOW);
          const endMin = toMin(e.time) + (e.duration || 30);
          const pastEnd = endMin <= nowMin;
          const insertNow = idx > 0
            && toMin(data[idx-1].time) + (data[idx-1].duration||30) <= nowMin
            && toMin(e.time) >= nowMin;
          const displayType = pastEnd ? 'done' : e.type;
          return (
            <React.Fragment key={e.id}>
              {insertNow && (
                <div className="now-line">
                  <span className="now-line-label">Now · {NOW}</span>
                  <span className="now-line-bar"/>
                </div>
              )}
              <div className="cal-day">
                <div className="cal-time">{e.time}</div>
                <div className="cal-event" data-type={displayType}>
                  <div className="cal-title">{e.title}</div>
                  {e.who && (
                    <div className="cal-attendees">
                      <div className="cal-stack-avatars">
                        {e.who.slice(0,3).map((w,i) => (
                          <span key={i} className="pds-avatar size-24">
                            <img src="ds/assets/avatar-default.svg" alt={w}/>
                          </span>
                        ))}
                      </div>
                      <span>{e.who.slice(0,3).join(', ')}{e.who.length > 3 ? ` +${e.who.length - 3}` : ''}</span>
                    </div>
                  )}
                </div>
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </Module>
  );
}

// --- Meeting load pill ---
function MeetingLoad({ data }) {
  const pct = Math.round((data.hoursThisWeek / data.hoursCap) * 100);
  return (
    <div style={{
      display:'flex', alignItems:'center', gap:12, padding:'12px 14px',
      border:'2px solid var(--border-default)', borderRadius:4, background:'var(--bg-surface)'
    }}>
      <div style={{
        width:42, height:42, borderRadius:10,
        background: data.hoursThisWeek > data.hoursCap ? 'var(--red-50)' : 'var(--grey-50)',
        display:'grid', placeItems:'center'
      }}>
        <Icon name="hourglass" size={20}/>
      </div>
      <div style={{flex:1, minWidth:0}}>
        <div style={{fontSize:12, fontWeight:600, color:'var(--fg-3)', letterSpacing:'0.04em', textTransform:'uppercase'}}>Meeting load</div>
        <div style={{fontFamily:'var(--font-display)', fontWeight:500, fontSize:20, lineHeight:1, marginTop:4}}>
          {data.hoursThisWeek}h <span style={{fontSize:13, color:'var(--fg-3)'}}>of {data.hoursCap}h</span>
        </div>
        <div style={{
          width:'100%', height:4, borderRadius:999, background:'var(--grey-100)',
          marginTop:6, position:'relative', overflow:'hidden'
        }}>
          <span style={{
            position:'absolute', inset:0, width:`${Math.min(100, pct)}%`,
            background: pct > 90 ? 'var(--red-500)' : 'var(--grey-900)', borderRadius:999
          }}/>
        </div>
      </div>
    </div>
  );
}

// --- Inbox module ---
function InboxMod({ data }) {
  const [items, setItems] = useState(data);
  useEffect(()=>{setItems(data)},[data]);
  return (
    <Module title="Inbox that matters" sub="Filtered · not raw counts" count={items.length}
            icon={<span style={{width:28, height:28, borderRadius:8, background:'var(--grey-100)', display:'grid', placeItems:'center'}}><Icon name="mail" size={16}/></span>}
            action="Open inbox" actionHref="https://mail.google.com/mail/u/0/#inbox"
            className="inbox-mod">
      {items.map(m => (
        <div key={m.id} className="inbox-row" onClick={()=>setItems(items.filter(x=>x.id!==m.id))}>
          <span className="pds-avatar size-32">
            <img src="ds/assets/avatar-default.svg" alt={m.from}/>
          </span>
          <div style={{minWidth:0}}>
            <div className="inbox-title">
              <span className="inbox-tag" data-t={m.tag}>{m.tag}</span>
              <span style={{color:'var(--fg-1)'}}>{m.from}</span>
              <span style={{color:'var(--fg-3)', fontWeight:400, fontSize:13}}>· {m.channel}</span>
            </div>
            <div className="inbox-preview">{m.title} — <span style={{color:'var(--fg-3)'}}>{m.preview}</span></div>
          </div>
          <div className="inbox-meta">{m.at}</div>
        </div>
      ))}
      {items.length === 0 && <div className="empty-ok"><span className="big">Inbox zero</span>Enjoy the quiet.</div>}
    </Module>
  );
}

// --- Free-form box (drag module header to move, drag edges to resize) ---
const BOX_MIN_W = 260, BOX_MIN_H = 140;
const DRAG_ZONE_SELECTOR = '.mod-h, .top3-h';
const IGNORE_SELECTOR = 'button, a, input, textarea, select, [role="button"], .box-rh, .task-tick, .top3-check, .inbox-row, .pin, .slack-row, .slack-tab, .slack-compose';

function DraggableBox({ id, box, onChange, onDragStart, onDragEnd, children }) {
  const ref = useRef(null);
  const [dragging, setDragging] = useState(false);

  const beginMove = (e) => {
    if (e.button !== 0) return;
    if (e.target.closest(IGNORE_SELECTOR)) return;
    if (!e.target.closest(DRAG_ZONE_SELECTOR)) return;
    e.preventDefault();
    setDragging(true);
    if (onDragStart) onDragStart(id);
    const sx = e.clientX, sy = e.clientY;
    const sL = box.left, sT = box.top;
    const onMove = (ev) => {
      onChange(id, { ...box, left: sL + (ev.clientX - sx), top: Math.max(0, sT + (ev.clientY - sy)) });
    };
    const onUp = () => {
      setDragging(false);
      if (onDragEnd) onDragEnd(id);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  };

  const beginResize = (dir) => (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);
    if (onDragStart) onDragStart(id);
    const sx = e.clientX, sy = e.clientY;
    const sW = box.width, sH = box.height, sL = box.left, sT = box.top;
    const onMove = (ev) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      let w = sW, h = sH, L = sL, T = sT;
      if (dir.includes('e')) w = Math.max(BOX_MIN_W, sW + dx);
      if (dir.includes('s')) h = Math.max(BOX_MIN_H, sH + dy);
      if (dir.includes('w')) { const nw = Math.max(BOX_MIN_W, sW - dx); L = sL + (sW - nw); w = nw; }
      if (dir.includes('n')) { const nh = Math.max(BOX_MIN_H, sH - dy); T = Math.max(0, sT + (sH - nh)); h = nh; }
      onChange(id, { ...box, left: L, top: T, width: w, height: h });
    };
    const onUp = () => {
      setDragging(false);
      if (onDragEnd) onDragEnd(id);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  };

  return (
    <div ref={ref}
         className={'box' + (dragging ? ' box-dragging' : '')}
         style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
         onPointerDown={beginMove}>
      <div className="box-inner">{children}</div>
      {['n','e','s','w','nw','ne','sw','se'].map(d => (
        <div key={d} className={`box-rh box-rh-${d}`} onPointerDown={beginResize(d)}/>
      ))}
    </div>
  );
}

Object.assign(window, { Icon, Module, Top3, TaskRow, TasksMod, CalendarMod, MeetingLoad, InboxMod, useDraggable, DraggableBox, BOX_MIN_W, BOX_MIN_H });
