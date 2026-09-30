import { describe, expect, it } from 'vitest'
import { normalizeShortcut, shortcutFromKeyboard } from './shortcuts'
describe('shortcut normalization', () => {
  it('normalizes modifier order and aliases', () => { expect(normalizeShortcut('shift+control+k')).toBe('Ctrl+Shift+K'); expect(normalizeShortcut('ALT+LEFT')).toBe('Alt+Left') })
  it('builds stable combos from DOM keyboard events', () => { expect(shortcutFromKeyboard({ key: 'Tab', ctrlKey: true, altKey: false, shiftKey: true, metaKey: false })).toBe('Ctrl+Shift+Tab'); expect(shortcutFromKeyboard({ key: 'k', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false })).toBe('Ctrl+K') })
})
