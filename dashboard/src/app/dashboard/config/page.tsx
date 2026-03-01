"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useTranslations } from "next-intl";

// Config shape (excluding fields managed elsewhere)
interface StreamingConfig {
  "keepalive-seconds": number;
  "bootstrap-retries": number;
  "nonstream-keepalive-interval": number;
}

interface QuotaExceededConfig {
  "switch-project": boolean;
  "switch-preview-model": boolean;
}

interface RoutingConfig {
  strategy: string;
}

interface Config {
  "proxy-url": string;
  "force-model-prefix": boolean;
  streaming: StreamingConfig;
  debug: boolean;
  "commercial-mode": boolean;
  "logging-to-file": boolean;
  "logs-max-total-size-mb": number;
  "error-logs-max-files": number;
  "usage-statistics-enabled": boolean;
  "request-retry": number;
  "max-retry-interval": number;
  "quota-exceeded": QuotaExceededConfig;
  routing: RoutingConfig;
  "ws-auth": boolean;
}

// Toggle Switch Component
function Toggle({ 
  enabled, 
  onChange, 
  disabled = false 
}: { 
  enabled: boolean; 
  onChange: (value: boolean) => void; 
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={() => onChange(!enabled)}
      disabled={disabled}
      className={`
        relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full
        border-2 border-transparent transition-colors duration-200 ease-in-out
        focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-transparent
        disabled:cursor-not-allowed disabled:opacity-50
        ${enabled ? 'bg-emerald-500' : 'bg-slate-700'}
      `}
    >
      <span
        className={`
          pointer-events-none inline-block h-6 w-6 transform rounded-full
          bg-white shadow-lg ring-0 transition duration-200 ease-in-out
          ${enabled ? 'translate-x-5' : 'translate-x-0'}
        `}
      />
    </button>
  );
}

// Dropdown Select Component
function Select({
  value,
  onChange,
  options,
  disabled = false
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="
        w-full rounded-sm border border-slate-700/70 bg-slate-900/50 px-3 py-2 text-sm
        text-slate-200
        focus:outline-none focus:border-blue-400/50 focus:ring-1 focus:ring-blue-400/30
        disabled:opacity-50 disabled:cursor-not-allowed
        transition-colors duration-200
      "
    >
      {options.map((option) => (
        <option key={option.value} value={option.value} className="bg-[#0f172a] text-slate-100">
          {option.label}
        </option>
      ))}
    </select>
  );
}

// Section Header Component
function SectionHeader({ title }: { title: string }) {
  return (
    <div className="mb-3">
      <h3 className="text-sm font-semibold uppercase tracking-[0.08em] text-slate-400">{title}</h3>
    </div>
  );
}

// Config Field Component
function ConfigField({
  label,
  description,
  children
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="block text-sm font-semibold text-slate-200">{label}</div>
      {description && <p className="text-xs text-slate-500">{description}</p>}
      <div>{children}</div>
    </div>
  );
}

export default function ConfigPage() {
  const [config, setConfig] = useState<Config | null>(null);
  const [originalConfig, setOriginalConfig] = useState<Config | null>(null);
  const [rawJson, setRawJson] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { showToast } = useToast();
  const t = useTranslations("config");

  const hasUnsavedChanges = config && originalConfig && JSON.stringify(config) !== JSON.stringify(originalConfig);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/management/config");
      if (!res.ok) {
        showToast(t("failedLoad"), "error");
        setLoading(false);
        return;
      }

      const data = await res.json();
      setConfig(data as Config);
      setOriginalConfig(data as Config);
      setRawJson(JSON.stringify(data, null, 2));
      setLoading(false);
    } catch {
      showToast(t("networkError"), "error");
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void fetchConfig();
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [fetchConfig]);

  const handleSave = async () => {
    if (!config || !originalConfig) return;

    setSaving(true);

    try {
      // Build list of changed fields to PATCH individually
      const patches: Array<{ path: string; value: unknown }> = [];

      // Top-level simple fields
      const simpleFields: Array<{ key: keyof Config; path: string }> = [
        { key: "proxy-url", path: "proxy-url" },
        { key: "force-model-prefix", path: "force-model-prefix" },
        { key: "debug", path: "debug" },
        { key: "commercial-mode", path: "commercial-mode" },
        { key: "logging-to-file", path: "logging-to-file" },
        { key: "logs-max-total-size-mb", path: "logs-max-total-size-mb" },
        { key: "error-logs-max-files", path: "error-logs-max-files" },
        { key: "usage-statistics-enabled", path: "usage-statistics-enabled" },
        { key: "request-retry", path: "request-retry" },
        { key: "max-retry-interval", path: "max-retry-interval" },
        { key: "ws-auth", path: "ws-auth" },
      ];

      for (const { key, path: fieldPath } of simpleFields) {
        if (config[key] !== originalConfig[key]) {
          patches.push({ path: fieldPath, value: config[key] });
        }
      }

      // Nested: streaming (patch each sub-field individually)
      if (config.streaming) {
        const origStreaming = originalConfig.streaming ?? {} as StreamingConfig;
        for (const [subKey, subVal] of Object.entries(config.streaming)) {
          if (subVal !== (origStreaming as unknown as Record<string, unknown>)[subKey]) {
            patches.push({ path: `streaming/${subKey}`, value: subVal });
          }
        }
      }

      // Nested: quota-exceeded
      if (config["quota-exceeded"]) {
        const origQuota = originalConfig["quota-exceeded"] ?? {} as QuotaExceededConfig;
        for (const [subKey, subVal] of Object.entries(config["quota-exceeded"])) {
          if (subVal !== (origQuota as unknown as Record<string, unknown>)[subKey]) {
            patches.push({ path: `quota-exceeded/${subKey}`, value: subVal });
          }
        }
      }

      // Nested: routing
      if (config.routing) {
        const origRouting = originalConfig.routing ?? {} as RoutingConfig;
        for (const [subKey, subVal] of Object.entries(config.routing)) {
          if (subVal !== (origRouting as unknown as Record<string, unknown>)[subKey]) {
            patches.push({ path: `routing/${subKey}`, value: subVal });
          }
        }
      }

      if (patches.length === 0) {
        showToast(t("savedSuccess"), "success");
        setSaving(false);
        return;
      }

      // Send each patch
      let hasError = false;
      for (const patch of patches) {
        const res = await fetch(`/api/management/${patch.path}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value: patch.value }),
        });
        if (!res.ok) {
          hasError = true;
          break;
        }
      }

      if (hasError) {
        showToast(t("failedSave"), "error");
        setSaving(false);
        return;
      }

      showToast(t("savedSuccess"), "success");
      setOriginalConfig(config);
      setRawJson(JSON.stringify(config, null, 2));
      setSaving(false);
    } catch {
      showToast(t("failedSave"), "error");
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    if (originalConfig) {
      setConfig(originalConfig);
      setRawJson(JSON.stringify(originalConfig, null, 2));
      showToast(t("discarded"), "info");
    }
  };

  const updateConfig = <K extends keyof Config>(key: K, value: Config[K]) => {
    if (!config) return;
    setConfig({ ...config, [key]: value });
  };

  const updateStreamingConfig = (key: keyof StreamingConfig, value: number) => {
    if (!config) return;
    setConfig({
      ...config,
      streaming: {
        ...(config.streaming ?? {}),
        [key]: value,
      } as StreamingConfig,
    });
  };

  const updateQuotaConfig = (key: keyof QuotaExceededConfig, value: boolean) => {
    if (!config) return;
    setConfig({
      ...config,
      "quota-exceeded": {
        ...(config["quota-exceeded"] ?? {}),
        [key]: value,
      } as QuotaExceededConfig,
    });
  };

  const updateRoutingConfig = (key: keyof RoutingConfig, value: string) => {
    if (!config) return;
    setConfig({
      ...config,
      routing: {
        ...(config.routing ?? {}),
        [key]: value,
      } as RoutingConfig,
    });
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <section className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-4">
          <h1 className="text-xl font-semibold tracking-tight text-slate-100">{t("title")}</h1>
        </section>
        <div className="rounded-md border border-slate-700/70 bg-slate-900/25 p-6">
          <div className="flex items-center justify-center">
            <div className="flex flex-col items-center gap-4">
              <div className="size-8 animate-spin rounded-full border-4 border-white/20 border-t-blue-500"></div>
              <p className="text-slate-400">{t("loadingConfig")}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="space-y-4">
        <section className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-4">
          <h1 className="text-xl font-semibold tracking-tight text-slate-100">{t("title")}</h1>
        </section>
        <div className="rounded-md border border-slate-700/70 bg-slate-900/25 p-4 text-center">
          <p className="text-slate-300">{t("failedLoad")}</p>
          <Button onClick={fetchConfig} className="mt-4 px-2.5 py-1 text-xs">
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-4">
        <div className="flex flex-col items-start justify-between gap-3 sm:flex-row">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-100">{t("title")}</h1>
            <p className="mt-1 text-sm text-slate-400">
              {t("description")}
            </p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap">
          {hasUnsavedChanges && (
            <>
              <span className="flex items-center gap-2 rounded-sm border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-300">
                <span className="size-1.5 rounded-full bg-amber-400"></span>
                Unsaved changes
              </span>
              <Button variant="ghost" onClick={handleDiscard} disabled={saving} className="px-2.5 py-1 text-xs">
                Discard Changes
              </Button>
            </>
          )}
          <Button onClick={handleSave} disabled={saving || !hasUnsavedChanges} className="px-2.5 py-1 text-xs">
            {saving ? t("saving") : t("saveChanges")}
          </Button>
          </div>
        </div>
      </section>

      <div className="rounded-sm border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
        <strong>{t("warning")}:</strong>{" "}
        <span>
          {t("warningInvalid")}
        </span>
      </div>

      {/* General Settings */}
      <section className="space-y-3 rounded-md border border-slate-700/70 bg-slate-900/25 p-4">
        <SectionHeader title={t("generalSettings")} />
           <div className="grid gap-4 sm:grid-cols-2">
              <ConfigField
                label={t("upstreamProxy")}
               description={t("upstreamProxyDesc")}
             >
               <Input
                 type="text"
                 name="proxy-url"
                 value={config["proxy-url"] ?? ""}
                 onChange={(value) => updateConfig("proxy-url", value)}
                 placeholder={t("proxyPlaceholder")}
                 className="font-mono"
               />
             </ConfigField>

             <ConfigField
               label={t("forceModelPrefix")}
               description={t("forceModelPrefixDesc")}
             >
               <Toggle
                 enabled={config["force-model-prefix"] ?? false}
                 onChange={(value) => updateConfig("force-model-prefix", value)}
               />
             </ConfigField>

             <ConfigField
               label={t("debugMode")}
               description={t("debugModeDesc")}
             >
               <Toggle
                 enabled={config.debug ?? false}
                 onChange={(value) => updateConfig("debug", value)}
               />
             </ConfigField>

            <ConfigField
              label={t("commercialMode")}
              description={t("commercialModeDesc")}
            >
              <Toggle
                enabled={config["commercial-mode"] ?? false}
                onChange={(value) => updateConfig("commercial-mode", value)}
              />
            </ConfigField>

            <ConfigField
              label={t("wsAuth")}
              description={t("wsAuthDesc")}
            >
              <Toggle
                enabled={config["ws-auth"] ?? false}
                onChange={(value) => updateConfig("ws-auth", value)}
              />
            </ConfigField>
          </div>
      </section>

      {/* Streaming Settings */}
      <section className="space-y-3 rounded-md border border-slate-700/70 bg-slate-900/25 p-4">
        <SectionHeader title={t("streaming")} />
           <div className="grid gap-4 sm:grid-cols-2">
             <ConfigField
               label={t("keepaliveSeconds")}
              description={t("keepaliveSecondsDesc")}
            >
              <Input
                type="number"
                name="keepalive-seconds"
                value={String(config.streaming?.["keepalive-seconds"] ?? 0)}
                onChange={(value) =>
                  updateStreamingConfig("keepalive-seconds", Number(value))
                }
                className="font-mono"
              />
            </ConfigField>

             <ConfigField
               label={t("bootstrapRetries")}
               description={t("bootstrapRetriesDesc")}
             >
               <Input
                 type="number"
                 name="bootstrap-retries"
                 value={String(config.streaming?.["bootstrap-retries"] ?? 0)}
                 onChange={(value) =>
                   updateStreamingConfig("bootstrap-retries", Number(value))
                 }
                 className="font-mono"
               />
             </ConfigField>

             <ConfigField
               label={t("nonStreamKeepalive")}
               description={t("nonStreamKeepaliveDesc")}
             >
               <Input
                 type="number"
                 name="nonstream-keepalive-interval"
                 value={String(config.streaming?.["nonstream-keepalive-interval"] ?? 0)}
                 onChange={(value) =>
                   updateStreamingConfig("nonstream-keepalive-interval", Number(value))
                 }
                 className="font-mono"
               />
             </ConfigField>
           </div>
      </section>

      {/* Retry & Resilience */}
      <section className="space-y-3 rounded-md border border-slate-700/70 bg-slate-900/25 p-4">
        <SectionHeader title={t("retryResilience")} />
           <div className="grid gap-4 sm:grid-cols-2">
             <ConfigField
               label={t("requestRetry")}
              description={t("requestRetryDesc")}
            >
              <Input
                type="number"
                name="request-retry"
                value={String(config["request-retry"] ?? 0)}
                onChange={(value) => updateConfig("request-retry", Number(value))}
                className="font-mono"
              />
            </ConfigField>

            <ConfigField
              label={t("maxRetryInterval")}
              description={t("maxRetryIntervalDesc")}
            >
              <Input
                type="number"
                name="max-retry-interval"
                value={String(config["max-retry-interval"] ?? 0)}
                onChange={(value) => updateConfig("max-retry-interval", Number(value))}
                className="font-mono"
              />
            </ConfigField>

             <ConfigField
               label={t("routingStrategy")}
               description={t("routingStrategyDesc")}
             >
               <Select
                 value={config.routing?.strategy ?? "round-robin"}
                 onChange={(value) => updateRoutingConfig("strategy", value)}
                 options={[
                   { value: "round-robin", label: t("roundRobin") },
                   { value: "random", label: t("random") },
                   { value: "least-loaded", label: t("leastLoaded") },
                 ]}
               />
             </ConfigField>

             <ConfigField
               label={t("switchProject")}
               description={t("switchProjectDesc")}
             >
               <Toggle
                 enabled={config["quota-exceeded"]?.["switch-project"] ?? false}
                 onChange={(value) =>
                   updateQuotaConfig("switch-project", value)
                 }
               />
             </ConfigField>

            <ConfigField
              label={t("switchPreviewModel")}
              description={t("switchPreviewModelDesc")}
            >
              <Toggle
                enabled={config["quota-exceeded"]?.["switch-preview-model"] ?? false}
                onChange={(value) =>
                  updateQuotaConfig("switch-preview-model", value)
                }
              />
            </ConfigField>
          </div>
      </section>

      {/* Logging */}
      <section className="space-y-3 rounded-md border border-slate-700/70 bg-slate-900/25 p-4">
        <SectionHeader title={t("logging")} />
           <div className="grid gap-4 sm:grid-cols-2">
             <ConfigField
               label={t("loggingToFile")}
              description={t("loggingToFileDesc")}
            >
              <Toggle
                enabled={config["logging-to-file"] ?? false}
                onChange={(value) => updateConfig("logging-to-file", value)}
              />
            </ConfigField>

            <ConfigField
              label={t("usageStatistics")}
              description={t("usageStatisticsDesc")}
            >
              <Toggle
                enabled={config["usage-statistics-enabled"] ?? false}
                onChange={(value) => updateConfig("usage-statistics-enabled", value)}
              />
            </ConfigField>

            <ConfigField
              label={t("maxLogSize")}
              description={t("maxLogSizeDesc")}
            >
              <Input
                type="number"
                name="logs-max-total-size-mb"
                value={String(config["logs-max-total-size-mb"] ?? 0)}
                onChange={(value) => updateConfig("logs-max-total-size-mb", Number(value))}
                className="font-mono"
              />
            </ConfigField>

            <ConfigField
              label={t("maxErrorLogFiles")}
              description={t("maxErrorLogFilesDesc")}
            >
              <Input
                type="number"
                name="error-logs-max-files"
                value={String(config["error-logs-max-files"] ?? 0)}
                onChange={(value) => updateConfig("error-logs-max-files", Number(value))}
                className="font-mono"
              />
            </ConfigField>
          </div>
      </section>

      {/* Advanced: Raw JSON Editor */}
      <section className="space-y-3 rounded-md border border-rose-500/40 bg-rose-500/5 p-4">
            <div className="flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
              <SectionHeader title={t("advancedRawJson")} />
              <Button
                variant="ghost"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="text-xs"
              >
                {showAdvanced ? t("hideRawJson") : t("showRawJson")}
              </Button>
            </div>
        {showAdvanced && (
            <div className="space-y-4">
              <div className="rounded-sm border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">
                <strong>{t("warning")}:</strong>{" "}
                <span>
                  {t("rawJsonWarning")}
                </span>
              </div>
              <textarea
                value={rawJson}
                readOnly
                className="h-96 w-full rounded-sm border border-slate-700/70 bg-slate-900/40 p-4 font-mono text-xs text-slate-200 focus:border-blue-400/50 focus:outline-none"
                spellCheck={false}
              />
              <p className="text-xs text-slate-500">
                This is a read-only view of the full configuration. Use the structured forms above to make changes.
              </p>
            </div>
        )}
      </section>

      <div className="rounded-sm border border-slate-700/70 bg-slate-900/25 p-4 text-xs text-slate-400">
        <strong>TIP:</strong> {t("tip")}
      </div>
    </div>
  );
}
