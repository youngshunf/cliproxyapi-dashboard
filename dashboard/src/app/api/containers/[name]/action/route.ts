import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/auth/session";
import { validateOrigin } from "@/lib/auth/origin";
import { prisma } from "@/lib/db";
import { CONTAINER_CONFIG, isValidContainerName } from "@/lib/containers";
import { execFile } from "child_process";
import { promisify } from "util";
import { z } from "zod";
import { ContainerActionSchema, formatZodError } from "@/lib/validation/schemas";
import { logger } from "@/lib/logger";
import { getRequestLocale } from "@/i18n/request-locale";
import { getAppMessage } from "@/i18n/message-utils";

const t = (key: string, values?: Record<string, unknown>) =>
  getAppMessage(getRequestLocale(), key, values);

const execFileAsync = promisify(execFile);

type ActionValue = "start" | "stop" | "restart";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const session = await verifySession();

  if (!session) {
    return NextResponse.json(
      { error: t("errors.auth.unauthorized") },
      { status: 401 }
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { isAdmin: true },
  });

  if (!user?.isAdmin) {
    return NextResponse.json(
      { error: t("errors.auth.adminRequired") },
      { status: 403 }
    );
  }

  const originError = validateOrigin(request);
  if (originError) {
    return originError;
  }

  const { name } = await params;

  if (!isValidContainerName(name)) {
    return NextResponse.json(
      { error: t("errors.container.invalidName") },
      { status: 400 }
    );
  }

  try {
    const body = await request.json();
    const validated = ContainerActionSchema.parse(body);

    const typedAction: ActionValue = validated.action;
    const config = CONTAINER_CONFIG[name];

    const permissionKey = `allow${typedAction.charAt(0).toUpperCase()}${typedAction.slice(1)}` as
      | "allowStart"
      | "allowStop"
      | "allowRestart";

    if (!config[permissionKey]) {
      return NextResponse.json(
        {
          error: t("errors.container.actionNotAllowed", {
            action: typedAction,
            name: config.displayName,
          }),
        },
        { status: 403 }
      );
    }

    await execFileAsync("docker", [typedAction, name]);

    return NextResponse.json({
      success: true,
      message: t("messages.container.actionCompleted", {
        name: config.displayName,
        action: typedAction,
      }),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(formatZodError(error), { status: 400 });
    }
    logger.error({ err: error, containerName: name }, "Container action error");
    const message = error instanceof Error ? error.message : t("errors.container.unknown");
    return NextResponse.json(
      { error: t("errors.container.actionFailed", { message }) },
      { status: 500 }
    );
  }
}
