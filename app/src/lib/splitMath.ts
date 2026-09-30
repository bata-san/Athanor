import type { Rect } from './types'
export function dividerRatioAt(dir: 'row' | 'column', pointer: { x: number; y: number }, bounds: Rect, gutter = 6) {
  const total = dir === 'row' ? bounds.w : bounds.h, position = dir === 'row' ? pointer.x - bounds.x : pointer.y - bounds.y
  return Math.min(0.8, Math.max(0.2, (position - gutter / 2) / Math.max(1, total)))
}
export function splitRectangles(rect: Rect, dir: 'row' | 'column', ratio: number, gutter = 6) {
  const clamped = Math.min(0.8, Math.max(0.2, ratio))
  if (dir === 'row') { const pivot = rect.w * clamped; return { a: { x: rect.x, y: rect.y, w: pivot - gutter / 2, h: rect.h }, divider: { x: rect.x + pivot - gutter / 2, y: rect.y, w: gutter, h: rect.h }, b: { x: rect.x + pivot + gutter / 2, y: rect.y, w: rect.w - pivot - gutter / 2, h: rect.h } } }
  const pivot = rect.h * clamped; return { a: { x: rect.x, y: rect.y, w: rect.w, h: pivot - gutter / 2 }, divider: { x: rect.x, y: rect.y + pivot - gutter / 2, w: rect.w, h: gutter }, b: { x: rect.x, y: rect.y + pivot + gutter / 2, w: rect.w, h: rect.h - pivot - gutter / 2 } }
}
