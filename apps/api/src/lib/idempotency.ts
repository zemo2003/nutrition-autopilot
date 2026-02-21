import crypto from "node:crypto";
import { prisma } from "@nutrition/db";

export function hashPayload(payload: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export async function ensureIdempotency(
  scope: string,
  key: string,
  requestPayload: unknown,
  existingResponse?: unknown
) {
  const requestHash = hashPayload(requestPayload);
  const existing = await prisma.idempotencyKey.findUnique({ where: { key } });
  if (existing) {
    return { replay: true, existing };
  }

  const record = await prisma.idempotencyKey.create({
    data: {
      scope,
      key,
      requestHash,
      responseBody: existingResponse === undefined ? undefined : (existingResponse as object),
      createdBy: "system"
    }
  });

  return { replay: false, existing: record };
}

export async function setIdempotencyResponse(key: string, responseBody: unknown) {
  await prisma.idempotencyKey.update({
    where: { key },
    data: {
      responseBody: responseBody as object,
      version: { increment: 1 }
    }
  });
}
