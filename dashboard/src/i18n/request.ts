import { getRequestConfig } from "next-intl/server";
import { cookies, headers } from "next/headers";
import { LOCALE_COOKIE } from "@/i18n/locales";
import { resolveLocaleFromRequest } from "@/i18n/locale-utils";

export default getRequestConfig(async () => {
  const cookieLocale = (await cookies()).get(LOCALE_COOKIE)?.value ?? null;
  const acceptLanguage = (await headers()).get("accept-language");
  const locale = resolveLocaleFromRequest({ cookieLocale, acceptLanguage });

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
