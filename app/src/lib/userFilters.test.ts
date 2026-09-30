import { describe, expect, it } from 'vitest'
import { countFilterLines, ignoredLineSummary, lineCountLabel, lineSelectionRange, validateFilterText } from './userFilters'
describe('user filter helpers', () => {
  it('accepts network rules, cosmetic filters, and comments', () => {
    expect(validateFilterText('! my rules\n\n||ads.example.com^$third-party\nexample.com##.banner\n@@||example.com^$document\n')).toEqual([])
  })
  it('reports unusable lines with 1-based numbers', () => {
    expect(validateFilterText('||good.example^\n##\nexample.com##.ok\nnot a rule\n')).toEqual([
      { line: 2, message: 'not a network or cosmetic rule' },
      { line: 4, message: 'not a network or cosmetic rule' },
    ])
  })
  it('rejects oversized text as a whole-text issue', () => { expect(validateFilterText('||a.example^'.repeat(60_000))[0]!.line).toBe(0) })
  it('selects the requested line and clamps out-of-range lines', () => {
    const text = '||a.example^\nexample.com##.banner\n||b.example^\n'
    expect(lineSelectionRange(text, 1)).toEqual({ start: 0, end: 12 })
    expect(lineSelectionRange(text, 2)).toEqual({ start: 13, end: 33 })
    expect(lineSelectionRange(text, 4)).toEqual({ start: 47, end: 47 })
    expect(lineSelectionRange(text, 9)).toEqual({ start: 47, end: 47 })
    expect(lineSelectionRange(text, 0)).toEqual({ start: 0, end: text.length })
  })
  it('counts lines for the editor counter', () => { expect(countFilterLines('')).toBe(0); expect(countFilterLines('||a^')).toBe(1); expect(countFilterLines('a\nb\n')).toBe(3) })
  it('pluralises the save summary', () => { expect(ignoredLineSummary(0)).toBe('0 lines ignored'); expect(ignoredLineSummary(1)).toBe('1 line ignored'); expect(lineCountLabel(3)).toBe('3 lines') })
})
