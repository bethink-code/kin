import { Router } from "express";
import passport from "passport";
import { db } from "../db";
import { users, accessRequests, insertAccessRequestSchema, onboardSchema } from "@shared/schema";
import { eq } from "drizzle-orm";
import { audit } from "../auditLog";
import { isAuthenticated } from "../auth";

const router = Router();

const CLIENT_URL =
  process.env.NODE_ENV === "production" ? (process.env.PUBLIC_URL ?? "/") : "http://localhost:5173";

router.get("/auth/google", passport.authenticate("google", { scope: ["profile", "email"] }));

// Custom callback handling so OAuth errors don't 500. The browser sometimes
// re-fires /auth/callback with the same code (back/forward, retry, etc.) —
// the second hit gets `invalid_grant` from Google and Passport throws
// TokenError. We catch it, and if the user is already authenticated we just
// redirect them home; otherwise we redirect with a soft error.
router.get("/auth/callback", (req, res, next) => {
  passport.authenticate(
    "google",
    (
      err: (Error & { code?: string }) | null,
      user: { id: string } | false,
      info: { message?: string } | undefined,
    ) => {
      if (err) {
        // Already-consumed-code is the dominant prod-log noise. If the user
        // already has a valid session, the duplicate hit is benign — send
        // them home. Otherwise log + redirect with an error message.
        if (req.isAuthenticated?.()) {
          console.warn(
            "[auth] callback errored but session is established — redirecting home:",
            err.message ?? err,
          );
          return res.redirect(CLIENT_URL);
        }
        console.error("[auth] callback failed:", err.message ?? err);
        return res.redirect(`${CLIENT_URL}/?error=oauth_failed`);
      }
      if (!user) {
        return res.redirect(`${CLIENT_URL}/?error=${info?.message ?? "not_invited"}`);
      }
      req.login(user, (loginErr) => {
        if (loginErr) return next(loginErr);
        audit({ req, action: "auth.login" });
        res.redirect(CLIENT_URL);
      });
    },
  )(req, res, next);
});

router.post("/auth/logout", (req, res) => {
  audit({ req, action: "auth.logout" });
  req.logout(() => {
    req.session.destroy(() => {
      res.clearCookie("connect.sid");
      res.json({ ok: true });
    });
  });
});

router.get("/api/auth/user", (req, res) => {
  if (!req.isAuthenticated?.()) return res.json(null);
  res.json(req.user);
});

router.post("/api/user/accept-terms", isAuthenticated, async (req, res) => {
  const user = req.user as { id: string };
  await db.update(users).set({ termsAcceptedAt: new Date() }).where(eq(users.id, user.id));
  audit({ req, action: "user.accept_terms" });
  res.json({ ok: true });
});

router.post("/api/user/build-complete", isAuthenticated, async (req, res) => {
  const user = req.user as { id: string };
  const [updated] = await db
    .update(users)
    .set({ buildCompletedAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, user.id))
    .returning();
  audit({ req, action: "user.build_complete" });
  res.json(updated);
});

router.post("/api/user/build-reopen", isAuthenticated, async (req, res) => {
  const user = req.user as { id: string };
  const [updated] = await db
    .update(users)
    .set({ buildCompletedAt: null, updatedAt: new Date() })
    .where(eq(users.id, user.id))
    .returning();
  audit({ req, action: "user.build_reopen" });
  res.json(updated);
});

router.post("/api/user/onboard", isAuthenticated, async (req, res) => {
  const parsed = onboardSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_input", detail: parsed.error.flatten() });
  }
  const user = req.user as { id: string };
  const [updated] = await db
    .update(users)
    .set({
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
      cell: parsed.data.cell,
      photoDataUrl: parsed.data.photoDataUrl,
      onboardedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id))
    .returning();
  audit({ req, action: "user.onboard_complete" });
  res.json(updated);
});

router.post("/api/request-access", async (req, res) => {
  const parsed = insertAccessRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_input" });
  }
  const [created] = await db.insert(accessRequests).values(parsed.data).returning();
  audit({ action: "access_request.create", resourceType: "access_request", resourceId: String(created.id) });
  res.json({ ok: true });
});

export default router;
