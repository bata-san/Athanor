/**
 * Arrow-key movement across a grid of cards (the tab overview). The grid lays its cards out in rows of
 * `columns`, so a vertical key is one whole row and a horizontal key is one card. Movement stops at the
 * edges instead of wrapping: walking the grid never puts you somewhere you did not point at, and the last
 * row of a partly filled grid simply stops. `Home`/`End` go to the first and last card.
 *
 * Returns -1 when there is nothing to move to, so the caller can leave focus alone.
 */
export function nextIndex(current: number, count: number, columns: number, key: string): number {
  if (!Number.isFinite(count) || count < 1) return -1
  const last = count - 1
  const step = Number.isFinite(columns) ? Math.max(1, Math.floor(columns)) : 1
  const from = Number.isFinite(current) && current >= 0 && current <= last ? Math.floor(current) : -1
  switch (key) {
    case 'ArrowRight': return from < 0 ? 0 : Math.min(from + 1, last)
    case 'ArrowLeft': return from < 0 ? 0 : Math.max(from - 1, 0)
    case 'ArrowDown': return from < 0 ? 0 : Math.min(from + step, last)
    case 'ArrowUp': return from < 0 ? 0 : Math.max(from - step, 0)
    case 'Home': return 0
    case 'End': return last
    // A key the grid does not own (Enter, a letter) leaves the focus where it is; -1 says "nothing focused".
    default: return from
  }
}