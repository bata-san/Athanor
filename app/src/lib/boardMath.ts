import type { BoardItem, Rect } from './types'

export function arrangeBoardItems<T extends BoardItem>(items: T[], gutter = 28, maxRowWidth = 1500): T[] {
  const ordered = [...items].sort((a, b) => b.h - a.h || a.id.localeCompare(b.id))
  let x = 0, y = 0, rowHeight = 0
  const placed = new Map<string, T>()
  for (const item of ordered) {
    if (x > 0 && x + item.w > maxRowWidth) { x = 0; y += rowHeight + gutter; rowHeight = 0 }
    placed.set(item.id, { ...item, x, y }); x += item.w + gutter; rowHeight = Math.max(rowHeight, item.h)
  }
  return items.map((item) => placed.get(item.id)!)
}
export function boardBounds(items: BoardItem[]): Rect | null {
  if (!items.length) return null
  const minX = Math.min(...items.map((item) => item.x)); const minY = Math.min(...items.map((item) => item.y))
  const maxX = Math.max(...items.map((item) => item.x + item.w)); const maxY = Math.max(...items.map((item) => item.y + item.h))
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}
export function fitBoardView(items: BoardItem[], viewport: { w: number; h: number }, padding = 72) {
  const bounds = boardBounds(items); if (!bounds) return { x: 0, y: 0, zoom: 1 }
  const usableW = Math.max(1, viewport.w - padding * 2), usableH = Math.max(1, viewport.h - padding * 2)
  const zoom = Math.min(usableW / Math.max(bounds.w, 1), usableH / Math.max(bounds.h, 1), 1.5)
  return { x: viewport.w / 2 - (bounds.x + bounds.w / 2) * zoom, y: viewport.h / 2 - (bounds.y + bounds.h / 2) * zoom, zoom }
}
export function hitTestBoardItem(items: BoardItem[], worldX: number, worldY: number): BoardItem | null {
  return [...items].sort((a, b) => b.z - a.z).find((item) => {
    const cx = item.x + item.w / 2, cy = item.y + item.h / 2
    const angle = -item.rotation * Math.PI / 180, dx = worldX - cx, dy = worldY - cy
    const localX = dx * Math.cos(angle) - dy * Math.sin(angle) + item.w / 2
    const localY = dx * Math.sin(angle) + dy * Math.cos(angle) + item.h / 2
    return localX >= 0 && localX <= item.w && localY >= 0 && localY <= item.h
  }) ?? null
}
export function screenToWorld(point: { x: number; y: number }, view: { x: number; y: number; zoom: number }) { return { x: (point.x - view.x) / view.zoom, y: (point.y - view.y) / view.zoom } }
export function zoomAround(view: { x: number; y: number; zoom: number }, screen: { x: number; y: number }, nextZoom: number) {
  const zoom = Math.min(4, Math.max(0.15, nextZoom)), ratio = zoom / view.zoom
  return { x: screen.x - (screen.x - view.x) * ratio, y: screen.y - (screen.y - view.y) * ratio, zoom }
}
