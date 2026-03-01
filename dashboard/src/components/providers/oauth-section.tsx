"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, ModalContent, ModalFooter, ModalHeader, ModalTitle } from "@/components/ui/modal";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { OwnerBadge, type CurrentUserLike } from "@/components/providers/api-key-section";

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
    nameKey: "providers.claude.name",
    descriptionKey: "providers.claude.description",
    authEndpoint: "/api/management/anthropic-auth-url?is_webui=true",
    requiresCallback: true,
  },
  {
    id: "gemini-cli" as const,
    nameKey: "providers.geminiCli.name",
    descriptionKey: "providers.geminiCli.description",
    authEndpoint: "/api/management/gemini-cli-auth-url?project_id=ALL&is_webui=true",
    requiresCallback: true,
  },
  {
    id: "codex" as const,
    nameKey: "providers.codex.name",
    descriptionKey: "providers.codex.description",
    authEndpoint: "/api/management/codex-auth-url?is_webui=true",
    requiresCallback: true,
  },
  {
    id: "antigravity" as const,
    nameKey: "providers.antigravity.name",
    descriptionKey: "providers.antigravity.description",
    authEndpoint: "/api/management/antigravity-auth-url?is_webui=true",
    requiresCallback: true,
  },
  {
    id: "iflow" as const,
    nameKey: "providers.iflow.name",
    descriptionKey: "providers.iflow.description",
    authEndpoint: "/api/management/iflow-auth-url?is_webui=true",
    requiresCallback: true,
  },
  {
    id: "kimi" as const,
    nameKey: "providers.kimi.name",
    descriptionKey: "providers.kimi.description",
    authEndpoint: "/api/management/kimi-auth-url?is_webui=true",
    requiresCallback: false,
  },
  {
    id: "qwen" as const,
    nameKey: "providers.qwen.name",
    descriptionKey: "providers.qwen.description",
    authEndpoint: "/api/management/qwen-auth-url?is_webui=true",
    requiresCallback: false,
  },
  {
    id: "copilot" as const,
    nameKey: "providers.copilot.name",
    descriptionKey: "providers.copilot.description",
    authEndpoint: "/api/management/github-auth-url?is_webui=true",
    requiresCallback: false,
  },
  {
    id: "kiro" as const,
    nameKey: "providers.kiro.name",
    descriptionKey: "providers.kiro.description",
    authEndpoint: "/api/management/kiro-auth-url?is_webui=true",
    requiresCallback: false,
  },
] as const;

type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];
type OAuthProviderId = OAuthProvider["id"];
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

interface OAuthAccountWithOwnership {
  id: string;
  accountName: string;
  accountEmail: string | null;
  provider: string;
  ownerUsername: string | null;
  ownerUserId: string | null;
  isOwn: boolean;
}

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

export function OAuthSection({
  showToast,
  currentUser,
  refreshProviders,
  onAccountCountChange,
}: OAuthSectionProps) {
  const t = useTranslations("providers.oauthSection");
  const common = useTranslations("common");
  const [isOAuthModalOpen, setIsOAuthModalOpen] = useState(false);
  const [oauthModalStatus, setOauthModalStatus] = useState<ModalStatus>(MODAL_STATUS.IDLE);
  const [selectedOAuthProviderId, setSelectedOAuthProviderId] = useState<OAuthProviderId | null>(null);
  const [authState, setAuthState] = useState<string | null>(null);
  const [callbackUrl, setCallbackUrl] = useState("");
  const [callbackValidation, setCallbackValidation] = useState<CallbackValidation>(CALLBACK_VALIDATION.EMPTY);
  const [callbackMessage, setCallbackMessage] = useState(() => t("callbackMessages.pasteFull"));
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

  const selectedOAuthProvider = getOAuthProviderById(selectedOAuthProviderId);
  const selectedOAuthProviderRequiresCallback = selectedOAuthProvider?.requiresCallback ?? true;
  const getProviderLabel = (provider: OAuthProvider | null) => (provider ? t(provider.nameKey) : "");

  const validateCallbackUrl = (value: string) => {
    if (!value.trim()) {
      return { status: CALLBACK_VALIDATION.EMPTY, message: t("callbackMessages.pasteFull") };
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(value.trim());
    } catch {
      return {
        status: CALLBACK_VALIDATION.INVALID,
        message: t("callbackMessages.invalidUrl"),
      };
    }

    const code = parsedUrl.searchParams.get("code");
    const state = parsedUrl.searchParams.get("state");

    if (!code || !state) {
      return {
        status: CALLBACK_VALIDATION.INVALID,
        message: t("callbackMessages.missingParams"),
      };
    }

    return {
      status: CALLBACK_VALIDATION.VALID,
      message: t("callbackMessages.ready"),
    };
  };

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
      const res = await fetch("/api/providers/oauth");
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
      showToast(common("networkError"), "error");
      setOauthErrorMessage(t("errors.loadAccountsNetwork"));
    }
  }, [common, onAccountCountChange, showToast, t]);

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
          setOauthErrorMessage(data.error || t("errors.authorizationFailed"));
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
    setCallbackMessage(t("callbackMessages.pasteFull"));
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
      const res = await fetch("/api/management/oauth-callback", {
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
        setOauthErrorMessage(data.error || t("errors.ownershipClaimFailed"));
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
    setCallbackMessage(t("callbackMessages.pasteFull"));

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
        setCallbackMessage(t("callbackMessages.deviceWaiting"));
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
        setCallbackMessage(t("callbackMessages.pasteFull"));
        showToast(t("toast.windowOpenedWithCallback"), "info");
      } else {
        setOauthModalStatus(MODAL_STATUS.POLLING);
        setCallbackValidation(CALLBACK_VALIDATION.VALID);
        setCallbackMessage(t("callbackMessages.noCallback"));
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
    setCallbackMessage(validation.message);
  };

  const handleSubmitCallback = async () => {
    const currentProvider = selectedOAuthProviderIdRef.current;
    const currentState = authStateRef.current;
    if (!currentProvider || !currentState) {
      console.warn("[OAuth] Submit failed - provider:", currentProvider, "state:", currentState,
                   "stateFromState:", selectedOAuthProviderId, "providerFromState:", authState);
      setOauthModalStatus(MODAL_STATUS.ERROR);
      setOauthErrorMessage(t("errors.missingProviderState"));
      return;
    }

    const validation = validateCallbackUrl(callbackUrl);
    if (validation.status !== CALLBACK_VALIDATION.VALID) {
      setCallbackValidation(validation.status);
      setCallbackMessage(validation.message);
      return;
    }

    setOauthModalStatus(MODAL_STATUS.SUBMITTING);
    setOauthErrorMessage(null);

    try {
      const res = await fetch("/api/management/oauth-callback", {
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
          data.error || t("errors.callbackRelayFailed")
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
      const res = await fetch(`/api/providers/oauth/${accountId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json();
        showToast(data.error || t("errors.removeFailed"), "error");
        return;
      }
      showToast(t("success.removed"), "success");
      await refreshProviders();
      void loadAccounts();
    } catch {
      showToast(common("networkError"), "error");
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

  return (
    <>
      <section id="provider-oauth" className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">{t("title")}</h2>
            <p className="text-xs text-slate-400">{t("subtitle")}</p>
          </div>
          <span className="text-xs font-medium text-slate-400">
            {t("connectedCount", { count: accounts.length })}
          </span>
        </div>

        <div className="space-y-3">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-400">{t("connectedTitle")}</h3>
            <p className="mt-1 text-xs text-slate-500">{t("connectedSubtitle")}</p>
          </div>
          {oauthAccountsLoading ? (
            <div className="flex items-center justify-center rounded-md border border-slate-700/70 bg-slate-900/25 p-8">
              <div className="flex flex-col items-center gap-3">
                <div className="size-8 animate-spin rounded-full border-4 border-white/20 border-t-blue-500"></div>
                <p className="text-sm text-slate-400">{t("loading")}</p>
              </div>
            </div>
          ) : accounts.length === 0 ? (
            <div className="rounded-sm border border-slate-700/70 bg-slate-900/30 p-3 text-xs text-slate-400">
              {t("empty")}
            </div>
          ) : (
            <div className="divide-y divide-slate-700/70 rounded-md border border-slate-700/70 bg-slate-900/25">
              {accounts.map((account) => (
                <div key={account.id} className="group p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-slate-100">{account.provider}</span>
                        {currentUser && (
                          <OwnerBadge ownerUsername={account.ownerUsername} isOwn={account.isOwn} />
                        )}
                      </div>
                      {account.accountEmail && (
                        <p className="truncate text-xs text-slate-300">{account.accountEmail}</p>
                      )}
                      <p className="truncate text-xs font-mono text-slate-500">{account.accountName}</p>
                    </div>
                    {currentUser && (account.isOwn || currentUser.isAdmin) && (
                      <div className="shrink-0">
                        <Button
                          variant="danger"
                          className="px-2.5 py-1 text-xs"
                          onClick={() => confirmDeleteOAuth(account.id)}
                        >
                          {t("actions.disconnect")}
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="rounded-sm border border-slate-700/70 bg-slate-900/30 p-3 text-xs text-slate-400">
            <strong className="text-slate-200">{t("note.label")}</strong> {t("note.body")}
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-400">{t("connectTitle")}</h3>
          </div>
          <div className="overflow-hidden rounded-md border border-slate-700/70 bg-slate-900/25">
            {OAUTH_PROVIDERS.map((provider, index) => (
              <div
                key={provider.id}
                className={cn(
                  "flex items-center justify-between gap-3 px-3 py-2.5",
                  index !== OAUTH_PROVIDERS.length - 1 && "border-b border-slate-700/70"
                )}
              >
                <div className="space-y-1">
                  <div className="text-sm font-medium text-slate-100">{t(provider.nameKey)}</div>
                  <p className="text-xs leading-relaxed text-slate-400">{t(provider.descriptionKey)}</p>
                </div>
                <Button
                  variant="secondary"
                  onClick={() => handleOAuthConnect(provider.id)}
                  className="shrink-0 px-2.5 py-1 text-xs"
                >
                  {t("actions.connect")}
                </Button>
              </div>
            ))}
          </div>
        </div>
      </section>

      <Modal isOpen={isOAuthModalOpen} onClose={handleOAuthModalClose}>
        <ModalHeader>
          <ModalTitle>
            {selectedOAuthProvider
              ? t("modal.title", { provider: getProviderLabel(selectedOAuthProvider) })
              : t("modal.titleFallback")}
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
                  <li>{t("modal.steps.step3")}</li>
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
                  placeholder={t("modal.callbackPlaceholder")}
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
                  {callbackMessage}
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
                    {t("modal.deviceCodeHint")}{" "}
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
            {common("close")}
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
        cancelLabel={common("cancel")}
        variant="danger"
      />
    </>
  );
}
