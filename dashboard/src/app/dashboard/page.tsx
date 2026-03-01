import Link from "next/link";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { CopyBlock } from "@/components/copy-block";
import { QuickStartConfigSection } from "@/components/quick-start-config-section";
import { ConfigPublisher } from "@/components/config-publisher";
import { ConfigSubscriber } from "@/components/config-subscriber";
import { getTranslations } from "next-intl/server";
import { verifySession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import type { OhMyOpenCodeFullConfig } from "@/lib/config-generators/oh-my-opencode-types";
import { fetchProxyModels } from "@/lib/config-generators/shared";
import { getProxyUrl, getInternalProxyUrl, buildAvailableModelsFromProxy, extractOAuthModelAliases } from "@/lib/config-generators/opencode";
import type { ConfigData } from "@/lib/config-generators/shared";
import { resolveOwnedByDisplay } from "@/lib/providers/model-grouping";

interface ManagementFetchParams {
  path: string;
}

async function fetchManagementJson({ path }: ManagementFetchParams) {
  try {
    const baseUrl =
      process.env.CLIPROXYAPI_MANAGEMENT_URL ||
      "http://cliproxyapi:8317/v0/management";
    const res = await fetch(`${baseUrl}/${path}`, {
      headers: {
        Authorization: `Bearer ${process.env.MANAGEMENT_API_KEY}`,
      },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function getServiceHealth() {
  try {
    const baseUrl =
      process.env.CLIPROXYAPI_MANAGEMENT_URL ||
      "http://cliproxyapi:8317/v0/management";
    const root = baseUrl.replace(/\/v0\/management\/?$/, "/");
    const res = await fetch(root, { cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  }
}

function getClaudeCodeEnv(): string {
  return `export ANTHROPIC_BASE_URL=${getProxyUrl()}
export ANTHROPIC_AUTH_TOKEN=your-api-key
export ANTHROPIC_DEFAULT_SONNET_MODEL=gemini-2.5-flash`;
}



interface OAuthAccountEntry {
  id: string;
  name: string;
  type?: string;
  provider?: string;
  disabled?: boolean;
}

function extractOAuthAccounts(data: unknown): OAuthAccountEntry[] {
  if (typeof data !== "object" || data === null) return [];
  const record = data as Record<string, unknown>;
  const files = record["files"];
  if (!Array.isArray(files)) return [];
  return files
    .filter((entry): entry is Record<string, unknown> =>
      typeof entry === "object" && entry !== null && "name" in entry
    )
    .map((entry) => ({
      id: typeof entry.id === "string" ? entry.id : String(entry.name),
      name: String(entry.name),
      type: typeof entry.type === "string" ? entry.type : undefined,
      provider: typeof entry.provider === "string" ? entry.provider : undefined,
      disabled: typeof entry.disabled === "boolean" ? entry.disabled : undefined,
    }));
}

function buildSourceMap(proxyModels: { id: string; owned_by: string }[]): Map<string, string> {
  const sourceMap = new Map<string, string>();
  for (const m of proxyModels) {
    sourceMap.set(m.id, resolveOwnedByDisplay(m.owned_by));
  }
  return sourceMap;
}

export default async function QuickStartPage() {
  const [config, isHealthy, oauthData, session] = await Promise.all([
    fetchManagementJson({ path: "config" }),
    getServiceHealth(),
    fetchManagementJson({ path: "auth-files" }),
    verifySession(),
  ]);

  const [modelPreference, agentOverride, activeSyncTokens, publishStatus, subscribeStatus, userApiKeys] = session
    ? await Promise.all([
        prisma.modelPreference.findUnique({ where: { userId: session.userId } }),
        prisma.agentModelOverride.findUnique({ where: { userId: session.userId } }),
        prisma.syncToken.findMany({
          where: { userId: session.userId, revokedAt: null },
          select: { id: true },
        }),
        prisma.configTemplate.findUnique({ where: { userId: session.userId } }),
        prisma.configSubscription.findUnique({ 
          where: { userId: session.userId },
          include: { template: true },
        }),
        prisma.userApiKey.findMany({
          where: { userId: session.userId },
          select: { id: true, key: true, name: true },
        }),
      ])
    : [null, null, [], null, null, []];
  const hasSyncActive = activeSyncTokens.length > 0;
  const hasApiKey = userApiKeys.length > 0;
  const isPublisher = publishStatus !== null;
  const isSubscriber = subscribeStatus !== null && subscribeStatus.isActive && subscribeStatus.template?.isActive;

  // Load publisher's config if user is an active subscriber
  let publisherModelPreference = null;
  let publisherAgentOverride = null;
  if (isSubscriber && subscribeStatus?.template) {
    const publisherId = subscribeStatus.template.userId;
    [publisherModelPreference, publisherAgentOverride] = await Promise.all([
      prisma.modelPreference.findUnique({ where: { userId: publisherId } }),
      prisma.agentModelOverride.findUnique({ where: { userId: publisherId } }),
    ]);
  }

  // Use publisher's excluded models if subscribed, otherwise own
  const initialExcludedModels = isSubscriber && publisherModelPreference
    ? publisherModelPreference.excludedModels
    : (modelPreference?.excludedModels ?? []);
  
  // Use publisher's overrides for model selection, but keep subscriber's MCPs
  const publisherOverrides = (publisherAgentOverride?.overrides ?? {}) as OhMyOpenCodeFullConfig;
  const subscriberOverrides = (agentOverride?.overrides ?? {}) as OhMyOpenCodeFullConfig;
  const agentOverrides: OhMyOpenCodeFullConfig = isSubscriber
    ? { ...publisherOverrides, mcpServers: subscriberOverrides.mcpServers, customPlugins: subscriberOverrides.customPlugins }
    : subscriberOverrides;

  const apiKeys = userApiKeys.map((k) => ({ key: k.key, name: k.name }));
  const oauthAccounts = extractOAuthAccounts(oauthData);

  const providerKeys = [
    "gemini-api-key",
    "claude-api-key",
    "codex-api-key",
    "vertex-api-key",
    "openai-compatibility",
  ];
  const configProviderCount = providerKeys.filter((key) => {
    const value = config?.[key];
    if (Array.isArray(value)) return value.length > 0;
    return Boolean(value);
  }).length;

  const activeOAuthProviders = new Set<string>();
  for (const account of oauthAccounts) {
    if (!account.disabled) {
      const provider = account.provider || account.type;
      if (provider) activeOAuthProviders.add(provider);
    }
  }

  const providerCount = configProviderCount + activeOAuthProviders.size;

  const apiKeyForProxy = userApiKeys.length > 0 ? userApiKeys[0].key : "";
  const proxyModels = apiKeyForProxy ? await fetchProxyModels(getInternalProxyUrl(), apiKeyForProxy) : [];
  const oauthAliasModels = extractOAuthModelAliases(config as ConfigData | null, oauthAccounts);
  const oauthAliasIds = Object.keys(oauthAliasModels);
  const availableModelIds = [...proxyModels.map((m) => m.id), ...oauthAliasIds];
  const modelSourceMap = buildSourceMap(proxyModels);
  for (const aliasId of oauthAliasIds) {
    modelSourceMap.set(aliasId, "OAuth Alias");
  }
  const allProxyModels = { ...buildAvailableModelsFromProxy(proxyModels), ...oauthAliasModels };
  const t = await getTranslations("quickStart");

  const baseSetupItems = [
    {
      labelKey: "setup.items.providerConnected",
      done: providerCount > 0,
      link: "/dashboard/providers",
      linkLabelKey: "setup.links.providers",
    },
    {
      labelKey: "setup.items.apiKeyCreated",
      done: apiKeys.length > 0,
      link: "/dashboard/api-keys",
      linkLabelKey: "setup.links.apiKeys",
    },
    {
      labelKey: "setup.items.modelCatalogAvailable",
      done: availableModelIds.length > 0,
      link: "/dashboard/providers",
      linkLabelKey: "setup.links.verifyProviders",
    },
  ];
  const completedSetupItems = baseSetupItems.filter((item) => item.done).length;
  const shouldShowSetupChecklist = completedSetupItems < baseSetupItems.length;
  const setupItems = baseSetupItems.map((item) => ({
    ...item,
    label: t(item.labelKey),
    linkLabel: t(item.linkLabelKey),
  }));
  const statusCards = [
    {
      label: t("statusCards.service.label"),
      value: isHealthy ? t("statusCards.service.value.online") : t("statusCards.service.value.offline"),
      tone: isHealthy ? "text-emerald-400" : "text-rose-400",
      icon: "●",
      iconTone: isHealthy ? "text-emerald-300" : "text-rose-300",
    },
    {
      label: t("statusCards.providers.label"),
      value: t("statusCards.providers.value", { count: providerCount }),
      tone: "text-slate-100",
      icon: "◆",
      iconTone: "text-blue-300",
    },
    {
      label: t("statusCards.apiKeys.label"),
      value: t("statusCards.apiKeys.value", { count: apiKeys.length }),
      tone: "text-slate-100",
      icon: "♟",
      iconTone: "text-amber-300",
    },
    {
      label: t("statusCards.proxyUrl.label"),
      value: getProxyUrl(),
      tone: "text-slate-100",
      icon: "◈",
      iconTone: "text-cyan-300",
      truncate: true,
    },
  ] as const;

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-100">{t("title")}</h1>
            <p className="mt-1 text-sm text-slate-400">
              {t("subtitle")}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/dashboard/providers"
              className="rounded-md border border-slate-600/80 bg-slate-800/70 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.1em] text-slate-200 transition-colors hover:bg-slate-700/80"
            >
              {t("actions.providers")}
            </Link>
            <Link
              href="/dashboard/api-keys"
              className="rounded-md border border-slate-600/80 bg-slate-800/70 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.1em] text-slate-200 transition-colors hover:bg-slate-700/80"
            >
              {t("actions.apiKeys")}
            </Link>
            <Link
              href="/dashboard/settings"
              className="rounded-md border border-slate-600/80 bg-slate-800/70 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.1em] text-slate-200 transition-colors hover:bg-slate-700/80"
            >
              {t("actions.settings")}
            </Link>
          </div>
        </div>
      </section>

      <section
        id="overview"
        className={`scroll-mt-24 grid gap-3 ${shouldShowSetupChecklist ? "xl:grid-cols-[minmax(0,2.2fr)_minmax(280px,1fr)]" : ""}`}
      >
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {statusCards.map((card) => (
            <div key={card.label} className="glass-card rounded-md border border-slate-700/70 px-2.5 py-2 transition-colors hover:border-slate-600">
              <div className="flex items-center justify-between">
                <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{card.label}</div>
                <span className={`text-xs ${card.iconTone}`} aria-hidden="true">{card.icon}</span>
              </div>
              <div className={`mt-0.5 text-xs font-semibold ${card.tone} ${"truncate" in card && card.truncate ? "truncate" : ""}`} title={String(card.value)}>
                {card.value}
              </div>
            </div>
          ))}
        </div>

        {shouldShowSetupChecklist && (
          <Card>
            <CardHeader>
              <CardTitle>{t("setup.checklistTitle")}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-3 text-sm text-slate-400">
                {t("setup.progress", {
                  completed: completedSetupItems,
                  total: baseSetupItems.length,
                })}
              </p>
              <div className="space-y-2.5">
                {setupItems.map((item) => (
                  <div key={item.label} className="flex items-center justify-between gap-3 rounded-md border border-slate-700/70 bg-slate-900/40 px-2.5 py-2">
                    <div className="flex items-center gap-2">
                      <span className={item.done ? "text-emerald-400" : "text-amber-300"} aria-hidden="true">
                        {item.done ? "●" : "○"}
                      </span>
                      <span className="text-sm text-slate-200">{item.label}</span>
                    </div>
                    {!item.done && (
                      <Link href={item.link} className="text-xs font-medium text-blue-300 hover:text-blue-200">
                        {item.linkLabel}
                      </Link>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </section>

      <QuickStartConfigSection
        apiKeys={apiKeys}
        config={config}
        oauthAccounts={oauthAccounts}
        availableModels={availableModelIds}
        allModels={allProxyModels}
        modelSourceMap={modelSourceMap}
        initialExcludedModels={initialExcludedModels}
        agentOverrides={agentOverrides}
        hasSyncActive={hasSyncActive}
        isSubscribed={isSubscriber}
        proxyUrl={getProxyUrl()}
      />

      <section id="sharing" className="scroll-mt-24">
        <details className="group rounded-lg border border-slate-700/70 bg-slate-900/40">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-slate-100">{t("publisher.title")}</p>
              <p className="text-xs text-slate-400">{t("publisher.description")}</p>
            </div>
            <svg className="h-4 w-4 text-slate-400 transition-transform duration-200 group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true"><polyline points="6 9 12 15 18 9" /></svg>
          </summary>
          <div className="grid gap-3 border-t border-slate-700/70 px-4 py-3 2xl:grid-cols-2">
            {!isSubscriber && <ConfigPublisher />}
            {!isPublisher && <ConfigSubscriber hasApiKey={hasApiKey} />}
          </div>
        </details>
      </section>

      <section id="integrations" className="scroll-mt-24">
        <details className="group rounded-lg border border-slate-700/70 bg-slate-900/40">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-slate-100">{t("integrations.title")}</p>
              <p className="text-xs text-slate-400">{t("integrations.description")}</p>
            </div>
            <svg className="h-4 w-4 text-slate-400 transition-transform duration-200 group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true"><polyline points="6 9 12 15 18 9" /></svg>
          </summary>
          <div className="border-t border-slate-700/70 px-4 py-3">
            <div className="rounded-md border border-slate-700/70 bg-slate-900/30 p-4">
              <h3 className="mb-3 text-sm font-semibold text-slate-100">
                <span className="flex items-center gap-3">
                  <span className="flex h-6 w-6 items-center justify-center rounded-md border border-blue-400/30 bg-blue-500/15 text-sm text-blue-300" aria-hidden="true">&#9654;</span>
                  {t("integrations.claudeTitle")}
                </span>
              </h3>
              <p className="mb-2 text-sm text-slate-300">
                {t("integrations.claudeDescription.sentence1")}
              </p>
              <p className="mb-4 text-sm text-slate-300">
                {t("integrations.claudeDescription.sentence2.part1")}
                <code className="break-all rounded bg-slate-800/80 px-1.5 py-0.5 font-mono text-xs text-blue-200">your-api-key</code>
                {t("integrations.claudeDescription.sentence2.part2")}
                <Link href="/dashboard/api-keys" className="font-medium text-blue-300 underline decoration-blue-400/30 underline-offset-2 hover:text-blue-200">
                  {t("integrations.claudeDescription.sentence2.linkText")}
                </Link>
                {t("integrations.claudeDescription.sentence2.postLink")}
              </p>
              <CopyBlock code={getClaudeCodeEnv()} />
            </div>
          </div>
        </details>
      </section>
    </div>
  );
}
