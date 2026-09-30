import { describe, expect, it } from 'vitest'
import { arrangeBoardItems, boardBounds, fitBoardView, hitTestBoardItem, screenToWorld, zoomAround } from './boardMath'
import type { BoardItem } from './types'
const item = (id: string, x: number, y: number, w: number, h: number, z = 0): BoardItem => ({ id, kind: 'text', text: id, size: 12, color: 'var(--foreground)', x, y, w, h, rotation: 0, opacity: 1, flipX: false, grayscale: false, locked: false, z })
describe('board geometry', () => {
  it('shelf packs items and returns them in their original order', () => { const result = arrangeBoardItems([item('a', 10, 10, 120, 80), item('b', 0, 0, 100, 100), item('c', 0, 0, 90, 50)], 10, 230); expect(result.map((entry) => entry.id)).toEqual(['a', 'b', 'c']); expect(result[0]!.x).toBe(110); expect(result[1]!.x).toBe(0); expect(result[2]!.y).toBe(110) })
  it('fits extents and handles empty boards', () => { expect(boardBounds([item('a', -20, 10, 100, 40)])).toEqual({ x: -20, y: 10, w: 100, h: 40 }); expect(fitBoardView([], { w: 300, h: 200 })).toEqual({ x: 0, y: 0, zoom: 1 }); const fit = fitBoardView([item('a', 0, 0, 100, 50)], { w: 300, h: 200 }); expect(fit.zoom).toBeGreaterThan(1) })
  it('hit-tests highest z and rotates around the item center', () => { const lower = item('low', 0, 0, 100, 100, 1), higher = item('high', 0, 0, 100, 100, 2); expect(hitTestBoardItem([lower, higher], 10, 10)?.id).toBe('high'); higher.rotation = 90; expect(hitTestBoardItem([higher], 50, -20)).toBeNull() })
  it('zooms around a cursor without moving its world point', () => { const view = { x: 10, y: 20, zoom: 1 }, cursor = { x: 100, y: 100 }, before = screenToWorld(cursor, view), afterView = zoomAround(view, cursor, 2), after = screenToWorld(cursor, afterView); expect(afterView.zoom).toBe(2); expect(after.x).toBeCloseTo(before.x); expect(after.y).toBeCloseTo(before.y) })
})
