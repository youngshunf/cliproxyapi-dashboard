import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/auth/session";
import { validateOrigin } from "@/lib/auth/origin";
import { removeKey, removeKeyByAdmin } from "@/lib/providers/dual-write";
import { prisma } from "@/lib/db";
import { PROVIDER, type Provider } from "@/lib/providers/constants";
import { AUDIT_ACTION, extractIpAddress, logAuditAsync } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { getRequestLocale } from "@/i18n/request-locale";
import { getAppMessage } from "@/i18n/message-utils";

const t = (key: string, values?: Record<string, unknown>) =>
  getAppMessage(getRequestLocale(), key, values);

function isValidProvider(provider: string): provider is Provider {
  return Object.values(PROVIDER).includes(provider as Provider);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ keyHash: string }> }
) {
  const session = await verifySession();
  if (!session) {
    return NextResponse.json(
      { error: t("errors.auth.unauthorized") },
      { status: 401 }
    );
  }

  const originError = validateOrigin(request);
  if (originError) {
    return originError;
  }

  try {
    const { keyHash } = await params;
    const { searchParams } = new URL(request.url);
    const provider = searchParams.get("provider");

    if (!keyHash || typeof keyHash !== "string") {
      return NextResponse.json(
        { error: t("errors.validation.invalidParameter", { param: "keyHash" }) },
        { status: 400 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { isAdmin: true },
    });

    const isAdmin = user?.isAdmin ?? false;

    const ownership = await prisma.providerKeyOwnership.findUnique({
      where: { keyHash },
    });

    let result: { ok: boolean; error?: string };

    if (!ownership && isAdmin && provider && isValidProvider(provider)) {
      result = await removeKeyByAdmin(keyHash, provider);
    } else {
      result = await removeKey(session.userId, keyHash, isAdmin);
    }

    if (!result.ok) {
      if (result.error?.includes("Access denied")) {
        return NextResponse.json(
          { error: t("errors.auth.forbidden") },
          { status: 403 }
        );
      }
      if (result.error?.includes("not found")) {
        return NextResponse.json(
          { error: t("errors.resource.notFound", { resource: t("resources.apiKey") }) },
          { status: 404 }
        );
      }
      return NextResponse.json(
        { error: t("errors.generic.removeFailed", { resource: t("resources.apiKey") }) },
        { status: 500 }
      );
    }

    logAuditAsync({
      userId: session.userId,
      action: AUDIT_ACTION.PROVIDER_KEY_REMOVED,
      target: ownership?.provider || provider || "unknown",
      metadata: {
        keyHash,
        removedByAdmin: isAdmin && ownership?.userId !== session.userId,
      },
      ipAddress: extractIpAddress(request),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ err: error }, "DELETE /api/providers/keys/[keyHash] error");
    return NextResponse.json(
      { error: t("errors.generic.removeFailed", { resource: t("resources.apiKey") }) },
      { status: 500 }
    );
  }
}
