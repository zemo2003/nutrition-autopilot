import type { Response } from "express";

/**
 * Standardized API error codes.
 * Every error response from the API should include one of these codes.
 */
export const ErrorCode = {
  VALIDATION_FAILED: "VALIDATION_FAILED",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  BAD_REQUEST: "BAD_REQUEST",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  INSUFFICIENT_INVENTORY: "INSUFFICIENT_INVENTORY",
  UNAUTHORIZED: "UNAUTHORIZED",
} as const;

export type ErrorCodeType = (typeof ErrorCode)[keyof typeof ErrorCode];

/**
 * Standard error response shape:
 *   { error: string, code: string, details?: object }
 */
export function sendError(
  res: Response,
  status: number,
  error: string,
  code: ErrorCodeType = ErrorCode.BAD_REQUEST,
  details?: object,
): void {
  const body: { error: string; code: string; details?: object } = { error, code };
  if (details) body.details = details;
  res.status(status).json(body);
}

export function send404(res: Response, entity: string): void {
  sendError(res, 404, `${entity} not found`, ErrorCode.NOT_FOUND);
}

export function send400(res: Response, message: string, details?: object): void {
  sendError(res, 400, message, ErrorCode.BAD_REQUEST, details);
}

export function send409(res: Response, message: string): void {
  sendError(res, 409, message, ErrorCode.CONFLICT);
}
