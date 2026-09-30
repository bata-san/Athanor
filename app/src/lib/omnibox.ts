export type OmniboxInput = { kind: 'url'; value: string } | { kind: 'search'; value: string } | { kind: 'internal'; value: string }
export function classifyOmniboxInput(input: string): OmniboxInput {
  const value = input.trim()
  if (/^athanor:\/\//i.test(value)) return { kind: 'internal', value }
  if (/^(https?:\/\/|file:\/\/)/i.test(value) || /^(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/i.test(value) || (/^[\w-]+(?:\.[\w-]+)+(?:\/.*)?$/.test(value) && !value.includes(' '))) return { kind: 'url', value: /^[a-z]+:\/\//i.test(value) ? value : `https://${value}` }
  return { kind: 'search', value }
}
