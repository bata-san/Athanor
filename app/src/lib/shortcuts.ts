export function normalizeShortcut(input: string): string {
  const aliases: Record<string, string> = { CONTROL: 'Ctrl', CTRL: 'Ctrl', CMD: 'Meta', COMMAND: 'Meta', OPTION: 'Alt', ESC: 'Escape', 'ARROWLEFT': 'Left', 'ARROWRIGHT': 'Right', 'ARROWUP': 'Up', 'ARROWDOWN': 'Down', ' ': 'Space' }
  const parts = input.split('+').map((part) => {
    const value = part.trim(), upper = value.toUpperCase()
    return aliases[upper] ?? ({ SHIFT: 'Shift', ALT: 'Alt', META: 'Meta', CONTROL: 'Ctrl', CTRL: 'Ctrl' }[upper] ?? (value.length === 1 ? value.toUpperCase() : value))
  })
  const order = ['Ctrl', 'Alt', 'Shift', 'Meta']
  const modifiers = order.filter((key) => parts.includes(key))
  const key = parts.find((part) => !order.includes(part)) ?? ''
  return [...modifiers, key].filter(Boolean).join('+')
}
export function shortcutFromKeyboard(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>): string | null {
  const key = event.key === ' ' ? 'Space' : event.key.length === 1 ? event.key.toUpperCase() : event.key
  if (!event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey && key !== 'F5' && key !== 'F12') return null
  return normalizeShortcut([event.ctrlKey ? 'Ctrl' : '', event.altKey ? 'Alt' : '', event.shiftKey ? 'Shift' : '', event.metaKey ? 'Meta' : '', key].filter(Boolean).join('+'))
}
