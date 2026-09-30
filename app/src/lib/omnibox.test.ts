import { describe, expect, it } from 'vitest'
import { classifyOmniboxInput } from './omnibox'
describe('omnibox classification', () => {
  it('keeps internal pages and explicit URLs', () => { expect(classifyOmniboxInput('athanor://settings')).toEqual({ kind: 'internal', value: 'athanor://settings' }); expect(classifyOmniboxInput('https://example.com')).toEqual({ kind: 'url', value: 'https://example.com' }) })
  it('treats hostnames as URLs and natural language as search', () => { expect(classifyOmniboxInput('localhost:5173')).toEqual({ kind: 'url', value: 'https://localhost:5173' }); expect(classifyOmniboxInput('cats in space')).toEqual({ kind: 'search', value: 'cats in space' }) })
})
