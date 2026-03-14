import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pickSupportedLocale,
  resolveLocaleFromRequest,
} from "@/i18n/locale-utils";
import { DEFAULT_LOCALE } from "@/i18n/locales";
import { getAppMessage } from "@/i18n/message-utils";

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

test("resolveLocaleFromRequest falls back to header when cookie is empty", () => {
  const locale = resolveLocaleFromRequest({
    cookieLocale: "  ",
    acceptLanguage: "en-US,en;q=0.8",
  });
  assert.equal(locale, "en-US");
});

test("getAppMessage reads translated title", () => {
  assert.equal(getAppMessage("zh-CN", "app.title"), "CLIProxyAPI Dashboard");
});

test("getAppMessage reads error translations", () => {
  assert.equal(
    getAppMessage("zh-CN", "errors.auth.invalidCredentials"),
    "账号或密码错误"
  );
});

test("getAppMessage reads providers api key section title", () => {
  assert.equal(
    getAppMessage("zh-CN", "providers.apiKeySection.title"),
    "API Key 提供商"
  );
});

test("getAppMessage reads providers oauth section title", () => {
  assert.equal(
    getAppMessage("zh-CN", "providers.oauthSection.title"),
    "OAuth 账号"
  );
});

test("getAppMessage reads providers custom section title", () => {
  assert.equal(
    getAppMessage("zh-CN", "providers.customSection.title"),
    "自定义提供商"
  );
});

test("quickStart title is translated", () => {
  assert.equal(getAppMessage("zh-CN", "quickStart.title"), "快速开始");
});

test("quickStart service status card uses localized value", () => {
  assert.equal(getAppMessage("zh-CN", "quickStart.statusCards.service.value.online"), "在线");
});
