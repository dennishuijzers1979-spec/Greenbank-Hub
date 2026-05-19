import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { LoginBody, ChangePasswordBody } from "@workspace/api-zod";
import {
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  setSessionCookie,
  clearSessionCookie,
  readSessionCookie,
  loadUserFromRequest,
  requireAuth,
} from "../lib/auth";
import { logActivity } from "../lib/activity";

const router: IRouter = Router();

function publicUser(u: {
  id: string;
  email: string;
  role: "prospect" | "loan_officer" | "admin";
  firstLoginCompleted: boolean;
  displayName: string | null;
}) {
  return {
    id: u.id,
    email: u.email,
    role: u.role,
    firstLoginCompleted: u.firstLoginCompleted,
    displayName: u.displayName,
  };
}

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { email, password } = parsed.data;
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email.toLowerCase().trim()))
    .limit(1);
  if (!user) {
    res.status(401).json({ error: "Onbekend e-mailadres of wachtwoord" });
    return;
  }
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    res.status(401).json({ error: "Onbekend e-mailadres of wachtwoord" });
    return;
  }
  if (user.status === "disabled") {
    // Generic 401 — do not leak whether the account exists or is disabled.
    res.status(401).json({ error: "Onbekend e-mailadres of wachtwoord" });
    return;
  }
  const token = await createSession(user.id);
  setSessionCookie(res, token);
  await logActivity({
    actor: user,
    action: "login",
    description: `${user.email} is ingelogd.`,
  });
  res.json({ user: publicUser(user) });
});

router.post("/auth/logout", async (req, res): Promise<void> => {
  const token = readSessionCookie(req);
  if (token) await destroySession(token);
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get("/auth/me", async (req, res): Promise<void> => {
  const user = await loadUserFromRequest(req);
  // Auth/session responses must never be cached: a stale 304 with the
  // previously-cached `{user: null}` body would make the freshly-logged-in
  // client believe it's logged out, triggering a redirect loop between
  // /login and /dashboard ("Maximum update depth exceeded").
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.json({ user: user ? publicUser(user) : null });
});

router.post("/auth/change-password", requireAuth(), async (req, res): Promise<void> => {
  const parsed = ChangePasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const user = req.user!;
  const ok = await verifyPassword(parsed.data.currentPassword, user.passwordHash);
  if (!ok) {
    res.status(400).json({ error: "Huidig wachtwoord klopt niet" });
    return;
  }
  if (parsed.data.newPassword.length < 8) {
    res.status(400).json({ error: "Nieuw wachtwoord moet minimaal 8 tekens zijn" });
    return;
  }
  const hash = await hashPassword(parsed.data.newPassword);
  await db
    .update(usersTable)
    .set({ passwordHash: hash, firstLoginCompleted: true, passwordRotatedAt: new Date() })
    .where(eq(usersTable.id, user.id));
  await logActivity({
    actor: user,
    action: "password_changed",
    description: `${user.email} heeft het wachtwoord gewijzigd.`,
  });
  res.json({ ok: true });
});

export default router;
