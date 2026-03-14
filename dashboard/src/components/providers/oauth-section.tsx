"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, ModalContent, ModalFooter, ModalHeader, ModalTitle } from "@/components/ui/modal";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { extractApiError } from "@/lib/utils";
import { API_ENDPOINTS } from "@/lib/api-endpoints";
import type { CurrentUserLike } from "@/components/providers/api-key-section";
import { OAuthCredentialList, type OAuthAccountWithOwnership } from "@/components/providers/oauth-credential-list";
import { OAuthImportForm } from "@/components/providers/oauth-import-form";
import { OAuthActions } from "@/components/providers/oauth-actions";
import { useTranslations } from "next-intl";

type ShowToast = ReturnType<typeof useToast>["showToast"];

interface OAuthSectionProps {
  showToast: ShowToast;
  currentUser: CurrentUserLike | null;
  refreshProviders: () => Promise<void>;
  onAccountCountChange: (count: number) => void;
}

const OAUTH_PROVIDERS = [
  {
    id: "claude" as const,
    name: "Claude Code",
    description: "Anthropic Claude (Pro/Max subscription)",
    authEndpoint: "/api/management/anthropic-auth-url?is_webui=true",
    requiresCallback: true,
  },
  {
    id: "gemini-cli" as const,
    name: "Gemini CLI",
    description: "Google Gemini (via Google OAuth)",
    authEndpoint: "/api/management/gemini-cli-auth-url?project_id=ALL&is_webui=true",
    requiresCallback: true,
  },
  {
    id: "codex" as const,
    name: "Codex",
    description: "OpenAI Codex (Plus/Pro subscription)",
    authEndpoint: "/api/management/codex-auth-url?is_webui=true",
    requiresCallback: true,
  },
  {
    id: "antigravity" as const,
    name: "Antigravity",
    description: "Google Antigravity (via Google OAuth)",
    authEndpoint: "/api/management/antigravity-auth-url?is_webui=true",
    requiresCallback: true,
  },
  {
    id: "iflow" as const,
    name: "iFlow",
    description: "iFlytek iFlow (via OAuth)",
    authEndpoint: "/api/management/iflow-auth-url?is_webui=true",
    requiresCallback: true,
  },
  {
    id: "kimi" as const,
    name: "Kimi",
    description: "Moonshot AI Kimi (device OAuth)",
    authEndpoint: "/api/management/kimi-auth-url?is_webui=true",
    requiresCallback: false,
  },
  {
    id: "qwen" as const,
    name: "Qwen Code",
    description: "Alibaba Qwen Code (device OAuth)",
    authEndpoint: "/api/management/qwen-auth-url?is_webui=true",
    requiresCallback: false,
  },
  {
    id: "copilot" as const,
    name: "GitHub Copilot",
    description: "GitHub Copilot (via GitHub device OAuth)",
    authEndpoint: "/api/management/github-auth-url?is_webui=true",
    requiresCallback: false,
  },
  {
    id: "kiro" as const,
    name: "Kiro",
    description: "AWS CodeWhisperer / Kiro (device OAuth)",
    authEndpoint: "/api/management/kiro-auth-url?is_webui=true",
    requiresCallback: false,
  },
] as const;

type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];
export type OAuthProviderId = OAuthProvider["id"];
const OAUTH_STATUS_POLL_INTERVAL_MS = 5000;
const OAUTH_STATUS_POLL_INTERVAL_HIDDEN_MS = 10000;

const MODAL_STATUS = {
  IDLE: "idle",
  LOADING: "loading",
  WAITING: "waiting",
  SUBMITTING: "submitting",
  POLLING: "polling",
  SUCCESS: "success",
  ERROR: "error",
} as const;

type ModalStatus = (typeof MODAL_STATUS)[keyof typeof MODAL_STATUS];

const CALLBACK_VALIDATION = {
  EMPTY: "empty",
  INVALID: "invalid",
  VALID: "valid",
} as const;

type CallbackValidation =
  (typeof CALLBACK_VALIDATION)[keyof typeof CALLBACK_VALIDATION];

interface AuthUrlResponse {
  status?: string;
  url?: string;
  state?: string;
  user_code?: string;
  method?: string;
  verification_uri?: string;
}
interface AuthStatusResponse {
  status?: string;
  error?: string;
  verification_url?: string;
  user_code?: string;
  url?: string;
}

interface OAuthCallbackResponse {
  status?: number;
  error?: string;
}

const getOAuthProviderById = (id: OAuthProviderId | null) =>
  OAUTH_PROVIDERS.find((provider) => provider.id === id) || null;

function isTabVisible(): boolean {
  if (typeof document === "undefined") return true;
  return document.visibilityState === "visible";
}

const validateCallbackUrl = (value: string) => {
  if (!value.trim()) {
    return { status: CALLBACK_VALIDATION.EMPTY, messageKey: "pasteFull" };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(value.trim());
  } catch {
    return {
      status: CALLBACK_VALIDATION.INVALID,
      messageKey: "invalidUrl",
    };
  }

  const code = parsedUrl.searchParams.get("code");
  const state = parsedUrl.searchParams.get("state");

  if (!code || !state) {
    return {
      status: CALLBACK_VALIDATION.INVALID,
      messageKey: "missingParams",
    };
  }

  return {
    status: CALLBACK_VALIDATION.VALID,
    messageKey: "ready",
  };
};

export function OAuthSection({
  showToast,
  currentUser,
  refreshProviders,
  onAccountCountChange,
}: OAuthSectionProps) {
  const t = useTranslations("providers.oauthSection");
  const [isOAuthModalOpen, setIsOAuthModalOpen] = useState(false);
  const [oauthModalStatus, setOauthModalStatus] = useState<ModalStatus>(MODAL_STATUS.IDLE);
  const [selectedOAuthProviderId, setSelectedOAuthProviderId] = useState<OAuthProviderId | null>(null);
  const [authState, setAuthState] = useState<string | null>(null);
  const [callbackUrl, setCallbackUrl] = useState("");
  const [callbackValidation, setCallbackValidation] = useState<CallbackValidation>(CALLBACK_VALIDATION.EMPTY);
  const [callbackMessage, setCallbackMessage] = useState("pasteFull");
  const [oauthErrorMessage, setOauthErrorMessage] = useState<string | null>(null);
  const pollingIntervalRef = useRef<number | null>(null);
  const pollingAttemptsRef = useRef(0);
  const noCallbackClaimTimeoutRef = useRef<number | null>(null);
  const noCallbackClaimAttemptsRef = useRef(0);
  const authStateRef = useRef<string | null>(null);
  const selectedOAuthProviderIdRef = useRef<OAuthProviderId | null>(null);
  const [deviceCodeInfo, setDeviceCodeInfo] = useState<{ verificationUrl: string; userCode: string } | null>(null);
  const deviceCodePopupOpenedRef = useRef(false);
  const [accounts, setAccounts] = useState<OAuthAccountWithOwnership[]>([]);
  const [oauthAccountsLoading, setOauthAccountsLoading] = useState(true);
  const [showConfirmOAuthDelete, setShowConfirmOAuthDelete] = useState(false);
  const [pendingOAuthDelete, setPendingOAuthDelete] = useState<{ accountId: string; accountName: string } | null>(null);
  const [togglingAccountId, setTogglingAccountId] = useState<string | null>(null);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importProviderId, setImportProviderId] = useState<OAuthProviderId | null>(null);
  const [importJsonContent, setImportJsonContent] = useState("");
  const [importFileName, setImportFileName] = useState("");
  const [importStatus, setImportStatus] = useState<"idle" | "validating" | "uploading" | "success" | "error">("idle");
  const [importErrorMessage, setImportErrorMessage] = useState<string | null>(null);

  const selectedOAuthProvider = getOAuthProviderById(selectedOAuthProviderId);
  const selectedOAuthProviderRequiresCallback = selectedOAuthProvider?.requiresCallback ?? true;

  const stopPolling = useCallback(() => {
    if (pollingIntervalRef.current !== null) {
      window.clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    pollingAttemptsRef.current = 0;
  }, []);

  const stopNoCallbackClaimPolling = useCallback(() => {
    if (noCallbackClaimTimeoutRef.current !== null) {
      window.clearTimeout(noCallbackClaimTimeoutRef.current);
      noCallbackClaimTimeoutRef.current = null;
    }
    noCallbackClaimAttemptsRef.current = 0;
  }, []);

  const loadAccounts = useCallback(async () => {
    setOauthAccountsLoading(true);
    try {
      const res = await fetch(API_ENDPOINTS.PROVIDERS.OAUTH);
      if (!res.ok) {
        showToast(t("errors.loadAccounts"), "error");
        setOauthAccountsLoading(false);
        return;
      }

      const data = await res.json();
      const nextAccounts = Array.isArray(data.accounts) ? data.accounts : [];
      setAccounts(nextAccounts);
      onAccountCountChange(nextAccounts.length);
      setOauthAccountsLoading(false);
    } catch {
      setOauthAccountsLoading(false);
      showToast("Network error", "error");
      setOauthErrorMessage(t("errors.loadAccountsNetwork"));
    }
  }, [onAccountCountChange, showToast]);

  const toggleOAuthAccount = async (accountId: string, currentlyDisabled: boolean) => {
    setTogglingAccountId(accountId);
    try {
      const res = await fetch(`${API_ENDPOINTS.PROVIDERS.OAUTH}/${accountId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disabled: !currentlyDisabled }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(extractApiError(data, t("errors.updateAccount")), "error");
      } else {
        showToast(!currentlyDisabled ? t("success.disabled") : t("success.enabled"), "success");
        await loadAccounts();
        await refreshProviders();
      }
    } catch {
      showToast("Network error", "error");
    } finally {
      setTogglingAccountId(null);
    }
  };

  const openAuthPopup = (url: string) => {
    const popup = window.open(url, "oauth", "width=600,height=800");
    return popup !== null;
  };

  const pollAuthStatus = (state: string) => {
    if (pollingIntervalRef.current !== null) {
      return;
    }

    pollingIntervalRef.current = window.setInterval(async () => {
      if (!isTabVisible()) {
        return;
      }

      pollingAttemptsRef.current += 1;
      if (pollingAttemptsRef.current > 60) {
        stopPolling();
        setOauthModalStatus(MODAL_STATUS.ERROR);
        setOauthErrorMessage(t("errors.timeout"));
        return;
      }

      try {
        const res = await fetch(
          `/api/management/get-auth-status?state=${encodeURIComponent(state)}`
        );
        if (!res.ok) {
          stopPolling();
          setOauthModalStatus(MODAL_STATUS.ERROR);
          setOauthErrorMessage(t("errors.statusCheckFailed"));
          return;
        }

        const data: AuthStatusResponse = await res.json();
        if (data.status === "wait") {
          return;
        }

        if (data.status === "device_code" && data.verification_url && data.user_code) {
          setDeviceCodeInfo({
            verificationUrl: data.verification_url,
            userCode: data.user_code,
          });
          if (!deviceCodePopupOpenedRef.current) {
            deviceCodePopupOpenedRef.current = true;
            window.open(data.verification_url, "oauth", "width=600,height=800");
          }
          return;
        }

        if (data.status === "ok") {
          stopPolling();
          setOauthModalStatus(MODAL_STATUS.SUCCESS);
          showToast(t("success.connected"), "success");
          await refreshProviders();
          void loadAccounts();
          return;
        }

        if (data.status === "error") {
          stopPolling();
          setOauthModalStatus(MODAL_STATUS.ERROR);
          setOauthErrorMessage(extractApiError(data, t("errors.authorizationFailed")));
          return;
        }
      } catch {
        stopPolling();
        setOauthModalStatus(MODAL_STATUS.ERROR);
        setOauthErrorMessage(t("errors.pollNetwork"));
      }
    }, isTabVisible() ? OAUTH_STATUS_POLL_INTERVAL_MS : OAUTH_STATUS_POLL_INTERVAL_HIDDEN_MS);
  };

  const resetOAuthModalState = () => {
    stopPolling();
    stopNoCallbackClaimPolling();
    setOauthModalStatus(MODAL_STATUS.IDLE);
    selectedOAuthProviderIdRef.current = null;
    setSelectedOAuthProviderId(null);
    authStateRef.current = null;
    setAuthState(null);
    setCallbackUrl("");
    setCallbackValidation(CALLBACK_VALIDATION.EMPTY);
    setCallbackMessage("pasteFull");
    setOauthErrorMessage(null);
    setDeviceCodeInfo(null);
    deviceCodePopupOpenedRef.current = false;
  };

  const handleOAuthModalClose = () => {
    setIsOAuthModalOpen(false);
    resetOAuthModalState();
  };

  async function claimOAuthWithoutCallback(providerId: OAuthProviderId, state: string) {
    try {
      const res = await fetch(API_ENDPOINTS.MANAGEMENT.OAUTH_CALLBACK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: providerId, state }),
      });

      const data: OAuthCallbackResponse = await res.json().catch(() => ({}));

      if (res.status === 202 || data.status === 202) {
        if (noCallbackClaimAttemptsRef.current >= 25) {
          stopNoCallbackClaimPolling();
          return;
        }

        noCallbackClaimAttemptsRef.current += 1;
        if (noCallbackClaimTimeoutRef.current !== null) {
          window.clearTimeout(noCallbackClaimTimeoutRef.current);
        }
        noCallbackClaimTimeoutRef.current = window.setTimeout(() => {
          void claimOAuthWithoutCallback(providerId, state);
        }, 3000);
        return;
      }

      if (!res.ok) {
        stopNoCallbackClaimPolling();
        stopPolling();
        setOauthModalStatus(MODAL_STATUS.ERROR);
        setOauthErrorMessage(extractApiError(data, t("errors.ownershipClaimFailed")));
        return;
      }

      stopNoCallbackClaimPolling();
      void loadAccounts();
    } catch {
      if (noCallbackClaimAttemptsRef.current >= 25) {
        stopNoCallbackClaimPolling();
        return;
      }
      noCallbackClaimAttemptsRef.current += 1;
      if (noCallbackClaimTimeoutRef.current !== null) {
        window.clearTimeout(noCallbackClaimTimeoutRef.current);
      }
      noCallbackClaimTimeoutRef.current = window.setTimeout(() => {
        void claimOAuthWithoutCallback(providerId, state);
      }, 3000);
    }
  }

  const handleOAuthConnect = async (providerId: OAuthProviderId) => {
    const provider = getOAuthProviderById(providerId);
    if (!provider) return;

    selectedOAuthProviderIdRef.current = providerId;
    setSelectedOAuthProviderId(providerId);
    setIsOAuthModalOpen(true);
    setOauthModalStatus(MODAL_STATUS.LOADING);
    setOauthErrorMessage(null);
    setCallbackUrl("");
    setCallbackValidation(CALLBACK_VALIDATION.EMPTY);
    setCallbackMessage("pasteFull");

    try {
      const res = await fetch(provider.authEndpoint);
      if (!res.ok) {
        setOauthModalStatus(MODAL_STATUS.ERROR);
        setOauthErrorMessage(t("errors.startFailed"));
        return;
      }

      const data: AuthUrlResponse = await res.json();
      if (!data.state) {
        setOauthModalStatus(MODAL_STATUS.ERROR);
        setOauthErrorMessage(t("errors.missingState"));
        return;
      }

      if (!data.url && data.method === "device_code") {
        authStateRef.current = data.state;
        setAuthState(data.state);
        setOauthModalStatus(MODAL_STATUS.POLLING);
        setCallbackValidation(CALLBACK_VALIDATION.VALID);
        setCallbackMessage("deviceWaiting");
        showToast(t("toast.deviceInit"), "info");
        pollAuthStatus(data.state);
        stopNoCallbackClaimPolling();
        void claimOAuthWithoutCallback(provider.id, data.state);
        return;
      }

      if (!data.url) {
        setOauthModalStatus(MODAL_STATUS.ERROR);
        setOauthErrorMessage(t("errors.missingUrl"));
        return;
      }
      const popupOpened = openAuthPopup(data.url);
      if (!popupOpened) {
        setOauthModalStatus(MODAL_STATUS.ERROR);
        setOauthErrorMessage(t("errors.popupBlocked"));
        return;
      }
      authStateRef.current = data.state;
      setAuthState(data.state);
      if (provider.requiresCallback) {
        setOauthModalStatus(MODAL_STATUS.WAITING);
        setCallbackValidation(CALLBACK_VALIDATION.EMPTY);
        setCallbackMessage("pasteFull");
        showToast(t("toast.windowOpenedWithCallback"), "info");
      } else {
        setOauthModalStatus(MODAL_STATUS.POLLING);
        setCallbackValidation(CALLBACK_VALIDATION.VALID);
        setCallbackMessage("noCallback");
        showToast(t("toast.windowOpened"), "info");
        if (data.user_code && data.url) {
          setDeviceCodeInfo({
            verificationUrl: data.url,
            userCode: data.user_code,
          });
          deviceCodePopupOpenedRef.current = true;
        }
        stopNoCallbackClaimPolling();
        void claimOAuthWithoutCallback(providerId, data.state);
      }

      pollAuthStatus(data.state);
    } catch {
      setOauthModalStatus(MODAL_STATUS.ERROR);
      setOauthErrorMessage(t("errors.startNetwork"));
    }
  };

  const handleCallbackChange = (value: string) => {
    setCallbackUrl(value);
    const validation = validateCallbackUrl(value);
    setCallbackValidation(validation.status);
    setCallbackMessage(validation.messageKey);
  };

  const handleSubmitCallback = async () => {
    const currentProvider = selectedOAuthProviderIdRef.current;
    const currentState = authStateRef.current;
    if (!currentProvider || !currentState) {
      console.warn("[OAuth] Submit failed - missing provider or state");
      setOauthModalStatus(MODAL_STATUS.ERROR);
      setOauthErrorMessage(t("errors.missingProviderState"));
      return;
    }

    const validation = validateCallbackUrl(callbackUrl);
    if (validation.status !== CALLBACK_VALIDATION.VALID) {
      setCallbackValidation(validation.status);
      setCallbackMessage(validation.messageKey);
      return;
    }

    setOauthModalStatus(MODAL_STATUS.SUBMITTING);
    setOauthErrorMessage(null);

    try {
      const res = await fetch(API_ENDPOINTS.MANAGEMENT.OAUTH_CALLBACK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: currentProvider,
          callbackUrl: callbackUrl.trim(),
        }),
      });

      const data: OAuthCallbackResponse = await res.json().catch(() => ({}));
      if (!res.ok) {
        setOauthModalStatus(MODAL_STATUS.ERROR);
        setOauthErrorMessage(
          extractApiError(data, t("errors.callbackRelayFailed"))
        );
        return;
      }

      stopPolling();
      setOauthModalStatus(MODAL_STATUS.POLLING);
      pollAuthStatus(currentState);
    } catch {
      setOauthModalStatus(MODAL_STATUS.ERROR);
      setOauthErrorMessage(t("errors.callbackNetwork"));
    }
  };

  const confirmDeleteOAuth = (accountId: string) => {
    const account = accounts.find((a) => a.id === accountId);
    if (!account) return;
    setPendingOAuthDelete({ accountId, accountName: account.accountName });
    setShowConfirmOAuthDelete(true);
  };

  const handleOAuthDelete = async () => {
    if (!pendingOAuthDelete) return;
    const { accountId } = pendingOAuthDelete;

    try {
      const res = await fetch(`${API_ENDPOINTS.PROVIDERS.OAUTH}/${accountId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json();
        showToast(extractApiError(data, t("errors.removeFailed")), "error");
        return;
      }
      showToast(t("success.removed"), "success");
      await refreshProviders();
      void loadAccounts();
    } catch {
      showToast("Network error", "error");
    }
  };

  const openImportModal = (providerId: OAuthProviderId) => {
    setImportProviderId(providerId);
    setImportJsonContent("");
    setImportFileName("");
    setImportStatus("idle");
    setImportErrorMessage(null);
    setIsImportModalOpen(true);
  };

  const closeImportModal = () => {
    setIsImportModalOpen(false);
    setImportProviderId(null);
    setImportJsonContent("");
    setImportFileName("");
    setImportStatus("idle");
    setImportErrorMessage(null);
  };

  const handleImportFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith(".json")) {
      setImportFileName("");
      setImportJsonContent("");
      setImportErrorMessage(t("import.notJson"));
      setImportStatus("error");
      return;
    }

    if (file.size > 1024 * 1024) {
      setImportFileName("");
      setImportJsonContent("");
      setImportErrorMessage(t("import.tooLarge"));
      setImportStatus("error");
      return;
    }

    setImportFileName(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result;
      if (typeof content === "string") {
        setImportJsonContent(content);
        validateImportJson(content);
      }
    };
    reader.onerror = () => {
      setImportErrorMessage(t("import.readFailed"));
      setImportStatus("error");
    };
    reader.readAsText(file);
  };

  const validateImportJson = (content: string) => {
    try {
      const parsed = JSON.parse(content);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        setImportErrorMessage(t("import.mustBeObject"));
        setImportStatus("error");
        return false;
      }
      setImportErrorMessage(null);
      setImportStatus("idle");
      return true;
    } catch {
      setImportErrorMessage(t("import.invalidJson"));
      setImportStatus("error");
      return false;
    }
  };

  const handleImportJsonChange = (value: string) => {
    setImportJsonContent(value);
    if (value.trim()) {
      validateImportJson(value);
    } else {
      setImportErrorMessage(null);
      setImportStatus("idle");
    }
  };

  const handleImportSubmit = async () => {
    if (!importProviderId || !importJsonContent.trim()) return;

    if (!validateImportJson(importJsonContent)) return;

    const fileName = importFileName || `${importProviderId}-credential.json`;

    setImportStatus("uploading");
    setImportErrorMessage(null);

    try {
      const res = await fetch(API_ENDPOINTS.PROVIDERS.OAUTH_IMPORT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: importProviderId,
          fileName,
          fileContent: importJsonContent.trim(),
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setImportStatus("error");
        setImportErrorMessage(extractApiError(data, t("import.uploadFailed")));
        return;
      }

      setImportStatus("success");
      showToast(t("import.success"), "success");
      await refreshProviders();
      void loadAccounts();
    } catch {
      setImportStatus("error");
      setImportErrorMessage(t("import.networkError"));
    }
  };

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadAccounts();
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
      stopPolling();
      stopNoCallbackClaimPolling();
    };
  }, [loadAccounts, stopNoCallbackClaimPolling, stopPolling]);

  const isOAuthSubmitDisabled =
    oauthModalStatus === MODAL_STATUS.LOADING ||
    oauthModalStatus === MODAL_STATUS.SUBMITTING ||
    oauthModalStatus === MODAL_STATUS.POLLING ||
    oauthModalStatus === MODAL_STATUS.SUCCESS ||
    callbackValidation !== CALLBACK_VALIDATION.VALID;

  const importProviderName = importProviderId
    ? getOAuthProviderById(importProviderId)?.name || importProviderId
    : "";

  return (
    <>
      <section id="provider-oauth" className="space-y-3 rounded-lg border border-slate-700/70 bg-slate-900/40 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">{t("title")}</h2>
            <p className="text-xs text-slate-400">{t("subtitle")}</p>
          </div>
          <span className="text-xs font-medium text-slate-400">{t("connectedCount", { count: accounts.length })}</span>
        </div>

        <div className="space-y-3">
          <OAuthCredentialList
            accounts={accounts}
            loading={oauthAccountsLoading}
            currentUser={currentUser}
            togglingAccountId={togglingAccountId}
            onToggle={toggleOAuthAccount}
            onDelete={confirmDeleteOAuth}
          />

          <div className="rounded-sm border border-slate-700/70 bg-slate-900/30 p-3 text-xs text-slate-400">
            <strong className="text-slate-200">{t("note.label")}</strong> {t("note.body")}
          </div>

          <OAuthActions
            providers={OAUTH_PROVIDERS}
            onConnect={handleOAuthConnect}
            onImport={openImportModal}
          />
        </div>
      </section>

      <Modal isOpen={isOAuthModalOpen} onClose={handleOAuthModalClose}>
        <ModalHeader>
          <ModalTitle>
            {selectedOAuthProvider ? t("modal.title", { provider: selectedOAuthProvider.name }) : t("modal.titleFallback")}
          </ModalTitle>
        </ModalHeader>
        <ModalContent>
          {oauthModalStatus === MODAL_STATUS.LOADING && (
            <div className="rounded-xl border-l-4 border-white/30 bg-white/5 p-4 text-sm text-white/80 backdrop-blur-xl">
              {t("modal.loading")}
            </div>
          )}

          {(oauthModalStatus === MODAL_STATUS.WAITING ||
            oauthModalStatus === MODAL_STATUS.SUBMITTING ||
            oauthModalStatus === MODAL_STATUS.POLLING ||
            oauthModalStatus === MODAL_STATUS.ERROR) &&
            selectedOAuthProviderRequiresCallback && (
            <div className="space-y-4">
              <div className="rounded-xl border-l-4 border-purple-400/60 bg-white/10 p-4 text-sm backdrop-blur-xl">
                <div className="font-medium text-white">
                  {t("modal.stepTitle")}
                </div>
                <ol className="mt-3 list-decimal space-y-2 pl-4 text-white/90">
                  <li>{t("modal.steps.step1")}</li>
                  <li>{t("modal.steps.step2")}</li>
                  <li>
                    {t("modal.steps.step3")}
                  </li>
                  <li>{t("modal.steps.step4")}</li>
                </ol>
              </div>

              <div>
                <div className="mb-2 text-xs font-medium text-white/90">
                  {t("modal.callbackLabel")}
                </div>
                <Input
                  type="text"
                  name="callbackUrl"
                  value={callbackUrl}
                  onChange={handleCallbackChange}
                  placeholder="https://localhost/callback?code=...&state=..."
                  disabled={
                    oauthModalStatus === MODAL_STATUS.SUBMITTING ||
                    oauthModalStatus === MODAL_STATUS.POLLING
                  }
                  className="font-mono"
                />
                <div
                  className={`mt-2 rounded-xl border-l-4 p-2 text-xs ${
                    callbackValidation === CALLBACK_VALIDATION.VALID
                      ? "border-green-400/60 bg-green-500/20 text-white backdrop-blur-xl"
                      : callbackValidation === CALLBACK_VALIDATION.INVALID
                        ? "border-red-400/60 bg-red-500/20 text-white backdrop-blur-xl"
                        : "border-white/30 bg-white/5 text-white/70 backdrop-blur-xl"
                  }`}
                >
                  {t(`callbackMessages.${callbackMessage}`)}
                </div>
              </div>
            </div>
          )}

          {(oauthModalStatus === MODAL_STATUS.WAITING ||
            oauthModalStatus === MODAL_STATUS.POLLING ||
            oauthModalStatus === MODAL_STATUS.ERROR) &&
            !selectedOAuthProviderRequiresCallback && (
            <div className="rounded-xl border-l-4 border-purple-400/60 bg-white/10 p-4 text-sm backdrop-blur-xl">
              <div className="font-medium text-white">
                {t("modal.deviceTitle")}
              </div>
              <ol className="mt-3 list-decimal space-y-2 pl-4 text-white/90">
                <li>{t("modal.deviceSteps.step1")}</li>
                <li>{t("modal.deviceSteps.step2")}</li>
                <li>{t("modal.deviceSteps.step3")}</li>
              </ol>
              {deviceCodeInfo && (
                <div className="mt-4 space-y-3">
                  <div className="rounded-lg bg-slate-800/60 p-3">
                    <p className="text-xs font-medium text-slate-400">{t("modal.deviceCodeLabel")}</p>
                    <p className="mt-1 select-all font-mono text-lg font-bold tracking-wider text-white">{deviceCodeInfo.userCode}</p>
                  </div>
                  <p className="text-xs text-slate-400">
                    Enter this code at{" "}
                    <a href={deviceCodeInfo.verificationUrl} target="_blank" rel="noopener noreferrer" className="text-blue-400 underline">
                      {deviceCodeInfo.verificationUrl}
                    </a>
                  </p>
                </div>
              )}
            </div>
          )}

          {oauthModalStatus === MODAL_STATUS.POLLING && (
            <div className="mt-4 rounded-xl border-l-4 border-blue-400/60 bg-blue-500/20 p-4 text-sm text-white backdrop-blur-xl">
              {selectedOAuthProviderRequiresCallback
                ? t("modal.pollingWithCallback")
                : t("modal.pollingWithoutCallback")}
            </div>
          )}

          {oauthModalStatus === MODAL_STATUS.SUCCESS && (
            <div className="rounded-xl border-l-4 border-green-400/60 bg-green-500/20 p-4 text-sm text-white backdrop-blur-xl">
              {t("success.message")}
            </div>
          )}

          {oauthModalStatus === MODAL_STATUS.ERROR && oauthErrorMessage && (
            <div className="rounded-xl border-l-4 border-red-400/60 bg-red-500/20 p-4 text-sm text-white backdrop-blur-xl">
              {oauthErrorMessage}
            </div>
          )}
        </ModalContent>
        <ModalFooter>
          <Button variant="ghost" onClick={handleOAuthModalClose}>
            {t("actions.close") ?? "Close"}
          </Button>
          {oauthModalStatus !== MODAL_STATUS.SUCCESS && selectedOAuthProviderRequiresCallback && (
            <Button
              variant="secondary"
              onClick={handleSubmitCallback}
              disabled={isOAuthSubmitDisabled}
            >
              {oauthModalStatus === MODAL_STATUS.SUBMITTING
                ? t("actions.submitting")
                : oauthModalStatus === MODAL_STATUS.POLLING
                  ? t("actions.waiting")
                  : t("actions.submitUrl")}
            </Button>
          )}
          {oauthModalStatus === MODAL_STATUS.SUCCESS && (
            <Button variant="secondary" onClick={handleOAuthModalClose}>
              {t("actions.done")}
            </Button>
          )}
        </ModalFooter>
      </Modal>

      <ConfirmDialog
        isOpen={showConfirmOAuthDelete}
        onClose={() => {
          setShowConfirmOAuthDelete(false);
          setPendingOAuthDelete(null);
        }}
        onConfirm={handleOAuthDelete}
        title={t("confirm.title")}
        message={t("confirm.message", { name: pendingOAuthDelete?.accountName ?? "" })}
        confirmLabel={t("confirm.confirmLabel")}
        cancelLabel={t("confirm.cancelLabel") ?? "Cancel"}
        variant="danger"
      />

      <OAuthImportForm
        isOpen={isImportModalOpen}
        providerName={importProviderName}
        jsonContent={importJsonContent}
        fileName={importFileName}
        status={importStatus}
        errorMessage={importErrorMessage}
        onClose={closeImportModal}
        onFileSelect={handleImportFileSelect}
        onJsonChange={handleImportJsonChange}
        onSubmit={handleImportSubmit}
      />
    </>
  );
}
