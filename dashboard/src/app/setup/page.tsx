"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function SetupPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const t = useTranslations("setup");
  const common = useTranslations("common");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError(t("passwordMismatch"));
      return;
    }

    if (password.length < 8) {
      setError(t("passwordTooShort"));
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        const errorMsg = typeof data.error === "string" 
          ? data.error 
          : (data.error?.message ?? t("errorFallback"));
        setError(errorMsg);
        setLoading(false);
        return;
      }

      // Account created successfully, redirect to dashboard
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError(common("networkError"));
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-purple-600 shadow-lg shadow-purple-600/30">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <title>{t("title")}</title>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">
            {t("brand")}
          </h1>
          <p className="mt-1 text-sm text-white/50">{t("subtitle")}</p>
        </div>

         <div className="glass-card rounded-xl p-6 shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
          <div className="mb-4 rounded-xl bg-amber-500/15 border border-amber-400/25 p-3 text-sm text-amber-200">
            {t("notice")}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="username" className="mb-2 block text-xs font-medium text-white/70 uppercase tracking-wider">
                {t("username")}
              </label>
              <Input
                type="text"
                name="username"
                value={username}
                onChange={setUsername}
                required
                autoComplete="username"
                placeholder={t("usernamePlaceholder")}
              />
            </div>

            <div>
              <label htmlFor="password" className="mb-2 block text-xs font-medium text-white/70 uppercase tracking-wider">
                {t("password")}
              </label>
              <Input
                type="password"
                name="password"
                value={password}
                onChange={setPassword}
                required
                autoComplete="new-password"
                placeholder={t("passwordPlaceholder")}
              />
            </div>

            <div>
              <label htmlFor="confirmPassword" className="mb-2 block text-xs font-medium text-white/70 uppercase tracking-wider">
                {t("confirmPassword")}
              </label>
              <Input
                type="password"
                name="confirmPassword"
                value={confirmPassword}
                onChange={setConfirmPassword}
                required
                autoComplete="new-password"
              />
            </div>

            {error && (
              <div className="rounded-xl bg-red-500/20 border border-red-400/30 p-3 text-sm text-red-300">
                {error}
              </div>
            )}

            <Button type="submit" disabled={loading} className="w-full">
              {loading ? t("submitting") : t("submit")}
            </Button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-white/30">
          {t("footer")}
        </p>
      </div>
    </div>
  );
}
