import { pgTable, text, timestamp, boolean, integer, serial, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Sessions — required by connect-pg-simple
export const sessions = pgTable(
  "sessions",
  {
    sid: text("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire", { mode: "date" }).notNull(),
  },
  (t) => [index("idx_sessions_expire").on(t.expire)]
);

// Users
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  profileImageUrl: text("profile_image_url"), // from Google OAuth
  photoDataUrl: text("photo_data_url"), // user-uploaded photo, overrides Google avatar
  cell: text("cell"),
  onboardedAt: timestamp("onboarded_at"),
  buildCompletedAt: timestamp("build_completed_at"),
  isAdmin: boolean("is_admin").notNull().default(false),
  termsAcceptedAt: timestamp("terms_accepted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Invite whitelist
export const invitedUsers = pgTable("invited_users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  invitedBy: text("invited_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Access requests (public form for people without an invite)
export const accessRequests = pgTable("access_requests", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  cell: text("cell"),
  status: text("status").notNull().default("pending"), // pending | approved | declined
  createdAt: timestamp("created_at").notNull().defaultNow(),
  decidedAt: timestamp("decided_at"),
  decidedBy: text("decided_by").references(() => users.id),
});

// Audit log
export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  userId: text("user_id").references(() => users.id),
  action: text("action").notNull(),
  resourceType: text("resource_type"),
  resourceId: text("resource_id"),
  outcome: text("outcome").notNull().default("success"),
  detail: jsonb("detail"),
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// System prompts — admin-editable, versioned.
// One row per version; isActive=true marks the version currently in use.
// Exactly one active row per promptKey.
export const systemPrompts = pgTable("system_prompts", {
  id: serial("id").primaryKey(),
  // Phase 1: extraction | analysis | qa | qa_bring_it_in
  // Phase 2: analysis_facts | analysis_prose | analysis_panels | analysis_chat
  promptKey: text("prompt_key").notNull(),
  label: text("label").notNull(),
  description: text("description"),
  model: text("model").notNull().default("claude-sonnet-4-6"),
  content: text("content").notNull(),
  version: integer("version").notNull().default(1),
  isActive: boolean("is_active").notNull().default(true),
  createdBy: text("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Uploaded bank statements + extraction results
export const statements = pgTable("statements", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  filename: text("filename").notNull(),
  sizeBytes: integer("size_bytes"),
  contentHash: text("content_hash"), // SHA-256 of PDF bytes — dedupe key per user
  status: text("status").notNull().default("extracting"), // extracting | extracted | failed
  extractionResult: jsonb("extraction_result"),
  extractionError: text("extraction_error"),
  promptVersionId: integer("prompt_version_id").references(() => systemPrompts.id),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  cacheReadTokens: integer("cache_read_tokens"),
  cacheCreationTokens: integer("cache_creation_tokens"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
});

// AI analyses — one row per analysis run per user
export const analyses = pgTable("analyses", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  status: text("status").notNull().default("analysing"), // analysing | done | failed
  result: jsonb("result"),
  errorMessage: text("error_message"),
  promptVersionId: integer("prompt_version_id").references(() => systemPrompts.id),
  sourceStatementIds: jsonb("source_statement_ids"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  cacheReadTokens: integer("cache_read_tokens"),
  cacheCreationTokens: integer("cache_creation_tokens"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
});

// Conversational Q&A — one live conversation per user.
// Continues across analysis re-runs; agent always sees the latest analysis context each turn.
export const conversations = pgTable("conversations", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().unique().references(() => users.id),
  status: text("status").notNull().default("active"), // active | paused | complete
  profile: jsonb("profile"), // accumulated QaProfile — what the agent has confirmed so far
  flaggedIssues: jsonb("flagged_issues"), // array of plain-language flags the agent has surfaced
  analysisIdAtStart: integer("analysis_id_at_start").references(() => analyses.id),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
});

// Messages within a conversation — append-only log of turns.
export const conversationMessages = pgTable(
  "conversation_messages",
  {
    id: serial("id").primaryKey(),
    conversationId: integer("conversation_id").notNull().references(() => conversations.id),
    role: text("role").notNull(), // user | assistant
    content: text("content").notNull(),
    profileUpdates: jsonb("profile_updates"), // what the assistant extracted on this turn (null for user messages)
    status: text("status"), // what the assistant set conversation status to on this turn
    // Assistant messages generated at a phase boundary (conversation start, phase transition).
    // The client renders these with a distinct visual treatment so the user sees them as
    // Ally orienting them to a new step rather than a regular reply.
    isTransition: boolean("is_transition").notNull().default(false),
    promptVersionId: integer("prompt_version_id").references(() => systemPrompts.id),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    cacheReadTokens: integer("cache_read_tokens"),
    cacheCreationTokens: integer("cache_creation_tokens"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("idx_conversation_messages_conversation_id").on(t.conversationId)]
);

// === Phase 2 — Our analysis ===
// The first-draft analysis Ally produces from everything known after Phase 1.
// One row per generation. Supersedes on user disagreement; agreed on sign-off.
export const analysisDrafts = pgTable(
  "analysis_drafts",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    // Which Phase 1 outputs this draft was built from. Kept for audit and for
    // reasoning about whether a stale draft needs regenerating.
    sourceConversationId: integer("source_conversation_id").references(() => conversations.id),
    sourceAnalysisId: integer("source_analysis_id").references(() => analyses.id),
    status: text("status").notNull().default("thinking"), // thinking | ready | agreed | superseded | failed
    facts: jsonb("facts"), // structured ground truth from analysis_facts prompt
    prose: jsonb("prose"), // Format A text story sections
    panels: jsonb("panels"), // Format B comic beats
    errorMessage: text("error_message"),
    supersededBy: integer("superseded_by"), // self-FK (deferred — no cycle in drizzle typing)
    // {facts: number, prose: number, panels: number} — versions of each prompt used
    promptVersionIds: jsonb("prompt_version_ids"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    cacheReadTokens: integer("cache_read_tokens"),
    cacheCreationTokens: integer("cache_creation_tokens"),
    generatedAt: timestamp("generated_at"),
    agreedAt: timestamp("agreed_at"),
    supersededAt: timestamp("superseded_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("idx_analysis_drafts_user_id").on(t.userId)]
);

// Derived index of annotations that live inside a draft — claim spans (Explain)
// and fact spans (Notes). Populated alongside the draft so Explain/Notes modes
// don't have to re-parse the prose/panels JSON on every click.
export const analysisClaims = pgTable(
  "analysis_claims",
  {
    id: serial("id").primaryKey(),
    // Polymorphic ownership: a claim belongs to either a Phase 2 draft OR
    // a Phase 1 analysis. App-level invariant: exactly one of (draftId,
    // analysisId) is non-null. Keeping both nullable avoids forcing Drizzle
    // through a CHECK constraint migration.
    draftId: integer("draft_id").references(() => analysisDrafts.id),
    analysisId: integer("analysis_id").references(() => analyses.id),
    kind: text("kind").notNull(), // explain | note
    anchorId: text("anchor_id").notNull(), // structural id referenced from prose/panels
    label: text("label").notNull(), // the phrase highlighted in the draft
    category: text("category"), // for notes grouping (house | retirement | crypto | ...)
    body: text("body"), // claim restatement or note body
    evidenceRefs: jsonb("evidence_refs"), // {transactions:[], months:[], profilePaths:[], ...}
  },
  (t) => [
    index("idx_analysis_claims_draft_id").on(t.draftId),
    index("idx_analysis_claims_analysis_id").on(t.analysisId),
  ]
);

// The refining conversation that happens alongside the draft. Separate from the
// Phase 1 `conversations` table — each baseline cycle starts a fresh conversation
// (PRD §8: "can scroll back through the chat but can't add to it. Changes require a
// new conversation.").
export const analysisConversations = pgTable(
  "analysis_conversations",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    draftId: integer("draft_id").notNull().references(() => analysisDrafts.id),
    status: text("status").notNull().default("active"), // active | paused | complete
    // Augmentations established during refining — may add or override Phase 1 facts
    // without rewriting the Phase 1 conversation.profile.
    profile: jsonb("profile"),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    completedAt: timestamp("completed_at"),
  },
  (t) => [index("idx_analysis_conversations_user_id").on(t.userId)]
);

export const analysisConversationMessages = pgTable(
  "analysis_conversation_messages",
  {
    id: serial("id").primaryKey(),
    analysisConversationId: integer("analysis_conversation_id")
      .notNull()
      .references(() => analysisConversations.id),
    role: text("role").notNull(), // user | assistant
    content: text("content").notNull(),
    profileUpdates: jsonb("profile_updates"),
    status: text("status"), // what the assistant set conversation.status to this turn
    // If this turn caused a regeneration, the new draft id. The chat renders a
    // distinct "Ally rewrote it" marker rather than a regular reply.
    regeneratedDraftId: integer("regenerated_draft_id").references(() => analysisDrafts.id),
    isTransition: boolean("is_transition").notNull().default(false),
    promptVersionId: integer("prompt_version_id").references(() => systemPrompts.id),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    cacheReadTokens: integer("cache_read_tokens"),
    cacheCreationTokens: integer("cache_creation_tokens"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_analysis_conversation_messages_conv_id").on(t.analysisConversationId),
  ]
);

// === Universal sub-step primitive (architecture spec Slice 1) ===
// Every on-screen moment where someone is doing (or waiting for) something is
// backed by exactly one active sub_steps row. Re-entry creates a new instance
// linked to its predecessor; nothing is overwritten. See Scratch/ally_architecture_spec.md.
//
// Slice 1 pragmatism: contentJson references existing content tables by id
// (e.g. { analysisId: 42 }) rather than inlining the artefact. Later cleanup
// slice can migrate content into this table if the reference model hurts
// cascade invalidation or record export.
export const subSteps = pgTable(
  "sub_steps",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    phaseKey: text("phase_key").notNull(), // picture | analysis | plan | progress
    step: text("step").notNull(), // gather | draft | discuss | live
    instance: integer("instance").notNull().default(1), // re-entry counter
    status: text("status").notNull().default("not_started"), // not_started | in_progress | agreed | superseded | paused
    driver: text("driver").notNull(), // person | ally | both
    // Phase × step specific artefact payload.
    // - picture.gather:  { statementIds: number[] }
    // - picture.draft:   { analysisId: number }   → references `analyses` row
    // - picture.discuss: { analysisId: number }   → same reference, conversation derives
    // - picture.live:    { analysisId: number }
    contentJson: jsonb("content_json"),
    // Attachments across the sub-step's lifetime. Kind distinguishes primary
    // (foundational data brought in during Gather) from supporting (evidence
    // attached mid-Discuss to settle a specific point).
    attachmentsJson: jsonb("attachments_json"),
    // Structured facts established during this sub-step — feeds the record of discussion.
    notesJson: jsonb("notes_json"),
    // Ally-at-work error state. Only set while status='in_progress' and step='draft'
    // and the Draft sub-mode is 'hit_problem' (derived; see server/modules/subStep).
    errorMessage: text("error_message"),
    predecessorId: integer("predecessor_id"), // self-fk, for re-entry chaining
    startedAt: timestamp("started_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    agreedAt: timestamp("agreed_at"),
    supersededAt: timestamp("superseded_at"),
    pausedAt: timestamp("paused_at"),
  },
  (t) => [
    index("idx_sub_steps_user").on(t.userId),
    index("idx_sub_steps_user_phase").on(t.userId, t.phaseKey),
  ],
);

// Unified conversation-turn log. Replaces the role of conversation_messages and
// analysis_conversation_messages for any sub-step that has a chat pane.
// Legacy messages are backfilled into this table by scripts/migrate-substeps.ts.
export const subStepMessages = pgTable(
  "sub_step_messages",
  {
    id: serial("id").primaryKey(),
    subStepId: integer("sub_step_id").notNull().references(() => subSteps.id),
    role: text("role").notNull(), // user | assistant
    content: text("content").notNull(),
    isTransition: boolean("is_transition").notNull().default(false),
    profileUpdates: jsonb("profile_updates"),
    promptVersionId: integer("prompt_version_id").references(() => systemPrompts.id),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    cacheReadTokens: integer("cache_read_tokens"),
    cacheCreationTokens: integer("cache_creation_tokens"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("idx_sub_step_messages_sub_step").on(t.subStepId)],
);

// === The Record (slice 3 — long-term brain across the whole relationship) ===
// User-facing surface = "Notes". Internally this is the record of conversation:
// the audit + memory layer that accumulates across every canvas, every session,
// every relationship year. See Scratch/ally_architecture_spec.md and the slice 3 plan.
//
// Design principles (must stay flexible):
//   - All `kind` / `category` / `relationKind` fields are open text columns, not
//     Postgres enums. New values are config changes, not migrations.
//   - Every entity has an `attributes` jsonb for fields we haven't designed yet.
//   - Append-only: edits create new rows; the old row points forward via supersededBy.
//   - Deletion is a status flag. Hard-delete is a separate compliance pass.

// One row per user. The root of their whole record. Periodically synthesised.
export const record = pgTable("record", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().unique().references(() => users.id),
  // Relationship-level synthesis — "who Garth is and where we are right now".
  // Refreshed by triggerMetaSynthesis (multi-hook callable; see server/modules/record).
  metaSummary: jsonb("meta_summary"),
  // Recurring patterns across the record: [{ theme, observation, evidence_count }].
  metaThemes: jsonb("meta_themes"),
  // Open jsonb extensibility hatch.
  attributes: jsonb("attributes"),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Slices of the record. A note can belong to many segments via record_note_segments.
// Segments can nest — a sub_step segment's parent is its canvas segment, etc.
export const recordSegments = pgTable(
  "record_segments",
  {
    id: serial("id").primaryKey(),
    recordId: integer("record_id").notNull().references(() => record.id),
    userId: text("user_id").notNull().references(() => users.id),
    // Open enum: sub_step | canvas | topic | meta | temporal | session | milestone | life_event | future
    kind: text("kind").notNull(),
    parentSegmentId: integer("parent_segment_id"),
    label: text("label").notNull(),
    description: text("description"),
    // Ally's compressed summary of THIS slice. Read by chat prompts in place
    // of full message history once the segment's tokens cross threshold.
    summaryJson: jsonb("summary_json"),
    attributes: jsonb("attributes"),
    // Provenance hooks per kind (any may apply).
    phaseKey: text("phase_key"),
    subStepId: integer("sub_step_id").references(() => subSteps.id),
    topicKey: text("topic_key"),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    endedAt: timestamp("ended_at"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_record_segments_record").on(t.recordId),
    index("idx_record_segments_user_kind").on(t.userId, t.kind),
    index("idx_record_segments_sub_step").on(t.subStepId),
  ],
);

// The leaf entries — individual facts, decisions, observations, summaries.
// Append-only. Edits create new rows pointing forward via supersededBy.
export const recordNotes = pgTable(
  "record_notes",
  {
    id: serial("id").primaryKey(),
    recordId: integer("record_id").notNull().references(() => record.id),
    userId: text("user_id").notNull().references(() => users.id),
    // Primary categorisation. Open enum.
    category: text("category"),
    // Multi-value emergent classification.
    tags: jsonb("tags"),
    // Open enum: fact | decision | skipped_gap | flag | summary | observation
    //          | preference | concern | intention | future
    kind: text("kind").notNull(),
    label: text("label").notNull(),
    body: text("body"),
    // Where the note's claim is grounded — transactions, statement ids,
    // message ids, profile paths, etc. Free-form jsonb for now.
    evidenceRefs: jsonb("evidence_refs"),
    attributes: jsonb("attributes"),
    // 0..1 — Ally's certainty. Useful for downstream synthesis weighting.
    confidence: text("confidence"),
    // ally_generated | user_stated | system_inferred | admin_set | imported
    sourceKind: text("source_kind"),
    // Origin provenance.
    sourcePhase: text("source_phase"),
    sourceSubStepId: integer("source_sub_step_id").references(() => subSteps.id),
    sourceMessageId: integer("source_message_id").references(() => subStepMessages.id),
    // Audit chain (status flag covers POPIA deletion intent — UI hides
    // deletion_pending; data is preserved until a compliance hard-delete pass).
    status: text("status").notNull().default("active"), // active | superseded | declined | deletion_pending
    supersededAt: timestamp("superseded_at"),
    supersededBy: integer("superseded_by"),
    establishedAt: timestamp("established_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_record_notes_user").on(t.userId),
    index("idx_record_notes_user_status").on(t.userId, t.status),
    index("idx_record_notes_user_category").on(t.userId, t.category),
    index("idx_record_notes_user_kind").on(t.userId, t.kind),
    index("idx_record_notes_record").on(t.recordId),
  ],
);

// m:n — a single note belongs to multiple segments.
export const recordNoteSegments = pgTable(
  "record_note_segments",
  {
    noteId: integer("note_id").notNull().references(() => recordNotes.id),
    segmentId: integer("segment_id").notNull().references(() => recordSegments.id),
  },
  (t) => [
    index("idx_record_note_segments_note").on(t.noteId),
    index("idx_record_note_segments_segment").on(t.segmentId),
  ],
);

// Knowledge-graph edges between notes. Built into the foundation now; used
// later. supports | contradicts | supersedes | derives_from | references | future
export const recordNoteRelations = pgTable(
  "record_note_relations",
  {
    id: serial("id").primaryKey(),
    fromNoteId: integer("from_note_id").notNull().references(() => recordNotes.id),
    toNoteId: integer("to_note_id").notNull().references(() => recordNotes.id),
    relationKind: text("relation_kind").notNull(),
    confidence: text("confidence"),
    establishedAt: timestamp("established_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_record_note_relations_from").on(t.fromNoteId),
    index("idx_record_note_relations_to").on(t.toNoteId),
  ],
);

// Audit log of synthesis runs. Every triggerMetaSynthesis fires a row here.
// Lets us ask "when did this metaSummary get rewritten and why?" without
// pinning the trigger logic to one mechanism.
export const recordSynthesisJobs = pgTable(
  "record_synthesis_jobs",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    // Open enum: discuss_agreed | reopen | scheduled | manual | post_summary | future
    triggerKind: text("trigger_kind").notNull(),
    // What changed since the last synthesis (segment ids touched, note count, etc.).
    contextJson: jsonb("context_json"),
    status: text("status").notNull().default("pending"), // pending | running | done | failed
    errorMessage: text("error_message"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    cacheReadTokens: integer("cache_read_tokens"),
    cacheCreationTokens: integer("cache_creation_tokens"),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    completedAt: timestamp("completed_at"),
  },
  (t) => [index("idx_record_synthesis_user").on(t.userId)],
);

// Zod schemas
export const insertAccessRequestSchema = createInsertSchema(accessRequests).pick({
  name: true,
  email: true,
  cell: true,
});

export const insertInviteSchema = z.object({
  email: z.string().email(),
});

export const savePromptSchema = z.object({
  promptKey: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
  model: z.string().min(1),
  content: z.string().min(1),
});

export const onboardSchema = z.object({
  firstName: z.string().min(1).max(80),
  lastName: z.string().max(80).optional(),
  cell: z.string().max(30).optional(),
  photoDataUrl: z.string().startsWith("data:image/").max(500_000).optional(),
});

// Types
export type User = typeof users.$inferSelect;
export type InvitedUser = typeof invitedUsers.$inferSelect;
export type AccessRequest = typeof accessRequests.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
export type SystemPrompt = typeof systemPrompts.$inferSelect;
export type Statement = typeof statements.$inferSelect;
export type Analysis = typeof analyses.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type ConversationMessage = typeof conversationMessages.$inferSelect;
export type AnalysisDraft = typeof analysisDrafts.$inferSelect;
export type AnalysisClaim = typeof analysisClaims.$inferSelect;
export type AnalysisConversation = typeof analysisConversations.$inferSelect;
export type AnalysisConversationMessage = typeof analysisConversationMessages.$inferSelect;
export type SubStep = typeof subSteps.$inferSelect;
export type SubStepMessage = typeof subStepMessages.$inferSelect;
export type Record = typeof record.$inferSelect;
export type RecordSegment = typeof recordSegments.$inferSelect;
export type RecordNote = typeof recordNotes.$inferSelect;
export type RecordNoteSegment = typeof recordNoteSegments.$inferSelect;
export type RecordNoteRelation = typeof recordNoteRelations.$inferSelect;
export type RecordSynthesisJob = typeof recordSynthesisJobs.$inferSelect;
