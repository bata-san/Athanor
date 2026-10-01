export function normalizeShortcut(input: string): string {
  const aliases: Record<string, string> = { CONTROL: 'Ctrl', CTRL: 'Ctrl', CMD: 'Meta', COMMAND: 'Meta', OPTION: 'Alt', ESC: 'Escape', LEFT: 'Left', RIGHT: 'Right', UP: 'Up', DOWN: 'Down', ARROWLEFT: 'Left', ARROWRIGHT: 'Right', ARROWUP: 'Up', ARROWDOWN: 'Down', ' ': 'Space' }
  const modifierAliases: Record<string, string> = { SHIFT: 'Shift', ALT: 'Alt', META: 'Meta', CONTROL: 'Ctrl', CTRL: 'Ctrl' }
  const parts = input.split('+').map((part) => {
    const value = part.trim(), upper = value.toUpperCase()
    return aliases[upper] ?? modifierAliases[upper] ?? (value.length === 1 ? value.toUpperCase() : value)
  })
  const order = ['Ctrl', 'Alt', 'Shift', 'Meta']
  const modifiers = order.filter((key) => parts.includes(key))
  const key = parts.find((part) => !order.includes(part)) ?? ''
  return [...modifiers, key].filter(Boolean).join('+')
}

/** Physical keys whose character changes with Shift or the layout; the combo is built from the key's position instead. */
const CODE_KEYS: Record<string, string> = { Equal: '=', NumpadAdd: '=', Minus: '-', NumpadSubtract: '-', Digit0: '0', Numpad0: '0', Comma: ',', Slash: '/' }
/** Keys that are shortcuts without any modifier. */
const BARE_KEYS = new Set(['F3', 'F5', 'F11', 'F12'])

export function shortcutFromKeyboard(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'> & { code?: string }): string | null {
  const byCode = event.ctrlKey && !event.altKey ? CODE_KEYS[event.code ?? ''] : undefined
  const key = byCode ?? (event.key === ' ' ? 'Space' : event.key.length === 1 ? event.key.toUpperCase() : event.key)
  if (!event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey && !BARE_KEYS.has(key)) return null
  // Shift only produces the character ("+" for "="), it is not part of these combos.
  const shift = event.shiftKey && !(byCode === '=' )
  return normalizeShortcut([event.ctrlKey ? 'Ctrl' : '', event.altKey ? 'Alt' : '', shift ? 'Shift' : '', event.metaKey ? 'Meta' : '', key].filter(Boolean).join('+'))
}

/** Other spellings of the same action, folded to the combo the app uses. */
const ALIASES: Record<string, string> = {
  'Ctrl+R': 'F5', 'Ctrl+F5': 'Ctrl+Shift+R', 'F3': 'Ctrl+G', 'Shift+F3': 'Ctrl+Shift+G',
  'Ctrl+PageDown': 'Ctrl+Tab', 'Ctrl+PageUp': 'Ctrl+Shift+Tab',
  'Ctrl+Shift+}': 'Ctrl+Tab', 'Ctrl+Shift+{': 'Ctrl+Shift+Tab', 'Ctrl+Shift+]': 'Ctrl+Tab', 'Ctrl+Shift+[': 'Ctrl+Shift+Tab',
  'Ctrl+Shift+F5': 'Ctrl+Shift+R',
}
export const canonicalShortcut = (combo: string): string => ALIASES[combo] ?? combo

export type ShortcutGroup = 'Tabs' | 'Page' | 'Navigation' | 'Window'
/** `shell` combos are handled by the React shell; `backend` ones by the Rust side (the shell forwards them). */
export interface ShortcutDef { combo: string; label: string; group: ShortcutGroup; owner: 'shell' | 'backend' }

/** The single list of keyboard shortcuts: drives the key handlers, the cheat sheet (Ctrl+/) and Settings. */
export const SHORTCUTS: readonly ShortcutDef[] = [
  { combo: 'Ctrl+T', label: 'New tab', group: 'Tabs', owner: 'shell' },
  { combo: 'Ctrl+W', label: 'Close tab', group: 'Tabs', owner: 'backend' },
  { combo: 'Ctrl+Shift+T', label: 'Reopen closed tab', group: 'Tabs', owner: 'backend' },
  { combo: 'Ctrl+Tab', label: 'Next tab', group: 'Tabs', owner: 'backend' },
  { combo: 'Ctrl+Shift+Tab', label: 'Previous tab', group: 'Tabs', owner: 'backend' },
  { combo: 'Ctrl+1', label: 'Go to tab 1–8 (Ctrl+9: last tab)', group: 'Tabs', owner: 'backend' },
  { combo: 'Ctrl+D', label: 'Pin or unpin tab', group: 'Tabs', owner: 'shell' },
  { combo: 'Ctrl+\\', label: 'Split with next tab', group: 'Tabs', owner: 'backend' },
  { combo: 'Ctrl+L', label: 'Open location', group: 'Navigation', owner: 'shell' },
  { combo: 'Ctrl+K', label: 'Command bar', group: 'Navigation', owner: 'shell' },
  { combo: 'Alt+Left', label: 'Back', group: 'Navigation', owner: 'backend' },
  { combo: 'Alt+Right', label: 'Forward', group: 'Navigation', owner: 'backend' },
  { combo: 'F5', label: 'Reload (Ctrl+R)', group: 'Navigation', owner: 'backend' },
  { combo: 'Ctrl+Shift+R', label: 'Reload without cache', group: 'Navigation', owner: 'backend' },
  { combo: 'Ctrl+F', label: 'Find in page', group: 'Page', owner: 'shell' },
  { combo: 'Ctrl+G', label: 'Find next (F3)', group: 'Page', owner: 'shell' },
  { combo: 'Ctrl+Shift+G', label: 'Find previous (Shift+F3)', group: 'Page', owner: 'shell' },
  { combo: 'Ctrl+=', label: 'Zoom in', group: 'Page', owner: 'backend' },
  { combo: 'Ctrl+-', label: 'Zoom out', group: 'Page', owner: 'backend' },
  { combo: 'Ctrl+0', label: 'Actual size', group: 'Page', owner: 'backend' },
  { combo: 'Ctrl+P', label: 'Print', group: 'Page', owner: 'backend' },
  { combo: 'F12', label: 'Page inspector', group: 'Page', owner: 'backend' },
  { combo: 'Ctrl+Shift+D', label: 'Developer panel', group: 'Page', owner: 'shell' },
  { combo: 'Ctrl+B', label: 'Show or hide sidebar', group: 'Window', owner: 'shell' },
  { combo: 'F11', label: 'Full screen', group: 'Window', owner: 'backend' },
  { combo: 'Ctrl+,', label: 'Settings', group: 'Window', owner: 'shell' },
  { combo: 'Ctrl+/', label: 'Keyboard shortcuts', group: 'Window', owner: 'shell' },
]

const ownerOf = new Map<string, 'shell' | 'backend'>(SHORTCUTS.map((item) => [item.combo, item.owner]))
for (let n = 2; n <= 9; n++) ownerOf.set(`Ctrl+${n}`, 'backend')
/** Who handles `combo`, or `null` when it is not an Athanor shortcut (the page / text field keeps it). */
export const shortcutOwner = (combo: string): 'shell' | 'backend' | null => ownerOf.get(combo) ?? null

/** Show a combo the way people read it: `Ctrl+Shift+T` -> ['Ctrl', 'Shift', 'T']. */
export const comboKeys = (combo: string): string[] => combo === 'Ctrl++' ? ['Ctrl', '+'] : combo.split('+').filter(Boolean).map((key) => ({ Left: '←', Right: '→', '=': '+' } as Record<string, string>)[key] ?? key)
