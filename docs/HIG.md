# Apple's Human Interface Guidelines, applied

## Navigation hang correction (2026-10-05, v0.1.19)

The official [progress indicators guidance](https://developer.apple.com/design/human-interface-guidelines/progress-indicators)
was read again: activity indicators describe ongoing work and disappear when it ends. Native navigation
completion now clears loading before recovery navigation and independently of history-state queries.
The existing shadcn appearance and indicator location are unchanged.

The document-request deferral introduced in v0.1.18 had no deadline and could leave navigation waiting
for asynchronous script registration. It has been removed, together with script-registration navigation
cancellation/replay. Scripts register without holding requests; ContentLoading remains a fallback.
Script-ID locks are released before native COM removal calls to avoid callback reentrancy deadlocks.
This supersedes the request-holding approach described below. Compilation and static analysis do not
establish that Google or signed-in YouTube works in the affected running profile; runtime observation
remains outstanding, including the timing of early YouTube protection.

## YouTube preroll correction (2026-10-05)

The existing playback and shadcn interface remain unchanged. Protection must be ready before the
player consumes its first response, including link-click navigation. Windows now holds the original
document request while registering its scripts instead of replaying a click or POST as GET. A content
event fallback covers paths without a native request event. The YouTube handler also covers XHR JSON,
response text, response arrays and inline player configuration, retaining existing accessors and video
state. Syntax checks, compilation and static analysis do not establish that real-site ads are absent;
that outcome still needs observation for the affected account and video.

## Reliability review (2026-10-05)

The [progress guidance](https://developer.apple.com/design/human-interface-guidelines/progress-indicators?changes=_4_6)
informs the persistent toolbar transfer indicator: report a percentage only when the total is known;
otherwise show an indeterminate indicator with received bytes. Keep the same location through progress,
pause and interruption, with explicit actions. Import no longer claims fictional processing stages based on a timer.

The [notification guidance](https://developer.apple.com/design/human-interface-guidelines/notifications?changes=_4)
informs brief contextual messages with meaningful recovery actions. Transfers update the toolbar rather than
creating a toast for every progress event. On Windows a transparent native child view solves the stacking
problem between DOM notifications and native page webviews. Notifications can also be read in a session history.

The [Touch Bar's contextual controls](https://developer.apple.com/documentation/appkit/nstouchbar)
inform the toolbar behavior: selected-page media controls and active-transfer controls appear when relevant.
Navigation, the address field, split view and overview retain their established positions and shadcn primitives.
Playback changes only in response to a user's action. Protection never seeks, speeds up or mutes the shared
YouTube video element to skip an ad. Full runtime validation of this revision remains outstanding.

---

Athanor is not a clone of an Apple app, but it borrows Apple's habits of care. This page records which guidance from the
[Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines) we followed and where it lives
in the code, so later changes keep the spirit. (Pages read: Motion, Accessibility, Feedback, Loading, Menus, Context menus,
Toolbars, Sidebars, Buttons, Layout, Materials, Color, Typography, Windows, Search fields.)

## Motion

| Guidance | What Athanor does |
| --- | --- |
| Add motion purposefully; avoid motion for frequent interactions | Frequent actions are short fades with a hint of scale (tab rows 160 ms, page change 160 ms with 4 px of travel, menus 130 ms at 97 %). Nothing overshoots. Springs (`lib/motion.ts`) are used only where something is physically moved (the active-tab pill, list reordering, the sidebar). |
| Make motion optional | Settings -> Appearance -> **Reduce motion**, and the system setting. Both turn transitions into instant state changes (`:root[data-reduce-motion]`, `MotionConfig reducedMotion`). Meaning is never carried by motion alone: progress, errors and states also have text or icons. |
| Feedback follows the gesture | Menus and popovers grow out of the point they were opened from; the find bar slides down from the toolbar and goes back up; drag shows the drop line where the tab will land. |
| Let people cancel motion | No animation gates input: dialogs close at once, menus can be dismissed mid-animation, drags start after 6 px. |
| Always give a press state | Every button squeezes to 97 % while pressed (`styles/tokens.css`, base layer). |

## Accessibility

* **Larger text up to 200 %**: Settings -> Appearance -> **Interface size** (100-200 %, steps of 5). The whole shell is sized in `rem`, and the root font size is `15px * --ath-ui-scale`; theme-defined pixel sizes (tab height, sidebar width) are multiplied by the same variable. Web pages keep their own zoom.
* **Contrast**: secondary text is at least 4.5:1 on every surface (light `#666670` on the sidebar is 5.2:1). **Increase contrast** (and the system's *Increase Contrast*) raises secondary text to 7:1 and control edges to 3:1 in both appearances.
* **Minimum text**: nothing smaller than 11 px (0.733 rem); light font weights are not used.
* **Not colour alone**: states have icons or text (a muted tab shows a speaker, a tab without hardware acceleration shows an off-bolt, an unreachable page says so).
* **Labels**: every icon button has an `aria-label` and a tooltip with its shortcut; dialogs have titles and descriptions; the find result is announced (`aria-live`).
* **Keyboard**: everything has a shortcut (`Ctrl+/` lists them); focus rings are visible.

## Feedback

* Status is shown where it belongs: loading as a hairline along the address pill, blocked trackers in the pill, zoom as a badge, and the link under the pointer in the pill. Active downloads show their filename, received bytes or percentage, progress, and pause/resume control in the toolbar. Clicking this activity opens Downloads (`Ctrl+J`), including interrupted transfers and recovery actions.
* **Undo instead of confirm** for cheap, reversible things: closing a tab (or several) shows *Closed "title" - Undo* for 7 s. Confirmations are kept for deleting a folder, a space or a board.
* Alerts are for things that need an answer: page dialogs and permission requests.
* When a command cannot run, say why: *Find isn't available on Athanor pages*, *Open another tab to use Split View*.

## Menus and context menus

* Few items, grouped (no more than three groups), the most used first, the command that ends something last.
* **Unavailable items are hidden, not dimmed** (only the clipboard commands may sit dimmed in the page menu).
* **No keyboard shortcuts in context menus**; they are shown in the More menu, the tooltips and the shortcut sheet.
* One level of submenu at most; the title says what is inside (*Move to...*).
* Title-style capitalisation, no articles (*Open Link in New Tab*), an ellipsis when more input is needed (*Rename...*, *New Folder...*), toggled items state the action (*Hide Sidebar* / *Show Sidebar*, *Turn Off Hardware Acceleration*).
* Everything in a context menu is also in the main interface (the tab menu's commands are in the More menu, shortcuts and command bar).

## Toolbars, sidebars, buttons

* The toolbar holds navigation, the address, and a few actions; the rest lives in a More menu. Icons without borders; tooltips name them.
* The sidebar is at most two levels deep (folders), can be hidden (`Ctrl+B`) but is shown by default so it stays discoverable, and is rearranged by dragging.
* One prominent button per dialog, on the trailing side; the same-size buttons differ by style, not size.

## Search

The address pill opens a command bar that searches as you type, shows recent pages before you type, and lets an address, a search, an open tab or a command be chosen from one list.

## Per-tab hardware acceleration

Tab menu -> *Turn Off Hardware Acceleration*. WebView2 decides GPU use per browser process, so a tab without the GPU runs in a second browser process with its own profile folder (`EBWebView-software`) and `--disable-gpu`. The tab is recreated at its address and the cookies that apply to it are copied across, so it stays signed in; its history and unsaved page state are not kept. A tab with it off shows an off-bolt in the sidebar. The choice is saved with the session.

## Manual filing review (October 2026)

The DocC JSON pages were consulted before changing the shell. [Toolbars](https://developer.apple.com/tutorials/data/design/human-interface-guidelines/toolbars.json) says to prioritize actions that support the main task, use a recognizable symbol, and explain an icon's meaning. The File control uses a folder arrow, an accessible name, and a tooltip with its shortcut. [Tab bars](https://developer.apple.com/tutorials/data/design/human-interface-guidelines/tab-bars.json) reserves tabs for navigation; filing is therefore a toolbar action. [Menus](https://developer.apple.com/tutorials/data/design/human-interface-guidelines/menus.json) informs the matching command bar and sidebar context entry. [Buttons](https://developer.apple.com/tutorials/data/design/human-interface-guidelines/buttons.json) informs the short action label.

[Accessibility](https://developer.apple.com/tutorials/data/design/human-interface-guidelines/accessibility.json) calls for familiar and consistent interactions with more than one input method. The same command is available by icon, command bar, Settings, sidebar menu, and `Ctrl+Shift+F`; the result is spelled out in a toast. The [Motion](https://developer.apple.com/tutorials/data/design/human-interface-guidelines/motion.json) guidance informed the existing short enter and exit timing, including Reduce Motion. [Color](https://developer.apple.com/tutorials/data/design/human-interface-guidelines/color.json) informed the monochrome toolbar treatment in both appearances.

The [Accessibility](https://developer.apple.com/tutorials/data/design/human-interface-guidelines/accessibility.json) and [Layout](https://developer.apple.com/tutorials/data/design/human-interface-guidelines/layout.json) guidance also informed the tab-close control that remains reachable by Tab, wrapping headers on narrow pages, and a simpler start-page empty state. The less-used toolbar actions move into More at narrow window widths. Destructive controls use a neutral monochrome tone, with their text and icon continuing to state the action.

The requested [sidebars](https://developer.apple.com/tutorials/data/design/human-interface-guidelines/sidebars.json), [undo and redo](https://developer.apple.com/tutorials/data/design/human-interface-guidelines/undo-and-redo.json), [feedback](https://developer.apple.com/tutorials/data/design/human-interface-guidelines/feedback.json), [search fields](https://developer.apple.com/tutorials/data/design/human-interface-guidelines/search-fields.json), [keyboards](https://developer.apple.com/tutorials/data/design/human-interface-guidelines/keyboards.json), [file management](https://developer.apple.com/tutorials/data/design/human-interface-guidelines/file-management.json), and [organizing](https://developer.apple.com/tutorials/data/design/human-interface-guidelines/organizing.json) DocC routes were attempted; they did not return readable JSON in the available browser tool. For these areas, the established notes above and the readable toolbar, menu, and accessibility guidance supplied the design basis. Filing is reversible from a seven-second toast, with a short result message and no confirmation dialog.

## Continuation review (October 2026)

Before the final shell pass, the DocC JSON routes for [Toolbars](https://developer.apple.com/tutorials/data/design/human-interface-guidelines/toolbars.json), [Motion](https://developer.apple.com/tutorials/data/design/human-interface-guidelines/motion.json), [Accessibility](https://developer.apple.com/tutorials/data/design/human-interface-guidelines/accessibility.json), [Layout](https://developer.apple.com/tutorials/data/design/human-interface-guidelines/layout.json), and [Color](https://developer.apple.com/tutorials/data/design/human-interface-guidelines/color.json) were read again. Toolbars recommends a clear primary action, recognizable icons, and overflow at narrow widths. Motion recommends brief, purposeful feedback that can be reduced. Accessibility and layout call for usable controls at varied input methods and widths; color supports a quiet monochromatic chrome. The Sidebars, Feedback, and Undo and Redo JSON routes were retried but were inaccessible through the available browser tool.

This review also found two inconsistencies to correct: legacy colored folder and space accents were still rendered despite the monochrome shell, and the welcome copy still promised automatic filing. A no-op File press must leave the prior Undo available while its toast remains visible.

## Address-bar activity hub (October 2026)

The DocC JSON for [Toolbars](https://developer.apple.com/tutorials/data/design/human-interface-guidelines/toolbars.json) was read before this change. It asks for a limited set of items, grouped by purpose, with the less important ones moved into a More menu as the window narrows. The address pill stays the single primary element. Page audio and media controls and download progress used to sit in separate boxes on either side of it; they now share one capsule directly beside the address, shown only while there is something to act on, so the top bar does not gain new permanent items. The same page actions (play or pause media, mute the page) lead the More menu, so a narrow window still reaches them. The progress for a download with an unknown total stays indeterminate and shows received bytes, following [Progress indicators](https://developer.apple.com/tutorials/data/design/human-interface-guidelines/progress-indicators.json).

Verification: TypeScript build and the unit test suite pass. The layout was checked in the browser preview with the mock backend at 1280 px wide, where the address keeps its host and path next to the capsule; a runtime check inside the Windows WebView2 build has not been done.

## WebView2 limits on shell styling

Tab pages are native WebView2 surfaces stacked above the shell. Any shell popup over a page area therefore freezes the page into a screenshot and hides the native view (see `lib/overlay.ts`). Styling a page's own scrollbars, selection, or native dialogs is outside the shell's reach; those stay with the engine. Shell-owned surfaces (menus, dialogs, permission prompts, the page context menu) are already drawn by Athanor.

## Softer, rounder chrome (October 2026)

The DocC JSON for [Motion](https://developer.apple.com/tutorials/data/design/human-interface-guidelines/motion.json), [Materials](https://developer.apple.com/tutorials/data/design/human-interface-guidelines/materials.json), and [Layout](https://developer.apple.com/tutorials/data/design/human-interface-guidelines/layout.json) was read before this change. Motion asks for brief, precise feedback that never makes people wait, and for motion to explain what changed. Materials ask for translucency on controls that float above content, so the content stays visible behind them. Layout asks for corners that nest with their container.

Applied: the base corner radius moved from 0.5rem to 0.625rem, so the page card, popups and the address field take a rounder shape while small controls keep their proportions. The address field and activity capsule are full pills. Menus, popovers and dialogs use a slightly translucent surface with a background blur, and a softer layered shadow with a hairline edge. Popups open from scale 0.94 on the spring curve; dialogs settle in from slightly lower; page switches use the same spring for a little longer. Every motion stays under the existing Reduce Motion rules in `styles/app.css`.

Kept on purpose: the shadcn components, the monochrome palette, and the IBM Plex typeface. Apple's Liquid Glass refraction and the SF system font are not reproduced, since the material is tied to Apple's own renderer and SF is not available on Windows.

Verification: the TypeScript build and the 42 unit tests pass. The result was viewed in the browser preview with the mock backend, in light appearance. Dark appearance and the real WebView2 build have not been checked, and the translucency depends on WebView2 supporting backdrop blur.
