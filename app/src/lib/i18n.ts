import { useAppStore } from './store'
import type { LanguageSetting } from './types'

/** Languages Athanor's own interface has text for. Anything else reads as English. */
export type Locale = 'en' | 'ja'

/**
 * Athanor's interface text. Add a key to `en` first, then its translation to `ja`; a missing translation falls back to
 * English, so an incomplete language never shows raw keys. Components use `useT()` instead of hard-coded strings.
 */
const messages = {
  en: {
    'settings.language': 'Language',
    'settings.language.row': 'Interface language',
    'settings.language.description': 'The language of Athanor’s own interface. System follows Windows.',
    'settings.language.system': 'System default',
    'settings.language.english': 'English',
    'settings.language.japanese': '日本語',
  },
  ja: {
    'settings.language': '言語',
    'settings.language.row': '表示言語',
    'settings.language.description': 'Athanor 自体の表示言語です。「システムの既定」は Windows の言語に従います。',
    'settings.language.system': 'システムの既定',
    'settings.language.english': 'English',
    'settings.language.japanese': '日本語',
  },
} as const satisfies Record<Locale, Record<string, string>>

export type MessageKey = keyof typeof messages.en

/** Turns the setting into the locale to show. `system` reads the language list the browser (Windows) reports. */
export function resolveLocale(setting: LanguageSetting | undefined, languages: readonly string[] = navigator.languages): Locale {
  if (setting === 'en' || setting === 'ja') return setting
  const first = languages.find(Boolean) ?? 'en'
  return first.toLowerCase().startsWith('ja') ? 'ja' : 'en'
}

export function translate(locale: Locale, key: MessageKey): string {
  return messages[locale][key] ?? messages.en[key]
}

/** The interface locale; components re-render when the language setting changes. */
export function useLocale(): Locale {
  const setting = useAppStore((state) => state.snapshot?.settings.language)
  return resolveLocale(setting)
}

/** `const t = useT(); t('settings.language')` */
export function useT() {
  const locale = useLocale()
  return (key: MessageKey) => translate(locale, key)
}
