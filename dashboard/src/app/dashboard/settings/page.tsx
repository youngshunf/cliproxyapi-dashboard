"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/ui/toast";
import { DeployDashboard } from "@/components/deploy-dashboard";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { extractApiError } from "@/lib/utils";
import { API_ENDPOINTS } from "@/lib/api-endpoints";
import { TelegramSettings } from "@/components/settings/telegram-settings";
import { ProviderSettings } from "@/components/settings/provider-settings";
import { PasswordSettings } from "@/components/settings/password-settings";

interface ProxyUpdateInfo {
  currentVersion: string;
  currentDigest: string;
  latestVersion: string;
  latestDigest: string;
  updateAvailable: boolean;
  availableVersions: string[];
}

interface DashboardUpdateInfo {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  availableVersions: string[];
  releaseUrl: string | null;
  releaseNotes: string | null;
}

interface SyncToken {
  id: string;
  name: string;
  syncApiKeyId: string | null;
  syncApiKeyName: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  isRevoked: boolean;
}

interface AvailableApiKey {
  id: string;
  name: string;
}

export default function SettingsPage() {
  const t = useTranslations("settings");
  const [cliProxyVersion, setCliProxyVersion] = useState<string | null>(null);
  const [cliProxyLoading, setCliProxyLoading] = useState(true);

  const [proxyUpdateInfo, setProxyUpdateInfo] = useState<ProxyUpdateInfo | null>(null);
  const [proxyUpdateLoading, setProxyUpdateLoading] = useState(true);
  const [proxyUpdating, setProxyUpdating] = useState(false);

  const [dashboardUpdateInfo, setDashboardUpdateInfo] = useState<DashboardUpdateInfo | null>(null);
  const [dashboardUpdateLoading, setDashboardUpdateLoading] = useState(true);
  const [dashboardUpdating, setDashboardUpdating] = useState(false);
  const [revokingSessions, setRevokingSessions] = useState(false);

  const [syncTokens, setSyncTokens] = useState<SyncToken[]>([]);
  const [syncTokensLoading, setSyncTokensLoading] = useState(true);
  const [generatingToken, setGeneratingToken] = useState(false);
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);
  const [showInstructions, setShowInstructions] = useState(false);
  const [availableApiKeys, setAvailableApiKeys] = useState<AvailableApiKey[]>([]);

  const [showConfirmProxyUpdate, setShowConfirmProxyUpdate] = useState(false);
  const [pendingProxyVersion, setPendingProxyVersion] = useState<string>("latest");
  const [showConfirmDashboardUpdate, setShowConfirmDashboardUpdate] = useState(false);
  const [showConfirmRevokeToken, setShowConfirmRevokeToken] = useState(false);
  const [pendingRevokeTokenId, setPendingRevokeTokenId] = useState<string | null>(null);
  const [showConfirmRevokeSessions, setShowConfirmRevokeSessions] = useState(false);

  const { showToast } = useToast();

  const fetchProxyUpdateInfo = useCallback(async (signal?: AbortSignal) => {
    setProxyUpdateLoading(true);
    try {
      const res = await fetch(API_ENDPOINTS.UPDATE.CHECK, { signal });
      if (res.ok) {
        const data = await res.json();
        setProxyUpdateInfo(data);
      }
    } catch (err) {
      if (signal?.aborted) return;
    } finally {
      if (!signal?.aborted) setProxyUpdateLoading(false);
    }
  }, []);

  const fetchDashboardUpdateInfo = useCallback(async (signal?: AbortSignal) => {
    setDashboardUpdateLoading(true);
    try {
      const res = await fetch(API_ENDPOINTS.UPDATE.DASHBOARD_CHECK, { signal });
      if (res.ok) {
        const data = await res.json();
        setDashboardUpdateInfo(data);
      }
    } catch (err) {
      if (signal?.aborted) return;
    } finally {
      if (!signal?.aborted) setDashboardUpdateLoading(false);
    }
  }, []);

  const fetchSyncTokens = useCallback(async (signal?: AbortSignal) => {
    setSyncTokensLoading(true);
    try {
      const res = await fetch(API_ENDPOINTS.CONFIG_SYNC.TOKENS, { signal });
      if (res.ok) {
        const data = await res.json();
        setSyncTokens(data.tokens || []);
        if (Array.isArray(data.apiKeys)) {
          setAvailableApiKeys(data.apiKeys);
        }
      }
    } catch (err) {
      if (signal?.aborted) return;
    } finally {
      if (!signal?.aborted) setSyncTokensLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    const fetchVersion = async () => {
      setCliProxyLoading(true);
      try {
        const res = await fetch(API_ENDPOINTS.MANAGEMENT.LATEST_VERSION, { signal: controller.signal });
        if (!res.ok) {
          setCliProxyVersion(null);
          setCliProxyLoading(false);
          return;
        }

        const data = await res.json();
        const version = typeof data?.["latest-version"] === "string" ? data["latest-version"] : null;
        setCliProxyVersion(version);
        setCliProxyLoading(false);
      } catch {
        if (controller.signal.aborted) return;
        setCliProxyVersion(null);
        setCliProxyLoading(false);
      }
    };

    fetchVersion();
    fetchProxyUpdateInfo(controller.signal);
    fetchDashboardUpdateInfo(controller.signal);
    fetchSyncTokens(controller.signal);

    return () => controller.abort();
  }, [fetchProxyUpdateInfo, fetchDashboardUpdateInfo, fetchSyncTokens]);

  const confirmProxyUpdate = (version: string = "latest") => {
    setPendingProxyVersion(version);
    setShowConfirmProxyUpdate(true);
  };

  const handleProxyUpdate = async () => {
    const version = pendingProxyVersion;
    setProxyUpdating(true);
    try {
      const res = await fetch(API_ENDPOINTS.UPDATE.BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version, confirm: true }),
      });

      if (res.ok) {
        showToast(t("updatedRestarting", { version }), "success");
        setTimeout(() => {
          fetchProxyUpdateInfo();
        }, 10000);
      } else {
        const data = await res.json();
        showToast(extractApiError(data, t("updateFailed")), "error");
      }
    } catch {
      showToast(t("networkErrorUpdate"), "error");
    } finally {
      setProxyUpdating(false);
    }
  };

  const confirmDashboardUpdate = () => {
    setShowConfirmDashboardUpdate(true);
  };

  const handleDashboardUpdate = async () => {
    setDashboardUpdating(true);
    try {
      const res = await fetch(API_ENDPOINTS.UPDATE.DASHBOARD, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });

      const data = await res.json().catch(() => null);

      if (res.ok) {
        const msg = typeof data?.message === "string" ? data.message : t("dashboardUpdatedRestarting");
        showToast(msg, "success");
        setTimeout(() => {
          fetchDashboardUpdateInfo();
        }, 10000);
      } else {
        const errMsg = extractApiError(data, "Update failed");
        showToast(errMsg, "error");
      }
    } catch {
      showToast("Network error during update", "error");
    } finally {
      setDashboardUpdating(false);
    }
  };

  const handleGenerateToken = async () => {
    setGeneratingToken(true);
    try {
      const res = await fetch(API_ENDPOINTS.CONFIG_SYNC.TOKENS, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (!res.ok) {
        const data = await res.json();
        showToast(extractApiError(data, "Failed to generate token"), "error");
        setGeneratingToken(false);
        return;
      }

      const data = await res.json();
      setGeneratedToken(data.token);
      showToast(t("tokenGenerated"), "success");
      fetchSyncTokens();
      setGeneratingToken(false);
    } catch {
      showToast("Network error", "error");
      setGeneratingToken(false);
    }
  };

  const confirmRevokeToken = (id: string) => {
    setPendingRevokeTokenId(id);
    setShowConfirmRevokeToken(true);
  };

  const handleRevokeToken = async () => {
    if (!pendingRevokeTokenId) return;
    const id = pendingRevokeTokenId;

    try {
      const res = await fetch(`${API_ENDPOINTS.CONFIG_SYNC.TOKENS}/${id}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const data = await res.json();
        showToast(extractApiError(data, "Failed to revoke token"), "error");
        return;
      }

      showToast(t("tokenRevoked"), "success");
      fetchSyncTokens();
    } catch {
      showToast("Network error", "error");
    }
  };

  const handleUpdateTokenApiKey = async (tokenId: string, apiKeyId: string) => {
    try {
      const res = await fetch(`${API_ENDPOINTS.CONFIG_SYNC.TOKENS}/${tokenId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ syncApiKey: apiKeyId || null }),
      });

      if (res.ok) {
        showToast(t("apiKeyUpdated"), "success");
        const selectedKey = availableApiKeys.find((k) => k.id === apiKeyId);
        setSyncTokens((prev) =>
          prev.map((t) => (t.id === tokenId ? { ...t, syncApiKeyId: apiKeyId || null, syncApiKeyName: selectedKey?.name || null } : t))
        );
      } else {
        const data = await res.json();
        showToast(extractApiError(data, "Failed to update API key"), "error");
      }
    } catch {
      showToast("Network error", "error");
    }
  };

  const handleCopyToken = async (token: string) => {
    try {
      await navigator.clipboard.writeText(token);
      showToast(t("tokenCopied"), "success");
    } catch {
      showToast(t("failedCopyToken"), "error");
    }
  };

  const confirmRevokeSessions = () => {
    setShowConfirmRevokeSessions(true);
  };

  const handleRevokeAllSessions = async () => {
    setRevokingSessions(true);
    try {
      const res = await fetch(API_ENDPOINTS.ADMIN.REVOKE_SESSIONS, {
        method: "POST",
      });

      if (!res.ok) {
        const data = await res.json();
        showToast(extractApiError(data, "Failed to revoke sessions"), "error");
        setRevokingSessions(false);
        return;
      }

      const data = await res.json();
      showToast(data.message || t("allSessionsRevoked"), "success");
      setRevokingSessions(false);
    } catch {
      showToast("Network error", "error");
      setRevokingSessions(false);
    }
  };

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-3">
        <h1 className="text-xl font-semibold tracking-tight text-slate-100">{t("title")}</h1>
        <p className="mt-1 text-sm text-slate-400">{t("description")}</p>
      </section>

      <TelegramSettings
        syncTokens={syncTokens}
        syncTokensLoading={syncTokensLoading}
        generatingToken={generatingToken}
        generatedToken={generatedToken}
        showInstructions={showInstructions}
        availableApiKeys={availableApiKeys}
        onGenerateToken={handleGenerateToken}
        onClearGeneratedToken={() => setGeneratedToken(null)}
        onCopyToken={handleCopyToken}
        onToggleInstructions={() => setShowInstructions(!showInstructions)}
        onConfirmRevokeToken={confirmRevokeToken}
        onUpdateTokenApiKey={handleUpdateTokenApiKey}
      />

      <ProviderSettings
        proxyUpdateInfo={proxyUpdateInfo}
        proxyUpdateLoading={proxyUpdateLoading}
        proxyUpdating={proxyUpdating}
        dashboardUpdateInfo={dashboardUpdateInfo}
        dashboardUpdateLoading={dashboardUpdateLoading}
        dashboardUpdating={dashboardUpdating}
        onConfirmProxyUpdate={confirmProxyUpdate}
        onConfirmDashboardUpdate={confirmDashboardUpdate}
        onRefreshProxyUpdate={fetchProxyUpdateInfo}
        onRefreshDashboardUpdate={fetchDashboardUpdateInfo}
      />

      <DeployDashboard />

      <PasswordSettings
        cliProxyVersion={cliProxyVersion}
        cliProxyLoading={cliProxyLoading}
        dashboardUpdateInfo={dashboardUpdateInfo}
        revokingSessions={revokingSessions}
        onConfirmRevokeSessions={confirmRevokeSessions}
      />

      <ConfirmDialog
        isOpen={showConfirmProxyUpdate}
        onClose={() => {
          setShowConfirmProxyUpdate(false);
          setPendingProxyVersion("latest");
        }}
        onConfirm={handleProxyUpdate}
        title={t("confirmUpdateProxy")}
        message={t("confirmUpdateProxyMsg", { version: pendingProxyVersion })}
        confirmLabel={t("update")}
        cancelLabel={t("cancel")}
        variant="warning"
      />

      <ConfirmDialog
        isOpen={showConfirmDashboardUpdate}
        onClose={() => setShowConfirmDashboardUpdate(false)}
        onConfirm={handleDashboardUpdate}
        title={t("confirmUpdateDashboard")}
        message={t("confirmUpdateDashboardMsg")}
        confirmLabel={t("update")}
        cancelLabel={t("cancel")}
        variant="warning"
      />

      <ConfirmDialog
        isOpen={showConfirmRevokeToken}
        onClose={() => {
          setShowConfirmRevokeToken(false);
          setPendingRevokeTokenId(null);
        }}
        onConfirm={handleRevokeToken}
        title={t("confirmRevokeToken")}
        message={t("confirmRevokeTokenMsg")}
        confirmLabel={t("revoke")}
        cancelLabel={t("cancel")}
        variant="danger"
      />

      <ConfirmDialog
        isOpen={showConfirmRevokeSessions}
        onClose={() => setShowConfirmRevokeSessions(false)}
        onConfirm={handleRevokeAllSessions}
        title={t("confirmForceLogout")}
        message={t("confirmForceLogoutMsg")}
        confirmLabel={t("forceLogoutAll")}
        cancelLabel={t("cancel")}
        variant="danger"
      />
    </div>
  );
}
