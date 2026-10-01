import { describe, expect, it } from 'vitest'
import { nextIndex } from './gridNav'

describe('nextIndex', () => {
  it('walks one card sideways and stops at the ends (nothing wraps)', () => {
    expect(nextIndex(0, 6, 3, 'ArrowRight')).toBe(1)
    expect(nextIndex(2, 6, 3, 'ArrowRight')).toBe(3)
    expect(nextIndex(1, 6, 3, 'ArrowLeft')).toBe(0)
    expect(nextIndex(0, 6, 3, 'ArrowLeft')).toBe(0)
    expect(nextIndex(5, 6, 3, 'ArrowRight')).toBe(5)
  })

  it('walks a whole row up and down', () => {
    expect(nextIndex(0, 6, 3, 'ArrowDown')).toBe(3)
    expect(nextIndex(4, 6, 3, 'ArrowDown')).toBe(5)
    expect(nextIndex(3, 6, 3, 'ArrowUp')).toBe(0)
    expect(nextIndex(5, 6, 3, 'ArrowUp')).toBe(2)
  })

  it('lands on the last card at the end of a partly filled row', () => {
    // Five cards, three columns: the second row holds two, so down from the first of them stays put.
    expect(nextIndex(3, 5, 3, 'ArrowDown')).toBe(4)
    expect(nextIndex(4, 5, 3, 'ArrowDown')).toBe(4)
    expect(nextIndex(4, 5, 3, 'ArrowUp')).toBe(1)
  })

  it('goes to the first and last card with Home and End', () => {
    expect(nextIndex(3, 7, 2, 'Home')).toBe(0)
    expect(nextIndex(3, 7, 2, 'End')).toBe(6)
  })

  it('starts at the first card when nothing is focused yet', () => {
    expect(nextIndex(-1, 4, 2, 'ArrowDown')).toBe(0)
    expect(nextIndex(-1, 4, 2, 'ArrowRight')).toBe(0)
    expect(nextIndex(-1, 4, 2, 'ArrowUp')).toBe(0)
    expect(nextIndex(-1, 4, 2, 'End')).toBe(3)
  })

  it('treats a missing or silly column count as a single column', () => {
    expect(nextIndex(1, 3, 0, 'ArrowDown')).toBe(2)
    expect(nextIndex(1, 3, -4, 'ArrowDown')).toBe(2)
    expect(nextIndex(1, 3, Number.NaN, 'ArrowDown')).toBe(2)
  })

  it('reports nothing to move to when the grid is empty', () => {
    expect(nextIndex(0, 0, 3, 'ArrowRight')).toBe(-1)
    expect(nextIndex(0, 0, 3, 'End')).toBe(-1)
  })

  it('leaves the focus alone for keys it does not own', () => {
    expect(nextIndex(2, 6, 3, 'Enter')).toBe(2)
    expect(nextIndex(2, 6, 3, 'Tab')).toBe(2)
    expect(nextIndex(2, 6, 3, 'a')).toBe(2)
  })

  it('starts from the beginning when the remembered index has gone stale', () => {
    expect(nextIndex(9, 6, 3, 'ArrowRight')).toBe(0)
    expect(nextIndex(Number.NaN, 6, 3, 'ArrowRight')).toBe(0)
  })
})