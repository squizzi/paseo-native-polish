# Native Polish for Paseo

[中文说明](README.zh-CN.md)

Motion for Paseo's existing interface. Sidebars, panes, tabs and disclosures transition smoothly while keeping Paseo's views and controls.

## Features

| Area | Behavior |
| --- | --- |
| Sidebars | Animate left sidebar and Explorer expansion/collapse, including adjacent pane resizing. Workspace rows fade in on creation and out on archive; neighboring rows move into place. |
| Edge preview | Hover at a hidden desktop sidebar’s window edge for a temporary, interactive overlay. Leaving restores the closed state without resizing the canvas. |
| Panes | Animate split, close, maximize and restore. |
| Tabs | Animate opening, closing and reordering; transition selection colors. |
| Explorer and timeline | Animate tree expansion/collapse, folder arrows, tool calls and thinking details. |
| Overlays and controls | Short menu/dialog transitions, button press feedback and hover changes. Tooltips keep Paseo's own motion and hover lifecycle. |
| Agent activity | Reveal coalesced streamed Markdown arrivals with core's opacity fade, plus core-style snap-to-line growth. Reveal tool labels and summaries at their natural text width as details arrive. Transition status changes and newly appended messages. |
| Scrolling | Damped edge rebound for agent conversations, workspace lists, Files, Changes, Markdown previews and editable/read-only file Source views. Normal scrolling and inertia stay with Paseo. |

Workspace rows also move smoothly when pinned, unpinned or moved between status groups. Project creation/removal animates the group and surrounding list. These transitions use the sidebar motion setting.

**Edge preview** has its own switch and is enabled by default. Move a mouse within 7 px of the left or right window edge, below the titlebar, and pause for 180 ms. The hidden sidebar slides over the canvas. Leaving allows 260 ms to return before it closes; Escape dismisses it until the mouse leaves the edge. Open menus and focused inputs keep the preview available while you interact. Clicking the normal sidebar toggle or using its shortcut can open the regular layout dock. Already-open sidebars and compact/touch layouts retain their behavior.

This runs in the client for local and remote workspaces. Transparent 7 px gutters reserve the activation edges while the corresponding sidebar is hidden, including above sandboxed HTML previews. The preview contents and sandbox are untouched; controls within those outer gutters receive hover through the plugin instead of the underlying page. Moving back into the HTML content starts the usual close delay.

The preview temporarily opens the real host sidebar, places it outside flex layout before the opening commit, and closes it again on exit. Sidebar visibility is transiently updated in Paseo during the preview; no copied controls or private React state are used.

Each motion category can be switched off. Choose **Gentle** (220 ms) or **Quick** (150 ms). System **Reduce Motion** disables added animations; shorter feedback uses its own timings.

**Elastic scrolling** has its own switch. Supported macOS/iOS browsers use their platform rebound. The Electron/other-browser fallback follows vertical wheel/trackpad and single-finger touch input directly, with viewport-dependent resistance and a fast return after release. A fling gets one edge collision and ignores residual momentum fluctuations. A quiet gap, direction change, spaced wheel impulse or sustained renewed pressure allows another pull at the same edge, starting from its visible offset. Horizontal scrolling, pinch zoom and nested code/detail scrollers retain their behavior. Quick speeds up only the fallback return. Native mobile clients keep their existing scrolling.

File scrolling covers rendered Markdown and editable/read-only Source views for all text file types. CodeMirror moves its complete viewport so text, line numbers and selection layers stay together; clicking, typing or starting IME composition immediately restores it. HTML preview content is inside a sandboxed iframe and is not yet covered. Images retain their existing zoom/pan gestures, rather than document-scroll rebound.

The desktop fallback is an approximation: Paseo's Electron window does not currently enable `scrollBounce`, and a client plugin cannot change that main-process option. Exact macOS rebound requires host support.

Streaming assistant rows render with Paseo's host `Markdown` component while live and reveal each coalesced text arrival by fading inert background covers over the newly appended glyph ranges, keeping Paseo as the sole Markdown paint owner. Completed rows return to Paseo's default timeline item; the adapter suppresses a second message entrance at that handoff. Streaming updates are coalesced by surface; wheel bursts rebase list snapshots after input settles. Text editing, selection and IME composition bypass global motion captures. Editor/terminal rendering does not trigger app layout scans. Motion and scans pause when the window loses focus or becomes hidden; returning rebases the current UI without replaying background changes. Tree commits reuse one bounded layout capture.

## Install

Requires **Paseo 0.13.0** or later, with plugins enabled on the target daemon.

```sh
paseo plugin add git:JasprW/paseo-native-polish
```

Open **Settings → Plugins → Native Polish**, or use **Native Polish: motion settings** in the Command Center.

```sh
paseo plugin update paseo-native-polish
paseo plugin disable paseo-native-polish
paseo plugin enable paseo-native-polish
```

## Compatibility and data

The motion adapter runs in desktop and browser clients. iOS and Android retain their existing native transitions. It observes Paseo's internal DOM structure, which is not a stable public API; new Paseo minor versions require a compatibility review.

The plugin has no daemon backend and makes no external requests. Exit animations can briefly copy visible DOM content locally. Copies are inert, hidden from accessibility and removed after the transition. Streaming text and loaded history do not replay message entrances. Scrolling and dragging interrupt animations.

Settings are stored in the current client's local storage. Disable or unload the plugin to remove its observers, styles, listeners and animation copies.

## Development

Use Node.js 22. Paseo compiles the TypeScript entries; no separate build is needed.

```sh
git clone https://github.com/JasprW/paseo-native-polish.git
cd paseo-native-polish
npm ci --ignore-scripts
npm run typecheck
paseo plugin install "$PWD"
# After editing:
paseo plugin reload paseo-native-polish
```

```text
index.client.tsx       Client registration and lifecycle
client/settings.tsx   Settings UI using Paseo components
client/preferences.ts Reactive preferences
client/streaming-markdown.tsx Live streaming assistant item using Paseo's Markdown component
client/web.ts         Web-only DOM and animation adapter
client/elastic-scroll.ts Web scroll boundary spring and cleanup
client/edge-peek.ts    Temporary desktop edge preview and restoration
paseo-plugin.json     Plugin identity and compatibility
OVERVIEW.md           Paseo plugin listing description
docs/architecture.md  Implementation notes
```

GitHub Actions runs the TypeScript check. It does not validate visual behavior in Paseo. See [CONTRIBUTING](CONTRIBUTING.md), [CHANGELOG](CHANGELOG.md) and the [architecture notes](docs/architecture.md).

## License

[Apache-2.0](LICENSE). This is an independent plugin for [Paseo](https://paseo.sh).
