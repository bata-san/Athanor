import { describe, expect, it } from 'vitest'
import { SHORTCUTS, canonicalShortcut, comboKeys, displayShortcut, normalizeShortcut, shortcutFromKeyboard, shortcutOwner } from './shortcuts'
describe('shortcut normalization', () => {
  it('normalizes modifier order and aliases', () => { expect(normalizeShortcut('shift+control+k')).toBe('Ctrl+Shift+K'); expect(normalizeShortcut('ALT+LEFT')).toBe('Alt+Left') })
  it('builds stable combos from DOM keyboard events', () => { expect(shortcutFromKeyboard({ key: 'Tab', ctrlKey: true, altKey: false, shiftKey: true, metaKey: false })).toBe('Ctrl+Shift+Tab'); expect(shortcutFromKeyboard({ key: 'k', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false })).toBe('Ctrl+K') })
})

describe('macOS shortcuts', () => {
  const macKey = (init: Partial<KeyboardEvent> & { key: string }) => shortcutFromKeyboard({ ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...init }, true)
  it('uses Command for browser actions and preserves system combinations', () => {
    expect(macKey({ key: 'l', metaKey: true })).toBe('Ctrl+L')
    expect(macKey({ key: '+', code: 'Equal', metaKey: true, shiftKey: true })).toBe('Ctrl+=')
    expect(macKey({ key: 'Tab', metaKey: true })).toBeNull()
    expect(macKey({ key: ' ', metaKey: true })).toBeNull()
    expect(macKey({ key: 'f', ctrlKey: true })).toBeNull()
    expect(macKey({ key: 'Tab', ctrlKey: true })).toBe('Ctrl+Tab')
  })
  it('supports browser navigation and the standard inspector/full-screen keys', () => {
    expect(macKey({ key: '[', code: 'BracketLeft', metaKey: true })).toBe('Alt+Left')
    expect(macKey({ key: ']', code: 'BracketRight', metaKey: true })).toBe('Alt+Right')
    expect(macKey({ key: '|', code: 'Backslash', metaKey: true, shiftKey: true })).toBe('Ctrl+Space')
    expect(macKey({ key: 'f', ctrlKey: true, metaKey: true })).toBe('F11')
    expect(macKey({ key: 'i', altKey: true, metaKey: true })).toBe('F12')
  })
  it('handles native DOM events whose key properties are not enumerable', () => {
    const event = new KeyboardEvent('keydown', { key: 'l', metaKey: true })
    expect(shortcutFromKeyboard(event, true)).toBe('Ctrl+L')
  })
  it('displays the actual Mac equivalents, including Control-Tab', () => {
    expect(displayShortcut('Ctrl+T', true)).toBe('Cmd+T')
    expect(comboKeys('Ctrl+Tab', true)).toEqual(['Ctrl', 'Tab'])
    expect(comboKeys('F11', true)).toEqual(['Ctrl', 'Cmd', 'F'])
    expect(displayShortcut('Alt+Left', true)).toBe('Cmd+[')
    expect(displayShortcut('Ctrl+T', false)).toBe('Ctrl+T')
  })
})
const key = (init: Partial<KeyboardEvent> & { key: string }) => shortcutFromKeyboard({ ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...init })
describe('shortcut registry', () => {
  it('reads zoom keys by position, whatever Shift or the layout does to the character', () => {
    expect(key({ key: '+', code: 'Equal', ctrlKey: true, shiftKey: true })).toBe('Ctrl+=')
    expect(key({ key: '=', code: 'Equal', ctrlKey: true })).toBe('Ctrl+=')
    expect(key({ key: '-', code: 'Minus', ctrlKey: true })).toBe('Ctrl+-')
    expect(key({ key: '0', code: 'Digit0', ctrlKey: true })).toBe('Ctrl+0')
    expect(key({ key: '/', code: 'Slash', ctrlKey: true })).toBe('Ctrl+/')
    expect(key({ key: ',', code: 'Comma', ctrlKey: true })).toBe('Ctrl+,')
  })
  it('knows bare function keys and ignores plain typing', () => {
    expect(key({ key: 'F3' })).toBe('F3')
    expect(key({ key: 'F11' })).toBe('F11')
    expect(key({ key: 'a' })).toBeNull()
  })
  it('folds alternative spellings onto one action', () => {
    expect(canonicalShortcut('Ctrl+R')).toBe('F5')
    expect(canonicalShortcut('F3')).toBe('Ctrl+G')
    expect(canonicalShortcut('Shift+F3')).toBe('Ctrl+Shift+G')
    expect(canonicalShortcut('Ctrl+PageDown')).toBe('Ctrl+Tab')
    expect(canonicalShortcut('Ctrl+Shift+F5')).toBe('Ctrl+Shift+R')
  })
  it('says who handles each combo', () => {
    expect(shortcutOwner('Ctrl+F')).toBe('shell')
    expect(shortcutOwner('Ctrl+Shift+T')).toBe('backend')
    expect(shortcutOwner('Ctrl+7')).toBe('backend')
    expect(shortcutOwner('Ctrl+Q')).toBeNull()
  })
  it('lists every combo once', () => {
    const combos = SHORTCUTS.map((item) => item.combo)
    expect(new Set(combos).size).toBe(combos.length)
  })
  it('spells combos for display', () => {
    expect(comboKeys('Ctrl+Shift+T')).toEqual(['Ctrl', 'Shift', 'T'])
    expect(comboKeys('Ctrl+=')).toEqual(['Ctrl', '+'])
    expect(comboKeys('Alt+Left')).toEqual(['Alt', '←'])
  })
})
