# Contributing

Use Node.js 22 and Paseo 0.11.2 or later. The plugin's compatibility range is declared in `paseo-plugin.json`.

```sh
npm ci --ignore-scripts
npm run typecheck
paseo plugin install "$PWD"
# After editing:
paseo plugin reload paseo-native-polish
```

The sidebar timing regression runs the real adapter in Chromium against a small host layout fixture:

```sh
npx playwright install chromium
npm run test:sidebar-browser
# Or use an installed Chrome:
CHROME_CHANNEL=chrome npm run test:sidebar-browser
```

It checks commits before a frame, inside a frame, and after bounded layout polling ends, as well as a single settings-sidebar entrance, pointer-up/click ordering, visible closes, and rapid reversals. Fixtures include retained gesture hosts with and without resize handles, plus the older direct width owner. This catches a full-width frame before the entrance starts; it does not replace checking the actual desktop interface.

Keep runtime code in `client/`, apart from `index.client.tsx`. This plugin has no server entry or shared runtime. Paseo supplies the host modules; do not add app-private imports or bundle a second React instance.

Run `npm run typecheck`, `npm run test:motion-runtime`, `npm run test:tree-motion`, `npm run test:sidebar-cascade`, `npm run test:sidebar-panels`, `npm run test:sidebar-shortcuts` and `npm run test:outline-rail-motion` before committing. The sidebar fixtures cover retained docks, legacy resize handles, host-owned overlays and shortcuts consumed by the host or delivered without DOM key events; desktop interaction checks are still required for motion changes.

For UI changes, use Paseo's theme colors and document the surface, settings, and interaction you checked. Record any remaining platform or visual checks in the pull request. Include relevant reproduction steps when fixing a bug.

Update README, OVERVIEW and CHANGELOG when behavior changes. Keep package and lockfile versions in sync. See [architecture](docs/architecture.md) for implementation boundaries.

Contributions are licensed under Apache-2.0.
