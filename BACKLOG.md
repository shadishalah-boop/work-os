# Backlog — deferred improvements

Notes captured during the v0.5.x work. Nothing here is committed as a change yet —
these are vetted findings to pick up later.

---

## 1. Vendor the runtime libraries (drop the unpkg CDN dependency) — HIGH VALUE

**Problem.** `public/Work Dashboard.html` loads its three core libraries from
`unpkg.com` at page-load time:

- `react.development.js`
- `react-dom.development.js`
- `@babel/standalone` (transpiles the JSX in-browser on every load)

Risks for colleague installs:
- **Blank page behind a firewall / offline.** Corporate networks (possibly
  Preply's) often block public CDNs. If unpkg is unreachable the dashboard is a
  silent blank `#root` — no error, no hint. Looks broken with nothing to report.
- **Slow path.** Ships the *development* React builds and re-transpiles ~7,000
  lines of JSX in the browser on every load.
- Version pinning + integrity hashes are correct, but don't help if the host is
  blocked or down.

**Fix.** Download the three files once into `public/ds/vendor/` and point the HTML
at local paths. Switch React to the *production* builds while doing it. Add a small
inline guard: if `React` is undefined after load, replace the blank `#root` with a
readable "couldn't load the dashboard libraries — check your connection" message.

- Keeps the "just static files, no build step" philosophy (Babel still transpiles
  in-browser, just from a local copy).
- Cost: ~3 MB added to the repo (Babel standalone is most of it).
- Ships via the existing update path — modifying `Work Dashboard.html` is a bundle
  change, so `prep.sh`'s version-stamped re-sync delivers it on the next
  `/plugin update` + refresh. No manual step. `custom.css` + data files preserved.

**Confirmed: does NOT affect the update mechanism.**
- Live data refresh keys only on `data-override.jsx` / `drive-index.jsx` `?v=N`
  bumps — never touches the React/Babel script tags.
- Bundle re-sync just copies a few more files (`ds/vendor/`).
- Vendored libs are pinned/static → no `?v=` cache-busting needed, and they won't
  interfere with the auto-reload version detection.

**Caveat for implementation:** requires fetching the files, which depends on the
execution environment's outbound network policy.

Tentative version: **v0.5.3** (v0.5.2 shipped the timezone auto-detect).

### Optional follow-on (bigger change, lower priority)
Pre-compile the JSX to plain JS at bundle-sync time to eliminate the in-browser
Babel cost entirely (fastest load). Downside: adds a transpiler dependency at
refresh time on the user's machine, which works against the "no toolchain"
property. Vendoring (above) is the robust, philosophy-preserving choice; treat
pre-compile as a separate future optimization only if load speed becomes a
complaint.

---

## 2. Rollout / validation (owner: Shadi)

- **Real-world validation still pending:** Shadi's own `/plugin update` →
  `/dashboard` upgrade, plus one colleague's fresh install. The container can't
  exercise the real MCP connectors or the headless `claude -p`, so this is the
  final proof.
- **While the repo is private:** each early tester must be added as a repo
  collaborator (GitHub → Settings → Collaborators), or their
  `/plugin marketplace add` fails.
- **Migrate to the Preply org** once installs are proven. The install command
  changes from `shadishalah-boop/work-os` to `preply/work-os`; update the README
  quickstart + `homepage`/`repository` in `plugin.json` at that point. Keeping the
  Preply design-system assets under `public/ds/` private is fine in an org repo.

---

## 3. Already shipped (for context — v0.5.0 / v0.5.1)

- MCP-only: bundled `.mcp.json` removed (dead `granola-mcp`, calendar OAuth), Slack
  agent on the Slack MCP (no `xoxp-`/Keychain), connector verification in setup.
- Install hardening: bundle auto-sync on missing/version-change, Linux `stat` fix,
  self-diagnosing refresh line, `--model sonnet` pin, bypass-disabled friendly
  error, truthful docs/setup, `custom.css` override file.
- De-hardcoding: timezone/focusTarget/greeting/logo/favicon/names → config or
  generic; labeled sample-data banner; config-driven OKRs (any count, optional
  `short`/`keywords`).
- Hands-free: `schedule.sh install/uninstall/status` (launchd/cron) + optional
  `--serve` localhost server so the open tab auto-reloads (Chrome blocks the
  poller on `file://`).
