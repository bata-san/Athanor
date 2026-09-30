import type { LineIssue } from './types'

/** Largest accepted "My filters" text, mirroring the Rust cap of 512 KiB. */
export const MAX_USER_FILTERS_BYTES = 512 * 1024

const isComment = (line: string) => line.startsWith('!') || line.startsWith('[Adblock') || line.startsWith('[uBlock')
const isRule = (line: string) => /^(?:\|\||\||@@)/.test(line) || /(?:#@#|#\?#|##)[^\s#]/.test(line)

/** Mock validator for filter text: keep the lines the engine would drop, report the rest by line number. */
export function validateFilterText(text: string): LineIssue[] {
  if (text.length > MAX_USER_FILTERS_BYTES) return [{ line: 0, message: `filters are larger than the ${MAX_USER_FILTERS_BYTES / 1024} KiB limit` }]
  const issues: LineIssue[] = []
  text.split('\n').forEach((raw, index) => {
    const line = raw.trim()
    if (line && !isComment(line) && !isRule(line)) issues.push({ line: index + 1, message: 'not a network or cosmetic rule' })
  })
  return issues
}

/** Map a 1-based line number (0 = whole text) onto a textarea selection range. */
export function lineSelectionRange(text: string, line: number): { start: number; end: number } {
  if (line <= 0) return { start: 0, end: text.length }
  const lines = text.split('\n')
  if (line > lines.length) return { start: text.length, end: text.length }
  const start = lines.slice(0, line - 1).reduce((total, entry) => total + entry.length + 1, 0)
  return { start, end: start + lines[line - 1]!.length }
}

/** Live line counter for the editor. */
export function countFilterLines(text: string): number { return text === '' ? 0 : text.split('\n').length }

/** Short count copy, e.g. `2 lines`. */
export function lineCountLabel(count: number): string { return `${count} ${count === 1 ? 'line' : 'lines'}` }

/** Short copy for the save toast, e.g. `2 lines ignored`. */
export function ignoredLineSummary(count: number): string { return `${lineCountLabel(count)} ignored` }
