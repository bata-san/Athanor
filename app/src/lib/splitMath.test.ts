import { describe, expect, it } from 'vitest'
import { dividerRatioAt, splitRectangles } from './splitMath'
describe('split divider geometry', () => {
  it('computes a bounded ratio in either direction', () => { expect(dividerRatioAt('row', { x: 506, y: 10 }, { x: 100, y: 10, w: 800, h: 400 })).toBeCloseTo(0.5); expect(dividerRatioAt('column', { x: 100, y: 900 }, { x: 100, y: 100, w: 800, h: 400 })).toBe(0.8) })
  it('allocates pane rectangles around a divider', () => { const panes = splitRectangles({ x: 0, y: 0, w: 1000, h: 500 }, 'row', 0.4); expect(panes.a.w + panes.divider.w + panes.b.w).toBe(1000); expect(panes.a.w).toBe(397); expect(panes.divider.x).toBe(397) })
})
