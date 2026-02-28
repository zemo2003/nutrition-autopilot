import type { Request, Response, NextFunction } from "express";

/**
 * Bearer-token auth middleware.
 * When NUMEN_API_KEY is set, requests to protected routes must include
 * `Authorization: Bearer <key>`. When unset (local dev), auth is skipped.
 */
export function requireApiKey(req: Request, res: Response, next: NextFunction) {
  const apiKey = process.env.NUMEN_API_KEY;

  // No key configured — skip auth (local dev)
  if (!apiKey) return next();

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid Authorization header. Use: Bearer <API_KEY>" });
  }

  const token = authHeader.slice(7);
  if (token !== apiKey) {
    return res.status(403).json({ error: "Invalid API key" });
  }

  return next();
}
