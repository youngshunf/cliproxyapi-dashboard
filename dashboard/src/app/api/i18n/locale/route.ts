import { NextRequest, NextResponse } from "next/server";
import { LOCALE_COOKIE } from "@/i18n/locales";
import { pickSupportedLocale } from "@/i18n/locale-utils";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const locale = pickSupportedLocale(body?.locale);

  const response = NextResponse.json({ locale });
  response.cookies.set(LOCALE_COOKIE, locale, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return response;
}
