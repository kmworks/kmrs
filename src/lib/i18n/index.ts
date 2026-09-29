import i18n, { type Resource } from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'zh-CN', label: '简体中文' },
] as const

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]['code']

// any locales/<lang>/<ns>.json is registered automatically, so new namespaces
// never need an edit here
const modules = import.meta.glob<{ default: Record<string, unknown> }>('./locales/*/*.json', { eager: true })
const resources: Resource = {}
for (const [path, mod] of Object.entries(modules)) {
  const match = /^\.\/locales\/([^/]+)\/([^/]+)\.json$/.exec(path)
  if (!match) continue
  const [, lng, ns] = match
  ;(resources[lng] ??= {})[ns] = mod.default
}

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    supportedLngs: SUPPORTED_LANGUAGES.map((l) => l.code),
    defaultNS: 'common',
    interpolation: { escapeValue: false },
    returnEmptyString: false,
    detection: {
      // querystring enables shareable ?lng= links; it wins and is then cached
      order: ['querystring', 'localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'kmweb.language',
      convertDetectedLanguage: (lng) => (lng.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'),
    },
  })

export default i18n
