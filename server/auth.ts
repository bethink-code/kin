import passport from "passport";
import { Strategy as GoogleStrategy, type Profile } from "passport-google-oauth20";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import type { Express, Request, Response, NextFunction } from "express";
import { db, pool } from "./db";
import { users, invitedUsers } from "@shared/schema";
import { eq } from "drizzle-orm";
import { audit } from "./auditLog";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export function setupAuth(app: Express) {
  if (!process.env.SESSION_SECRET) throw new Error("SESSION_SECRET not set");
  if (!process.env.GOOGLE_CLIENT_ID) throw new Error("GOOGLE_CLIENT_ID not set");
  if (!process.env.GOOGLE_CLIENT_SECRET) throw new Error("GOOGLE_CLIENT_SECRET not set");

  const PgStore = connectPgSimple(session);
  const isProd = process.env.NODE_ENV === "production";

  app.use(
    session({
      store: new PgStore({ pool, tableName: "sessions", createTableIfMissing: false }),
      secret: process.env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: isProd,
        sameSite: "lax",
        maxAge: SEVEN_DAYS_MS,
      },
    })
  );

  app.use(passport.initialize());
  app.use(passport.session());

  const callbackURL = isProd
    ? `${process.env.PUBLIC_URL ?? ""}/auth/callback`
    : "http://localhost:5000/auth/callback";

  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL,
      },
      async (_at: string, _rt: string, profile: Profile, done: (err: unknown, user?: unknown) => void) => {
        try {
          const email = profile.emails?.[0]?.value?.toLowerCase();
          if (!email) return done(null, false);

          const [invite] = await db.select().from(invitedUsers).where(eq(invitedUsers.email, email));
          const adminEmail = process.env.ADMIN_EMAIL?.toLowerCase();
          const isSeedAdmin = email === adminEmail;

          if (!invite && !isSeedAdmin) {
            return done(null, false, { message: "not_invited" });
          }

          const [existing] = await db.select().from(users).where(eq(users.email, email));

          if (existing) {
            const [updated] = await db
              .update(users)
              .set({
                firstName: profile.name?.givenName ?? existing.firstName,
                lastName: profile.name?.familyName ?? existing.lastName,
                profileImageUrl: profile.photos?.[0]?.value ?? existing.profileImageUrl,
                updatedAt: new Date(),
              })
              .where(eq(users.id, existing.id))
              .returning();
            return done(null, updated);
          }

          const [created] = await db
            .insert(users)
            .values({
              id: profile.id,
              email,
              firstName: profile.name?.givenName,
              lastName: profile.name?.familyName,
              profileImageUrl: profile.photos?.[0]?.value,
              isAdmin: isSeedAdmin,
            })
            .returning();
          return done(null, created);
        } catch (err) {
          done(err);
        }
      }
    )
  );

  passport.serializeUser((user: { id: string }, done) => done(null, user.id));
  passport.deserializeUser(async (id: string, done) => {
    try {
      const [user] = await db.select().from(users).where(eq(users.id, id));
      done(null, user ?? false);
    } catch (err) {
      done(err);
    }
  });
}

export function isAuthenticated(req: Request, res: Response, next: NextFunction) {
  if (req.isAuthenticated?.()) return next();
  res.status(401).json({ error: "unauthorized" });
}

export function isAdmin(req: Request, res: Response, next: NextFunction) {
  const user = req.user as { isAdmin?: boolean } | undefined;
  if (req.isAuthenticated?.() && user?.isAdmin) return next();
  audit({ req, action: "admin.access_denied", outcome: "failure" });
  res.status(403).json({ error: "forbidden" });
}
