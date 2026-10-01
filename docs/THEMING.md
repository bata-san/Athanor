# Athanor shell theming

Themes are JSON files declared under an extension's `contributes.themes`, or one of the bundled `monolith`, `chalk`, `ember`, `paper`, `midnight`, `terminal`, and `mist` themes. Chalk (neutral white, the default) and Monolith (neutral black) are the two baseline themes; both use IBM Plex Sans JP (bundled, OFL) and a 0.75rem radius. The host selects a theme, calls `Theme::to_css()`, and applies the result to the shell. It should also set `data-theme-dark`, `data-side`, and `data-density` on the shell; theme CSS does not depend on those attributes.

Only `id`, `name`, `dark`, and `colors.background`, `colors.foreground`, `colors.primary` are required. Missing colors and options inherit from Monolith for dark themes or Chalk for light themes. Color fields accept CSS color strings such as hex, `hsl()`, and `oklch()`. Interpolated values reject semicolons, braces, comments, `url(`, `@import`, `expression(`, and newlines. The optional raw `css` field is appended after variables; `@import` and `</style` are rejected. Extension source directories are trusted code packages, so review raw CSS before installation.

```json
{
  "id": "my-theme", "name": "My Theme", "dark": true,
  "colors": {"background":"#1b1917","foreground":"#f5eee4","primary":"#e9a857"},
  "radius": "0.6rem",
  "fonts": {"ui":"system-ui, sans-serif","mono":"ui-monospace, monospace"},
  "ui": {"sidebarSide":"right","density":"compact","tabHeight":28,"sidebarWidth":64,"blur":0,"showFavicons":true},
  "css": "[data-part='tab'][data-active='true'] { font-weight: 700; }"
}
```

## CSS variable contract

All color tokens are emitted on `:root` as CSS variables. The complete set is `--background`, `--foreground`, `--card`, `--card-foreground`, `--popover`, `--popover-foreground`, `--primary`, `--primary-foreground`, `--secondary`, `--secondary-foreground`, `--muted`, `--muted-foreground`, `--accent`, `--accent-foreground`, `--destructive`, `--border`, `--input`, `--ring`, `--sidebar`, `--sidebar-foreground`, `--sidebar-accent`, `--sidebar-accent-foreground`, `--sidebar-border`, `--ath-tab-active`, `--ath-tab-hover`, and `--ath-space-accent`.

Layout variables are `--radius`, `--font-ui`, `--font-mono`, `--ath-sidebar-side` (`left` or `right`), `--ath-density` (`compact` or `comfortable`), `--ath-tab-height` (px), `--ath-sidebar-width` (px), `--ath-blur` (px), and `--ath-show-favicons` (`true` or `false`). CSS also sets `color-scheme`. The shell must consume these variables for their corresponding surfaces and controls; this crate only emits the contract.

## Stable shell parts

The React shell should expose these `data-part` values for extension CSS: `shell`, `titlebar`, `sidebar`, `sidebar-header`, `space-switcher`, `space`, `pinned-grid`, `pinned-tab`, `tab-list`, `folder`, `folder-header`, `tab`, `tab-favicon`, `tab-title`, `tab-close`, `new-tab-button`, `omnibox`, `toolbar`, `nav-button`, `content`, `split-divider`, `palette`, `palette-item`, `new-tab-page`, `board`, `board-toolbar`, `dev-panel`, `shield-badge`, `window-controls`, `frozen-page`, `page-context-menu`, `settings`, `extension-panel`.

Expose state attributes where applicable: `data-active`, `data-pinned`, `data-loading`, `data-collapsed`, `data-audible`, `data-archived`, `data-side`, and `data-density`. Boolean attributes should use string values `true` or `false` consistently. Theme authors should target parts and state instead of generated React class names.

For example, a right-hand compact rail can be supplied entirely by a theme's `ui` fields above and this `shell.css`:

```css
[data-part="shell"][data-side="right"] { flex-direction: row-reverse; }
[data-part="sidebar"] { width: var(--ath-sidebar-width); min-width: var(--ath-sidebar-width); }
[data-part="sidebar"][data-density="compact"] [data-part="tab"] {
  height: var(--ath-tab-height);
  padding-inline: 0.35rem;
}
[data-part="sidebar"][data-density="compact"] [data-part="tab-title"] { display: none; }
[data-part="sidebar"][data-density="compact"] [data-part="tab-favicon"] { margin-inline: auto; }
```

The host must map the theme's `ui.sidebarSide` and `ui.density` to those attributes and use the variables for layout. The extension's `shellCss` requires `shell.style` permission.

## Motion and structure

The shell animates with one vocabulary (`app/src/lib/motion.ts`, springs; `app/src/styles/tokens.css`, keyframes and `--ease-snap` / `--ease-spring`). Themes can retune it through CSS: override `--ease-snap`, `--ease-spring`, or set `* { animation-duration: 0s !important }` to disable. `prefers-reduced-motion` is honoured.

The sidebar exposes `data-collapsed="true"` while it is the icon rail; labels carry the `sb-label` class and fold away on that attribute, so a theme can restyle either state with plain selectors. The page area (`data-part="content"`) is a native view: popups hide it and show a captured still (`data-part="frozen-page"`) instead.
