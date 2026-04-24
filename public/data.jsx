/* global React */
// =============================================================================
// Dashboard seed data — realistic, role-neutral "senior knowledge worker"
// =============================================================================

window.SEED = {
  user: { name: 'Alex', role: 'Senior PM', tz: 'Europe/Kyiv' },

  // Today: April 23, 2026 — Thursday
  greeting: {
    morning: 'Morning, <em>Alex</em>.',
    afternoon: 'Afternoon, <em>Alex</em>.',
    evening: 'Evening, <em>Alex</em>.',
  },

  top3: [
    { id: 't1', label: 'Review Q2 OKR draft before 2pm standup', meta: 'Due 2:00pm · Finance sync depends on it', done: false },
    { id: 't2', label: 'Ship pricing v3 decision doc', meta: 'Blocked on Mia · nudge by EOD', done: false },
    { id: 't3', label: 'Record Loom for async exec update', meta: 'Drafted 80% · needs 10min', done: true },
  ],

  overdue: [
    { id: 'o1', label: 'Respond to legal on data retention clause', meta: 'Legal · overdue 2d', p: 1, project: 'contracts', done: false },
    { id: 'o2', label: 'Close out Jan retro action items', meta: 'Ops · overdue 5d', p: 2, project: 'ops', done: false },
  ],

  dueSoon: [
    { id: 'd1', label: 'Interview debrief — Priya (Staff PM)', meta: 'Tomorrow · 10:00', p: 1, project: 'hiring', done: false },
    { id: 'd2', label: 'Review partnership memo w/ Sam', meta: 'Fri · EOD', p: 2, project: 'partnerships', done: false },
    { id: 'd3', label: 'Reimbursements — March travel', meta: 'Mon · 5pm', p: 3, project: 'ops', done: false },
    { id: 'd4', label: 'Sync notes — infra review', meta: 'Mon · async', p: 3, project: 'infra', done: false },
  ],

  blocked: [
    { id: 'b1', label: 'Pricing v3 — awaiting Mia\'s numbers', meta: 'Mia K. · 3d waiting', p: 1, project: 'growth', done: false },
    { id: 'b2', label: 'Brand mark refresh approval', meta: 'Theo R. · 1d waiting', p: 2, project: 'brand', done: false },
  ],

  shipped: [
    { id: 's1', title: 'Shipped: onboarding v2 to 100%', meta: '2h ago · growth' },
    { id: 's2', title: 'Closed: hiring loop for Staff PM', meta: 'Yesterday · hiring' },
    { id: 's3', title: 'Published: Q1 recap to all-hands deck', meta: 'Mon · comms' },
    { id: 's4', title: 'Rolled out: billing emails v4 EU', meta: 'Mon · billing' },
  ],

  projects: [
    { id: 'p1', name: 'Pricing v3',              status: 'at-risk',   pct: 62, meta: 'Milestone · May 6', color: 'var(--pink-400)' },
    { id: 'p2', name: 'Onboarding v2',            status: 'on-track',  pct: 94, meta: '100% rollout · Apr 25', color: 'var(--teal-400)' },
    { id: 'p3', name: 'Enterprise SSO',           status: 'on-track',  pct: 48, meta: 'Design review · Fri',  color: 'var(--blue-400)' },
    { id: 'p4', name: 'Brand refresh',            status: 'off-track', pct: 30, meta: 'Waiting on Theo',      color: 'var(--yellow-400)' },
    { id: 'p5', name: 'Tutor matching algorithm', status: 'on-track',  pct: 71, meta: 'A/B live · Apr 30',    color: 'var(--grey-700)' },
  ],

  okrs: [
    { id: 'k1', name: 'Q2: Lift activation 15%', pct: 68, trend: 'on-pace' },
    { id: 'k2', name: 'Q2: Cut time-to-first-lesson <48h', pct: 42, trend: 'behind' },
    { id: 'k3', name: 'Q2: NPS 60+', pct: 78, trend: 'ahead' },
  ],

  decisions: [
    { id: 'dec1', title: 'Approve v3 pricing A/B scope', who: 'Mia K.', meta: 'Awaiting your call · 2d' },
    { id: 'dec2', title: 'Sign off on Priya offer letter', who: 'People ops', meta: 'Awaiting your call · 1d' },
    { id: 'dec3', title: 'Pick vendor: CX survey tool', who: 'CX · you + Sam', meta: 'Awaiting your call · 4d' },
  ],

  calendar: [
    { id: 'c1', time: '09:00', duration: 30, title: '1:1 with Mia',                type: 'done',    who: ['Mia K.'] },
    { id: 'c2', time: '10:00', duration: 60, title: 'Design review · pricing',      type: 'done',    who: ['Lena', 'Priya', 'Theo'] },
    { id: 'c3', time: '11:30', duration: 30, title: 'Deep work — OKR draft',        type: 'focus' },
    { id: 'c4', time: '12:30', duration: 30, title: 'Lunch',                        type: 'focus' },
    { id: 'c5', time: '13:00', duration: 30, title: 'Exec readout prep',            type: 'event',   who: ['Sam', 'You'] },
    { id: 'c6', time: '14:00', duration: 60, title: 'Product standup',              type: 'event',   who: ['Mia', 'Theo', 'Sam', 'Priya', '+3'] },
    { id: 'c7', time: '15:00', duration: 30, title: 'Pricing A/B — decision',       type: 'conflict',who: ['Mia', 'Finance'] },
    { id: 'c8', time: '15:00', duration: 30, title: 'Partner sync — Berlitz',       type: 'conflict',who: ['Sam', 'Partner'] },
    { id: 'c9', time: '16:00', duration: 60, title: 'Deep work — async Loom',       type: 'focus' },
    { id: 'c10',time: '17:30', duration: 30, title: 'Interview — Staff PM',         type: 'event',   who: ['Candidate', 'Lena'] },
  ],

  nextMeeting: {
    title: 'Exec readout prep',
    startsIn: 18, // minutes
    with: 'Sam',
    room: 'Zoom · Board',
  },

  meetingLoad: {
    hoursThisWeek: 21,
    hoursCap: 28,
    pctInMeetings: 54,
    backToBackBlocks: 2,
  },

  inbox: [
    { id: 'i1', tag: 'mention',  from: 'Mia K.',    channel: '#growth',     title: 'tagged you in pricing v3 thread',  preview: '…can you weigh in on tier 2 bundle before EOD? Blocking the deck', at: '12m' },
    { id: 'i2', tag: 'decision', from: 'Priya S.',  channel: 'DM',          title: 'needs a yes/no on offer extension', preview: 'recruiter wants to get the letter out today', at: '28m' },
    { id: 'i3', tag: 'reply',    from: 'Theo R.',   channel: '#brand',      title: 'replied to your brand mark question', preview: 'okay — 6 directions ready, which two for Friday?', at: '1h' },
    { id: 'i4', tag: 'draft',    from: 'You',       channel: '#leadership', title: '"Q2 OKR recap — pasting notes…"',     preview: 'started yesterday · saved 4 times · 78 words', at: '1d' },
    { id: 'i5', tag: 'reply',    from: 'Lena M.',   channel: 'DM',          title: 'is waiting on your review', preview: 'pinged twice · design draft #4, would love to ship it', at: '2d' },
  ],

  team: [
    { name: 'Mia K.',    status: 'active',  note: 'Same TZ · in standup',  ooo: false, manager: false },
    { name: 'Theo R.',   status: 'away',    note: 'Lisbon · lunch',         ooo: false, manager: false },
    { name: 'Priya S.',  status: 'active',  note: 'NYC · 5h offset',        ooo: false, manager: false },
    { name: 'Lena M.',   status: 'active',  note: 'Berlin · 1h offset',     ooo: false, manager: false },
    { name: 'Sam O.',    status: 'active',  note: 'SF · 10h offset',        ooo: false, manager: true  },
    { name: 'Jules P.',  status: 'ooo',     note: 'OOO until Apr 28',       ooo: true,  manager: false },
  ],

  // Role: senior PM — product-ish KPIs
  kpis: [
    { label: 'Activation', value: '31.4%', target: '+15% by EOQ', trend: { dir: 'up',   pct: 2.1, period: 'vs last week' } },
    { label: 'Weekly active learners', value: '412k', target: 'target 450k', trend: { dir: 'up',   pct: 4.8, period: 'vs last week' } },
    { label: 'Time to first lesson', value: '63h', target: 'target <48h', trend: { dir: 'down', pct: 6,   period: 'improving', good: true } },
    { label: 'NPS', value: '57', target: 'target 60+', trend: { dir: 'flat', pct: 0, period: 'no change' } },
  ],

  // Slack — FULL depth: threads, priority, summaries, suggested replies
  slack: {
    tabs: [
      { id: 'missed',    label: 'You missed this', count: 4, active: true },
      { id: 'mentions',  label: 'Mentions', count: 7, active: false },
      { id: 'owed',      label: 'Replies owed', count: 3, active: false },
      { id: 'watching',  label: 'Threads you\'re watching', count: 12, active: false },
    ],
    channels: [
      {
        id: 'ch1',
        channel: '#growth-pricing',
        unread: 28,
        priority: 'high',
        updated: '12m ago',
        summary: 'Mia flagged a 9% conversion dip in the tier-2 bundle test last night. She wants your call on whether to pause or re-randomize. Thread is active — 3 people weighing in, decision needs you.',
        mentions: [
          { pri: 'high', label: '@alex — pause or keep?' },
          { pri: 'high', label: 'blocking finance deck' },
        ],
        peek: [
          { who: 'Mia K.',   body: 'tier 2 is down 9% day-3. Do we pause or let it run to 7d?' },
          { who: 'Finance',  body: 'if we pause today I can still rebuild the deck tomorrow' },
          { who: 'Theo R.',  body: 'data looks noisy but not random — I\'d pause' },
        ],
        suggested: [
          { label: 'Pause, re-randomize Monday', primary: true },
          { label: 'Keep running · 48h', primary: false },
          { label: 'Ask me later', primary: false },
        ],
      },
      {
        id: 'ch2',
        channel: '#hiring-pm',
        unread: 14,
        priority: 'high',
        updated: '28m ago',
        summary: 'Priya\'s offer window closes Friday. Recruiter needs your sign-off on the comp band adjustment — she has a competing offer at +12%. You\'ve been tagged twice.',
        mentions: [
          { pri: 'high', label: '@alex — comp band?' },
          { pri: 'med',  label: 'deadline Friday' },
        ],
        peek: [
          { who: 'Recruiter', body: 'she has a counter at +12%. Bump band or walk?' },
          { who: 'Lena M.',   body: 'I\'d bump. she\'s a unicorn.' },
        ],
        suggested: [
          { label: 'Approve +12% · send letter', primary: true },
          { label: 'Counter at +8%', primary: false },
          { label: 'Let\'s sync · 15m', primary: false },
        ],
      },
      {
        id: 'ch3',
        channel: '#leadership',
        unread: 9,
        priority: 'med',
        updated: '1h ago',
        summary: 'Sam shared the draft board narrative. No decisions pending, but there\'s a paragraph on pricing that still references v2 numbers — likely needs your edit before Monday.',
        mentions: [
          { pri: 'med', label: 'board narrative draft' },
        ],
        peek: [
          { who: 'Sam O.',   body: 'draft 1 attached. Pricing section tbd.' },
        ],
        suggested: [
          { label: 'I\'ll patch pricing by Fri', primary: true },
          { label: 'Looks good · ship it', primary: false },
        ],
      },
      {
        id: 'ch4',
        channel: '#design-crit',
        unread: 5,
        priority: 'low',
        updated: '3h ago',
        summary: 'Lena posted 6 brand-mark directions. Theo wants your two favorites to take into Friday review. Nothing urgent — you can answer async.',
        mentions: [
          { pri: 'low', label: '6 directions posted' },
        ],
        peek: [
          { who: 'Lena M.',  body: 'figma link · directions 1–6 inside' },
          { who: 'Theo R.',  body: 'which two do we bring to Friday?' },
        ],
        suggested: [
          { label: 'Pick: #2 and #5', primary: true },
          { label: 'Need more time', primary: false },
        ],
      },
    ],
  },

  pins: [
    { id: 'pn1', label: 'Q2 OKR doc',         sub: 'Notion · edited 2h ago',  letter: 'N', bg: 'var(--grey-100)' },
    { id: 'pn2', label: 'Pricing v3 tracker', sub: 'Linear · 14 open',         letter: 'L', bg: 'var(--blue-100)' },
    { id: 'pn3', label: 'Board narrative',    sub: 'Gdoc · Sam',               letter: 'G', bg: 'var(--teal-100)' },
    { id: 'pn4', label: 'Growth dashboard',   sub: 'Looker',                   letter: 'M', bg: 'var(--yellow-100)' },
    { id: 'pn5', label: 'Exec readout deck',  sub: 'Slides · Apr 23',          letter: 'S', bg: 'var(--red-100)' },
    { id: 'pn6', label: '#growth-pricing',    sub: 'Slack · 28 unread',        letter: '#', bg: 'var(--pink-100)' },
    { id: 'pn7', label: 'Priya offer letter', sub: 'Greenhouse',               letter: 'G', bg: 'var(--grey-100)' },
    { id: 'pn8', label: 'Design system',      sub: 'Figma',                    letter: 'F', bg: 'var(--blue-100)' },
  ],

  personalSignals: {
    focusHours: 2.5,
    focusTarget: 4,
    meetingHours: 5.5,
    pctMeetings: 54,
    shippedThisWeek: 4,
    streak: 3,
    weeklyMessage: 'You\'ve been in meetings <em>54%</em> of this week. That\'s a lot. Protect tomorrow morning?',
  },
};

