# dsh-workspace-monitor · workspace session dashboard

Version 1.2.0 | Harness 0.2.1-rc.5 | Cordis bundle (host half + web client half)

In one line: click the sidebar entry and the main area becomes a monitoring board — every session grouped by workspace, with live status, cumulative usage and last activity; when there are many sessions it pages one workspace at a time; click any card to read that session's activity timeline.

The Chinese README is authoritative (`README.md`); this is its English counterpart. Development notes and evidence are kept outside this repository.

---

## 1. What works today, and what does not

| Part | Status | Evidence |
|---|---|---|
| Client half (all UI and data reads) | **loaded live** | Sidebar occupant `{id:"dsh-workspace-monitor", order:20, active:true}` and keyed main occupant `{key:"dsh-workspace-monitor", active:true}`, both readable through `cordis_inspect_query` |
| Card / carousel / timeline logic | **offline smoke test passes** | `node tmp/smoke.js` → ALL CHECKS PASSED (assertions in §9 and log stage 13) |
| Host projection `dshWorkspaceMonitor` | **not active on this machine** | 92 checkpoint files under `~\.dsh\storages\session_projcache\sessions\` all carry the same 27 framework keys; our key appears zero times. Keys whose stored `val` is null still get a row, so a registered unit must produce a row |
| Does the board still show data | **yes, independent of the above** | Since 1.1.0 cards and the drawer read the framework's own projection keys (§4) |
| Look and "which keys the client really receives" | **needs a browser check by you** | The footer toggle "projection keys" lists the keys visible on the page |

---

## 2. Package contents

| File | Role |
|---|---|
| `client.js` | Client half: UI, seat registration, status rules, carousel, read-only event window. Shape: `window.__ModuleLoader__.load({id, factory})`, only `require('react')`, no JSX |
| `index.js` | Host half: folds each session log into the optional projection `dshWorkspaceMonitor` (see §10 item 1) |
| `cordis.patch.yml` | Bundle patch: one `insert` entry plus the six default config values |
| `package.json` | `dsh.bundle.patch` points at the patch; `dsh.client` declares the client-half injections; every `@deepseek-ai/*` is an optional peerDependency |
| `icon.svg` | Sidebar icon (an equivalent inline SVG lives in `client.js`) |
| `locale/zh.json`, `locale/en.json` | Reserved; UI strings currently come from the dictionaries inside `client.js`, and `ctx.locale` is not wired yet |
| `tests/smoke.js` | Offline smoke test; not part of the runtime |
| `README.md` / `README.en.md` | This documentation |

---

## 3. Layout (four regions)

1. **Header**: title, archived-visibility note, "Refresh list" and "Back to default view", six stat tiles (workspaces, sessions, running, waiting, completed, interrupted), plus one line about data-source health.
2. **Body**: one module per workspace (title, path, session count, per-status counters) with a card grid. A card shows the title, status pill, last activity, model, turns/steps, cumulative tokens, context pressure, pinned/archived marks and a progress bar.
3. **Footer controls**: when the carousel is on — `‹` dots `›`, page label, "carousel paused" while the pointer is inside the body; on the right the legend and the "projection keys" toggle.
4. **Detail drawer**: status pill, title, "Open this session", close; two fact-tile groups; a context-pressure percentage bar; a progress bar; a reverse-chronological timeline. `Esc`, the close button or a click on the backdrop closes it.

Colours are the `THEME` constants inside `client.js` applied as inline styles; only four `@keyframes` (pulse, slide, fade-up, slide-in) are injected through a `<style>` element that unmounts with the panel.

---

## 4. Where every number comes from

| On screen | Source | Observed shape on this machine | When unavailable |
|---|---|---|---|
| Workspace groups, session list, archived and pinned ids | the seat's `useWorkspaces()` | `{items:[{workspaceId,path,title,sessionIds,createdAt,updatedAt}], archivedSessionIds, pinnedSessionIds}` | an explicit "no data source" notice |
| Running / waiting | `useSessionStatus()` (driven by `api-session/*` and `agent/status`) | Map of `{running, pendingInteraction, completionUnread}` | falls back to projection-based rules |
| Model | projection `modelSelection` | `{lastUsed:{provider,model}, pending:null}` (also accepts the older `{next:{model}}`) | `—` |
| Cumulative tokens | projection `tokenUsage` | `{totals:{uncachedInputTokens,outputTokens,cacheReadTokens,cacheWriteTokens}, last:{turn,step,buckets}}` | tile omitted |
| Turns / steps | projection `sessionStats` | `{turns, steps, lastTurn, openStep, pendingCalls}` | tile omitted |
| Context pressure (**the only real percentage**) | projection `contextPressure` | `{surfaceTokens, contextWindow, pressureTokens}` | tile omitted |
| Last prompt time | projection `sessionListMetadata` | `{blank:false, lastPromptAt}`; fallback `SessionSummary.updatedAt` | `—` |
| Activity timeline | `ctx.get('sessions').retain(id, {source:'controllerOperation', signal})` → `binding.eventSource.getSnapshot().entries` → `session.loadOlder()` | committed envelopes `{type, seq, time, data}`; payloads are always read from `data` | an explicit "no sessions service" notice |
| Tool calls / failures (card) | only when the host projection `dshWorkspaceMonitor` has a value | — | tile omitted |
| Tool calls / failures (drawer, "in this window") | counted from the timeline window already read | `tool/call` count; `tool/result` failure via `message.isError` or `error` | tile omitted when zero |

A cell that has no source shows `—` or is not rendered at all. Nothing is estimated, and unknown values are never shown as `0`.

---

## 5. Status rules (first match wins)

| Priority | Condition | Light |
|---|---|---|
| 1 | `runtime.running === true` | 🟢 running |
| 2 | `runtime.pendingInteraction` present | 🟡 waiting |
| 3 | projection `lastTurnEndReason ∈ {error, aborted, interrupted, blocked, max-tokens}` | 🔴 interrupted |
| 4 | `turns > 0` or user messages > 0 (or `completionUnread`) | ⚪ completed |
| 5 | none of the above | 🟡 waiting |

Two honest caveats: the framework exposes no standalone "idle" signal, so rule 5 is a fallback; rule 3 needs `turn/end`'s `reason.kind`, which is only available once the host projection actually registers.

---

## 6. What the progress bar really means

- 🟢 running: **indeterminate** animated bar plus real counters in the card text. There is no completion percentage in the framework, so none is invented.
- 🟡 waiting: short static bar.
- ⚪ completed: full bar, muted.
- 🔴 interrupted: full bar, red.

Bar length encodes state, not completion. The only genuine percentage in the whole board is the drawer's context pressure (`pressureTokens / contextWindow`; green below 60%, yellow 60–84%, red 85% and above).

---

## 7. Configuration

Declared in `cordis.patch.yml` under `insert[0].config`:

| Key | Default | Range | Effect |
|---|---|---|---|
| `carouselIntervalMs` | 8000 | 1500–120000 | page interval |
| `carouselThreshold` | 9 | 1–200 | carousel turns on above this many sessions |
| `carouselWorkspaceThreshold` | 3 | 1–50 | carousel turns on above this many workspaces |
| `maxSessionsPerWorkspace` | 6 | 1–50 | card cap per workspace module |
| `statusRefreshIntervalMs` | 2000 | 500–60000 | cadence for recomputing relative timestamps |
| `showArchivedSessions` | false | boolean | include archived sessions |

Host and Client each normalise the same field table, so an invalid value falls back to its default instead of half-applying. Since 1.2.0 the Host `Config` is a Schemastery schema (`import('@deepseek-ai/schemastery')`, resolved by the Loader; if it ever cannot be resolved the export falls back to the dependency-free `~standard` validator, so the plugin still mounts). Measured result: `Config.listConfigs entry=include:dsh-workspace-monitor` moved from `unsupported` to **`schema`** - six typed fields with defaults and descriptions, `acceptsMissing: true` - so the row in the Plugins page offers a config form. Values edited there are written into the profile's `cordis.patch.yml` and the Loader restarts the plugin so they take effect, no app restart needed. Out-of-range numbers never break activation: `clampConfig` pulls them back to the boundary (`carouselIntervalMs: 999999` is used as 120000), while `normalizeConfig` stays available for patch validation and the smoke test.

---

## 8. Install / update / removal

**Canonical location**: the root of this repository. Make changes here and commit them here.

Install, either way:

1. Plugin Manager → install bundle → `link:<absolute path where you checked out this repository>`
2. `pnpm -C <your DSH profile directory, for example ~/.dsh/profiles/desktop> add "<directory of this checkout>"` (equivalent; pnpm records a `link:`)

Installation links the package into the profile's `node_modules` and records it in the profile `package.json` (`dependencies` plus `dsh.profile.bundles`).

What takes effect when:

- change **`client.js`** → hard refresh the browser (**Ctrl+F5**); there is no `pnpm run dev:web` watcher here, so nothing hot-reloads
- change **`index.js` / `package.json` / `cordis.patch.yml`** → **restart the app** (the host half loads at startup; the GUI port changes on each restart)
- remove it: Plugin Manager → `remove_bundle`

Never hand-edit the profile's `package.json` or the profile's `cordis.patch.yml`.

---

## 9. Verification

1. **Offline smoke test** (no app needed): run `node tests/smoke.js` from this package directory. It drives the whole path with a stub React and framework-shaped fixtures (8 sessions / 2 workspaces / 1 archived / 1 blank / 1 ungrouped) and asserts: self-registration, both seats registered, card count equal to `maxSessionsPerWorkspace`, carousel dots present, a card click opens the drawer, timeline rows render with failed tools highlighted, "load older" appears when `hasMore`, and after unmount the retain is released with zero subscriptions and zero document listeners. Current result: exit 0, ALL CHECKS PASSED.
2. **Live**: click the sidebar icon, click a card, close the drawer with `Esc`; click the footer "projection keys" to see which projection keys the page actually receives.
3. **Seat evidence**: Client `Slots listSubTree` with `root` = `main` and `sidebar.panellist`; both should list the `dsh-workspace-monitor` occupant.

---

## 10. Known limits

1. **The host projection is not registered.** 92 checkpoint files, same 27 framework keys, our key absent. The export shape was checked against the framework source and against a working third-party bundle (`dshmarket\lib\index.js:205` also uses `export function apply(ctx, config)` + `ctx.inject([...], cb)`), so the suspect is visibility or ordering of `sessionProjections` for this bundle's fiber. Two follow-ups: a one-off `activation.log` in `index.js`, or a static `export const inject = ['sessionProjections']` the way `dsh-session-clean` does it.
2. No configuration editor in Plugin Manager (§7).
3. Session records carry no `createdAt`, so the drawer's "workspace created" tile is `workspace.createdAt`, not the session's creation time.
4. The timeline is bounded by the retained event window and advances through "load older"; at most 200 rows are rendered and the rest are reported as a hidden count.
5. Unknown event types are counted, never interpreted; 14 types are mapped today.
6. UI strings come from the bundled dictionaries (zh/en picked by browser language); `ctx.locale` is not wired and `locale/*.json` is reserved.
7. Two accessibility rules are currently missing: card keyboard focus outline, and a dimmed disabled button state.
8. Visual acceptance (dark modular feel, carousel pacing, drawer behaviour in narrow windows) can only be judged in the browser.

---

## 11. Versions and rollback

- **1.2.0 (2026-11-06)**: the Host `Config` became a Schemastery schema, so the Installed row in the Plugins page now carries a config form (`status: schema`); added `clampConfig` - out-of-range values are pulled back instead of blocking activation.
- **1.1.0 (2026-11-06)**: restored status rules, grouping and filters, carousel, config, and the read-only event timeline; switched the data source to the framework's own projections; added the context-pressure percentage bar and the projection-key diagnostic.
- **1.0.0 (2026-11-05)**: first release, dark modular layout.

Version history is in the two entries above and in this repository's `git log --oneline`. Every release is checked with `node tests/smoke.js` before publishing.

---

## 12. Data handling

The board is read-only: session metadata, the status Map, framework projection values, and the event window of the session you clicked. It writes nothing into a session, polls no log, and sends nothing outside this machine. Removing the plugin removes its seats and registrations.
