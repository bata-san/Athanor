import { describe, expect, it } from 'vitest'
import { resolveLocale, translate } from './i18n'

describe('language setting', () => {
  it('follows the system language unless a language is chosen', () => {
    expect(resolveLocale('system', ['ja-JP', 'en-US'])).toBe('ja')
    expect(resolveLocale('system', ['en-US'])).toBe('en')
    expect(resolveLocale('system', [])).toBe('en')
    expect(resolveLocale('en', ['ja-JP'])).toBe('en')
    expect(resolveLocale('ja', ['en-US'])).toBe('ja')
  })

  it('falls back to English when a translation is missing', () => {
    expect(translate('ja', 'settings.language')).toBe('言語')
    expect(translate('en', 'settings.language')).toBe('Language')
  })
})
