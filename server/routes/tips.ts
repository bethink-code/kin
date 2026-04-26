import { Router } from "express";
import { isAuthenticated } from "../auth";
import { getTipsForUser } from "../modules/tips";

const router = Router();
router.use(isAuthenticated);

// GET /api/tips — personalised tip cards drawn from the user's record.
// Wait-state rotators interleave these with the curated story library.
router.get("/api/tips", async (req, res) => {
  const user = req.user as { id: string };
  try {
    const tips = await getTipsForUser(user.id);
    res.json(tips);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    res.status(500).json({ error: "tips_failed", message });
  }
});

export default router;
