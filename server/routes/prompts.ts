import { Router } from "express";
import { isAdmin } from "../auth";
import { audit } from "../auditLog";
import { savePromptSchema } from "@shared/schema";
import { listActivePrompts, listPromptVersions } from "../modules/prompts/getPrompt";
import { savePromptVersion, rollbackTo } from "../modules/prompts/savePrompt";

const router = Router();
router.use(isAdmin);

router.get("/api/admin/prompts", async (_req, res) => {
  const rows = await listActivePrompts();
  res.json(rows);
});

router.get("/api/admin/prompts/:key/versions", async (req, res) => {
  const rows = await listPromptVersions(req.params.key);
  res.json(rows);
});

router.post("/api/admin/prompts", async (req, res) => {
  const parsed = savePromptSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_input", detail: parsed.error.flatten() });
  }
  const actor = req.user as { id: string };

  const created = await savePromptVersion({ ...parsed.data, createdBy: actor.id });
  audit({
    req,
    action: "admin.prompt_save",
    resourceType: "system_prompt",
    resourceId: String(created.id),
    detail: { promptKey: created.promptKey, version: created.version },
  });
  res.json(created);
});

router.post("/api/admin/prompts/:key/rollback/:id", async (req, res) => {
  const { key, id } = req.params;
  const activated = await rollbackTo(key, Number(id));
  audit({
    req,
    action: "admin.prompt_rollback",
    resourceType: "system_prompt",
    resourceId: id,
    detail: { promptKey: key, version: activated.version },
  });
  res.json(activated);
});

export default router;
