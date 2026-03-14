import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type Locale } from "@/i18n/locales";

export function pickSupportedLocale(locale?: string | null): Locale {
  if (!locale) return DEFAULT_LOCALE;
  const normalized = locale.toLowerCase();
  if (normalized.startsWith("en")) return "en-US";
  if (normalized.startsWith("zh")) return "zh-CN";
  if (SUPPORTED_LOCALES.includes(locale as Locale)) return locale as Locale;
  return DEFAULT_LOCALE;
}

export function resolveLocaleFromRequest(input: {
  cookieLocale?: string | null;
  acceptLanguage?: string | null;
}): Locale {
  if (input.cookieLocale?.trim()) return pickSupportedLocale(input.cookieLocale);
  if (input.acceptLanguage) {
    const primary = input.acceptLanguage.split(",")[0]?.trim();
    return pickSupportedLocale(primary);
  }
  return DEFAULT_LOCALE;
}
