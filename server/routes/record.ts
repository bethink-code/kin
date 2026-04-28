import { Router } from "express";
import { z } from "zod";
import { isAuthenticated } from "../auth";
import { audit } from "../auditLog";
import {
  ensureRecord,
  ensureSegment,
  listNotes,
  listSegments,
  writeNote,
  supersedeNote,
  softDeleteNote,
} from "../modules/record";

const router = Router();
router.use(isAuthenticated);

// GET /api/record — record root + segments + recent notes
router.get("/api/record", async (req, res) => {
  const user = req.user as { id: string };
  try {
    const root = await ensureRecord(user.id);
    const [segments, notes] = await Promise.all([
      listSegments(user.id),
      listNotes({ userId: user.id, limit: 50 }),
    ]);
    res.json({ record: root, segments, notes });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    res.status(500).json({ error: "record_load_failed", message });
  }
});

const listNotesQuery = z.object({
  segmentId: z.coerce.number().optional(),
  category: z.string().optional(),
  kind: z.string().optional(),
  limit: z.coerce.number().min(1).max(500).optional(),
});

// GET /api/record/notes — filtered list. Default scoping = all active notes.
// Query params: segmentId, category, kind, limit.
router.get("/api/record/notes", async (req, res) => {
  const user = req.user as { id: string };
  const parsed = listNotesQuery.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_query", detail: parsed.error.flatten() });
  }
  try {
    const notes = await listNotes({
      userId: user.id,
      segmentId: parsed.data.segmentId,
      category: parsed.data.category,
      kind: parsed.data.kind,
      limit: parsed.data.limit,
    });
    res.json(notes);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    res.status(500).json({ error: "notes_load_failed", message });
  }
});

// GET /api/record/segments — all segments for the user
router.get("/api/record/segments", async (req, res) => {
  const user = req.user as { id: string };
  try {
    const segments = await listSegments(user.id);
    res.json(segments);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    res.status(500).json({ error: "segments_load_failed", message });
  }
});

const writeNoteBody = z.object({
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  kind: z.string().min(1),
  label: z.string().min(1).max(200),
  body: z.string().max(10000).optional(),
  evidenceRefs: z.unknown().optional(),
  attributes: z.unknown().optional(),
  confidence: z.number().min(0).max(1).optional(),
  sourcePhase: z.string().optional(),
  sourceSubStepId: z.number().optional(),
  sourceMessageId: z.number().optional(),
  segmentIds: z.array(z.number()).optional(),
});

// POST /api/record/notes — manual note creation (user-stated by default)
router.post("/api/record/notes", async (req, res) => {
  const user = req.user as { id: string };
  const parsed = writeNoteBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_input", detail: parsed.error.flatten() });
  }
  try {
    const note = await writeNote({
      userId: user.id,
      sourceKind: "user_stated",
      ...parsed.data,
    });
    audit({ req, action: "record.note.create", resourceType: "record_note", resourceId: String(note.id) });
    res.json(note);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    res.status(500).json({ error: "note_create_failed", message });
  }
});

// PATCH /api/record/notes/:id/supersede — replace with corrected content
router.patch("/api/record/notes/:id/supersede", async (req, res) => {
  const user = req.user as { id: string };
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid_id" });
  const parsed = writeNoteBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_input", detail: parsed.error.flatten() });
  }
  try {
    const note = await supersedeNote(user.id, id, {
      userId: user.id,
      sourceKind: "user_stated",
      ...parsed.data,
    });
    audit({
      req,
      action: "record.note.supersede",
      resourceType: "record_note",
      resourceId: String(id),
      detail: { newId: note.id },
    });
    res.json(note);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    res.status(500).json({ error: "note_supersede_failed", message });
  }
});

// POST /api/record/notes/:id/delete — POPIA-style soft delete (status flag).
// Data preserved; UI hides deletion_pending. Hard-delete is a separate
// compliance pass, not built here.
router.post("/api/record/notes/:id/delete", async (req, res) => {
  const user = req.user as { id: string };
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid_id" });
  try {
    await softDeleteNote(user.id, id);
    audit({
      req,
      action: "record.note.soft_delete",
      resourceType: "record_note",
      resourceId: String(id),
    });
    res.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    res.status(500).json({ error: "note_delete_failed", message });
  }
});

export default router;

// Re-export helpers for use by other route modules / orchestrators.
export { ensureRecord, ensureSegment, listNotes, writeNote, softDeleteNote };
