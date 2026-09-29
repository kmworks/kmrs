import { useTranslation } from 'react-i18next'
import { SUPPORTED_LANGUAGES, type LanguageCode } from '@/lib/i18n'
import { SegmentedControl } from '@/components/ui/SegmentedControl'

export function LanguageSwitcher({ className, size }: { className?: string; size?: 'sm' | 'md' }) {
  const { i18n } = useTranslation()
  const current: LanguageCode = SUPPORTED_LANGUAGES.some((l) => l.code === i18n.language)
    ? (i18n.language as LanguageCode)
    : 'en'
  return (
    <SegmentedControl<LanguageCode>
      className={className}
      size={size}
      options={SUPPORTED_LANGUAGES.map((l) => ({ value: l.code, label: l.label }))}
      value={current}
      onChange={(code) => void i18n.changeLanguage(code)}
    />
  )
}
