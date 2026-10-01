# Apple's Human Interface Guidelines, applied

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

* Status is shown where it belongs: loading as a hairline along the address pill, blocked trackers in the pill, zoom as a badge, the link under the pointer in the pill, downloads as a toast with *Show in folder*.
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
