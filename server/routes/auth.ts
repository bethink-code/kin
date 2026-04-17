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

router.get(
  "/auth/callback",
  passport.authenticate("google", {
    failureRedirect: `${CLIENT_URL}/?error=not_invited`,
  }),
  (req, res) => {
    audit({ req, action: "auth.login" });
    res.redirect(CLIENT_URL);
  }
);

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
