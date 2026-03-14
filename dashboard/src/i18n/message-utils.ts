import { createTranslator } from "next-intl";
import type { Locale } from "@/i18n/locales";
import { DEFAULT_LOCALE } from "@/i18n/locales";
import zh from "@/messages/zh-CN.json";
import en from "@/messages/en-US.json";

const messages: Record<string, typeof zh> = {
  "zh-CN": zh,
  "en-US": en,
};

export function getAppMessage(
  locale: Locale | Promise<Locale>,
  key: string,
  values?: Record<string, unknown>
): string {
  // Handle both sync and async locale (API routes pass async getRequestLocale())
  let resolvedLocale: Locale;
  if (locale && typeof (locale as Promise<Locale>).then === "function") {
    // Promise was passed — fall back to default locale synchronously
    // (the caller should ideally await, but this prevents crashes)
    resolvedLocale = DEFAULT_LOCALE;
  } else {
    resolvedLocale = locale as Locale;
  }
  const msgs = messages[resolvedLocale] ?? messages[DEFAULT_LOCALE];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const translator = createTranslator({ locale: resolvedLocale, messages: msgs });
  return (translator as any)(key, values);
}

export async function getAppMessageAsync(
  locale: Locale | Promise<Locale>,
  key: string,
  values?: Record<string, unknown>
): Promise<string> {
  const resolvedLocale = await locale;
  const msgs = messages[resolvedLocale] ?? messages[DEFAULT_LOCALE];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const translator = createTranslator({ locale: resolvedLocale, messages: msgs });
  return (translator as any)(key, values);
}
