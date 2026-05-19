import type { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { eq, and, gt } from "drizzle-orm";
import { db, sessionsTable, usersTable } from "@workspace/db";

const COOKIE_NAME = "geenbank_session";
const SESSION_DAYS = 30;

export type AuthUserRow = typeof usersTable.$inferSelect;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUserRow;
    }
  }
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400 * 1000);
  await db.insert(sessionsTable).values({ userId, token, expiresAt });
  return token;
}

export async function destroySession(token: string): Promise<void> {
  await db.delete(sessionsTable).where(eq(sessionsTable.token, token));
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 86400 * 1000,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, { path: "/" });
}

export function readSessionCookie(req: Request): string | undefined {
  const v = req.cookies?.[COOKIE_NAME];
  return typeof v === "string" ? v : undefined;
}

export async function loadUserFromRequest(
  req: Request,
): Promise<AuthUserRow | undefined> {
  const token = readSessionCookie(req);
  if (!token) return undefined;
  const [row] = await db
    .select({ user: usersTable })
    .from(sessionsTable)
    .innerJoin(usersTable, eq(usersTable.id, sessionsTable.userId))
    .where(
      and(eq(sessionsTable.token, token), gt(sessionsTable.expiresAt, new Date())),
    )
    .limit(1);
  return row?.user;
}

export function requireAuth(roles?: AuthUserRow["role"][]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const user = await loadUserFromRequest(req);
    if (!user) {
      res.status(401).json({ error: "Niet geautoriseerd" });
      return;
    }
    if (user.status === "disabled") {
      // Drop the cookie so the disabled session cannot keep retrying.
      clearSessionCookie(res);
      res.status(401).json({ error: "Account is gedeactiveerd" });
      return;
    }
    if (roles && !roles.includes(user.role)) {
      res.status(403).json({ error: "Onvoldoende rechten" });
      return;
    }
    if (
      !user.firstLoginCompleted &&
      !req.path.startsWith("/auth/change-password") &&
      !req.path.startsWith("/auth/logout") &&
      !req.path.startsWith("/auth/me")
    ) {
      res.status(409).json({ error: "Wachtwoord moet eerst gewijzigd worden" });
      return;
    }
    req.user = user;
    next();
  };
}

export const COOKIE = { name: COOKIE_NAME };
