# Agent guidelines

Native Polish is a client-only Paseo plugin that adds motion to Paseo's existing desktop and web interface. It has no server entry and sends no content anywhere. Read [architecture](docs/architecture.md) before changing motion behavior, and [CONTRIBUTING](CONTRIBUTING.md) for the contributor workflow.

## Language

Write all project documentation in English: README, OVERVIEW, CHANGELOG, CONTRIBUTING, SECURITY, `docs/`, code comments, commit messages, pull request descriptions and issue templates.

The one exception is `README.zh-CN.md`, the Chinese translation of the README. Keep it in Chinese, and update it whenever README changes so both describe the same features and settings.

## Layout

| Path | Purpose |
| --- | --- |
| `index.client.tsx` | Client entry: registers the settings screen and Command Center item, then starts motion. |
| `client/web.ts` | DOM motion adapter: captures, sidebars, panes, tabs, trees, overlays, workspace rows. |
| `client/edge-peek.ts` | Desktop hidden-sidebar edge preview. |
| `client/sidebar-cascade.ts` | Stagger timing for the sidebar item cascade on open. |
| `client/elastic-scroll.ts` | Damped edge rebound for scroll surfaces. |
| `client/motion-runtime.ts` | Hands the single window motion owner to the highest connected plugin version. |
| `client/preferences.ts`, `client/settings.tsx` | Shared preference store and settings UI. |
| `tests/` | Node tests run with `--experimental-strip-types`. |

## Checks

Use Node.js 22 (`.nvmrc`). Run these before every commit:

```sh
npm ci --ignore-scripts   # first time only
npm run typecheck
npm run test:motion-runtime
npm run test:tree-motion
npm run test:sidebar-cascade
```

CI only runs the typecheck, so run the tests locally. Static checks do not confirm motion; for behavior changes, reload the plugin and check the interaction in the desktop app (see Verifying below). Add or extend a test in `tests/` when logic can be exercised without a real DOM.

## Code rules

- Runtime boundaries: client code lives in `client/`; there is no `server/` or `shared/`. Do not add other code modules to the plugin root. Import only public `@getpaseo/plugin` modules and the host-provided runtime modules; never import Paseo app internals or bundle a second React.
- DOM access: only the web adapter modules (`client/web.ts`, `client/edge-peek.ts`, `client/elastic-scroll.ts`) touch `document`/`window`. Each declares the minimal DOM types it uses instead of adding `"DOM"` to `tsconfig.json`, and is gated on `Platform.OS === "web"` with a no-op on native.
- Host DOM is not a public API. Keep selectors in the adapter, prefer `data-testid` and roles, and fail closed: when the expected structure is missing, skip the animation rather than guess.
- Stay out of the host's way: never cancel or modify host events, focus, caret or selection; never access React internals or reparent live host content; never change host state except through its own controls (edge preview).
- Exit copies must stay inert: strip IDs and test IDs, remove interactive media, mark them `inert` and `aria-hidden`, and remove them when the animation ends or is cancelled.
- Clean up everything you add: temporary styles (restore only values still owned by the plugin), injected CSS, DOM markers, observers, timers and listeners. Respect Reduce Motion and the per-category preferences, and keep input-path work bounded.
- Settings: a new preference needs a default in `client/preferences.ts`, a switch in `client/settings.tsx`, and its key in the saved-preference list in `client/web.ts`.
- Style: follow `.editorconfig` (2 spaces, LF, final newline). Comments explain why a host-specific guard exists, not what the line does.

## Versions and releases

- `VERSION` in `client/web.ts`, `version` in `package.json` and the root entries in `package-lock.json` must always match.
- `paseo-plugin.json` declares only a minimum Paseo version (currently `>=0.11.2`). Never add an upper bound.
- Behavior changes update README, `README.zh-CN.md`, OVERVIEW and CHANGELOG, and `docs/architecture.md` when an implementation boundary changes. `OVERVIEW.md` is the Paseo listing page: plain factual prose, no installation instructions, badges or changelog.
- CHANGELOG entries go under `## x.y.z · YYYY-MM-DD`, newest first, as user-facing sentences that say what changed and why.

## Commits and pull requests

- Commit subjects use a lowercase conventional prefix and an imperative summary, e.g. `fix: keep left sidebar rows aligned while it collapses`. Prefixes in use: `feat`, `fix`, `perf`, `docs`, `chore`. Explain the cause in the body when it is not obvious.
- Commit only the change at hand; leave unrelated work in progress out of the commit.
- Pull requests target `main` and fill in `.github/pull_request_template.md`: typecheck result, Paseo and plugin versions, and the interactions checked or known gaps. CodeRabbit reviews pull requests automatically.

## Verifying in the desktop app

- Install the working tree with `paseo plugin install "$PWD"` and load edits with `paseo plugin reload paseo-native-polish`. Never restart the Paseo daemon to load changes.
- Each connected Paseo host evaluates its own copy of the plugin, and `client/motion-runtime.ts` hands DOM motion to the highest version (the newest load on a tie). A local build only takes effect when its version is at least as high as every other connected host's.
- Renderer `console.info` output goes to `~/Library/Logs/Paseo/main.log`. The `[Native Polish] loaded` line shows which version owns motion. Remove temporary diagnostics before committing.
- Check left sidebar changes in a non-fullscreen macOS window too: there the sidebar owns the traffic-light row, and its layout changes when it closes.

## Things that are easy to miss

- Unistyles (web) deletes a class's CSS rule as soon as no mounted element uses it. A clone taken before a commit can lose styles that the commit unmounted; see `restoreUnistyles` in `client/web.ts`.
- `cloneNode` does not keep scroll offsets. Exit copies of scrolled lists need their offsets restored (`PanelSnapshot.scrolls`).
- Paseo's keyboard shortcut handler commits sidebar state before the plugin's keydown listener runs, so sidebar baselines are taken when Cmd/Ctrl goes down.
