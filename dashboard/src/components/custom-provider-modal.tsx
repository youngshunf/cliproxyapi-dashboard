"use client";

import { useState, useEffect } from "react";
import { Modal, ModalHeader, ModalTitle, ModalContent, ModalFooter } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useTranslations } from "next-intl";

interface ModelMapping {
  upstreamName: string;
  alias: string;
}

interface CustomProvider {
  id: string;
  name: string;
  providerId: string;
  baseUrl: string;
  prefix: string | null;
  proxyUrl: string | null;
  headers: Record<string, string>;
  models: ModelMapping[];
  excludedModels: { pattern: string }[];
  groupId: string | null;
}

interface CustomProviderModalProps {
  isOpen: boolean;
  onClose: () => void;
  provider?: CustomProvider;
  onSuccess: () => void;
}

interface HeaderEntry {
  key: string;
  value: string;
}

interface FetchedModel {
  id: string;
  selected: boolean;
}

function generateProviderId(name: string): string {
  return name.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

export function CustomProviderModal({ isOpen, onClose, provider, onSuccess }: CustomProviderModalProps) {
  const { showToast } = useToast();
  const t = useTranslations("providers.customModal");
  const common = useTranslations("common");
  const isEdit = !!provider;

  const [name, setName] = useState("");
  const [providerId, setProviderId] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [prefix, setPrefix] = useState("");
  const [proxyUrl, setProxyUrl] = useState("");
  const [headers, setHeaders] = useState<HeaderEntry[]>([]);
  const [models, setModels] = useState<ModelMapping[]>([{ upstreamName: "", alias: "" }]);
  const [excludedModels, setExcludedModels] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<FetchedModel[]>([]);
  const [showFetchedModels, setShowFetchedModels] = useState(false);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [groups, setGroups] = useState<{id: string; name: string; color: string | null}[]>([]);

  const [errors, setErrors] = useState({
    name: "",
    providerId: "",
    baseUrl: "",
    apiKey: "",
    models: ""
  });

  useEffect(() => {
    const fetchGroups = async () => {
      try {
        const res = await fetch("/api/provider-groups");
        if (res.ok) {
          const data = await res.json();
          setGroups(data.groups || []);
        }
      } catch (err) {
        // silently fail for group fetch in modal
      }
    };
    void fetchGroups();
  }, []);

  useEffect(() => {
    if (provider) {
      setName(provider.name);
      setProviderId(provider.providerId);
      setBaseUrl(provider.baseUrl);
      setPrefix(provider.prefix || "");
      setProxyUrl(provider.proxyUrl || "");
      setHeaders(Object.entries(provider.headers || {}).map(([key, value]) => ({ key, value })));
      setModels(provider.models.length > 0 ? provider.models : [{ upstreamName: "", alias: "" }]);
      setExcludedModels(provider.excludedModels.map(e => e.pattern));
      setGroupId(provider.groupId);
      setApiKey("");
    } else {
      resetForm();
    }
  }, [provider, isOpen]);

  const resetForm = () => {
    setName("");
    setProviderId("");
    setBaseUrl("");
    setApiKey("");
    setPrefix("");
    setProxyUrl("");
    setHeaders([]);
    setModels([{ upstreamName: "", alias: "" }]);
    setExcludedModels([]);
    setErrors({ name: "", providerId: "", baseUrl: "", apiKey: "", models: "" });
    setFetchingModels(false);
    setFetchedModels([]);
    setShowFetchedModels(false);
    setGroupId(null);
  };

  const handleNameChange = (value: string) => {
    setName(value);
    if (!isEdit) {
      setProviderId(generateProviderId(value));
    }
  };

  const validate = () => {
    const newErrors = {
      name: name.length === 0 ? t("errors.nameRequired") : name.length > 100 ? t("errors.nameTooLong") : "",
      providerId: !/^[a-z0-9-]+$/.test(providerId) ? t("errors.providerIdInvalid") : "",
      baseUrl: !baseUrl.startsWith("https://") ? t("errors.baseUrlHttps") : "",
      apiKey: !isEdit && apiKey.length === 0 ? t("errors.apiKeyRequired") : "",
      models: models.filter(m => m.upstreamName && m.alias).length === 0 ? t("errors.modelsRequired") : ""
    };

    setErrors(newErrors);
    return Object.values(newErrors).every(e => e === "");
  };

  const handleSubmit = async () => {
    if (!validate()) return;

    setSaving(true);

    const validModels = models.filter(m => m.upstreamName && m.alias);
    const headersObj = headers.reduce((acc, h) => {
      if (h.key && h.value) acc[h.key] = h.value;
      return acc;
    }, {} as Record<string, string>);

    const payload = {
      name,
      providerId,
      baseUrl,
      ...(apiKey ? { apiKey } : {}),
      prefix: prefix || undefined,
      proxyUrl: proxyUrl || undefined,
      headers: Object.keys(headersObj).length > 0 ? headersObj : undefined,
      models: validModels,
      excludedModels: excludedModels.filter(e => e.trim()),
      groupId: groupId || null
    };

    try {
      const url = isEdit ? `/api/custom-providers/${provider.id}` : "/api/custom-providers";
      const method = isEdit ? "PATCH" : "POST";

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        showToast(isEdit ? t("toast.updated") : t("toast.created"), "success");
        onSuccess();
        onClose();
        resetForm();
      } else {
        const error = await response.json();
        showToast(error.error || t("toast.saveFailed"), "error");
      }
    } catch {
      showToast(common("networkError"), "error");
    } finally {
      setSaving(false);
    }
  };

  const addModelMapping = () => {
    setModels([...models, { upstreamName: "", alias: "" }]);
  };

  const removeModelMapping = (index: number) => {
    setModels(models.filter((_, i) => i !== index));
  };

  const updateModelMapping = (index: number, field: keyof ModelMapping, value: string) => {
    const updated = [...models];
    updated[index][field] = value;
    setModels(updated);
  };

  const addHeader = () => {
    setHeaders([...headers, { key: "", value: "" }]);
  };

  const removeHeader = (index: number) => {
    setHeaders(headers.filter((_, i) => i !== index));
  };

  const updateHeader = (index: number, field: keyof HeaderEntry, value: string) => {
    const updated = [...headers];
    updated[index][field] = value;
    setHeaders(updated);
  };

  const addExcludedModel = () => {
    setExcludedModels([...excludedModels, ""]);
  };

  const removeExcludedModel = (index: number) => {
    setExcludedModels(excludedModels.filter((_, i) => i !== index));
  };

  const updateExcludedModel = (index: number, value: string) => {
    const updated = [...excludedModels];
    updated[index] = value;
    setExcludedModels(updated);
  };

  const fetchModels = async () => {
    if (!baseUrl.startsWith("https://") || apiKey.length === 0) {
      showToast(t("toast.baseUrlApiKey"), "error");
      return;
    }

    setFetchingModels(true);
    setFetchedModels([]);
    setShowFetchedModels(false);

    try {
      const response = await fetch("/api/custom-providers/fetch-models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl, apiKey })
      });

      if (response.ok) {
        const data = await response.json();
        const existingModelIds = new Set(models.filter(m => m.upstreamName).map(m => m.upstreamName));
        
        const fetchedList: FetchedModel[] = data.models.map((model: { id: string }) => ({
          id: model.id,
          selected: existingModelIds.has(model.id)
        }));

        setFetchedModels(fetchedList);
        setShowFetchedModels(true);
        showToast(t("toast.modelsFound", { count: fetchedList.length }), "success");
      } else {
        const error = await response.json();
        showToast(error.error || t("toast.fetchFailed"), "error");
      }
    } catch {
      showToast(common("networkError"), "error");
    } finally {
      setFetchingModels(false);
    }
  };

  const toggleFetchedModel = (id: string) => {
    setFetchedModels(prev => 
      prev.map(model => 
        model.id === id ? { ...model, selected: !model.selected } : model
      )
    );
  };

  const toggleAllFetchedModels = () => {
    const allSelected = fetchedModels.every(m => m.selected);
    setFetchedModels(prev => prev.map(model => ({ ...model, selected: !allSelected })));
  };

  const addSelectedModels = () => {
    const selectedModels = fetchedModels.filter(m => m.selected);
    const existingModelIds = new Set(models.filter(m => m.upstreamName).map(m => m.upstreamName));
    
    const newModels = selectedModels
      .filter(model => !existingModelIds.has(model.id))
      .map(model => ({
        upstreamName: model.id,
        alias: model.id
      }));

    if (newModels.length > 0) {
      setModels(prev => {
        // Keep all existing rows (including partially filled ones) — only drop fully empty rows
        const existing = prev.filter(m => m.upstreamName || m.alias);
        return [...existing, ...newModels];
      });
      showToast(t("toast.modelsAdded", { count: newModels.length }), "success");
    }

    setShowFetchedModels(false);
    setFetchedModels([]);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="max-w-3xl">
      <ModalHeader>
        <ModalTitle>{isEdit ? t("title.edit") : t("title.create")}</ModalTitle>
      </ModalHeader>

      <ModalContent>
        <div className="space-y-5 max-h-[65vh] overflow-y-auto pr-2">
          {/* Name */}
          <div>
            <label htmlFor="name" className="mb-2 block text-sm font-semibold text-white">
              {t("fields.name.label")} <span className="text-red-400">*</span>
            </label>
            <Input
              type="text"
              name="name"
              value={name}
              onChange={handleNameChange}
              placeholder={t("fields.name.placeholder")}
              required
              disabled={saving}
            />
            {errors.name && <p className="mt-1.5 text-xs text-red-400">{errors.name}</p>}
          </div>

          {/* Provider ID */}
          <div>
            <label htmlFor="providerId" className="mb-2 block text-sm font-semibold text-white">
              {t("fields.providerId.label")} <span className="text-red-400">*</span>
            </label>
            <Input
              type="text"
              name="providerId"
              value={providerId}
              onChange={setProviderId}
              placeholder="my-custom-provider"
              required
              disabled={saving || isEdit}
              className={isEdit ? "opacity-60 cursor-not-allowed" : ""}
            />
            {errors.providerId && <p className="mt-1.5 text-xs text-red-400">{errors.providerId}</p>}
            {!errors.providerId && (
              <p className="mt-1.5 text-xs text-white/50">
                {t("helpers.providerId")}
                {" "}
                {isEdit ? t("helpers.cannotChange") : t("helpers.autoGenerated")}
              </p>
            )}
          </div>

          {/* Base URL */}
          <div>
            <label htmlFor="baseUrl" className="mb-2 block text-sm font-semibold text-white">
              {t("fields.baseUrl.label")} <span className="text-red-400">*</span>
            </label>
            <Input
              type="text"
              name="baseUrl"
              value={baseUrl}
              onChange={setBaseUrl}
              placeholder={t("fields.baseUrl.placeholder")}
              required
              disabled={saving}
            />
            {errors.baseUrl && <p className="mt-1.5 text-xs text-red-400">{errors.baseUrl}</p>}
          </div>

          {/* API Key */}
          <div>
            <label htmlFor="apiKey" className="mb-2 block text-sm font-semibold text-white">
              {t("fields.apiKey.label")} {!isEdit && <span className="text-red-400">*</span>}
            </label>
            <Input
              type="password"
              name="apiKey"
              value={apiKey}
              onChange={setApiKey}
              placeholder={isEdit ? t("fields.apiKey.placeholderEditable") : t("fields.apiKey.placeholder")}
              required={!isEdit}
              disabled={saving}
            />
            {errors.apiKey && <p className="mt-1.5 text-xs text-red-400">{errors.apiKey}</p>}
            {!errors.apiKey && isEdit && <p className="mt-1.5 text-xs text-white/50">{t("helpers.keepExistingKey")}</p>}
          </div>

          {/* Prefix */}
          <div>
            <label htmlFor="prefix" className="mb-2 block text-sm font-semibold text-white">
              {t("fields.prefix.label")}
            </label>
            <Input
              type="text"
              name="prefix"
              value={prefix}
              onChange={setPrefix}
              placeholder={t("fields.prefix.placeholder")}
              disabled={saving}
            />
            <p className="mt-1.5 text-xs text-white/50">{t("helpers.prefix")}</p>
          </div>

          {/* Proxy URL */}
          <div>
            <label htmlFor="proxyUrl" className="mb-2 block text-sm font-semibold text-white">
              Proxy URL (Optional)
            </label>
            <Input
              type="text"
              name="proxyUrl"
              value={proxyUrl}
              onChange={setProxyUrl}
              placeholder="http://proxy.example.com:8080"
              disabled={saving}
            />
          </div>

          {/* Headers */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label htmlFor="headers" className="text-sm font-semibold text-white">{t("fields.headers.label")}</label>
              <Button variant="ghost" onClick={addHeader} className="px-3 py-1.5 text-xs" disabled={saving}>
                {t("actions.addHeader")}
              </Button>
            </div>
            {headers.length > 0 && (
              <div className="space-y-2">
                {headers.map((header, idx) => (
                  <div key={idx} className="flex gap-2">
                    <Input
                      type="text"
                      name={`header-key-${idx}`}
                      value={header.key}
                      onChange={(val) => updateHeader(idx, 'key', val)}
                      placeholder={t("fields.headers.placeholderKey")}
                      disabled={saving}
                      className="flex-1"
                    />
                    <Input
                      type="text"
                      name={`header-value-${idx}`}
                      value={header.value}
                      onChange={(val) => updateHeader(idx, 'value', val)}
                      placeholder={t("fields.headers.placeholderValue")}
                      disabled={saving}
                      className="flex-1"
                    />
                    <Button variant="danger" onClick={() => removeHeader(idx)} className="px-3 shrink-0" disabled={saving}>
                      ✕
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Fetch Models */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-white">{t("fetch.title")}</span>
              <Button 
                variant="secondary" 
                onClick={fetchModels} 
                disabled={!baseUrl.startsWith("https://") || apiKey.length === 0 || fetchingModels || saving}
                className="px-3 py-1.5 text-xs"
              >
                {fetchingModels ? (
                  <span className="flex items-center gap-2">
                    <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" aria-hidden="true">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    {t("fetch.loading")}
                  </span>
                ) : (
                  t("actions.fetchModels")
                )}
              </Button>
            </div>
            {showFetchedModels && fetchedModels.length > 0 && (
              <div className="bg-white/5 border border-white/10 rounded-lg p-3 mb-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-white">
                      {t("fetch.available", { count: fetchedModels.length })}
                    </span>
                    <span className="text-xs text-white/70 bg-white/10 px-2 py-0.5 rounded">
                      {t("fetch.selected", { count: fetchedModels.filter(m => m.selected).length })}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={toggleAllFetchedModels}
                    className="text-xs text-white/70 hover:text-white transition-colors"
                  >
                    {fetchedModels.every(m => m.selected) ? t("fetch.deselectAll") : t("fetch.selectAll")}
                  </button>
                </div>
                <div className="max-h-48 overflow-y-auto space-y-1.5 mb-3">
                  {fetchedModels.map((model) => (
                    <label key={model.id} className="flex items-center gap-2 cursor-pointer hover:bg-white/5 rounded px-2 py-1.5 transition-colors">
                      <input
                        type="checkbox"
                        checked={model.selected}
                        onChange={() => toggleFetchedModel(model.id)}
                        className="w-4 h-4 rounded border-white/20 bg-white/5 checked:bg-blue-500 focus:ring-2 focus:ring-blue-500/50"
                      />
                      <span className="text-sm text-white/70">{model.id}</span>
                    </label>
                  ))}
                </div>
                <Button 
                  onClick={addSelectedModels}
                  disabled={fetchedModels.filter(m => m.selected).length === 0}
                  className="w-full"
                >
                  {t("actions.addSelected", { count: fetchedModels.filter(m => m.selected).length })}
                </Button>
              </div>
            )}
            <p className="text-xs text-white/50 mb-2">{t("helpers.manualMapping")}</p>
          </div>

          {/* Model Mappings */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label htmlFor="models" className="text-sm font-semibold text-white">
                {t("fields.models.label")} <span className="text-red-400">*</span>
              </label>
              <Button variant="ghost" onClick={addModelMapping} className="px-3 py-1.5 text-xs" disabled={saving}>
                {t("actions.addModel")}
              </Button>
            </div>
            <div className="space-y-2">
              {models.map((model, idx) => (
                <div key={idx} className="flex gap-2">
                  <Input
                    type="text"
                    name={`model-upstream-${idx}`}
                    value={model.upstreamName}
                    onChange={(val) => updateModelMapping(idx, 'upstreamName', val)}
                    placeholder="gpt-4"
                    disabled={saving}
                    className="flex-1"
                  />
                  <Input
                    type="text"
                    name={`model-alias-${idx}`}
                    value={model.alias}
                    onChange={(val) => updateModelMapping(idx, 'alias', val)}
                    placeholder="custom-gpt-4"
                    disabled={saving}
                    className="flex-1"
                  />
                  {models.length > 1 && (
                    <Button variant="danger" onClick={() => removeModelMapping(idx)} className="px-3 shrink-0" disabled={saving}>
                      ✕
                    </Button>
                  )}
                </div>
              ))}
            </div>
            {errors.models && <p className="mt-1.5 text-xs text-red-400">{errors.models}</p>}
            {!errors.models && <p className="mt-1.5 text-xs text-white/50">{t("helpers.manualMapping")}</p>}
          </div>

          {/* Excluded Models */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label htmlFor="excludedModels" className="text-sm font-semibold text-white">{t("fields.excluded.label")}</label>
              <Button variant="ghost" onClick={addExcludedModel} className="px-3 py-1.5 text-xs" disabled={saving}>
                {t("actions.addExclusion")}
              </Button>
            </div>
            {excludedModels.length > 0 && (
              <div className="space-y-2">
                {excludedModels.map((pattern, idx) => (
                  <div key={idx} className="flex gap-2">
                    <Input
                      type="text"
                      name={`excluded-${idx}`}
                      value={pattern}
                      onChange={(val) => updateExcludedModel(idx, val)}
                      placeholder="gpt-4-* or specific-model"
                      disabled={saving}
                      className="flex-1"
                    />
                    <Button variant="danger" onClick={() => removeExcludedModel(idx)} className="px-3 shrink-0" disabled={saving}>
                      ✕
                    </Button>
                  </div>
                ))}
              </div>
            )}
            {excludedModels.length === 0 && (
              <p className="text-xs text-white/50">{t("helpers.excluded")}</p>
            )}
          </div>

          {/* Group Assignment */}
          <div>
            <label className="mb-2 block text-sm font-semibold text-white">
              {t("fields.group.label")}
            </label>
            <select
              value={groupId ?? ""}
              onChange={(e) => setGroupId(e.target.value || null)}
              disabled={saving}
              className="w-full px-3 py-2 text-sm rounded-md glass-input text-white focus:outline-none focus:border-blue-400/50 focus:ring-1 focus:ring-blue-400/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200 bg-slate-900 border border-slate-700/70"
            >
              <option value="" className="bg-slate-900 text-white">{t("fields.group.none")}</option>
              {groups.map(g => (
                <option key={g.id} value={g.id} className="bg-slate-900 text-white">{g.name}</option>
              ))}
            </select>
            <p className="mt-1.5 text-xs text-white/50">{t("helpers.group")}</p>
          </div>
        </div>
      </ModalContent>

      <ModalFooter>
        <Button variant="ghost" onClick={onClose} disabled={saving}>
          {common("cancel")}
        </Button>
        <Button onClick={handleSubmit} disabled={saving}>
          {saving
            ? isEdit
              ? t("actions.updating")
              : t("actions.creating")
            : isEdit
              ? t("actions.updateProvider")
              : t("actions.createProvider")}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
