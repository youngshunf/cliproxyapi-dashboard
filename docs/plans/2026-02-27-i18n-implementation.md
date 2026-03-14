# Dashboard I18n Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add zh-CN/en-US internationalization across WebUI and API responses, defaulting to zh-CN and providing a language switch.

**Architecture:** Use `next-intl` App Router integration with a request-based locale resolver (cookie > Accept-Language > default). UI strings use `t()` from `next-intl`, and API errors emit localized messages with stable message keys.

**Tech Stack:** Next.js 16 App Router, `next-intl`, TypeScript, Tailwind, Node test runner (`node --test --import tsx`).

---

### Task 1: Add i18n scaffolding and locale resolver (TDD for pure locale logic)

**Files:**
- Create: `dashboard/src/i18n/locales.ts`
- Create: `dashboard/src/i18n/locale-utils.ts`
- Create: `dashboard/src/i18n/request-locale.ts`
- Create: `dashboard/src/i18n/request.ts`
- Create: `dashboard/src/messages/zh-CN.json`
- Create: `dashboard/src/messages/en-US.json`
- Modify: `dashboard/next.config.ts`
- Modify: `dashboard/package.json`
- Create: `dashboard/tests/i18n/locale-utils.test.ts`

**Step 1: Write the failing test (locale parsing utilities)**

```ts
// dashboard/tests/i18n/locale-utils.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveLocaleFromRequest, pickSupportedLocale } from "@/i18n/locale-utils";
import { DEFAULT_LOCALE } from "@/i18n/locales";

test("pickSupportedLocale returns default for unsupported values", () => {
  assert.equal(pickSupportedLocale("fr-FR"), DEFAULT_LOCALE);
});

test("pickSupportedLocale maps en variants to en-US", () => {
  assert.equal(pickSupportedLocale("en"), "en-US");
  assert.equal(pickSupportedLocale("en-GB"), "en-US");
});

test("pickSupportedLocale maps zh variants to zh-CN", () => {
  assert.equal(pickSupportedLocale("zh"), "zh-CN");
  assert.equal(pickSupportedLocale("zh-TW"), "zh-CN");
});

test("resolveLocaleFromRequest prefers cookie over header", () => {
  const locale = resolveLocaleFromRequest({
    cookieLocale: "en-US",
    acceptLanguage: "zh-CN,zh;q=0.9,en;q=0.8",
  });
  assert.equal(locale, "en-US");
});
```

**Step 2: Run test to verify it fails**

Run: `cd dashboard && npm run test`
Expected: FAIL with module-not-found for `@/i18n/locale-utils` or missing exports.

**Step 3: Write minimal implementation**

```ts
// dashboard/src/i18n/locales.ts
export const SUPPORTED_LOCALES = ["zh-CN", "en-US"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "zh-CN";
export const LOCALE_COOKIE = "cliproxyapi_locale";
```

```ts
// dashboard/src/i18n/locale-utils.ts
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
  if (input.cookieLocale) return pickSupportedLocale(input.cookieLocale);
  if (input.acceptLanguage) {
    const primary = input.acceptLanguage.split(",")[0]?.trim();
    return pickSupportedLocale(primary);
  }
  return DEFAULT_LOCALE;
}
```

```ts
// dashboard/src/i18n/request-locale.ts
import { cookies, headers } from "next/headers";
import { LOCALE_COOKIE } from "@/i18n/locales";
import { resolveLocaleFromRequest } from "@/i18n/locale-utils";

export function getRequestLocale() {
  const cookieLocale = cookies().get(LOCALE_COOKIE)?.value ?? null;
  const acceptLanguage = headers().get("accept-language");
  return resolveLocaleFromRequest({ cookieLocale, acceptLanguage });
}
```

**Step 4: Run test to verify it passes**

Run: `cd dashboard && npm run test`
Expected: PASS

**Step 5: Add `next-intl` request config + messages**

```ts
// dashboard/src/i18n/request.ts
import { getRequestConfig } from "next-intl/server";
import { cookies, headers } from "next/headers";
import { LOCALE_COOKIE } from "@/i18n/locales";
import { resolveLocaleFromRequest } from "@/i18n/locale-utils";

export default getRequestConfig(async () => {
  const cookieLocale = cookies().get(LOCALE_COOKIE)?.value ?? null;
  const acceptLanguage = headers().get("accept-language");
  const locale = resolveLocaleFromRequest({ cookieLocale, acceptLanguage });

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
```

```json
// dashboard/src/messages/zh-CN.json
{
  "app": {
    "title": "CLIProxyAPI Dashboard",
    "description": "CLIProxyAPI 管理控制台"
  }
}
```

```json
// dashboard/src/messages/en-US.json
{
  "app": {
    "title": "CLIProxyAPI Dashboard",
    "description": "Management dashboard for CLIProxyAPI"
  }
}
```

**Step 6: Wire `next-intl` plugin + test script**

```ts
// dashboard/next.config.ts
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default withNextIntl(nextConfig);
```

```json
// dashboard/package.json (additions)
{
  "scripts": {
    "test": "node --test --import tsx"
  },
  "dependencies": {
    "next-intl": "^3.20.0"
  }
}
```

**Step 7: Run tests again**

Run: `cd dashboard && npm run test`
Expected: PASS

---

### Task 2: Add language switch API + UI control

**Files:**
- Create: `dashboard/src/app/api/i18n/locale/route.ts`
- Modify: `dashboard/src/components/dashboard-nav.tsx`
- Modify: `dashboard/src/messages/zh-CN.json`
- Modify: `dashboard/src/messages/en-US.json`

**Step 1: Write the failing test (cookie precedence)**

```ts
// dashboard/tests/i18n/locale-utils.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveLocaleFromRequest } from "@/i18n/locale-utils";

test("resolveLocaleFromRequest falls back to header when cookie is empty", () => {
  const locale = resolveLocaleFromRequest({
    cookieLocale: "",
    acceptLanguage: "en-US,en;q=0.8",
  });
  assert.equal(locale, "en-US");
});
```

**Step 2: Run test to verify it fails**

Run: `cd dashboard && npm run test`
Expected: FAIL (empty string still treated as value).

**Step 3: Update locale resolver to treat empty cookie as missing**

```ts
// dashboard/src/i18n/locale-utils.ts
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
```

**Step 4: Run test to verify it passes**

Run: `cd dashboard && npm run test`
Expected: PASS

**Step 5: Add locale API route**

```ts
// dashboard/src/app/api/i18n/locale/route.ts
import { NextRequest, NextResponse } from "next/server";
import { LOCALE_COOKIE, SUPPORTED_LOCALES } from "@/i18n/locales";
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
```

**Step 6: Add language switcher to nav**

```tsx
// dashboard/src/components/dashboard-nav.tsx (inside component)
import { useLocale, useTranslations } from "next-intl";

// ...
const t = useTranslations();
const locale = useLocale();

const handleLocaleChange = async (nextLocale: string) => {
  await fetch("/api/i18n/locale", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ locale: nextLocale }),
  });
  router.refresh();
};
```

```tsx
// dashboard/src/components/dashboard-nav.tsx (render near logout)
<div className="mb-4 flex items-center gap-2">
  <button
    type="button"
    onClick={() => handleLocaleChange("zh-CN")}
    className={cn(
      "rounded-md px-2 py-1 text-xs font-medium",
      locale === "zh-CN" ? "bg-slate-700 text-slate-100" : "text-slate-400"
    )}
  >
    中文
  </button>
  <button
    type="button"
    onClick={() => handleLocaleChange("en-US")}
    className={cn(
      "rounded-md px-2 py-1 text-xs font-medium",
      locale === "en-US" ? "bg-slate-700 text-slate-100" : "text-slate-400"
    )}
  >
    English
  </button>
</div>
```

**Step 7: Add translation keys for nav**

```json
// dashboard/src/messages/zh-CN.json (merge)
{
  "nav": {
    "general": "通用",
    "access": "访问",
    "admin": "管理",
    "quickStart": "快速开始",
    "providers": "提供商",
    "usage": "用量",
    "quota": "配额",
    "apiKeys": "API Keys",
    "settings": "设置",
    "monitoring": "监控",
    "containers": "容器",
    "config": "配置",
    "users": "用户",
    "logs": "日志",
    "logout": "退出登录",
    "collapse": "收起侧边栏",
    "expand": "展开侧边栏",
    "brandTitle": "CLIProxy",
    "brandSubtitle": "管理控制台"
  }
}
```

```json
// dashboard/src/messages/en-US.json (merge)
{
  "nav": {
    "general": "General",
    "access": "Access",
    "admin": "Admin",
    "quickStart": "Quick Start",
    "providers": "Providers",
    "usage": "Usage",
    "quota": "Quota",
    "apiKeys": "API Keys",
    "settings": "Settings",
    "monitoring": "Monitoring",
    "containers": "Containers",
    "config": "Config",
    "users": "Users",
    "logs": "Logs",
    "logout": "Logout",
    "collapse": "Collapse sidebar",
    "expand": "Expand sidebar",
    "brandTitle": "CLIProxy",
    "brandSubtitle": "Management"
  }
}
```

---

### Task 3: Wire i18n provider + metadata

**Files:**
- Modify: `dashboard/src/app/layout.tsx`

**Step 1: Write failing test for title translation helper**

```ts
// dashboard/tests/i18n/locale-utils.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { getAppMessage } from "@/i18n/message-utils";

test("getAppMessage reads translated title", () => {
  assert.equal(getAppMessage("zh-CN", "app.title"), "CLIProxyAPI Dashboard");
});
```

**Step 2: Run test to verify it fails**

Run: `cd dashboard && npm run test`
Expected: FAIL (missing message utils).

**Step 3: Implement message helper**

```ts
// dashboard/src/i18n/message-utils.ts
import { createTranslator } from "next-intl";
import type { Locale } from "@/i18n/locales";
import zh from "@/messages/zh-CN.json";
import en from "@/messages/en-US.json";

const messages = {
  "zh-CN": zh,
  "en-US": en,
};

export function getAppMessage(locale: Locale, key: string, values?: Record<string, unknown>) {
  const translator = createTranslator({ locale, messages: messages[locale] });
  return translator(key, values);
}
```

**Step 4: Run test to verify it passes**

Run: `cd dashboard && npm run test`
Expected: PASS

**Step 5: Update layout to use `NextIntlClientProvider` and localized metadata**

```tsx
// dashboard/src/app/layout.tsx
import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getLocale } from "next-intl/server";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const messages = await getMessages();
  const t = new (await import("next-intl")).createTranslator({ locale, messages });
  return {
    title: t("app.title"),
    description: t("app.description"),
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale}>
      <body className={`${GeistSans.variable} ${GeistMono.variable} antialiased`}>
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
```

---

### Task 4: Translate auth pages and common UI strings

**Files:**
- Modify: `dashboard/src/app/login/page.tsx`
- Modify: `dashboard/src/app/setup/page.tsx`
- Modify: `dashboard/src/components/ui/*` (labels, placeholders)
- Modify: `dashboard/src/messages/zh-CN.json`
- Modify: `dashboard/src/messages/en-US.json`

**Step 1: Replace literals with `t()` in login page**

```tsx
// dashboard/src/app/login/page.tsx (example pattern)
import { useTranslations } from "next-intl";

const t = useTranslations("login");
<h1>{t("title")}</h1>
<p>{t("subtitle")}</p>
```

**Step 2: Add translation keys**

```json
// dashboard/src/messages/zh-CN.json (merge)
{
  "login": {
    "title": "登录",
    "subtitle": "使用管理员账号登录",
    "username": "用户名",
    "password": "密码",
    "submit": "登录"
  },
  "setup": {
    "title": "初始化设置",
    "subtitle": "创建管理员账号",
    "submit": "创建账号"
  }
}
```

```json
// dashboard/src/messages/en-US.json (merge)
{
  "login": {
    "title": "Login",
    "subtitle": "Sign in with your admin account",
    "username": "Username",
    "password": "Password",
    "submit": "Login"
  },
  "setup": {
    "title": "Setup",
    "subtitle": "Create the admin account",
    "submit": "Create account"
  }
}
```

**Step 3: Run tests**

Run: `cd dashboard && npm run test`
Expected: PASS

---

### Task 5: Localize API errors with message keys

**Files:**
- Modify: `dashboard/src/lib/errors.ts`
- Modify: `dashboard/src/app/api/**` (use message keys)
- Modify: `dashboard/src/messages/zh-CN.json`
- Modify: `dashboard/src/messages/en-US.json`

**Step 1: Write failing test for error translation**

```ts
// dashboard/tests/i18n/locale-utils.test.ts (append)
import { getAppMessage } from "@/i18n/message-utils";

test("error messages include translated content", () => {
  assert.equal(getAppMessage("zh-CN", "errors.auth.invalidCredentials"), "账号或密码错误");
});
```

**Step 2: Run tests**

Run: `cd dashboard && npm run test`
Expected: FAIL (key missing).

**Step 3: Add error messages to message files**

```json
// dashboard/src/messages/zh-CN.json (merge)
{
  "errors": {
    "auth": {
      "unauthorized": "未授权",
      "invalidCredentials": "账号或密码错误",
      "forbidden": "权限不足"
    },
    "validation": {
      "missingFields": "缺少必填字段：{fields}",
      "invalidInputTypes": "输入类型无效",
      "failed": "校验失败"
    },
    "rateLimit": {
      "tooMany": "请求过于频繁，请稍后再试"
    },
    "resource": {
      "notFound": "{resource} 未找到"
    },
    "internal": {
      "serverError": "服务器内部错误",
      "databaseError": "数据库操作失败"
    }
  }
}
```

```json
// dashboard/src/messages/en-US.json (merge)
{
  "errors": {
    "auth": {
      "unauthorized": "Unauthorized",
      "invalidCredentials": "Invalid credentials",
      "forbidden": "Insufficient permissions"
    },
    "validation": {
      "missingFields": "Missing required fields: {fields}",
      "invalidInputTypes": "Invalid input types",
      "failed": "Validation failed"
    },
    "rateLimit": {
      "tooMany": "Too many requests. Try again later."
    },
    "resource": {
      "notFound": "{resource} not found"
    },
    "internal": {
      "serverError": "Internal server error",
      "databaseError": "Database operation failed"
    }
  }
}
```

**Step 4: Update `Errors` to use message keys**

```ts
// dashboard/src/lib/errors.ts (pattern)
import { getRequestLocale } from "@/i18n/request-locale";
import { getAppMessage } from "@/i18n/message-utils";

const t = (key: string, values?: Record<string, unknown>) =>
  getAppMessage(getRequestLocale(), key, values);

// Example:
unauthorized: () =>
  apiError(ERROR_CODE.AUTH_UNAUTHORIZED, t("errors.auth.unauthorized"), 401),
```

**Step 5: Update API routes to use key-based validation messages**

```ts
// dashboard/src/app/api/auth/login/route.ts (example)
return Errors.validation("errors.validation.invalidInputTypes");
```

**Step 6: Run tests**

Run: `cd dashboard && npm run test`
Expected: PASS

---

### Task 6: Translate remaining dashboard pages and notifications

**Files:**
- Modify: `dashboard/src/app/dashboard/**`
- Modify: `dashboard/src/components/**`
- Modify: `dashboard/src/messages/zh-CN.json`
- Modify: `dashboard/src/messages/en-US.json`

**Step 1: Replace literals with `useTranslations()` and add keys**

```tsx
// Example pattern
const t = useTranslations("dashboard.providers");
<h2>{t("title")}</h2>
```

**Step 2: Add translation keys in both locale files**

```json
// dashboard/src/messages/zh-CN.json (merge)
{
  "dashboard": {
    "providers": {
      "title": "提供商"
    }
  }
}
```

```json
// dashboard/src/messages/en-US.json (merge)
{
  "dashboard": {
    "providers": {
      "title": "Providers"
    }
  }
}
```

**Step 3: Run tests**

Run: `cd dashboard && npm run test`
Expected: PASS

---

### Task 7: Final verification

**Step 1: Run tests**

Run: `cd dashboard && npm run test`
Expected: PASS

**Step 2: Manual smoke check**

- Start dev server: `cd dashboard && npm run dev`
- Verify zh-CN default on `/login` and `/dashboard`
- Switch to English and refresh; verify persistence via cookie.
