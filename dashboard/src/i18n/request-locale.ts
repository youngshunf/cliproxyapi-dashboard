import { cookies, headers } from "next/headers";
import { LOCALE_COOKIE } from "@/i18n/locales";
import { resolveLocaleFromRequest } from "@/i18n/locale-utils";

export async function getRequestLocale() {
  const cookieLocale = (await cookies()).get(LOCALE_COOKIE)?.value ?? null;
  const acceptLanguage = (await headers()).get("accept-language");
  return resolveLocaleFromRequest({ cookieLocale, acceptLanguage });
}
