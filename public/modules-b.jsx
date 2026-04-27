/* global React, SEED, Icon, Module */
// =============================================================================
// Dashboard — Slack, Projects, KPIs, Team, Blockers, Pins, Wellness
// =============================================================================

const { useState: useStateB, useEffect: useEffectB, useMemo: useMemoB } = React;

// --- Slack Module (tabs filter real data; buttons open Slack) ---
function SlackMod({ data }) {
  const [activeTab, setActiveTab] = useStateB(data.tabs.find(t=>t.active)?.id || 'missed');
  const [expanded, setExpanded] = useStateB(data.channels[0]?.id);
  const [askQ, setAskQ] = useStateB('');
  const [askState, setAskState] = useStateB({ status: 'idle', results: [], error: null, query: '' });
  const [replyText, setReplyText] = useStateB({});

  const workspace = data.workspace || 'preply';
  const openInSlack = (url) => { if (url) window.open(url, '_blank', 'noopener'); };

  // Helper-service awareness: when the local dashboard-helper is up, clicks
  // become real one-click Slack sends with undo. When it's down, we fall back
  // to copy-to-clipboard + open-in-Slack (the original Path A behavior).
  const [helperOnline, setHelperOnline] = useStateB(false);
  useEffectB(() => {
    if (!window.DashboardHelper) return;
    return window.DashboardHelper.onStatus(setHelperOnline);
  }, []);
  const slackSendOrFallback = async (text, permalink, where) => {
    const helper = window.DashboardHelper;
    const trimmed = (text || '').trim();
    if (helper && helper.online && permalink && trimmed) {
      const { channel, thread_ts } = helper.parsePermalink(permalink);
      if (channel) {
        try {
          await helper.sendWithUndo({ channel, text: trimmed, thread_ts, where });
          return;
        } catch (e) {
          helper.toast('Send failed: ' + (e.message || 'unknown error'), { kind: 'error', durationMs: 4000 });
        }
      }
    }
    if (trimmed && navigator.clipboard) {
      try { await navigator.clipboard.writeText(trimmed); } catch {}
    }
    if (permalink) window.open(permalink, '_blank', 'noopener');
  };
  const searchSlackNative = (q) => {
    const query = encodeURIComponent(q || '');
    window.open(`https://${workspace}.slack.com/search/${query}`, '_blank', 'noopener');
  };
  const runAsk = async (q) => {
    setAskState({ status: 'loading', results: [], error: null, query: q });
    try {
      const r = await fetch('http://127.0.0.1:8766/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q }),
      });
      const data = await r.json();
      if (data.error === 'slack-token-missing') {
        setAskState({ status: 'no-token', results: [], error: data.message, query: q });
        return;
      }
      if (data.error) {
        setAskState({ status: 'error', results: [], error: data.error, query: q });
        return;
      }
      setAskState({ status: 'ok', results: data.results || [], error: null, query: q });
    } catch (err) {
      setAskState({ status: 'no-server', results: [], error: String(err), query: q });
    }
  };
  const onAskSubmit = (e) => {
    if (e.key && e.key !== 'Enter') return;
    if (!askQ.trim()) return;
    runAsk(askQ.trim());
  };

  // Filter by active tab (channel must list the tab in c.tabs)
  const channels = data.channels.filter(c => (c.tabs || []).includes(activeTab));

  return (
    <Module
      title={<span style={{display:'inline-flex', alignItems:'center', gap:8}}><span className="slack-brand"/>Slack · what you missed</span>}
      sub={`${data.channels.length} tracked · ${(data.activeThreads||[]).length} active threads across Preply`}
      right={
        <div style={{display:'flex', alignItems:'center', gap:8}}>
          <span
            className={'helper-status ' + (helperOnline ? 'on' : 'off')}
            title={helperOnline ? 'dashboard-helper online · clicks send instantly' : 'dashboard-helper offline · clicks copy to clipboard + open Slack'}
          >
            {helperOnline ? '⚡ live send' : 'open-in-Slack'}
          </span>
          <button className="icon-btn" aria-label="Open Slack" onClick={()=>openInSlack(`https://${workspace}.slack.com`)}><Icon name="external-link" size={16}/></button>
        </div>
      }
      className="slack-mod">

      {/* Ask-anything box */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 10px', marginBottom: 10,
        border: '2px solid var(--border-default)', borderRadius: 8,
        background: 'var(--grey-50)',
      }}>
        <Icon name="search" size={14}/>
        <input
          value={askQ}
          onChange={e=>setAskQ(e.target.value)}
          onKeyDown={onAskSubmit}
          placeholder="Ask Slack anything · e.g. &quot;what did Bogdan say about Q2 hiring?&quot;"
          style={{flex:1, border:'none', outline:'none', background:'transparent', fontSize:13, fontFamily:'inherit'}}
        />
        <button className="btn btn--primary btn--sm" onClick={()=>onAskSubmit({})} disabled={!askQ.trim() || askState.status==='loading'}>
          {askState.status==='loading' ? '…' : 'Ask'}
        </button>
      </div>

      {/* Ask results */}
      {askState.status !== 'idle' && (
        <div style={{
          marginBottom: 12, padding: 10,
          border: '2px solid var(--border-default)', borderRadius: 8,
          background: 'var(--bg-1)',
        }}>
          <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: 8, fontSize: 12, color:'var(--fg-2)'}}>
            <span>
              {askState.status==='loading' && `Searching Slack for "${askState.query}"…`}
              {askState.status==='ok' && `${askState.results.length} result${askState.results.length===1?'':'s'} for "${askState.query}"`}
              {askState.status==='no-token' && 'Backend running — but Slack token not set'}
              {askState.status==='no-server' && 'Local ask-server not running on :8766'}
              {askState.status==='error' && `Slack error: ${askState.error}`}
            </span>
            <button className="btn btn--ghost btn--sm" onClick={()=>setAskState({status:'idle', results:[], error:null, query:''})}>Clear</button>
          </div>

          {askState.status==='no-server' && (
            <div style={{fontSize:12, color:'var(--fg-2)', lineHeight:1.5}}>
              Open a Terminal and run: <code style={{fontFamily:'var(--font-mono)', background:'var(--grey-100)', padding:'1px 5px', borderRadius:3}}>bash ~/.claude/dashboard-server/start.sh</code>
              <br/>Then paste your Slack user token (xoxp-…) into <code style={{fontFamily:'var(--font-mono)', background:'var(--grey-100)', padding:'1px 5px', borderRadius:3}}>~/.claude/dashboard-server/slack-token.txt</code>
            </div>
          )}

          {askState.status==='no-token' && (
            <div style={{fontSize:12, color:'var(--fg-2)', lineHeight:1.5}}>
              Paste your Slack user token (xoxp-…) into <code style={{fontFamily:'var(--font-mono)', background:'var(--grey-100)', padding:'1px 5px', borderRadius:3}}>~/.claude/dashboard-server/slack-token.txt</code> and ask again.
              <div style={{marginTop:6}}>
                <button className="btn btn--ghost btn--sm" onClick={()=>searchSlackNative(askState.query)}>Open in Slack search instead</button>
              </div>
            </div>
          )}

          {askState.status==='ok' && askState.results.length === 0 && (
            <div style={{fontSize:12, color:'var(--fg-2)'}}>
              No matches. <button className="btn btn--ghost btn--sm" onClick={()=>searchSlackNative(askState.query)}>Try in Slack</button>
            </div>
          )}

          {askState.status==='ok' && askState.results.map((m, i) => (
            <div key={i} style={{padding:'8px 0', borderTop: i>0 ? '1px solid var(--border-subtle)' : 'none'}}>
              <div style={{display:'flex', alignItems:'center', gap:8, fontSize:11, color:'var(--fg-2)', marginBottom:4}}>
                <span style={{fontFamily:'var(--font-mono)', fontWeight:700}}>#{m.channel}</span>
                <span>·</span>
                <span>{m.user}</span>
                {m.permalink && (<>
                  <span style={{marginLeft:'auto'}}></span>
                  <a href={m.permalink} target="_blank" rel="noreferrer" style={{fontSize:11, color:'var(--fg-2)'}}>Open ↗</a>
                </>)}
              </div>
              <div style={{fontSize:13, lineHeight:1.45, color:'var(--fg-1)'}}>{m.text}</div>
            </div>
          ))}
        </div>
      )}

      <div className="slack-tabs">
        {data.tabs.map(t => (
          <button key={t.id} className="slack-tab" data-active={activeTab===t.id} onClick={()=>setActiveTab(t.id)}>
            {t.label}<span className="bubble">{t.count}</span>
          </button>
        ))}
      </div>

      {channels.map(c => (
        <div key={c.id} className="slack-row" style={{display:'block', cursor:'pointer'}} onClick={()=>setExpanded(expanded===c.id ? null : c.id)}>
          <div style={{display:'grid', gridTemplateColumns:'auto 1fr auto', gap:12, alignItems:'start'}}>
            <span style={{
              width: 28, height: 28, borderRadius: 6,
              background: c.priority === 'high' ? 'var(--red-50)' : c.priority === 'med' ? 'var(--yellow-50)' : 'var(--grey-100)',
              display: 'grid', placeItems: 'center', flexShrink: 0,
              color: c.priority === 'high' ? 'var(--red-600)' : c.priority === 'med' ? 'var(--yellow-800)' : 'var(--fg-3)',
              fontWeight: 700, fontSize: 13, fontFamily: 'var(--font-mono)'
            }}>#</span>
            <div style={{minWidth:0}}>
              <div className="slack-channel">
                <span>{c.channel}</span>
                <span className="mention-chip" data-pri={c.priority} style={{marginLeft:'auto'}}>
                  {c.priority === 'high' ? 'Needs you' : c.priority === 'med' ? 'Look soon' : 'FYI'}
                </span>
              </div>
              <div className="slack-row-meta">
                {c.unread > 0 ? `${c.unread} unread · ` : ''}updated {c.updated}
                {c.yourMsgsToday ? ` · ${c.yourMsgsToday} msg${c.yourMsgsToday===1?'':'s'} from you today` : ''}
              </div>
              <div className="slack-ai">
                <div className="label"><Icon name="sparkle" size={12}/>Claude summary</div>
                {c.summary}
              </div>
              <div className="slack-mentions">
                {c.mentions.map((m, i) => (
                  <span key={i} className="mention-chip" data-pri={m.pri}>{m.label}</span>
                ))}
              </div>
              {expanded === c.id && (
                <div onClick={e=>e.stopPropagation()}>
                  <div className="slack-thread-peek">
                    {c.peek.map((m, i) => (
                      <div key={i} className="slack-msg">
                        <span className="pds-avatar size-24"><img src="ds/assets/avatar-default.svg" alt={m.who}/></span>
                        <div className="body"><strong>{m.who}</strong>{m.body}</div>
                      </div>
                    ))}
                  </div>
                  <div className="slack-suggested">
                    {c.suggested.map((s, i) => (
                      <button
                        key={i}
                        className={'sug' + (s.primary ? ' primary' : '')}
                        title={helperOnline ? `Send to ${c.channel}` : 'Copies to clipboard and opens in Slack'}
                        onClick={()=>slackSendOrFallback(s.label, c.permalink, c.channel)}>
                        {s.primary && <Icon name="sparkle" size={12} style={{filter: s.primary ? 'invert(1)' : 'none'}}/>}
                        {s.label}
                        {helperOnline && <span className="sug-bolt" aria-label="instant send" title="instant send">⚡</span>}
                      </button>
                    ))}
                  </div>
                  <div className="slack-compose">
                    <Icon name="reply" size={14}/>
                    <input
                      placeholder={helperOnline ? `Type and press Enter to send to ${c.channel}` : `Draft reply — opens in Slack to send`}
                      value={replyText[c.id] || ''}
                      onChange={e=>setReplyText({...replyText, [c.id]: e.target.value})}
                      onKeyDown={async e => {
                        if (e.key !== 'Enter') return;
                        const t = replyText[c.id] || '';
                        if (!t.trim()) return;
                        await slackSendOrFallback(t, c.permalink, c.channel);
                        if (window.DashboardHelper && window.DashboardHelper.online) {
                          setReplyText({...replyText, [c.id]: ''});
                        }
                      }}
                    />
                    <button
                      className="icon-btn"
                      aria-label={helperOnline ? 'Send' : 'Open in Slack'}
                      title={helperOnline ? `Send to ${c.channel}` : 'Copies draft to clipboard and opens the thread in Slack'}
                      onClick={async ()=>{
                        const t = replyText[c.id] || '';
                        if (!t.trim()) return;
                        await slackSendOrFallback(t, c.permalink, c.channel);
                        if (window.DashboardHelper && window.DashboardHelper.online) {
                          setReplyText({...replyText, [c.id]: ''});
                        }
                      }}
                    ><Icon name="send" size={14}/></button>
                  </div>
                </div>
              )}
            </div>
            <Icon name={expanded === c.id ? "chevron-down" : "chevron-right"} size={14} style={{opacity: 0.5, marginTop: 6}}/>
          </div>
        </div>
      ))}
      {channels.length === 0 && <div className="empty-ok"><span className="big">All caught up</span>Nothing in this tab right now.</div>}

      {/* Most active threads across Slack */}
      {(data.activeThreads || []).length > 0 && (
        <div style={{marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border-subtle)'}}>
          <div style={{
            fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em',
            color: 'var(--fg-3, var(--fg-2))', fontWeight: 700, marginBottom: 8,
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <Icon name="sparkle" size={12}/>
            Most active threads across Preply — today
          </div>
          {data.activeThreads.map(t => (
            <div key={t.id} onClick={()=>openInSlack(t.permalink)} style={{
              display: 'grid', gridTemplateColumns: '1fr auto', gap: 8,
              padding: '8px 4px', cursor: 'pointer',
              borderBottom: '1px dashed var(--border-subtle)',
            }}>
              <div style={{minWidth:0}}>
                <div style={{fontSize:13, fontWeight:600, color:'var(--fg-1)'}}>
                  <span style={{fontFamily:'var(--font-mono)', color:'var(--fg-2)', fontWeight:500, marginRight:8}}>{t.channel}</span>
                  {t.title}
                </div>
                <div style={{fontSize:12, color:'var(--fg-2)', marginTop:2}}>{t.summary}</div>
                <div style={{fontSize:11, color:'var(--fg-3, var(--fg-2))', marginTop:4, fontFamily:'var(--font-mono)'}}>
                  {t.starter} · {t.replies} replies · {t.lastActivity}
                </div>
              </div>
              <Icon name="external-link" size={12} style={{opacity:0.5, marginTop:6}}/>
            </div>
          ))}
        </div>
      )}
    </Module>
  );
}

// --- Projects Module ---
function ProjectsMod({ data, okrs, decisions, okrApi }) {
  const [decList, setDecList] = useStateB(decisions);
  const [expanded, setExpanded] = useStateB({}); // okr id → bool
  useEffectB(() => { setDecList(decisions); }, [decisions]);
  const skipDec = (id) => setDecList(decList.filter(x => x.id !== id));
  const decideDec = (d) => {
    if (d.href) window.open(d.href, '_blank', 'noreferrer');
  };
  const toggleOkr = (id) => setExpanded(prev => ({ ...prev, [id]: !prev[id] }));

  const generateNotes = async () => {
    if (!okrApi || !okrApi.generateReviewMarkdown) return;
    const md = okrApi.generateReviewMarkdown();
    try {
      await navigator.clipboard.writeText(md);
      if (window.DashboardHelper && window.DashboardHelper.toast) {
        window.DashboardHelper.toast('Review notes copied to clipboard', { kind: 'success', durationMs: 4000 });
      } else {
        alert('Review notes copied to clipboard');
      }
    } catch (e) {
      // fallback: open the markdown in a new tab
      const w = window.open();
      if (w) { w.document.write('<pre>' + md.replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'})[c]) + '</pre>'); }
    }
  };

  const Tagger = window.OkrTagger; // shared component from modules-a.jsx

  return (
    <Module title="Projects & goals" sub={`${data.length} active · ${data.filter(p=>p.status!=='on-track').length} need attention`}
            icon={<span style={{width:28, height:28, borderRadius:8, background:'var(--grey-100)', display:'grid', placeItems:'center'}}><Icon name="progress" size={16}/></span>}
            action="All projects"
            className="proj-mod">
      {data.map(p => (
        <div key={p.id} className="proj-row">
          <span className="status-dot" data-s={p.status}/>
          <div style={{minWidth:0}}>
            <div className="proj-name">{p.name}</div>
            <div className="proj-sub">
              <span style={{color: p.status==='off-track' ? 'var(--red-600)' : p.status==='at-risk' ? 'var(--yellow-800)' : 'var(--teal-600)', fontWeight:600}}>
                {p.status==='on-track'?'On track':p.status==='at-risk'?'At risk':'Off track'}
              </span>
              <span>· {p.meta}</span>
            </div>
          </div>
          <div style={{display:'flex', alignItems:'center', gap:10}}>
            <div className="proj-bar" style={{'--pct': p.pct+'%'}}/>
            <span style={{fontSize:12, fontFamily:'var(--font-mono)', color:'var(--fg-2)', minWidth:34, textAlign:'right'}}>{p.pct}%</span>
          </div>
        </div>
      ))}
      <div className="sub-section-head">
        Q2 OKRs<span className="bar"/>
        {okrApi && (
          <button
            className="okr-generate-btn"
            onClick={generateNotes}
            title="Compile this week's tagged + auto-suggested items into a markdown review and copy to clipboard"
          >Generate review notes →</button>
        )}
      </div>
      {okrs.map(o => {
        const isOpen = !!expanded[o.id];
        const ev = okrApi ? okrApi.collectEvidence(o.id) : { confirmed: [], suggested: [] };
        const meta = (okrApi && okrApi.META && okrApi.META[o.id]) || {};
        const linkedCount = ev.confirmed.length + ev.suggested.length;
        return (
          <div key={o.id} className={'okr-row' + (isOpen ? ' is-open' : '')}>
            <div className="okr-row-head" onClick={() => toggleOkr(o.id)} role="button">
              <div className="okr-row-body">
                <div className="okr-row-title">
                  {meta.short && <span className="okr-row-pill" style={{background: meta.bg, color: meta.ink}}>{meta.short}</span>}
                  <span>{o.name}</span>
                  {linkedCount > 0 && (
                    <span className="okr-row-count" title={`${ev.confirmed.length} tagged · ${ev.suggested.length} auto-suggested`}>
                      {linkedCount} linked
                    </span>
                  )}
                </div>
                <div className="okr-row-bar">
                  <span style={{width: o.pct+'%', background: o.trend==='ahead'?'var(--teal-500)':o.trend==='behind'?'var(--red-500)':'var(--grey-900)'}}/>
                </div>
              </div>
              <div className="okr-row-trend" style={{color: o.trend==='ahead'?'var(--teal-600)':o.trend==='behind'?'var(--red-600)':'var(--fg-2)'}}>
                {o.pct}% · {o.trend}
                <span className="okr-row-chev" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
              </div>
            </div>
            {isOpen && (
              <div className="okr-row-evidence">
                {ev.confirmed.length === 0 && ev.suggested.length === 0 && (
                  <div className="okr-row-empty">No linked items yet. Tag a task with <span className="okr-row-pill" style={{background: meta.bg, color: meta.ink}}>{meta.short}</span> to start building evidence.</div>
                )}
                {ev.confirmed.length > 0 && (
                  <ul className="okr-evidence-list">
                    {ev.confirmed.map((it, i) => (
                      <li key={'c'+i}>
                        <span className="okr-evidence-kind">{it._kind}</span>
                        <span>{it.label}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {ev.suggested.length > 0 && (
                  <>
                    <div className="okr-evidence-subhead">Auto-suggested · click <code>?</code> chip on the row to confirm</div>
                    <ul className="okr-evidence-list okr-evidence-list-suggested">
                      {ev.suggested.map((it, i) => (
                        <li key={'s'+i}>
                          <span className="okr-evidence-kind">{it._kind}</span>
                          <span>{it.label}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
      <div className="sub-section-head">Pending your decision<span className="bar"/><span>{decList.length}</span></div>
      {decList.map(d => (
        <div key={d.id} style={{display:'grid', gridTemplateColumns:'1fr auto auto auto', gap:10, alignItems:'center', padding:'10px 4px', borderTop:'1px solid var(--border-subtle)'}}>
          <div>
            <div style={{fontSize:13, fontWeight:600}}>{d.title}</div>
            <div style={{fontSize:12, color:'var(--fg-3)'}}>{d.who} · {d.meta}</div>
          </div>
          {Tagger && <Tagger label={d.title} meta={d.meta} okrApi={okrApi}/>}
          <button className="btn btn--tertiary btn--xs" onClick={() => skipDec(d.id)}>Skip</button>
          <button className="btn btn--primary btn--xs" onClick={() => decideDec(d)}>Decide</button>
        </div>
      ))}
    </Module>
  );
}

// --- KPIs Module ---
function Sparkline({ dir }) {
  const pts = dir === 'up'   ? [20,22,19,24,23,28,30,32,35] :
              dir === 'down' ? [32,30,28,26,24,22,20,18,16] :
                               [22,24,21,23,22,24,22,23,22];
  const max = Math.max(...pts), min = Math.min(...pts);
  const W = 100, H = 28;
  const path = pts.map((v, i) => {
    const x = (i/(pts.length-1))*W;
    const y = H - ((v-min)/(max-min || 1))*H;
    return `${i===0?'M':'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const color = dir === 'up' ? 'var(--teal-500)' : dir === 'down' ? 'var(--red-500)' : 'var(--grey-400)';
  return (
    <svg className="kpi-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <path d={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
}

function KpiMod({ data }) {
  return (
    <Module title="Metrics" sub="Numbers, trend, vs target"
            icon={<span style={{width:28, height:28, borderRadius:8, background:'var(--grey-100)', display:'grid', placeItems:'center'}}><Icon name="insights" size={16}/></span>}
            action="Dashboards"
            className="kpi-mod">
      <div className="kpi-grid">
        {data.map((k, i) => {
          const good = k.trend.good !== undefined ? k.trend.good : k.trend.dir === 'up';
          return (
            <div key={i} className="kpi">
              <div className="kpi-label">{k.label}</div>
              <div className="kpi-value">{k.value}</div>
              <Sparkline dir={good ? 'up' : k.trend.dir === 'flat' ? 'flat' : 'down'}/>
              <div className="kpi-foot">
                <span className="kpi-trend" data-dir={good ? 'up' : k.trend.dir === 'flat' ? 'flat' : 'down'}>
                  {k.trend.dir === 'up' ? '▲' : k.trend.dir === 'down' ? '▼' : '—'} {k.trend.pct}%
                </span>
                <span className="kpi-target">{k.target}</span>
              </div>
            </div>
          );
        })}
      </div>
    </Module>
  );
}

// --- Team Module ---
function TeamMod({ data }) {
  const people = Array.isArray(data) ? data : data.people;
  const attention = Array.isArray(data) ? null : data.attention;
  return (
    <Module title="Your people" sub={`${people.filter(p=>!p.ooo).length} around · ${people.filter(p=>p.ooo).length} out`}
            icon={<span style={{width:28, height:28, borderRadius:8, background:'var(--grey-100)', display:'grid', placeItems:'center'}}><Icon name="user-group" size={16}/></span>}
            className="team-mod">
      {attention && (
        <div style={{marginBottom: 10, padding: '10px 12px', background:'var(--accent-bg)', borderRadius: 8, fontSize: 13}}>
          <strong>Who needs attention:</strong> <span dangerouslySetInnerHTML={{__html: attention}}/>
        </div>
      )}
      <div className="team-grid">
        {people.map((p, i) => (
          <div key={i} className="team-person" data-out={p.ooo}>
            <span className="pds-avatar size-32"><img src="ds/assets/avatar-default.svg" alt={p.name}/></span>
            <div className="who">
              <div className="team-name">{p.name}{p.manager && <span style={{fontSize:10, marginLeft:6, color:'var(--fg-3)'}}>MGR</span>}</div>
              <div className="team-status">{p.note}</div>
            </div>
            <span className="team-dot" data-s={p.status}/>
          </div>
        ))}
      </div>
    </Module>
  );
}

// --- Blockers Module ---
function BlockersMod({ data }) {
  const rows = data || [
    { sev: 'high',   title: 'Pricing v3 A/B — 9% conversion dip in tier 2',   meta: 'Trending wrong · needs decision today',  icon: '!' },
    { sev: 'high',   title: 'Legal waiting on data retention clause edits',    meta: 'Blocking contract close · overdue 2d',    icon: '!' },
    { sev: 'medium', title: 'Brand mark refresh — approver OOO',               meta: 'Theo out until Friday · review slips',    icon: '•' },
    { sev: 'low',    title: 'Enterprise SSO integration tests flaky',          meta: 'Not blocking yet · worth a look',         icon: '·' },
  ];
  return (
    <Module title="Risks & blockers" sub="Stuck, waiting, or trending red"
            icon={<span style={{width:28, height:28, borderRadius:8, background:'var(--red-50)', display:'grid', placeItems:'center'}}><Icon name="error-warning" size={16}/></span>}
            className="blockers-mod">
      {rows.map((r, i) => (
        <div key={i} className="block-row" data-sev={r.sev}>
          <div className="block-icon">{r.icon}</div>
          <div>
            <div className="block-title">{r.title}</div>
            <div className="block-meta">{r.meta}</div>
          </div>
          <button className="btn btn--tertiary btn--xs">Open</button>
        </div>
      ))}
    </Module>
  );
}

// --- Shipped Module ---
function ShippedMod({ data }) {
  return (
    <Module title="Recently shipped" sub="Momentum, not backlog" count={data.length}
            icon={<span style={{width:28, height:28, borderRadius:8, background:'var(--teal-100)', display:'grid', placeItems:'center'}}><Icon name="celebrate" size={16}/></span>}
            className="ship-mod">
      {data.map(s => (
        <div key={s.id} className="ship-row">
          <div className="tick"><Icon name="check" size={12}/></div>
          <div className="ship-body">
            <div className="ship-title">{s.title}</div>
            <div className="ship-meta">{s.meta}</div>
          </div>
        </div>
      ))}
    </Module>
  );
}

// --- Pins Module ---
function PinsMod({ data }) {
  const [items, setItems] = useStateB(data);
  const [manage, setManage] = useStateB(false);
  const [label, setLabel] = useStateB('');
  const [url,   setUrl]   = useStateB('');
  const [sub,   setSub]   = useStateB('');
  useEffectB(() => { setItems(data); }, [data]);
  const removePin = (id, e) => {
    e.preventDefault();
    e.stopPropagation();
    setItems(items.filter(p => p.id !== id));
  };
  const palette = ['var(--teal-100)', 'var(--pink-100)', 'var(--blue-100)', 'var(--yellow-100)', 'var(--red-100)', 'var(--grey-100)'];
  const deriveSub = (u) => {
    try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; }
    };
  const addPin = () => {
    const l = label.trim(), u = url.trim();
    if (!l || !u) return;
    const href = /^https?:\/\//i.test(u) ? u : `https://${u}`;
    setItems([...items, {
      id: 'pin-' + Date.now(),
      label: l,
      sub: sub.trim() || deriveSub(href) || 'Link',
      letter: l[0].toUpperCase(),
      bg: palette[items.length % palette.length],
      href,
    }]);
    setLabel(''); setUrl(''); setSub('');
  };
  return (
    <Module title="Quick access" sub={manage ? 'Add below or click × to remove · Done when finished' : 'Pinned · recent'}
            icon={<span style={{width:28, height:28, borderRadius:8, background:'var(--grey-100)', display:'grid', placeItems:'center'}}><Icon name="pages" size={16}/></span>}
            action={manage ? 'Done' : 'Manage'}
            onAction={() => setManage(!manage)}
            className="pins-mod">
      <div className="pins-grid">
        {items.map(p => (
          <a key={p.id} className="pin" href={manage ? '#' : (p.href || '#')}
             target={manage ? undefined : '_blank'} rel="noreferrer"
             onClick={e => { if (manage || !p.href) e.preventDefault(); }}
             style={{position:'relative'}}>
            <span className="pin-icon" style={{background: p.bg}}>{p.letter}</span>
            <div>
              <div className="pin-label">{p.label}</div>
              <div className="pin-sub">{p.sub}</div>
            </div>
            {manage && (
              <button
                onClick={(e) => removePin(p.id, e)}
                aria-label="Remove pin"
                style={{
                  position:'absolute', top:6, right:6, width:20, height:20,
                  borderRadius:'50%', border:'none', background:'var(--red-500)',
                  color:'white', fontSize:12, fontWeight:700, cursor:'pointer',
                  display:'grid', placeItems:'center', lineHeight:1,
                }}
              >×</button>
            )}
          </a>
        ))}
      </div>
      {manage && (
        <div style={{
          marginTop: 12, padding: 12, borderRadius: 8,
          background: 'var(--grey-50)', border: '1px solid var(--border-subtle)',
          display: 'grid', gap: 8,
        }}>
          <div style={{fontSize: 12, fontWeight: 600, color: 'var(--fg-2)', textTransform: 'uppercase', letterSpacing: '0.04em'}}>Add a pin</div>
          <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8}}>
            <input
              type="text" placeholder="Label (e.g. Q2 OKRs)"
              value={label} onChange={e => setLabel(e.target.value)}
              style={{padding: '8px 10px', border: '1px solid var(--border-default)', borderRadius: 6, fontSize: 13, background: 'white'}}
            />
            <input
              type="text" placeholder="Sub-label (optional)"
              value={sub} onChange={e => setSub(e.target.value)}
              style={{padding: '8px 10px', border: '1px solid var(--border-default)', borderRadius: 6, fontSize: 13, background: 'white'}}
            />
          </div>
          <div style={{display: 'grid', gridTemplateColumns: '1fr auto', gap: 8}}>
            <input
              type="text" placeholder="URL (https://...)"
              value={url} onChange={e => setUrl(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addPin(); }}
              style={{padding: '8px 10px', border: '1px solid var(--border-default)', borderRadius: 6, fontSize: 13, background: 'white'}}
            />
            <button
              className="btn btn--primary btn--sm"
              onClick={addPin}
              disabled={!label.trim() || !url.trim()}
            >Add</button>
          </div>
        </div>
      )}
    </Module>
  );
}

// --- Wellness Module ---
function WellnessMod({ data }) {
  const [dismissed, setDismissed] = useStateB(false);
  const slot = data.suggestedFocus;
  const blockSuggested = (e) => {
    e.preventDefault();
    if (!slot) return;
    // Convert ISO-with-offset to the "YYYYMMDDTHHMMSS" form Google Calendar
    // templates expect, preserving the local wall-clock time.
    const toCalStr = (iso) => iso.replace(/[-:]/g, '').replace(/([+-]\d{4}|Z)$/, '').slice(0, 15);
    const url = `https://calendar.google.com/calendar/render?action=TEMPLATE`
      + `&text=${encodeURIComponent('Focus block')}`
      + `&dates=${toCalStr(slot.startISO)}/${toCalStr(slot.endISO)}`
      + `&ctz=Europe/Madrid`
      + `&details=${encodeURIComponent('Blocked from Work Dashboard')}`;
    window.open(url, '_blank', 'noreferrer');
  };
  const blockLabel = slot ? `Block 1h · ${slot.label}` : 'Block 1h';
  return (
    <div className="wellness wellness-mod">
      <div className="wellness-msg" dangerouslySetInnerHTML={{__html: data.weeklyMessage}}/>
      <div className="wellness-stats">
        <div className="wellness-stat">
          <div className="icon"><Icon name="clock" size={16}/></div>
          <div>
            <div className="v">{data.focusHours}h <span style={{fontSize:12, color:'var(--fg-3)'}}>/ {data.focusTarget}h</span></div>
            <div className="k">Focus time today</div>
          </div>
        </div>
        <div className="wellness-stat">
          <div className="icon"><Icon name="user-group" size={16}/></div>
          <div>
            <div className="v">{data.pctMeetings}%</div>
            <div className="k">Week in meetings</div>
          </div>
        </div>
        <div className="wellness-stat">
          <div className="icon"><Icon name="thumbs-up" size={16}/></div>
          <div>
            <div className="v">{data.shippedThisWeek}</div>
            <div className="k">Shipped this week</div>
          </div>
        </div>
        <div className="wellness-stat">
          <div className="icon"><Icon name="lightning" size={16}/></div>
          <div>
            <div className="v">{data.streak}d</div>
            <div className="k">Focus streak</div>
          </div>
        </div>
      </div>
      {!dismissed && (
        <div style={{marginTop:14, display:'flex', gap:8}}>
          <button className="btn btn--secondary btn--sm" onClick={blockSuggested}>{blockLabel}</button>
          <button className="btn btn--ghost btn--sm" onClick={() => setDismissed(true)}>Skip</button>
        </div>
      )}
    </div>
  );
}

// --- Search over SEED data (tasks, meetings, slack, inbox, projects, people, …) ---
function searchDashboard(q) {
  const query = q.trim().toLowerCase();
  if (!query) return [];
  const m = (v) => v != null && String(v).toLowerCase().includes(query);
  const out = [];
  const S = window.SEED || {};

  (S.top3 || []).forEach(t => {
    if (m(t.label) || m(t.meta)) out.push({ type:'top3', key:'top-'+t.id, icon:'lightning', title:t.label, subtitle:t.meta, badge:'Today' });
  });
  const bucketLabel = { overdue:'Overdue', dueSoon:'Due soon', blocked:'Blocked' };
  ['overdue','dueSoon','blocked'].forEach(bucket => {
    (S[bucket] || []).forEach(t => {
      if (m(t.label) || m(t.meta)) out.push({
        type:'task', key:'task-'+bucket+'-'+(t.id||Math.random()),
        icon:'check-circle', title:t.label, subtitle:t.meta, badge:bucketLabel[bucket],
      });
    });
  });
  (S.shipped || []).forEach(t => {
    if (m(t.title) || m(t.meta)) out.push({ type:'task', key:'ship-'+t.id, icon:'check', title:t.title, subtitle:t.meta, badge:'Shipped' });
  });
  (S.calendar || []).forEach(e => {
    const who = (e.who || []).join(' ');
    if (m(e.title) || m(who)) out.push({
      type:'event', key:'ev-'+e.id, icon:'calendar',
      title:e.title,
      subtitle:`${e.time || ''}${e.who ? ' · ' + e.who.slice(0,3).join(', ') : ''}`,
      badge: e.type ? e.type.replace(/^\w/, c => c.toUpperCase()) : 'Event',
    });
  });
  const slack = S.slack || {};
  (slack.channels || []).forEach(c => {
    if (m(c.channel) || m(c.summary)) out.push({
      type:'slack', key:'ch-'+c.id, icon:'messages',
      title:c.channel, subtitle:c.summary || '',
      badge: c.unread ? `${c.unread} unread` : 'Slack',
      href:c.permalink,
    });
    (c.mentions || []).forEach((mn, i) => {
      if (m(mn.label)) out.push({
        type:'slack', key:'mn-'+c.id+'-'+i, icon:'messages',
        title:mn.label, subtitle:c.channel, badge:'Mention', href:c.permalink,
      });
    });
  });
  (slack.activeThreads || []).forEach(t => {
    if (m(t.title) || m(t.summary) || m(t.channel) || m(t.starter)) out.push({
      type:'slack', key:'th-'+t.id, icon:'messages',
      title:t.title, subtitle:`${t.channel} · ${t.summary}`, badge:'Thread', href:t.permalink,
    });
  });
  (S.inbox || []).forEach(it => {
    if (m(it.title) || m(it.preview) || m(it.from)) out.push({
      type:'inbox', key:'mail-'+it.id, icon:'mail',
      title:it.title, subtitle:`${it.from} · ${it.preview}`, badge:it.tag || 'Inbox',
    });
  });
  (S.projects || []).forEach(p => {
    if (m(p.name) || m(p.meta)) out.push({
      type:'project', key:'pr-'+p.id, icon:'progress',
      title:p.name, subtitle:p.meta, badge:p.pct!=null ? `${p.pct}%` : 'Project',
    });
  });
  (S.okrs || []).forEach(o => {
    if (m(o.name) || m(o.trend)) out.push({
      type:'okr', key:'okr-'+o.id, icon:'insights',
      title:o.name, subtitle:`${o.pct}% · ${o.trend}`, badge:'OKR',
    });
  });
  (S.decisions || []).forEach(d => {
    if (m(d.title) || m(d.meta) || m(d.who)) out.push({
      type:'decision', key:'dec-'+d.id, icon:'error-warning',
      title:d.title, subtitle:`${d.who} · ${d.meta}`, badge:'Decision', href:d.href,
    });
  });
  const team = Array.isArray(S.team) ? S.team : (S.team && S.team.people) || [];
  team.forEach((p, i) => {
    if (m(p.name) || m(p.note)) out.push({
      type:'person', key:'per-'+i, icon:'user-group',
      title:p.name + (p.manager ? ' · MGR' : ''),
      subtitle:p.note || (p.ooo ? 'Out of office' : ''),
      badge: p.ooo ? 'OOO' : 'Preply',
    });
  });
  (S.blockers || []).forEach((b, i) => {
    if (m(b.title) || m(b.meta)) out.push({
      type:'blocker', key:'blk-'+i, icon:'error-warning',
      title:b.title, subtitle:b.meta, badge:b.sev ? b.sev.toUpperCase() : 'Blocker',
    });
  });
  (S.pins || []).forEach(p => {
    if (m(p.label) || m(p.sub)) out.push({
      type:'pin', key:'pin-'+p.id, icon:'pages',
      title:p.label, subtitle:p.sub, badge:'Pin', href:p.href,
    });
  });
  const driveIconByKind = { Doc:'notes', Sheet:'insights', Slide:'pages', PDF:'file', Folder:'library' };
  (window.DRIVE_INDEX || []).forEach(f => {
    if (m(f.title) || m(f.owner)) out.push({
      type:'drive', key:'drive-'+f.id,
      icon: driveIconByKind[f.kind] || 'file',
      title: f.title,
      subtitle: `${f.owner || ''}${f.modified ? ' · modified ' + f.modified : ''}`,
      badge: f.kind || 'Drive',
      href: f.viewUrl,
    });
  });
  return out;
}
function groupResults(results) {
  const order = ['top3','task','event','slack','inbox','decision','project','okr','blocker','person','pin','drive'];
  const labels = { top3:'Top 3 today', task:'Tasks', event:'Calendar', slack:'Slack', inbox:'Inbox', decision:'Decisions', project:'Projects', okr:'OKRs', blocker:'Blockers', person:'People', pin:'Quick access', drive:'Drive files' };
  const by = {};
  results.forEach(r => { (by[r.type] = by[r.type] || []).push(r); });
  return order.filter(k => by[k]).map(k => ({ key:k, label:labels[k], items:by[k] }));
}
function Highlight({ text, q }) {
  if (!q || !text) return text || null;
  const i = String(text).toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text;
  const s = String(text);
  return <React.Fragment>{s.slice(0,i)}<mark className="hl">{s.slice(i, i+q.length)}</mark>{s.slice(i+q.length)}</React.Fragment>;
}

// --- Find anything (in-dashboard search + external fallback) ---
function FindModal({ open, onClose, prefillQuery }) {
  const [q, setQ] = useStateB('');
  const [selIdx, setSelIdx] = useStateB(0);

  useEffectB(() => {
    if (!open) { setQ(''); setSelIdx(0); return; }
    if (prefillQuery) setQ(prefillQuery);
  }, [open, prefillQuery]);
  useEffectB(() => { setSelIdx(0); }, [q]);

  const results = useMemoB(() => searchDashboard(q), [q]);
  const groups  = useMemoB(() => groupResults(results), [results]);
  const flat    = useMemoB(() => groups.flatMap(g => g.items), [groups]);

  const workspace = (window.SEED && window.SEED.slack && window.SEED.slack.workspace) || 'preply';
  const tools = [
    { id:'gmail',    label:'Gmail',    url:(x)=>x?`https://mail.google.com/mail/u/0/#search/${encodeURIComponent(x)}`:'https://mail.google.com/mail/u/0/' },
    { id:'slack',    label:'Slack',    url:(x)=>x?`https://${workspace}.slack.com/search/${encodeURIComponent(x)}`:`https://${workspace}.slack.com` },
    { id:'drive',    label:'Drive',    url:(x)=>x?`https://drive.google.com/drive/search?q=${encodeURIComponent(x)}`:'https://drive.google.com/drive/u/0/my-drive' },
    { id:'calendar', label:'Calendar', url:(x)=>x?`https://calendar.google.com/calendar/u/0/r/search?q=${encodeURIComponent(x)}`:'https://calendar.google.com/calendar/u/0/r' },
  ];
  const openTool = (t) => { window.open(t.url(q.trim()), '_blank', 'noreferrer'); onClose(); };
  const selectResult = (r) => {
    if (r && r.href) window.open(r.href, '_blank', 'noreferrer');
    onClose();
  };

  useEffectB(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowDown') { e.preventDefault(); setSelIdx(i => Math.min(flat.length - 1, i + 1)); }
      else if (e.key === 'ArrowUp')   { e.preventDefault(); setSelIdx(i => Math.max(0, i - 1)); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        if (flat.length > 0) selectResult(flat[selIdx]);
        else if (q.trim()) openTool(tools[0]);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, flat, selIdx, q]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel find-panel" onClick={e=>e.stopPropagation()}>
        <div className="modal-search">
          <Icon name="search" size={16}/>
          <input autoFocus placeholder="Search your dashboard · tasks, meetings, messages, people…"
                 value={q} onChange={e=>setQ(e.target.value)}/>
          <button className="btn btn--ghost btn--sm" onClick={onClose}>ESC</button>
        </div>

        {q.trim() && flat.length > 0 && (
          <div className="find-results">
            {groups.map((g, gi) => (
              <div key={g.key} className="find-group">
                <div className="find-group-label">{g.label} · {g.items.length}</div>
                {g.items.map((r, ri) => {
                  const idx = groups.slice(0, gi).reduce((a, x) => a + x.items.length, 0) + ri;
                  return (
                    <button key={r.key} className="find-row" data-active={idx === selIdx}
                            onMouseEnter={() => setSelIdx(idx)}
                            onClick={() => selectResult(r)}>
                      <Icon name={r.icon} size={14}/>
                      <div className="find-row-body">
                        <div className="find-row-title"><Highlight text={r.title} q={q}/></div>
                        {r.subtitle && <div className="find-row-sub"><Highlight text={r.subtitle} q={q}/></div>}
                      </div>
                      {r.badge && <span className="find-row-badge">{r.badge}</span>}
                      {r.href && <Icon name="external-link" size={12} style={{opacity:0.5}}/>}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}

        {q.trim() && flat.length === 0 && (
          <div className="find-empty">
            <div style={{fontSize:13, color:'var(--fg-2)'}}>Nothing in the dashboard matches “{q.trim()}”.</div>
            <div style={{fontSize:12, color:'var(--fg-3)', marginTop:6}}>Try searching externally below ↓</div>
          </div>
        )}

        <div className="modal-section">
          <div className="modal-section-title">{q.trim() ? `Search externally for “${q.trim()}”` : 'Open a tool'}</div>
          <div className="modal-tools">
            {tools.map(t => (
              <button key={t.id} className="modal-tool" onClick={()=>openTool(t)}>
                <div>
                  <div className="modal-tool-l">{t.label}</div>
                  <div className="modal-tool-h">Search {t.label}</div>
                </div>
                <Icon name="chevron-right" size={14}/>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Add task ---
function AddTaskModal({ open, onClose, prefillLabel }) {
  const [label, setLabel] = useStateB('');
  const [p, setP] = useStateB(2);
  const [bucket, setBucket] = useStateB('dueSoon');
  useEffectB(() => {
    if (!open) { setLabel(''); setP(2); setBucket('dueSoon'); return; }
    if (prefillLabel) setLabel(prefillLabel);
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, prefillLabel]);
  if (!open) return null;

  const submit = () => {
    const text = label.trim();
    if (!text) return;
    window.dispatchEvent(new CustomEvent('dash:task-added', { detail: {
      id: 'task-' + Date.now(),
      label: text, meta: 'Just added', p, bucket, done: false, project: 'ops',
    }}));
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={e=>e.stopPropagation()}>
        <div className="modal-search">
          <Icon name="plus" size={16}/>
          <input autoFocus placeholder="What needs to get done?"
                 value={label} onChange={e=>setLabel(e.target.value)}
                 onKeyDown={e=>{ if (e.key === 'Enter') submit(); }}/>
          <button className="btn btn--ghost btn--sm" onClick={onClose}>ESC</button>
        </div>
        <div className="modal-section">
          <div className="modal-section-title">Priority</div>
          <div className="modal-segs">
            {[1,2,3].map(n => (
              <button key={n} className="modal-seg" data-active={p===n} onClick={()=>setP(n)}>P{n}</button>
            ))}
          </div>
        </div>
        <div className="modal-section">
          <div className="modal-section-title">Add to</div>
          <div className="modal-segs">
            {[
              {k:'overdue', l:'Overdue'},
              {k:'dueSoon', l:'Due soon'},
              {k:'blocked', l:'Blocked on others'},
            ].map(b => (
              <button key={b.k} className="modal-seg" data-active={bucket===b.k} onClick={()=>setBucket(b.k)}>{b.l}</button>
            ))}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn--ghost btn--sm" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary btn--sm" onClick={submit} disabled={!label.trim()}>Add task</button>
        </div>
      </div>
    </div>
  );
}

// --- Attendees input with Gmail contact autocomplete (uses Google People API) ---
function AttendeesInput({ value, onChange, placeholder, open }) {
  const [contacts, setContacts]   = useStateB([]);
  const [showSug, setShowSug]     = useStateB(false);
  const [activeIdx, setActiveIdx] = useStateB(0);
  const [loadState, setLoadState] = useStateB('idle'); // idle | loading | loaded | error | none
  const inputRef = React.useRef(null);

  useEffectB(() => {
    if (!open) { setShowSug(false); return; }
    if (typeof window.gcalListContacts !== 'function') { setLoadState('none'); return; }
    if (!(window.gcalHasClientId && window.gcalHasClientId())) { setLoadState('none'); return; }
    setLoadState('loading');
    window.gcalListContacts().then(res => {
      if (res && res.ok) { setContacts(res.items || []); setLoadState('loaded'); }
      else { setLoadState('error'); }
    });
  }, [open]);

  const tokens = value.split(',');
  const lastToken = (tokens[tokens.length - 1] || '').trim().toLowerCase();
  const suggestions = useMemoB(() => {
    if (lastToken.length < 1 || !contacts.length) return [];
    const alreadyUsed = new Set(
      tokens.slice(0, -1)
        .map(t => t.trim().toLowerCase())
        .filter(t => /@/.test(t))
    );
    const q = lastToken;
    const scored = [];
    for (const c of contacts) {
      const n = (c.name || '').toLowerCase();
      const e = (c.email || '').toLowerCase();
      if (alreadyUsed.has(e)) continue;
      let score = 0;
      if (e.startsWith(q)) score = 5;
      else if (n.startsWith(q)) score = 4;
      else if (n.split(/\s+/).some(w => w.startsWith(q))) score = 3;
      else if (e.includes(q)) score = 2;
      else if (n.includes(q)) score = 1;
      if (score) scored.push({ c, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 8).map(x => x.c);
  }, [lastToken, contacts, value]);

  useEffectB(() => { setActiveIdx(0); }, [lastToken]);

  const pick = (c) => {
    const kept = tokens.slice(0, -1).map(t => t.trim()).filter(Boolean);
    kept.push(c.email);
    const next = kept.join(', ') + ', ';
    onChange(next);
    setShowSug(false);
    setTimeout(() => { if (inputRef.current) inputRef.current.focus(); }, 0);
  };

  const onKeyDown = (e) => {
    if (!suggestions.length || !showSug) {
      if (e.key === 'Enter') { /* let parent handle submit */ }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, suggestions.length - 1)); }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      pick(suggestions[activeIdx] || suggestions[0]);
    }
    else if (e.key === 'Escape') { setShowSug(false); }
  };

  return (
    <div className="attendee-wrap">
      <input
        ref={inputRef}
        value={value}
        onChange={e => { onChange(e.target.value); setShowSug(true); }}
        onFocus={() => setShowSug(true)}
        onBlur={() => setTimeout(() => setShowSug(false), 150)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className="attendee-input"/>
      {showSug && suggestions.length > 0 && (
        <div className="attendee-suggestions" role="listbox">
          {suggestions.map((c, i) => (
            <button
              key={c.email + i}
              className={'attendee-row' + (i === activeIdx ? ' active' : '')}
              onMouseDown={e => { e.preventDefault(); pick(c); }}
              onMouseEnter={() => setActiveIdx(i)}
              role="option"
              aria-selected={i === activeIdx}>
              <span className="attendee-name">{c.name || c.email}</span>
              {c.name && c.email && c.name.toLowerCase() !== c.email.toLowerCase()
                && <span className="attendee-email">{c.email}</span>}
            </button>
          ))}
        </div>
      )}
      <div className="attendee-status">
        {loadState === 'loading' && 'Loading your contacts…'}
        {loadState === 'error'   && 'Couldn\u2019t load contacts (enable People API in Google Cloud).'}
        {loadState === 'none'    && 'Connect Google Calendar below to auto-suggest from your Gmail contacts.'}
      </div>
    </div>
  );
}

// --- Add meeting ---
function AddMeetingModal({ open, onClose, prefillTitle }) {
  const pad = (n) => String(n).padStart(2, '0');
  const todayISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  };
  const nextQuarterHour = () => {
    const d = new Date();
    const minutes = Math.ceil((d.getMinutes() + 1) / 15) * 15;
    d.setMinutes(minutes, 0, 0);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const [title, setTitle] = useStateB('');
  const [date, setDate] = useStateB(todayISO());
  const [time, setTime] = useStateB(nextQuarterHour());
  const [duration, setDuration] = useStateB(30);
  const [type, setType] = useStateB('event');
  const [who, setWho] = useStateB('');
  const [sendInvite, setSendInvite] = useStateB(true);
  const [submitting, setSubmitting] = useStateB(false);
  const [cfgOpen, setCfgOpen] = useStateB(false);
  const [cfgId, setCfgId] = useStateB('');
  const [hasClient, setHasClient] = useStateB(false);

  useEffectB(() => {
    if (!open) {
      setTitle(''); setDate(todayISO()); setTime(nextQuarterHour());
      setDuration(30); setType('event'); setWho(''); setSendInvite(true);
      setSubmitting(false); setCfgOpen(false);
      return;
    }
    if (prefillTitle) setTitle(prefillTitle);
    // Sync config UI with current stored client ID
    const currentId = (typeof window.gcalGetClientId === 'function' && window.gcalGetClientId()) || '';
    setCfgId(currentId);
    setHasClient(!!currentId);
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, prefillTitle]);

  if (!open) return null;

  // Fallback: Google Calendar "render" URL — opens pre-filled event editor in a new tab.
  // Used only when direct API send isn't configured (no client ID).
  const buildGcalUrl = ({ title, date, time, duration, attendees, details }) => {
    const [y, m, d] = date.split('-').map(Number);
    const [hh, mm]  = time.split(':').map(Number);
    const start = new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0);
    const end   = new Date(start.getTime() + (Number(duration) || 30) * 60000);
    const fmt = (dt) => `${dt.getFullYear()}${pad(dt.getMonth()+1)}${pad(dt.getDate())}T${pad(dt.getHours())}${pad(dt.getMinutes())}00`;
    const params = new URLSearchParams();
    params.set('action', 'TEMPLATE');
    params.set('text', title);
    params.set('dates', `${fmt(start)}/${fmt(end)}`);
    if (details) params.set('details', details);
    const emails = (attendees || []).filter(a => /@/.test(a));
    if (emails.length) params.set('add', emails.join(','));
    return `https://calendar.google.com/calendar/render?${params.toString()}`;
  };

  const toast = (msg, kind = 'info') => {
    window.dispatchEvent(new CustomEvent('dash:toast', { detail: { msg, kind } }));
  };

  const saveClientId = () => {
    const id = (cfgId || '').trim();
    if (typeof window.gcalSetClientId === 'function') window.gcalSetClientId(id);
    setHasClient(!!id);
    toast(id ? 'Direct send connected.' : 'Client ID cleared.', 'ok');
  };

  const submit = async () => {
    const text = title.trim();
    if (!text) return;
    const attendees = who.trim()
      ? who.split(',').map(s => s.trim()).filter(Boolean)
      : [];

    // Always update the local dashboard calendar first.
    window.dispatchEvent(new CustomEvent('dash:meeting-added', { detail: {
      id: 'cal-' + Date.now(),
      title: text,
      date,
      time,
      duration: Number(duration) || 30,
      type,
      who: attendees,
    }}));

    if (!sendInvite || type !== 'event') { onClose(); return; }

    const names = attendees.filter(a => !/@/.test(a));
    const emails = attendees.filter(a => /@/.test(a));
    const description = names.length
      ? `Invitees (unresolved): ${names.join(', ')}`
      : '';

    // Try direct API send first — no redirect, invitees get emailed automatically.
    if (typeof window.gcalCreate === 'function' && window.gcalHasClientId && window.gcalHasClientId()) {
      setSubmitting(true);
      try {
        const result = await window.gcalCreate({
          title: text, date, time, duration: Number(duration) || 30,
          attendees, description,
        });
        setSubmitting(false);
        if (result && result.ok) {
          const n = result.invitedCount || 0;
          toast(n > 0
            ? `Meeting created. ${n} invitee${n === 1 ? '' : 's'} notified.`
            : 'Meeting created on your calendar.', 'ok');
          onClose();
          return;
        }
        // Direct send failed for a reason other than missing client — surface and stop.
        toast('Direct send failed: ' + (result?.reason || 'unknown error') + '. Opening Google Calendar instead.', 'warn');
      } catch (e) {
        setSubmitting(false);
        toast('Direct send error: ' + String(e.message || e) + '. Opening Google Calendar instead.', 'warn');
      }
    }

    // Fallback: open Google Calendar in a new tab with the event pre-filled.
    const url = buildGcalUrl({ title: text, date, time, duration, attendees, details: description });
    try { window.open(url, '_blank', 'noopener,noreferrer'); } catch {}
    onClose();
  };

  const emailCount = who.split(',').map(s => s.trim()).filter(s => /@/.test(s)).length;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={e=>e.stopPropagation()}>
        <div className="modal-search">
          <Icon name="calendar" size={16}/>
          <input autoFocus placeholder="Meeting title (e.g. Payments review w/ Konstantinos)"
                 value={title} onChange={e=>setTitle(e.target.value)}
                 onKeyDown={e=>{ if (e.key === 'Enter') submit(); }}/>
          <button className="btn btn--ghost btn--sm" onClick={onClose}>ESC</button>
        </div>
        <div className="modal-section" style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:16}}>
          <div>
            <div className="modal-section-title">Date</div>
            <input type="date" value={date} onChange={e=>setDate(e.target.value)}
                   style={{width:'100%', padding:'8px 10px', border:'1px solid var(--border-default)', borderRadius:8, fontFamily:'var(--font-ui)', fontSize:14}}/>
          </div>
          <div>
            <div className="modal-section-title">Start time</div>
            <input type="time" value={time} onChange={e=>setTime(e.target.value)}
                   style={{width:'100%', padding:'8px 10px', border:'1px solid var(--border-default)', borderRadius:8, fontFamily:'var(--font-ui)', fontSize:14}}/>
          </div>
        </div>
        <div className="modal-section">
          <div className="modal-section-title">Duration</div>
          <div className="modal-segs">
            {[15, 30, 45, 60, 90].map(n => (
              <button key={n} className="modal-seg" data-active={Number(duration)===n} onClick={()=>setDuration(n)}>{n}m</button>
            ))}
          </div>
        </div>
        <div className="modal-section">
          <div className="modal-section-title">Type</div>
          <div className="modal-segs">
            <button className="modal-seg" data-active={type==='event'} onClick={()=>setType('event')}>Meeting</button>
            <button className="modal-seg" data-active={type==='focus'} onClick={()=>setType('focus')}>Focus block</button>
          </div>
        </div>
        {type === 'event' && (
          <>
            <div className="modal-section">
              <div className="modal-section-title">
                Attendees <span style={{color:'var(--fg-3)', fontWeight:400}}>(type to search your Gmail contacts)</span>
              </div>
              <AttendeesInput
                value={who} onChange={setWho} open={open}
                placeholder="Start typing a name or email — e.g. konstantinos, emily, sagar"/>
              <div style={{marginTop:6, fontSize:12, color:'var(--fg-3)'}}>
                {emailCount > 0
                  ? `${emailCount} invitee${emailCount === 1 ? '' : 's'} will receive a Google Calendar invite.`
                  : 'Names without an @ will be listed in the description but not invited.'}
              </div>
            </div>
            <div className="modal-section">
              <label style={{display:'flex', alignItems:'center', gap:10, cursor:'pointer', fontSize:13, color:'var(--fg-1)'}}>
                <input type="checkbox" checked={sendInvite} onChange={e=>setSendInvite(e.target.checked)}
                       style={{accentColor:'var(--accent)', width:16, height:16}}/>
                <span>Send Google Calendar invite on create</span>
              </label>
              <div style={{marginTop:8, display:'flex', alignItems:'center', justifyContent:'space-between', gap:8}}>
                <div style={{fontSize:12, display:'flex', alignItems:'center', gap:6}}>
                  <span style={{
                    display:'inline-block', width:8, height:8, borderRadius:'50%',
                    background: hasClient ? 'var(--ok, #2c9c5c)' : 'var(--fg-3)',
                  }}/>
                  <span style={{color: hasClient ? 'var(--fg-1)' : 'var(--fg-3)'}}>
                    {hasClient ? 'Direct send connected — invites email automatically' : 'Set up direct send to skip the Google Calendar tab'}
                  </span>
                </div>
                <button className="btn btn--ghost btn--sm" onClick={()=>setCfgOpen(o=>!o)}>
                  {cfgOpen ? 'Hide' : (hasClient ? 'Edit' : 'Set up')}
                </button>
              </div>
              {cfgOpen && (
                <div style={{
                  marginTop:10, padding:12, borderRadius:8,
                  background:'var(--grey-50)', border:'1px solid var(--border-subtle)',
                }}>
                  <div style={{fontSize:12, color:'var(--fg-2)', marginBottom:8, lineHeight:1.45}}>
                    Paste your Google OAuth 2.0 <b>Web</b> Client ID. One-time setup:{' '}
                    <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer"
                       style={{color:'var(--accent)'}}>console.cloud.google.com/apis/credentials</a>
                    {' '}→ Create OAuth Client ID → Web app → add{' '}
                    <code style={{background:'var(--grey-100)', padding:'1px 4px', borderRadius:3}}>
                      {typeof window !== 'undefined' ? window.location.origin : 'http://localhost:PORT'}
                    </code>
                    {' '}as an authorized origin. Also enable <b>Google Calendar API</b> on the project.
                  </div>
                  <div style={{display:'flex', gap:6}}>
                    <input value={cfgId} onChange={e=>setCfgId(e.target.value)}
                           placeholder="123456789012-abc...apps.googleusercontent.com"
                           style={{flex:1, padding:'8px 10px', border:'1px solid var(--border-default)', borderRadius:8, fontFamily:'var(--font-mono, ui-monospace)', fontSize:12}}/>
                    <button className="btn btn--primary btn--sm" onClick={saveClientId}
                            disabled={(cfgId || '').trim() === ((typeof window.gcalGetClientId === 'function' && window.gcalGetClientId()) || '')}>
                      Save
                    </button>
                    {hasClient && (
                      <button className="btn btn--ghost btn--sm" onClick={()=>{ setCfgId(''); if (typeof window.gcalSetClientId === 'function') window.gcalSetClientId(''); setHasClient(false); toast('Client ID removed.', 'ok'); }}>
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
        <div className="modal-footer">
          <button className="btn btn--ghost btn--sm" onClick={onClose} disabled={submitting}>Cancel</button>
          <button className="btn btn--primary btn--sm" onClick={submit} disabled={!title.trim() || submitting}>
            {submitting
              ? 'Sending…'
              : (sendInvite && type === 'event'
                  ? (hasClient ? 'Create & send invites' : 'Create & open Calendar')
                  : 'Create meeting')}
          </button>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Voice summary modal — readouts for "what are my priorities?", "my meetings today",
// "who's blocking me?", etc. Shows a compact card + speaks the summary aloud.
// =============================================================================
function buildVoiceSummary(topic, payload) {
  const SEED = window.SEED || {};
  const pad = (n) => String(n).padStart(2, '0');
  const fmtTime = (t) => {
    if (!t) return '';
    const [h, m] = t.split(':').map(Number);
    const h12 = ((h + 11) % 12) + 1;
    const ampm = h < 12 ? 'am' : 'pm';
    return `${h12}:${pad(m)} ${ampm}`;
  };
  // Format a Google Calendar event start (dateTime or all-day date).
  const fmtGCalTime = (s) => {
    if (!s) return '';
    if (s.dateTime) {
      const d = new Date(s.dateTime);
      const h = d.getHours(), m = d.getMinutes();
      return fmtTime(`${pad(h)}:${pad(m)}`);
    }
    return 'all-day';
  };
  const gcalAttendeesOf = (e) => {
    if (!e.attendees) return [];
    return e.attendees
      .filter(a => !a.self && !a.resource)
      .map(a => a.displayName || (a.email ? a.email.split('@')[0] : ''))
      .filter(Boolean);
  };

  // Live Google Calendar results — used for 'schedule', 'first', 'last'.
  if (payload && Array.isArray(payload.events)) {
    const events = payload.events.filter(e => e.status !== 'cancelled');
    const label = payload.label || 'that day';
    const labelCap = label.charAt(0).toUpperCase() + label.slice(1);

    if (topic === 'first' || topic === 'last') {
      const pick = topic === 'first' ? events[0] : events[events.length - 1];
      if (!pick) {
        return {
          title: (topic === 'first' ? 'First meeting — ' : 'Last meeting — ') + label,
          lines: [{ head: `Nothing on your calendar ${label}.`, sub: '' }],
          spoken: `You have nothing on your calendar ${label}.`,
        };
      }
      const t = fmtGCalTime(pick.start);
      const attendees = gcalAttendeesOf(pick);
      const lines = [{
        head: `${t} · ${pick.summary || '(no title)'}`,
        sub: attendees.length ? 'with ' + attendees.slice(0, 4).join(', ') : '',
      }];
      if (pick.location) lines.push({ head: 'Location', sub: pick.location });
      if (pick.description) {
        const clean = String(pick.description).replace(/<[^>]+>/g, '').trim().slice(0, 200);
        if (clean) lines.push({ head: 'Details', sub: clean });
      }
      const spoken = `Your ${topic} meeting ${label} is ${pick.summary || 'an event'} at ${t}${attendees.length ? ' with ' + attendees.slice(0, 2).join(' and ') : ''}.`;
      return {
        title: (topic === 'first' ? 'First meeting — ' : 'Last meeting — ') + label,
        lines, spoken,
      };
    }

    // Full schedule list for the range.
    const lines = events.map(e => ({
      head: `${fmtGCalTime(e.start)} · ${e.summary || '(no title)'}`,
      sub: (() => {
        const att = gcalAttendeesOf(e);
        if (att.length) return 'with ' + att.slice(0, 4).join(', ');
        if (e.location) return e.location;
        return '';
      })(),
    }));
    const spoken = events.length
      ? `On ${label}, you have ${events.length} event${events.length === 1 ? '' : 's'}. ${events.slice(0, 4).map(e => `${fmtGCalTime(e.start)}: ${e.summary || 'untitled'}`).join('. ')}.`
      : `Nothing scheduled for ${label}.`;
    return { title: `Schedule — ${labelCap}`, lines, spoken };
  }

  if (topic === 'priorities') {
    const top3 = SEED.top3 || [];
    const overdue = SEED.overdue || [];
    const dueSoon = SEED.dueSoon || [];
    const lines = top3.map((p, i) => ({ head: `${i + 1}. ${p.label || p.title || 'Untitled'}`, sub: p.meta || '' }));
    if (overdue.length) lines.push({ head: `${overdue.length} overdue`, sub: overdue.map(o => o.label).join(', ') });
    if (dueSoon.length) lines.push({ head: `${dueSoon.length} due soon`, sub: dueSoon.slice(0, 3).map(o => o.label).join(', ') });
    const spoken = top3.length
      ? `Your top ${top3.length} priorities today are: ${top3.map((p, i) => (i + 1) + '. ' + (p.label || p.title || '')).join('. ')}.${overdue.length ? ` Plus ${overdue.length} overdue.` : ''}`
      : `You have no top priorities set for today.`;
    return { title: 'Top priorities', lines, spoken };
  }

  if (topic === 'meetings' || topic === 'schedule') {
    const cal = SEED.calendar || [];
    const events = cal.filter(e => e.type === 'event');
    const lines = cal.map(e => ({
      head: `${fmtTime(e.time)} · ${e.title}`,
      sub: e.type === 'focus' ? 'Focus block' : (e.who && e.who.length ? 'with ' + e.who.slice(0, 4).join(', ') : ''),
    }));
    const spoken = events.length
      ? `You have ${events.length} meeting${events.length === 1 ? '' : 's'} today. ${events.slice(0, 4).map(e => `${fmtTime(e.time)}: ${e.title}${e.who && e.who.length ? ' with ' + e.who.slice(0, 2).join(' and ') : ''}`).join('. ')}.`
      : `No meetings today.`;
    return { title: `Today's schedule`, lines, spoken };
  }

  if (topic === 'next') {
    const nm = SEED.nextMeeting;
    if (!nm || nm.startsIn === 0) return { title: 'Next up', lines: [{ head: 'Nothing else scheduled today.', sub: '' }], spoken: 'Nothing else scheduled today.' };
    const lines = [
      { head: nm.title, sub: nm.with ? 'with ' + nm.with : '' },
      { head: `In ${nm.startsIn} minute${nm.startsIn === 1 ? '' : 's'}`, sub: nm.room ? `at ${nm.room}` : '' },
    ];
    return { title: 'Next up', lines, spoken: `Your next meeting is ${nm.title}${nm.with ? ' with ' + nm.with : ''}, in ${nm.startsIn} minute${nm.startsIn === 1 ? '' : 's'}.` };
  }

  if (topic === 'blockers') {
    const bl = SEED.blockers || [];
    const lines = bl.map(b => ({ head: b.title, sub: b.meta || '' }));
    const spoken = bl.length
      ? `You have ${bl.length} open blocker${bl.length === 1 ? '' : 's'}. ${bl.slice(0, 3).map(b => b.title).join('. ')}.`
      : `No blockers right now.`;
    return { title: 'Blockers & risks', lines, spoken };
  }

  if (topic === 'inbox') {
    const inbox = SEED.inbox || [];
    const lines = inbox.map(m => ({ head: `${m.from} — ${m.title}`, sub: m.preview || '' }));
    const spoken = inbox.length
      ? `${inbox.length} message${inbox.length === 1 ? '' : 's'} need attention. ${inbox.slice(0, 3).map(m => `${m.from}: ${m.title}`).join('. ')}.`
      : `Inbox is clear.`;
    return { title: 'Inbox — needs attention', lines, spoken };
  }

  if (topic === 'team') {
    const team = (SEED.team && SEED.team.people) || [];
    const lines = team.map(p => ({ head: p.name, sub: p.note || '' }));
    const attention = (SEED.team && SEED.team.attention) || '';
    const plain = attention.replace(/<[^>]+>/g, '');
    const spoken = plain ? `Team attention: ${plain}` : `Your team: ${team.map(p => p.name).join(', ')}.`;
    return { title: 'Team', lines, spoken };
  }

  if (topic === 'projects') {
    const projects = SEED.projects || [];
    const lines = projects.map(p => ({ head: `${p.name} · ${p.pct}%`, sub: p.meta || '' }));
    const spoken = projects.length
      ? `${projects.length} active project${projects.length === 1 ? '' : 's'}. ${projects.slice(0, 4).map(p => `${p.name}, ${p.pct} percent`).join('. ')}.`
      : `No active projects.`;
    return { title: 'Projects', lines, spoken };
  }

  // Fallback: briefing — a one-shot executive digest.
  const topCount = (SEED.top3 || []).length;
  const meetingCount = (SEED.calendar || []).filter(e => e.type === 'event').length;
  const blockerCount = (SEED.blockers || []).length;
  const inboxCount = (SEED.inbox || []).length;
  const nm = SEED.nextMeeting;
  const lines = [
    { head: `${topCount} top priorit${topCount === 1 ? 'y' : 'ies'}`, sub: (SEED.top3 || []).map(t => t.label).slice(0, 2).join(' · ') },
    { head: `${meetingCount} meeting${meetingCount === 1 ? '' : 's'} today`, sub: nm && nm.title ? `next: ${nm.title} (${nm.startsIn}m)` : '' },
    { head: `${blockerCount} blocker${blockerCount === 1 ? '' : 's'}`, sub: (SEED.blockers || []).slice(0, 1).map(b => b.title).join('') },
    { head: `${inboxCount} inbox item${inboxCount === 1 ? '' : 's'}`, sub: (SEED.inbox || []).slice(0, 1).map(m => m.from + ': ' + m.title).join('') },
  ];
  const spoken = `Here's your brief. ${topCount} top priorit${topCount === 1 ? 'y' : 'ies'}, ${meetingCount} meeting${meetingCount === 1 ? '' : 's'} today, ${blockerCount} open blocker${blockerCount === 1 ? '' : 's'}, ${inboxCount} inbox item${inboxCount === 1 ? '' : 's'}.${nm && nm.title && nm.startsIn ? ` Next up: ${nm.title} in ${nm.startsIn} minutes.` : ''}`;
  return { title: 'Daily brief', lines, spoken };
}

function VoiceSummaryModal({ open, topic, payload, onClose }) {
  const summary = useMemoB(() => buildVoiceSummary(topic, payload), [topic, payload, open]);
  const [speaking, setSpeaking] = useStateB(false);

  const speak = React.useCallback((text) => {
    try {
      if (!window.speechSynthesis) return;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.05; u.pitch = 1; u.volume = 1;
      u.onstart = () => setSpeaking(true);
      u.onend   = () => setSpeaking(false);
      u.onerror = () => setSpeaking(false);
      window.speechSynthesis.speak(u);
    } catch {}
  }, []);

  useEffectB(() => {
    if (!open) { try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch {} setSpeaking(false); return; }
    speak(summary.spoken);
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch {}
    };
  }, [open, topic]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel voice-summary-panel" onClick={e => e.stopPropagation()}>
        <div className="modal-section">
          <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:6}}>
            <div className="modal-section-title" style={{margin:0}}>{summary.title}</div>
            {speaking && <span className="voice-summary-speaking"><span className="voice-summary-pulse"/>Speaking…</span>}
          </div>
          <ul className="voice-summary-list">
            {summary.lines.map((l, i) => (
              <li key={i}>
                <div className="voice-summary-head">{l.head}</div>
                {l.sub && <div className="voice-summary-sub">{l.sub}</div>}
              </li>
            ))}
          </ul>
        </div>
        <div className="modal-footer">
          <button className="btn btn--ghost btn--sm" onClick={() => {
            try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch {}
            setSpeaking(false);
          }} disabled={!speaking}>Stop</button>
          <button className="btn btn--ghost btn--sm" onClick={() => speak(summary.spoken)}>Repeat</button>
          <button className="btn btn--primary btn--sm" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { SlackMod, ProjectsMod, KpiMod, Sparkline, TeamMod, BlockersMod, ShippedMod, PinsMod, WellnessMod, FindModal, AddTaskModal, AddMeetingModal, VoiceSummaryModal, buildVoiceSummary });
