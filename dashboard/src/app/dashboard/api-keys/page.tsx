"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Modal, ModalHeader, ModalTitle, ModalContent, ModalFooter } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { HelpTooltip } from "@/components/ui/tooltip";
import { API_ENDPOINTS } from "@/lib/api-endpoints";

interface ApiKey {
  id: string;
  name: string;
  keyPreview: string;
  createdAt: string;
  lastUsedAt: string | null;
}

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function useCopyToClipboard() {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const copy = useCallback(async (text: string, id?: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    setCopiedKey(id ?? text);
    setTimeout(() => setCopiedKey(null), 2000);
  }, []);

  return { copiedKey, copy };
}

const EMPTY_KEYS: ApiKey[] = [];

export default function ApiKeysPage() {
  const t = useTranslations("apiKeys");
  const tCommon = useTranslations("common");
  const [apiKeys, setApiKeys] = useState<ApiKey[]>(EMPTY_KEYS);
  const [loading, setLoading] = useState(true);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [keyNameInput, setKeyNameInput] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newKeyValue, setNewKeyValue] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const { showToast } = useToast();
  const { copiedKey, copy } = useCopyToClipboard();

  const fetchApiKeys = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const res = await fetch(API_ENDPOINTS.USER.API_KEYS, { signal });
      if (!res.ok) {
        showToast(t("toast.loadFailed"), "error");
        setLoading(false);
        return;
      }

      const data = await res.json();
      const keys = Array.isArray(data.apiKeys) ? data.apiKeys : [];
      setApiKeys(keys);
      setLoading(false);
    } catch {
      if (signal?.aborted) return;
      showToast(tCommon("networkError"), "error");
      setLoading(false);
    }
  }, [showToast, t]);

  useEffect(() => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      void fetchApiKeys(controller.signal);
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [fetchApiKeys]);

  const handleCreateKey = async () => {
    setCreating(true);

    try {
      const res = await fetch(API_ENDPOINTS.USER.API_KEYS, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: keyNameInput.trim() || t("defaultName") }),
      });

      if (!res.ok) {
        showToast(t("toast.createFailed"), "error");
        setCreating(false);
        return;
      }

      const newKey = await res.json();
      showToast(t("toast.createSuccess"), "success");
      setNewKeyValue(newKey.key);
      setIsCreateModalOpen(false);
      setIsModalOpen(true);
      setCreating(false);
      await fetchApiKeys();
    } catch {
      showToast(tCommon("networkError"), "error");
      setCreating(false);
    }
  };

  const confirmDelete = (id: string) => {
    setPendingDeleteId(id);
    setShowConfirm(true);
  };

  const handleDeleteKey = async () => {
    if (!pendingDeleteId) return;
    const id = pendingDeleteId;

    try {
      const res = await fetch(
        `${API_ENDPOINTS.USER.API_KEYS}?id=${encodeURIComponent(id)}`,
        {
        method: "DELETE",
        }
      );

      if (!res.ok) {
        showToast(t("toast.deleteFailed"), "error");
        return;
      }

      showToast(t("toast.deleteSuccess"), "success");
      setApiKeys((prev) => prev.filter((item) => item.id !== id));
    } catch {
      showToast(tCommon("networkError"), "error");
    }
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setNewKeyValue(null);
  };

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-100">{t("title")}</h1>
            <p className="mt-1 text-xs text-slate-400">{t("description")} <HelpTooltip content="API keys authenticate external tools (like the opencode-cliproxyapi-sync plugin) to access your dashboard configuration programmatically" /></p>
          </div>
          <Button onClick={() => { setKeyNameInput(""); setIsCreateModalOpen(true); }} disabled={creating} className="px-2.5 py-1 text-xs">
            {t("createKey")}
          </Button>
        </div>
      </section>

      {loading ? (
        <div className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-6 text-center text-sm text-slate-400">{tCommon("loading")}</div>
      ) : apiKeys.length === 0 ? (
        <div className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-8">
          <div className="flex flex-col items-center justify-center gap-4 text-center">
            <div className="flex size-14 items-center justify-center rounded-full border border-slate-700/70 bg-slate-900/30">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400" aria-hidden="true">
                <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
                <path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2" />
                <circle cx="12" cy="11" r="2" />
                <path d="M12 13a4 4 0 014 4h-8a4 4 0 014-4z" />
              </svg>
            </div>
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-slate-100">{t("emptyTitle")}</h3>
              <p className="text-xs text-slate-400">{t("emptyDescription")}</p>
            </div>
            <Button onClick={() => { setKeyNameInput(""); setIsCreateModalOpen(true); }} disabled={creating} className="px-3 py-1.5 text-xs">
              {t("createApiKey")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <section className="min-w-[600px] overflow-hidden rounded-lg border border-slate-700/70 bg-slate-900/40">
            <div className="sticky top-0 z-10 grid grid-cols-[minmax(0,1fr)_180px_160px_110px] border-b border-slate-700/70 bg-slate-900/95 backdrop-blur-sm px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
              <span>{t("table.name")}</span>
              <span>{t("table.created")}</span>
              <span>{t("table.lastUsed")}</span>
              <span>{t("table.actions")}</span>
            </div>
          {apiKeys.map((apiKey) => (
            <div key={apiKey.id} className="grid grid-cols-[minmax(0,1fr)_180px_160px_110px] items-center border-b border-slate-700/60 px-3 py-2 last:border-b-0">
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-slate-100">{apiKey.name}</p>
                <p className="mt-0.5 truncate font-mono text-xs text-slate-400">{apiKey.keyPreview}</p>
              </div>
              <span className="text-xs text-slate-400">{new Date(apiKey.createdAt).toLocaleDateString()}</span>
              <span className="text-xs text-slate-400">{apiKey.lastUsedAt ? new Date(apiKey.lastUsedAt).toLocaleDateString() : t("never")}</span>
              <div className="flex justify-end">
                <Button variant="danger" onClick={() => confirmDelete(apiKey.id)} className="px-2.5 py-1 text-xs">
                  {t("delete")}
                </Button>
              </div>
            </div>
          ))}
          </section>
        </div>
      )}

      {/* ── Create Key Modal ── */}
      <Modal isOpen={isCreateModalOpen} onClose={() => setIsCreateModalOpen(false)}>
        <ModalHeader>
          <ModalTitle>{t("modal.createTitle")}</ModalTitle>
        </ModalHeader>
        <ModalContent>
          <div className="space-y-4">
            <div>
              <label htmlFor="key-name-input" className="mb-2 block text-sm font-semibold text-slate-300">
                {t("modal.keyName")}
              </label>
              <Input
                type="text"
                name="key-name-input"
                value={keyNameInput}
                onChange={setKeyNameInput}
                placeholder={t("modal.placeholder")}
                disabled={creating}
              />
              <p className="mt-1.5 text-xs text-slate-500">{t("modal.helper")}</p>
            </div>
          </div>
        </ModalContent>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setIsCreateModalOpen(false)}>
            {tCommon("cancel")}
          </Button>
          <Button onClick={handleCreateKey} disabled={creating}>
            {creating ? t("modal.creating") : t("modal.create")}
          </Button>
        </ModalFooter>
      </Modal>

      <Modal isOpen={isModalOpen && newKeyValue !== null} onClose={handleCloseModal}>
        <ModalHeader>
          <ModalTitle>{t("modal.newTitle")}</ModalTitle>
        </ModalHeader>
        <ModalContent>
          <div className="space-y-4">
            <div className="rounded-sm border border-slate-700/70 bg-slate-900/40 p-4 text-sm">
              <div className="mb-2 font-medium text-slate-100">{t("modal.copyNow")}</div>
              <div className="relative group">
                <div className="break-all rounded-sm border border-slate-700/70 bg-slate-900/40 p-3 pr-12 font-mono text-xs text-slate-200">
                  {newKeyValue}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (newKeyValue) {
                      copy(newKeyValue, "modal");
                      showToast(t("toast.copied"), "success");
                    }
                  }}
                  className="absolute right-2.5 top-2.5 rounded-sm border border-slate-700/70 bg-slate-800/60 p-1.5 text-slate-400 transition-colors duration-200 hover:bg-slate-700/70 hover:text-slate-200"
                  title={t("modal.copyAction")}
                >
                  {copiedKey === "modal" ? <CheckIcon /> : <CopyIcon />}
                </button>
              </div>
            </div>
            <div className="rounded-sm border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              <span className="text-amber-200">{t("modal.oneTimeNotice")}</span>
            </div>
          </div>
        </ModalContent>
        <ModalFooter>
          <Button onClick={handleCloseModal}>{t("modal.saved")}</Button>
        </ModalFooter>
      </Modal>

      <ConfirmDialog
        isOpen={showConfirm}
        onClose={() => {
          setShowConfirm(false);
          setPendingDeleteId(null);
        }}
        onConfirm={handleDeleteKey}
        title={t("confirm.title")}
        message={t("confirm.message")}
        confirmLabel={t("delete")}
        cancelLabel={tCommon("cancel")}
        variant="danger"
      />
    </div>
  );
}
