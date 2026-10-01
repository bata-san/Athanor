/**
 * Applies the host-generated theme CSS and keeps `data-theme-dark` in step with the theme's real
 * `color-scheme`, so the shadcn tokens, the toaster and native widgets all agree with it.
 */
export function applyShellCss(css: string, fallbackDark = false) {
  let style = document.getElementById('athanor-shell-css') as HTMLStyleElement | null
  if (!style) { style = document.createElement('style'); style.id = 'athanor-shell-css'; document.head.append(style) }
  style.textContent = css
  const root = document.documentElement
  // The theme CSS declares `color-scheme: dark|light` on :root; with the attribute removed the computed value is its own.
  root.removeAttribute('data-theme-dark')
  const dark = css.trim() ? getComputedStyle(root).colorScheme.trim() === 'dark' : fallbackDark
  root.dataset.themeDark = String(dark)
}

export function isDarkTheme() { return document.documentElement.dataset.themeDark === 'true' }
