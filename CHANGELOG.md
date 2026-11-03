# Changelog

## 0.4.17 · 2026-11-01

- Animate filtered projects added to and removed from the sidebar. When projects are shown or hidden using sidebar filters, their groups fade and slide into or out of place, and neighboring rows transition smoothly just like project creation and removal.
- Cascade sidebar items in when a sidebar opens. Navigation rows, section titles, projects, workspaces and footer buttons fade and slide in one after another, top to bottom and left to right within a row, so the sidebar reads as unfolding rather than appearing at once. The Explorer does the same for its tabs and Files/Changes tree rows, mirrored to slide in from the right; other panels it hosts, such as terminals, appear with the drawer. Long lists compress the stagger so the last visible row still starts within about a quarter second. Previewing a hidden sidebar from the window edge cascades its items the same way as it slides in. It uses the sidebar motion setting and respects Reduce Motion.
- Keep the window header still while a sidebar is previewed from the window edge. Opening the left sidebar removes the header's traffic-light space and opening the Explorer moves its toggle out of the header, so the title and right-hand buttons jumped while the preview slid over them. The preview now holds them in place until it closes.
- Add an edge peek sensitivity setting. It sets how close to the window edge the pointer must rest to preview a hidden sidebar: 4 px, the default 7 px, or 14 px. A wider zone is easier to hit but takes the outermost pixels of HTML previews for hover.
- Animate the shortcut numbers that appear in the sidebar while Cmd/Ctrl is held. Each workspace row's diff stat or timestamp rolls up and out as its number rolls in, and releasing the key reverses it, so the swap reads as one value changing instead of a jump cut. Project rows fade their numbers in and out. It uses the sidebar motion setting and respects Reduce Motion.
- Keep the left sidebar's rows aligned while it collapses. On macOS the sidebar drops its traffic-light row and the styles for it before it is hidden, so navigation rows and workspaces jumped up mid-animation. The exit now shrinks a copy of the open layout with its styles and scroll position intact.

## 0.4.16 · 2026-10-21

- Stop applying overlay entrance and exit animation to hover tooltips. Tooltip text now follows Paseo's own hover lifecycle instead of flashing on pointer enter or leave. Thanks to @squizzi for the fix in #1.
- Correct the listing's settings instructions to point to Settings → Plugins → Native Polish or the Command Center.

## 0.4.15 · 2026-10-20

- Drop the Paseo version upper bound. The plugin now requires Paseo 0.11.2 or later instead of `<0.12.0`, so it keeps loading on newer hosts.

## 0.4.14 · 2026-10-19

- Stop replaying the close of dialogs that fade out with a keyframe animation. React Native web modals (e.g. a plugin's settings window) fade themselves out and are removed afterwards; the exit copy then faded the whole window a second time. A host animation that ends transparent on an overlay or its portal wrapper now marks the exit as host-owned.

## 0.4.13 · 2026-10-13

- Stop doubling overlay animations. Popups that Paseo already fades, such as Usage, no longer get a second entrance or exit, and the Command Center no longer replays its entrance while typing. Reused portal surfaces are recognized when they open.

## 0.4.12 · 2026-10-13

- Remove the sidebar footer entry. Open motion settings from Settings → Plugins or the Command Center.

## 0.4.11 · 2026-10-13

- Restore elastic scrolling in hover-previewed sidebars. The preview suppresses layout captures, but no longer disables rebound for its own lists.

## 0.4.10 · 2026-10-12

- Animate sidebars toggled with Cmd/Ctrl+B and Cmd/Ctrl+E. The host commits the toggle before later keydown listeners run, so take the sidebar baseline when Cmd/Ctrl goes down, reuse the last commit for repeated shortcuts and poll for the layout commit.
- Fix hover previews staying open after the pointer enters a sandboxed HTML preview. Clear cross-document coordinates on both frame entry events, handle null relatedTarget via host hit-testing and observe pointerleave on the real sidebar root.
- Keep hover previews outside flex layout until the host dock is hidden/unmounted, then rebase through two layout frames before resuming ordinary motion. Prevent closing previews from triggering a canvas scale animation.
- Use one DOM motion adapter per client window across connected hosts, prefer the newer version and hand ownership over on disconnect. Share motion preferences across host contributions.
- Add boundary rebound to Markdown file previews using the existing elastic-scroll setting and gesture handling. Keep nested code/detail scrollers under their own control.
- Cover editable and read-only Source views for all text file types, including Markdown, HTML, code and plain text. Translate CodeMirror's complete viewport inside its existing clipped host, keeping content, gutters and selection layers together without changing editor overflow or scroll metrics.
- Reset rebound before pointer/keyboard input and IME composition; ignore wheel input while dragging. Discover editor scroll surfaces when CodeMirror mounts without scanning token/caret updates.

## 0.4.9 · 2026-10-11

- Hover near either window edge to preview a hidden desktop sidebar over the canvas, without consuming its flex layout slot. Leave to restore the closed state.
- Use real host controls and interactive views; mount Explorer only for the preview and retain existing sidebar settings/contents.
- Add an independent edge-preview setting, a 180 ms entry delay, a 260 ms exit grace period and Escape dismissal. Ignore touch, dragging, titlebar edges, dialogs and already-open sidebars.
- Preserve interaction with portal menus and focused inputs. Close previews on blur, resize, disabling or unload. Regular toggles/shortcuts can still open the normal layout dock.
- Keep the preview under one motion owner, rebase underlying motion captures and respect Reduce Motion.
- Receive edge hover above sandboxed HTML previews with transparent 7 px window gutters. Distinguish nested-frame focus from window blur, and close a preview when the cursor returns to frame content.

## 0.4.8 · 2026-10-11

- Restrict interaction snapshots to actionable controls and supported chrome shortcuts. Text selection, caret placement, ordinary editable Enter/Space, editor/terminal shortcuts and IME composition do not capture global layouts.
- Ignore editor/terminal internal DOM updates in the ambient observer; preserve host-owned focus, selection and keyboard handling.
- Pause scans and motion on window blur or document hiding. Cancel pending frames/timers, restore elastic styles and release detached baseline copies. Rebase once on return without replaying background changes.
- Capture each committed file-tree layout once, reuse it before applying FLIP transforms, and cap deep-copied visible rows at 120.

## 0.4.7 · 2026-10-11

- Allow deliberate same-direction pulls at an existing top/bottom boundary before the previous wheel tail has fully expired.
- Distinguish sustained renewed pressure and spaced/discrete wheel impulses from isolated momentum fluctuations; retain confirming input and resume from the visible offset.
- Adapt the release gap to observed event cadence (40–120 ms), so sparse wheel input does not prematurely start the return. Momentum release still bypasses this hold.

## 0.4.6 · 2026-10-11

- Latch wheel release for the entire gesture: momentum fluctuations and short tail gaps cannot repeatedly restart the rebound. A quiet gap or direction change starts a new gesture.
- Allow one edge collision during a fling, then keep the return independent of its remaining wheel events. Cancelling feedback on content/layout changes also closes that gesture.
- Coalesce ambient work by surface. Chat streaming refreshes tool/message state without cloning workspace/project snapshots or measuring pane/tab layouts.
- Ignore adapter-owned elastic style writes and ghost-only mutations. Rebase workspace/tab/message snapshots after a wheel burst instead of on every wheel event.

## 0.4.5 · 2026-10-11

- Make elastic pull respond directly to input, removing spring-follow lag and the 80 ms release hold.
- Use viewport-dependent rubber-band resistance and a faster critically damped return without oscillation.
- Detect sustained decaying wheel input as momentum release; give edge collisions one displacement instead of repeatedly extending the pull.
- Resume input from the current visible offset instead of jumping back to an earlier maximum.
- Use platform overscroll in supported macOS/iOS browsers; document the Electron native-scrollBounce limitation.

## 0.4.4 · 2026-10-11

- Add optional elastic scrolling to agent chat, project/status workspace lists, Files and Changes.
- Bound wheel/trackpad and web touch edge feedback to 42 px, with resistance and a damped spring return. Keep native scrolling/inertia and virtualized row transforms.
- Clip translated descendants inside the unchanged content box; guard scroll metrics and cancel feedback on content growth, real scrolling, interaction, blur, preference changes and unload.
- Prevent native boundary feedback from duplicating the added rebound; restore the original overscroll/translate/clip styles on disable/unload.
- Add an Elastic scrolling setting; respect Reduce Motion and provide a faster spring return in Quick mode.

## 0.4.3 · 2026-10-11

- Move workspace rows smoothly when pinned, unpinned or moved between status groups, preserving their stable identity across remounts.
- Animate project creation/removal and surrounding rows moving into place. Fully visible groups use one animation owner; clipped groups use visible row/header motion.
- Animate section headers appearing/disappearing with list changes, including the Pinned section.
- Continue interrupted list motion from its current position on a new structural commit; exclude initial mount, filter/grouping changes, scrolling and dragging.

## 0.4.2 · 2026-10-11

- Animate workspace row creation and archive removal, including neighboring rows and section headers moving into place.
- Track stable workspace keys across offscreen rows and use scroll-relative positions for project/status sidebar lists.
- Rebase on initial mount, section toggles, scrolling, dragging and active parent/sidebar animations to avoid duplicate row motion.
- Keep project new-workspace buttons separate from section disclosure detection.

## 0.4.1 · 2026-10-11

- Keep maximize/restore under one animation owner throughout the gesture, including hidden-pane commits.
- Avoid measuring active pane/sidebars into the ambient pane layout baseline.
- Animate tab reordering only when key order changes, using positions relative to the tab rail.
- Exclude nested sidebar width owners and child tab motion while a parent is animating.

## 0.4.0 · 2026-10-11

- Keep the plugin limited to animations.
- Remove pane header backgrounds, inactive window colors and opacity, added focus outlines and desktop cursor overrides.
- Remove Desktop feel settings, focus detection and related timers/listeners. Existing animation preferences remain supported.

## 0.3.2 · 2026-10-11

- Remove the added composer focus ring and its DOM decoration.
- Prepare the public repository, documentation and typecheck CI.

## 0.3.1 · 2026-10-10

- Remove added tab and pane header underlines.

## 0.3.0 · 2026-10-10

- Add a separate Desktop feel preference for pane focus, window activity and desktop cursors.

## 0.2.0 · 2026-10-10

- Add tab, pane split/close, overlay, button, status and new-message motion.
- Handle asynchronous commits, drag/scroll interruption and virtualized message history.

## 0.1.1 · 2026-10-10

- Correct left and Explorer sidebar width-owner detection.
- Add pane maximize/restore motion.

## 0.1.0 · 2026-10-10

- Initial sidebar, file-tree, tool-call and thinking motion with per-category settings.
