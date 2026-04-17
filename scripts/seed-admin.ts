import { db } from "../server/db";
import { users, invitedUsers } from "../shared/schema";
import { eq } from "drizzle-orm";

const ADMINS = ["garth@bethink.co.za", "savannah@bethink.co.za"];

for (const email of ADMINS) {
  const lower = email.toLowerCase();

  await db.insert(invitedUsers).values({ email: lower }).onConflictDoNothing();

  const [user] = await db.select().from(users).where(eq(users.email, lower));
  if (!user) {
    console.log(`[seed] ${email} — not yet logged in. Whitelisted. Log in with Google, then re-run.`);
    continue;
  }

  await db.update(users).set({ isAdmin: true }).where(eq(users.id, user.id));
  console.log(`[seed] ${email} — promoted to admin.`);
}

process.exit(0);
