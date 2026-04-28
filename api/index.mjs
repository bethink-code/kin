var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// server/api.ts
import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";

// server/auth.ts
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";

// server/db.ts
import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

// shared/schema.ts
var schema_exports = {};
__export(schema_exports, {
  accessRequests: () => accessRequests,
  analyses: () => analyses,
  analysisClaims: () => analysisClaims,
  analysisConversationMessages: () => analysisConversationMessages,
  analysisConversations: () => analysisConversations,
  analysisDrafts: () => analysisDrafts,
  auditLogs: () => auditLogs,
  conversationMessages: () => conversationMessages,
  conversations: () => conversations,
  insertAccessRequestSchema: () => insertAccessRequestSchema,
  insertInviteSchema: () => insertInviteSchema,
  invitedUsers: () => invitedUsers,
  onboardSchema: () => onboardSchema,
  record: () => record,
  recordNoteRelations: () => recordNoteRelations,
  recordNoteSegments: () => recordNoteSegments,
  recordNotes: () => recordNotes,
  recordSegments: () => recordSegments,
  recordSynthesisJobs: () => recordSynthesisJobs,
  savePromptSchema: () => savePromptSchema,
  sessions: () => sessions,
  statements: () => statements,
  subStepMessages: () => subStepMessages,
  subSteps: () => subSteps,
  systemPrompts: () => systemPrompts,
  users: () => users
});
import { pgTable, text, timestamp, boolean, integer, serial, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
var sessions = pgTable(
  "sessions",
  {
    sid: text("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire", { mode: "date" }).notNull()
  },
  (t) => [index("idx_sessions_expire").on(t.expire)]
);
var users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  profileImageUrl: text("profile_image_url"),
  // from Google OAuth
  photoDataUrl: text("photo_data_url"),
  // user-uploaded photo, overrides Google avatar
  cell: text("cell"),
  onboardedAt: timestamp("onboarded_at"),
  buildCompletedAt: timestamp("build_completed_at"),
  isAdmin: boolean("is_admin").notNull().default(false),
  termsAcceptedAt: timestamp("terms_accepted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow()
});
var invitedUsers = pgTable("invited_users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  invitedBy: text("invited_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow()
});
var accessRequests = pgTable("access_requests", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  cell: text("cell"),
  status: text("status").notNull().default("pending"),
  // pending | approved | declined
  createdAt: timestamp("created_at").notNull().defaultNow(),
  decidedAt: timestamp("decided_at"),
  decidedBy: text("decided_by").references(() => users.id)
});
var auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  userId: text("user_id").references(() => users.id),
  action: text("action").notNull(),
  resourceType: text("resource_type"),
  resourceId: text("resource_id"),
  outcome: text("outcome").notNull().default("success"),
  detail: jsonb("detail"),
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at").notNull().defaultNow()
});
var systemPrompts = pgTable("system_prompts", {
  id: serial("id").primaryKey(),
  // Canvas 1: extraction | analysis | qa | qa_bring_it_in
  // Canvas 2: analysis_facts | analysis_prose | analysis_panels | analysis_chat
  promptKey: text("prompt_key").notNull(),
  label: text("label").notNull(),
  description: text("description"),
  model: text("model").notNull().default("claude-sonnet-4-6"),
  content: text("content").notNull(),
  version: integer("version").notNull().default(1),
  isActive: boolean("is_active").notNull().default(true),
  createdBy: text("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow()
});
var statements = pgTable("statements", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  filename: text("filename").notNull(),
  sizeBytes: integer("size_bytes"),
  contentHash: text("content_hash"),
  // SHA-256 of PDF bytes — dedupe key per user
  status: text("status").notNull().default("extracting"),
  // extracting | extracted | failed
  extractionResult: jsonb("extraction_result"),
  extractionError: text("extraction_error"),
  promptVersionId: integer("prompt_version_id").references(() => systemPrompts.id),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  cacheReadTokens: integer("cache_read_tokens"),
  cacheCreationTokens: integer("cache_creation_tokens"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at")
});
var analyses = pgTable("analyses", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  status: text("status").notNull().default("analysing"),
  // analysing | done | failed
  result: jsonb("result"),
  errorMessage: text("error_message"),
  promptVersionId: integer("prompt_version_id").references(() => systemPrompts.id),
  sourceStatementIds: jsonb("source_statement_ids"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  cacheReadTokens: integer("cache_read_tokens"),
  cacheCreationTokens: integer("cache_creation_tokens"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at")
});
var conversations = pgTable("conversations", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().unique().references(() => users.id),
  status: text("status").notNull().default("active"),
  // active | paused | complete
  profile: jsonb("profile"),
  // accumulated QaProfile — what the agent has confirmed so far
  flaggedIssues: jsonb("flagged_issues"),
  // array of plain-language flags the agent has surfaced
  analysisIdAtStart: integer("analysis_id_at_start").references(() => analyses.id),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at")
});
var conversationMessages = pgTable(
  "conversation_messages",
  {
    id: serial("id").primaryKey(),
    conversationId: integer("conversation_id").notNull().references(() => conversations.id),
    role: text("role").notNull(),
    // user | assistant
    content: text("content").notNull(),
    profileUpdates: jsonb("profile_updates"),
    // what the assistant extracted on this turn (null for user messages)
    status: text("status"),
    // what the assistant set conversation status to on this turn
    // Assistant messages generated at a phase boundary (conversation start, phase transition).
    // The client renders these with a distinct visual treatment so the user sees them as
    // Ally orienting them to a new step rather than a regular reply.
    isTransition: boolean("is_transition").notNull().default(false),
    promptVersionId: integer("prompt_version_id").references(() => systemPrompts.id),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    cacheReadTokens: integer("cache_read_tokens"),
    cacheCreationTokens: integer("cache_creation_tokens"),
    createdAt: timestamp("created_at").notNull().defaultNow()
  },
  (t) => [index("idx_conversation_messages_conversation_id").on(t.conversationId)]
);
var analysisDrafts = pgTable(
  "analysis_drafts",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    // Which Canvas 1 outputs this draft was built from. Kept for audit and for
    // reasoning about whether a stale draft needs regenerating.
    sourceConversationId: integer("source_conversation_id").references(() => conversations.id),
    sourceAnalysisId: integer("source_analysis_id").references(() => analyses.id),
    status: text("status").notNull().default("thinking"),
    // thinking | ready | agreed | superseded | failed
    facts: jsonb("facts"),
    // structured ground truth from analysis_facts prompt
    prose: jsonb("prose"),
    // Format A text story sections
    panels: jsonb("panels"),
    // Format B comic beats
    errorMessage: text("error_message"),
    supersededBy: integer("superseded_by"),
    // self-FK (deferred — no cycle in drizzle typing)
    // {facts: number, prose: number, panels: number} — versions of each prompt used
    promptVersionIds: jsonb("prompt_version_ids"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    cacheReadTokens: integer("cache_read_tokens"),
    cacheCreationTokens: integer("cache_creation_tokens"),
    generatedAt: timestamp("generated_at"),
    agreedAt: timestamp("agreed_at"),
    supersededAt: timestamp("superseded_at"),
    createdAt: timestamp("created_at").notNull().defaultNow()
  },
  (t) => [index("idx_analysis_drafts_user_id").on(t.userId)]
);
var analysisClaims = pgTable(
  "analysis_claims",
  {
    id: serial("id").primaryKey(),
    // Polymorphic ownership: a claim belongs to either a Canvas 2 draft OR
    // a Canvas 1 analysis. App-level invariant: exactly one of (draftId,
    // analysisId) is non-null. Keeping both nullable avoids forcing Drizzle
    // through a CHECK constraint migration.
    draftId: integer("draft_id").references(() => analysisDrafts.id),
    analysisId: integer("analysis_id").references(() => analyses.id),
    kind: text("kind").notNull(),
    // explain | note
    anchorId: text("anchor_id").notNull(),
    // structural id referenced from prose/panels
    label: text("label").notNull(),
    // the phrase highlighted in the draft
    category: text("category"),
    // for notes grouping (house | retirement | crypto | ...)
    body: text("body"),
    // claim restatement or note body
    evidenceRefs: jsonb("evidence_refs")
    // {transactions:[], months:[], profilePaths:[], ...}
  },
  (t) => [
    index("idx_analysis_claims_draft_id").on(t.draftId),
    index("idx_analysis_claims_analysis_id").on(t.analysisId)
  ]
);
var analysisConversations = pgTable(
  "analysis_conversations",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    draftId: integer("draft_id").notNull().references(() => analysisDrafts.id),
    status: text("status").notNull().default("active"),
    // active | paused | complete
    // Augmentations established during refining — may add or override Canvas 1 facts
    // without rewriting the Canvas 1 conversation.profile.
    profile: jsonb("profile"),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    completedAt: timestamp("completed_at")
  },
  (t) => [index("idx_analysis_conversations_user_id").on(t.userId)]
);
var analysisConversationMessages = pgTable(
  "analysis_conversation_messages",
  {
    id: serial("id").primaryKey(),
    analysisConversationId: integer("analysis_conversation_id").notNull().references(() => analysisConversations.id),
    role: text("role").notNull(),
    // user | assistant
    content: text("content").notNull(),
    profileUpdates: jsonb("profile_updates"),
    status: text("status"),
    // what the assistant set conversation.status to this turn
    // If this turn caused a regeneration, the new draft id. The chat renders a
    // distinct "Ally rewrote it" marker rather than a regular reply.
    regeneratedDraftId: integer("regenerated_draft_id").references(() => analysisDrafts.id),
    isTransition: boolean("is_transition").notNull().default(false),
    promptVersionId: integer("prompt_version_id").references(() => systemPrompts.id),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    cacheReadTokens: integer("cache_read_tokens"),
    cacheCreationTokens: integer("cache_creation_tokens"),
    createdAt: timestamp("created_at").notNull().defaultNow()
  },
  (t) => [
    index("idx_analysis_conversation_messages_conv_id").on(t.analysisConversationId)
  ]
);
var subSteps = pgTable(
  "sub_steps",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    canvasKey: text("canvas_key").notNull(),
    // picture | analysis | plan | progress
    beat: text("beat").notNull(),
    // gather | analyse | discuss | live
    instance: integer("instance").notNull().default(1),
    // re-entry counter
    status: text("status").notNull().default("not_started"),
    // not_started | in_progress | agreed | superseded | paused
    driver: text("driver").notNull(),
    // person | ally | both
    // Canvas × beat specific artefact payload.
    // - picture.gather:  { statementIds: number[] }
    // - picture.analyse: { analysisId: number }   → references `analyses` row
    // - picture.discuss: { analysisId: number }   → same reference, conversation derives
    // - picture.live:    { analysisId: number }
    contentJson: jsonb("content_json"),
    // Attachments across the sub-step's lifetime. Kind distinguishes primary
    // (foundational data brought in during Gather) from supporting (evidence
    // attached mid-Discuss to settle a specific point).
    attachmentsJson: jsonb("attachments_json"),
    // Structured facts established during this sub-step — feeds the record of discussion.
    notesJson: jsonb("notes_json"),
    // Ally-at-work error state. Only set while status='in_progress' and beat='analyse'
    // and the Analyse sub-mode is 'hit_problem' (derived; see server/modules/subStep).
    errorMessage: text("error_message"),
    predecessorId: integer("predecessor_id"),
    // self-fk, for re-entry chaining
    startedAt: timestamp("started_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    agreedAt: timestamp("agreed_at"),
    supersededAt: timestamp("superseded_at"),
    pausedAt: timestamp("paused_at")
  },
  (t) => [
    index("idx_sub_steps_user").on(t.userId),
    index("idx_sub_steps_user_canvas").on(t.userId, t.canvasKey)
  ]
);
var subStepMessages = pgTable(
  "sub_step_messages",
  {
    id: serial("id").primaryKey(),
    subStepId: integer("sub_step_id").notNull().references(() => subSteps.id),
    role: text("role").notNull(),
    // user | assistant
    content: text("content").notNull(),
    isTransition: boolean("is_transition").notNull().default(false),
    profileUpdates: jsonb("profile_updates"),
    promptVersionId: integer("prompt_version_id").references(() => systemPrompts.id),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    cacheReadTokens: integer("cache_read_tokens"),
    cacheCreationTokens: integer("cache_creation_tokens"),
    createdAt: timestamp("created_at").notNull().defaultNow()
  },
  (t) => [index("idx_sub_step_messages_sub_step").on(t.subStepId)]
);
var record = pgTable("record", {
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
  updatedAt: timestamp("updated_at").notNull().defaultNow()
});
var recordSegments = pgTable(
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
    canvasKey: text("canvas_key"),
    subStepId: integer("sub_step_id").references(() => subSteps.id),
    topicKey: text("topic_key"),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    endedAt: timestamp("ended_at"),
    updatedAt: timestamp("updated_at").notNull().defaultNow()
  },
  (t) => [
    index("idx_record_segments_record").on(t.recordId),
    index("idx_record_segments_user_kind").on(t.userId, t.kind),
    index("idx_record_segments_sub_step").on(t.subStepId)
  ]
);
var recordNotes = pgTable(
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
    sourceCanvas: text("source_canvas"),
    sourceSubStepId: integer("source_sub_step_id").references(() => subSteps.id),
    sourceMessageId: integer("source_message_id").references(() => subStepMessages.id),
    // Audit chain (status flag covers POPIA deletion intent — UI hides
    // deletion_pending; data is preserved until a compliance hard-delete pass).
    status: text("status").notNull().default("active"),
    // active | superseded | declined | deletion_pending
    supersededAt: timestamp("superseded_at"),
    supersededBy: integer("superseded_by"),
    establishedAt: timestamp("established_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow()
  },
  (t) => [
    index("idx_record_notes_user").on(t.userId),
    index("idx_record_notes_user_status").on(t.userId, t.status),
    index("idx_record_notes_user_category").on(t.userId, t.category),
    index("idx_record_notes_user_kind").on(t.userId, t.kind),
    index("idx_record_notes_record").on(t.recordId)
  ]
);
var recordNoteSegments = pgTable(
  "record_note_segments",
  {
    noteId: integer("note_id").notNull().references(() => recordNotes.id),
    segmentId: integer("segment_id").notNull().references(() => recordSegments.id)
  },
  (t) => [
    index("idx_record_note_segments_note").on(t.noteId),
    index("idx_record_note_segments_segment").on(t.segmentId)
  ]
);
var recordNoteRelations = pgTable(
  "record_note_relations",
  {
    id: serial("id").primaryKey(),
    fromNoteId: integer("from_note_id").notNull().references(() => recordNotes.id),
    toNoteId: integer("to_note_id").notNull().references(() => recordNotes.id),
    relationKind: text("relation_kind").notNull(),
    confidence: text("confidence"),
    establishedAt: timestamp("established_at").notNull().defaultNow()
  },
  (t) => [
    index("idx_record_note_relations_from").on(t.fromNoteId),
    index("idx_record_note_relations_to").on(t.toNoteId)
  ]
);
var recordSynthesisJobs = pgTable(
  "record_synthesis_jobs",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    // Open enum: discuss_agreed | reopen | scheduled | manual | post_summary | future
    triggerKind: text("trigger_kind").notNull(),
    // What changed since the last synthesis (segment ids touched, note count, etc.).
    contextJson: jsonb("context_json"),
    status: text("status").notNull().default("pending"),
    // pending | running | done | failed
    errorMessage: text("error_message"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    cacheReadTokens: integer("cache_read_tokens"),
    cacheCreationTokens: integer("cache_creation_tokens"),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    completedAt: timestamp("completed_at")
  },
  (t) => [index("idx_record_synthesis_user").on(t.userId)]
);
var insertAccessRequestSchema = createInsertSchema(accessRequests).pick({
  name: true,
  email: true,
  cell: true
});
var insertInviteSchema = z.object({
  email: z.string().email()
});
var savePromptSchema = z.object({
  promptKey: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
  model: z.string().min(1),
  content: z.string().min(1)
});
var onboardSchema = z.object({
  firstName: z.string().min(1).max(80),
  lastName: z.string().max(80).optional(),
  cell: z.string().max(30).optional(),
  photoDataUrl: z.string().startsWith("data:image/").max(5e5).optional()
});

// server/db.ts
neonConfig.webSocketConstructor = ws;
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL not set \u2014 is Doppler running?");
}
var connectionString = process.env.DATABASE_URL.replace(/[?&]channel_binding=require/, "");
var pool = new Pool({ connectionString });
var db = drizzle(pool, { schema: schema_exports });

// server/auth.ts
import { eq } from "drizzle-orm";

// server/auditLog.ts
function audit(input) {
  const userId = input.userId ?? input.req?.user?.id ?? null;
  const ipAddress = input.req?.headers["x-forwarded-for"]?.split(",")[0]?.trim() ?? input.req?.socket.remoteAddress ?? null;
  db.insert(auditLogs).values({
    userId,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    outcome: input.outcome ?? "success",
    detail: input.detail,
    ipAddress
  }).catch((err) => {
    console.error("[audit] failed to write log:", err);
  });
}

// server/auth.ts
var SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1e3;
function setupAuth(app2) {
  if (!process.env.SESSION_SECRET) throw new Error("SESSION_SECRET not set");
  if (!process.env.GOOGLE_CLIENT_ID) throw new Error("GOOGLE_CLIENT_ID not set");
  if (!process.env.GOOGLE_CLIENT_SECRET) throw new Error("GOOGLE_CLIENT_SECRET not set");
  const PgStore = connectPgSimple(session);
  const isProd = process.env.NODE_ENV === "production";
  app2.use(
    session({
      store: new PgStore({ pool, tableName: "sessions", createTableIfMissing: false }),
      secret: process.env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: isProd,
        sameSite: "lax",
        maxAge: SEVEN_DAYS_MS
      }
    })
  );
  app2.use(passport.initialize());
  app2.use(passport.session());
  const callbackURL = isProd ? `${process.env.PUBLIC_URL ?? ""}/auth/callback` : "http://localhost:5000/auth/callback";
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL
      },
      async (_at, _rt, profile, done) => {
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
            const [updated] = await db.update(users).set({
              firstName: profile.name?.givenName ?? existing.firstName,
              lastName: profile.name?.familyName ?? existing.lastName,
              profileImageUrl: profile.photos?.[0]?.value ?? existing.profileImageUrl,
              updatedAt: /* @__PURE__ */ new Date()
            }).where(eq(users.id, existing.id)).returning();
            return done(null, updated);
          }
          const [created] = await db.insert(users).values({
            id: profile.id,
            email,
            firstName: profile.name?.givenName,
            lastName: profile.name?.familyName,
            profileImageUrl: profile.photos?.[0]?.value,
            isAdmin: isSeedAdmin
          }).returning();
          return done(null, created);
        } catch (err) {
          done(err);
        }
      }
    )
  );
  passport.serializeUser((user, done) => done(null, user.id));
  passport.deserializeUser(async (id, done) => {
    try {
      const [user] = await db.select().from(users).where(eq(users.id, id));
      done(null, user ?? false);
    } catch (err) {
      done(err);
    }
  });
}
function isAuthenticated(req, res, next) {
  if (req.isAuthenticated?.()) return next();
  res.status(401).json({ error: "unauthorized" });
}
function isAdmin(req, res, next) {
  const user = req.user;
  if (req.isAuthenticated?.() && user?.isAdmin) return next();
  audit({ req, action: "admin.access_denied", outcome: "failure" });
  res.status(403).json({ error: "forbidden" });
}

// server/routes/auth.ts
import { Router } from "express";
import passport2 from "passport";
import { eq as eq2 } from "drizzle-orm";
var router = Router();
var CLIENT_URL = process.env.NODE_ENV === "production" ? process.env.PUBLIC_URL ?? "/" : "http://localhost:5173";
router.get("/auth/google", passport2.authenticate("google", { scope: ["profile", "email"] }));
router.get("/auth/callback", (req, res, next) => {
  passport2.authenticate(
    "google",
    (err, user, info) => {
      if (err) {
        if (req.isAuthenticated?.()) {
          console.warn(
            "[auth] callback errored but session is established \u2014 redirecting home:",
            err.message ?? err
          );
          return res.redirect(CLIENT_URL);
        }
        console.warn("[auth] callback bad-request \u2014 soft retry:", err.message ?? err);
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
    }
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
  const user = req.user;
  await db.update(users).set({ termsAcceptedAt: /* @__PURE__ */ new Date() }).where(eq2(users.id, user.id));
  audit({ req, action: "user.accept_terms" });
  res.json({ ok: true });
});
router.post("/api/user/build-complete", isAuthenticated, async (req, res) => {
  const user = req.user;
  const [updated] = await db.update(users).set({ buildCompletedAt: /* @__PURE__ */ new Date(), updatedAt: /* @__PURE__ */ new Date() }).where(eq2(users.id, user.id)).returning();
  audit({ req, action: "user.build_complete" });
  res.json(updated);
});
router.post("/api/user/build-reopen", isAuthenticated, async (req, res) => {
  const user = req.user;
  const [updated] = await db.update(users).set({ buildCompletedAt: null, updatedAt: /* @__PURE__ */ new Date() }).where(eq2(users.id, user.id)).returning();
  audit({ req, action: "user.build_reopen" });
  res.json(updated);
});
router.post("/api/user/onboard", isAuthenticated, async (req, res) => {
  const parsed = onboardSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_input", detail: parsed.error.flatten() });
  }
  const user = req.user;
  const [updated] = await db.update(users).set({
    firstName: parsed.data.firstName,
    lastName: parsed.data.lastName,
    cell: parsed.data.cell,
    photoDataUrl: parsed.data.photoDataUrl,
    onboardedAt: /* @__PURE__ */ new Date(),
    updatedAt: /* @__PURE__ */ new Date()
  }).where(eq2(users.id, user.id)).returning();
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
var auth_default = router;

// server/routes/admin.ts
import { Router as Router2 } from "express";
import { desc, eq as eq3, sql } from "drizzle-orm";
var router2 = Router2();
router2.use(isAdmin);
router2.get("/users", async (_req, res) => {
  const rows = await db.select().from(users).orderBy(desc(users.createdAt));
  res.json(rows);
});
router2.patch("/users/:id/admin", async (req, res) => {
  const { id } = req.params;
  const { isAdmin: newFlag } = req.body;
  await db.update(users).set({ isAdmin: Boolean(newFlag) }).where(eq3(users.id, id));
  audit({ req, action: "admin.toggle_admin", resourceType: "user", resourceId: id, detail: { isAdmin: newFlag } });
  res.json({ ok: true });
});
router2.get("/invites", async (_req, res) => {
  const rows = await db.select().from(invitedUsers).orderBy(desc(invitedUsers.createdAt));
  res.json(rows);
});
router2.post("/invites", async (req, res) => {
  const parsed = insertInviteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
  const email = parsed.data.email.toLowerCase();
  const actor = req.user;
  const [created] = await db.insert(invitedUsers).values({ email, invitedBy: actor.id }).onConflictDoNothing().returning();
  audit({ req, action: "admin.invite_create", resourceType: "invite", detail: { email } });
  res.json(created ?? { email });
});
router2.delete("/invites/:id", async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(invitedUsers).where(eq3(invitedUsers.id, id));
  audit({ req, action: "admin.invite_delete", resourceType: "invite", resourceId: String(id) });
  res.json({ ok: true });
});
router2.get("/access-requests", async (_req, res) => {
  const rows = await db.select().from(accessRequests).orderBy(desc(accessRequests.createdAt));
  res.json(rows);
});
router2.patch("/access-requests/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body;
  const actor = req.user;
  const [updated] = await db.update(accessRequests).set({ status, decidedAt: /* @__PURE__ */ new Date(), decidedBy: actor.id }).where(eq3(accessRequests.id, id)).returning();
  if (updated && status === "approved") {
    await db.insert(invitedUsers).values({ email: updated.email.toLowerCase(), invitedBy: actor.id }).onConflictDoNothing();
  }
  audit({ req, action: "admin.access_request_decide", resourceType: "access_request", resourceId: String(id), detail: { status } });
  res.json(updated);
});
router2.get("/audit-logs", async (_req, res) => {
  const rows = await db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(500);
  res.json(rows);
});
router2.get("/security-overview", async (_req, res) => {
  const [{ userCount }] = await db.select({ userCount: sql`count(*)::int` }).from(users);
  const [{ adminCount }] = await db.select({ adminCount: sql`count(*)::int` }).from(users).where(eq3(users.isAdmin, true));
  const [{ inviteCount }] = await db.select({ inviteCount: sql`count(*)::int` }).from(invitedUsers);
  const [{ pendingRequests }] = await db.select({ pendingRequests: sql`count(*)::int` }).from(accessRequests).where(eq3(accessRequests.status, "pending"));
  res.json({ userCount, adminCount, inviteCount, pendingRequests });
});
var admin_default = router2;

// server/routes/statements.ts
import { Router as Router3 } from "express";
import { z as z3 } from "zod";
import { and as and2, desc as desc3, eq as eq5 } from "drizzle-orm";

// server/modules/prompts/getPrompt.ts
import { and, desc as desc2, eq as eq4 } from "drizzle-orm";
async function getActivePrompt(promptKey) {
  const [row] = await db.select().from(systemPrompts).where(and(eq4(systemPrompts.promptKey, promptKey), eq4(systemPrompts.isActive, true))).limit(1);
  return row ?? null;
}
async function listPromptVersions(promptKey) {
  return db.select().from(systemPrompts).where(eq4(systemPrompts.promptKey, promptKey)).orderBy(desc2(systemPrompts.version));
}
async function listActivePrompts() {
  return db.select().from(systemPrompts).where(eq4(systemPrompts.isActive, true)).orderBy(systemPrompts.promptKey);
}

// server/modules/extraction/extract.ts
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

// server/modules/extraction/schema.ts
import { z as z2 } from "zod/v4";
var transactionSchema = z2.object({
  date: z2.string().describe("Transaction date in YYYY-MM-DD format"),
  description: z2.string().describe("Description exactly as it appears on the statement"),
  amount: z2.number().describe("Transaction amount as a positive number"),
  direction: z2.enum(["debit", "credit"]).describe("Whether money left or entered the account")
});
var extractionSchema = z2.object({
  accountHolderName: z2.string().nullable(),
  accountNumberMasked: z2.string().describe('Account number masked for display, e.g. "****4521"').nullable(),
  bankName: z2.string().nullable(),
  statementPeriodStart: z2.string().describe("Start date of statement period in YYYY-MM-DD").nullable(),
  statementPeriodEnd: z2.string().describe("End date of statement period in YYYY-MM-DD").nullable(),
  openingBalance: z2.number().nullable(),
  closingBalance: z2.number().nullable(),
  transactions: z2.array(transactionSchema),
  isValidBankStatement: z2.boolean().describe("False if this PDF does not appear to be a bank statement"),
  notes: z2.string().optional().describe("Any caveats, quality issues, or things flagged during extraction")
});

// server/modules/extraction/extract.ts
var client = new Anthropic();
async function extractStatement(input) {
  const response = await client.messages.parse({
    model: input.model,
    max_tokens: 16e3,
    system: [
      {
        type: "text",
        text: input.systemPrompt,
        cache_control: { type: "ephemeral" }
      }
    ],
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: input.pdfBase64 }
          },
          {
            type: "text",
            text: "Extract the structured data from this bank statement PDF."
          }
        ]
      }
    ],
    output_config: {
      format: zodOutputFormat(extractionSchema)
    }
  });
  if (!response.parsed_output) {
    throw new Error("Extraction returned no parsed output");
  }
  return {
    result: response.parsed_output,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0
    }
  };
}

// server/routes/statements.ts
var router3 = Router3();
router3.use(isAuthenticated);
var uploadSchema = z3.object({
  filename: z3.string().min(1),
  pdfBase64: z3.string().min(1),
  sizeBytes: z3.number().int().nonnegative().optional(),
  contentHash: z3.string().length(64)
});
router3.post("/api/statements/upload", async (req, res) => {
  const parsed = uploadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_input", detail: parsed.error.flatten() });
  }
  const user = req.user;
  const [existing] = await db.select().from(statements).where(and2(eq5(statements.userId, user.id), eq5(statements.contentHash, parsed.data.contentHash))).limit(1);
  if (existing) {
    audit({
      req,
      action: "statement.upload_duplicate",
      resourceType: "statement",
      resourceId: String(existing.id)
    });
    return res.status(200).json({ ...existing, wasDuplicate: true });
  }
  const prompt = await getActivePrompt("extraction");
  if (!prompt) {
    return res.status(500).json({ error: "no_active_extraction_prompt" });
  }
  const [created] = await db.insert(statements).values({
    userId: user.id,
    filename: parsed.data.filename,
    sizeBytes: parsed.data.sizeBytes,
    contentHash: parsed.data.contentHash,
    status: "extracting",
    promptVersionId: prompt.id
  }).returning();
  audit({ req, action: "statement.upload_start", resourceType: "statement", resourceId: String(created.id) });
  try {
    const { result, usage } = await extractStatement({
      pdfBase64: parsed.data.pdfBase64,
      systemPrompt: prompt.content,
      model: prompt.model
    });
    const [finished] = await db.update(statements).set({
      status: "extracted",
      extractionResult: result,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheCreationTokens: usage.cacheCreationTokens,
      completedAt: /* @__PURE__ */ new Date()
    }).where(eq5(statements.id, created.id)).returning();
    audit({
      req,
      action: "statement.extraction_success",
      resourceType: "statement",
      resourceId: String(created.id),
      detail: { usage }
    });
    res.json(finished);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    await db.update(statements).set({ status: "failed", extractionError: message, completedAt: /* @__PURE__ */ new Date() }).where(eq5(statements.id, created.id));
    audit({
      req,
      action: "statement.extraction_failure",
      resourceType: "statement",
      resourceId: String(created.id),
      outcome: "failure",
      detail: { message }
    });
    res.status(500).json({ error: "extraction_failed", message });
  }
});
router3.get("/api/statements", async (req, res) => {
  const user = req.user;
  const rows = await db.select().from(statements).where(eq5(statements.userId, user.id)).orderBy(desc3(statements.createdAt));
  res.json(rows);
});
router3.get("/api/statements/:id", async (req, res) => {
  const user = req.user;
  const id = Number(req.params.id);
  const [row] = await db.select().from(statements).where(and2(eq5(statements.id, id), eq5(statements.userId, user.id)));
  if (!row) return res.status(404).json({ error: "not_found" });
  res.json(row);
});
var statements_default = router3;

// server/routes/prompts.ts
import { Router as Router4 } from "express";

// server/modules/prompts/savePrompt.ts
import { and as and3, desc as desc4, eq as eq6 } from "drizzle-orm";
async function savePromptVersion(input) {
  return db.transaction(async (tx) => {
    const [prev] = await tx.select().from(systemPrompts).where(eq6(systemPrompts.promptKey, input.promptKey)).orderBy(desc4(systemPrompts.version)).limit(1);
    const nextVersion = prev ? prev.version + 1 : 1;
    await tx.update(systemPrompts).set({ isActive: false }).where(and3(eq6(systemPrompts.promptKey, input.promptKey), eq6(systemPrompts.isActive, true)));
    const [created] = await tx.insert(systemPrompts).values({
      promptKey: input.promptKey,
      label: input.label,
      description: input.description,
      model: input.model,
      content: input.content,
      version: nextVersion,
      isActive: true,
      createdBy: input.createdBy
    }).returning();
    return created;
  });
}
async function rollbackTo(promptKey, versionId) {
  return db.transaction(async (tx) => {
    await tx.update(systemPrompts).set({ isActive: false }).where(and3(eq6(systemPrompts.promptKey, promptKey), eq6(systemPrompts.isActive, true)));
    const [activated] = await tx.update(systemPrompts).set({ isActive: true }).where(and3(eq6(systemPrompts.id, versionId), eq6(systemPrompts.promptKey, promptKey))).returning();
    return activated;
  });
}

// server/routes/prompts.ts
var router4 = Router4();
router4.use(isAdmin);
router4.get("/prompts", async (_req, res) => {
  const rows = await listActivePrompts();
  res.json(rows);
});
router4.get("/prompts/:key/versions", async (req, res) => {
  const rows = await listPromptVersions(req.params.key);
  res.json(rows);
});
router4.post("/prompts", async (req, res) => {
  const parsed = savePromptSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_input", detail: parsed.error.flatten() });
  }
  const actor = req.user;
  const created = await savePromptVersion({ ...parsed.data, createdBy: actor.id });
  audit({
    req,
    action: "admin.prompt_save",
    resourceType: "system_prompt",
    resourceId: String(created.id),
    detail: { promptKey: created.promptKey, version: created.version }
  });
  res.json(created);
});
router4.post("/prompts/:key/rollback/:id", async (req, res) => {
  const { key, id } = req.params;
  const activated = await rollbackTo(key, Number(id));
  audit({
    req,
    action: "admin.prompt_rollback",
    resourceType: "system_prompt",
    resourceId: id,
    detail: { promptKey: key, version: activated.version }
  });
  res.json(activated);
});
var prompts_default = router4;

// server/routes/analysis.ts
import { Router as Router5 } from "express";
import { and as and5, desc as desc5, eq as eq8 } from "drizzle-orm";

// server/modules/analysis/analyse.ts
import Anthropic2 from "@anthropic-ai/sdk";
import { zodOutputFormat as zodOutputFormat2 } from "@anthropic-ai/sdk/helpers/zod";

// server/modules/analysis/schema.ts
import { z as z4 } from "zod/v4";
var categorySchema = z4.object({
  category: z4.string().describe("Plain-language category name \u2014 'Food & groceries', 'Transport', 'Subscriptions', etc. Not dev-speak."),
  monthlyAverage: z4.number().describe("Rough average monthly spend in ZAR as a positive number"),
  percentOfSpend: z4.number().describe("Share of total monthly spend as a decimal 0-1"),
  examples: z4.array(z4.string()).describe("3-5 actual merchant or description examples from the statements")
});
var recurringSchema = z4.object({
  description: z4.string().describe("Description as it appears on statement \u2014 exact"),
  amount: z4.number().describe("ZAR amount, positive"),
  frequency: z4.string().describe('e.g. "monthly on 25th", "every 2nd month"'),
  category: z4.string()
});
var incomeSourceSchema = z4.object({
  description: z4.string(),
  monthlyAverage: z4.number(),
  frequency: z4.string().describe('e.g. "monthly", "irregular"')
});
var gapSchema = z4.object({
  key: z4.string().describe('Short slug \u2014 e.g. "retirement", "insurance", "crypto", "other_debt", "employer_benefits", "goals", "concerns"'),
  label: z4.string().describe("Human-readable label \u2014 'Retirement savings', 'Insurance cover', etc."),
  whyItMatters: z4.string().describe("One or two sentences in plain language explaining why this gap is worth closing"),
  questionToAsk: z4.string().describe("The specific conversational question to ask the user next, warm and curious, not interrogative")
});
var annotationSchema = z4.object({
  kind: z4.literal("explain"),
  phrase: z4.string().describe("The exact phrase from the surrounding text that becomes clickable. Must appear verbatim in the text."),
  anchorId: z4.string().describe("A short stable id for this anchor \u2014 e.g. 'income-pattern', 'monthly-average', 'spending-shape'. Used to look up the matching explainClaim.")
});
var explainClaimSchema = z4.object({
  anchorId: z4.string().describe("Matches an annotation's anchorId."),
  label: z4.string().describe("The phrase being explained, restated."),
  body: z4.string().describe("The explanation in 1-3 sentences. The 'why' or 'how' behind the headline phrase. Warm, plain-language."),
  evidenceRefs: z4.array(z4.object({
    kind: z4.string().describe("e.g. 'transactions', 'months', 'category'"),
    ref: z4.string().describe("Specific reference \u2014 date range, merchant, etc.")
  })).default([]),
  chartKind: z4.enum([
    "none",
    "balance_by_month",
    "spend_by_category",
    "income_over_time",
    "cash_flow_shape"
  ]).default("none").describe("If a small evidence chart helps, the kind. Default 'none'.")
});
var analysisSchema = z4.object({
  lifeSnapshot: z4.string().describe("A warm 2-3 sentence paragraph describing this person's financial life based on what the statements show. Observational and human \u2014 'Your money comes in once a month. Most of it goes out again within a fortnight.'"),
  lifeSnapshotAnnotations: z4.array(annotationSchema).default([]).describe("Phrases in lifeSnapshot worth making clickable for inline explanation. 0-3 items."),
  income: z4.object({
    summary: z4.string().describe("Short narrative describing income \u2014 regularity, sources, variability. Plain language, warm, not clinical."),
    summaryAnnotations: z4.array(annotationSchema).default([]).describe("Phrases in summary worth making clickable. 0-3 items."),
    monthlyAverage: z4.number().nullable().describe("Average monthly income across the period, ZAR"),
    regularity: z4.enum(["steady", "variable", "irregular"]),
    sources: z4.array(incomeSourceSchema)
  }),
  spending: z4.object({
    summary: z4.string().describe("Short narrative describing the shape of spending \u2014 calm, non-judgemental."),
    summaryAnnotations: z4.array(annotationSchema).default([]).describe("Phrases in summary worth making clickable. 0-3 items."),
    monthlyAverage: z4.number().nullable(),
    byCategory: z4.array(categorySchema).describe("Categories sorted by monthlyAverage descending")
  }),
  savings: z4.object({
    summary: z4.string().describe("A single observation about savings behaviour \u2014 what's happening or what isn't. No lecturing."),
    summaryAnnotations: z4.array(annotationSchema).default([]).describe("Phrases in summary worth making clickable. 0-3 items."),
    monthlyAverageSaved: z4.number().nullable().describe("Can be negative if outflows exceed inflows. Null if unclear."),
    observation: z4.string().describe("One sentence \u2014 plain, honest, hopeful.")
  }),
  recurring: z4.array(recurringSchema).describe("Debit orders / subscriptions / regular outflows detected"),
  gaps: z4.array(gapSchema).describe("What the statements cannot show but we need to understand the full picture. Typical gaps: retirement, insurance, crypto, undisclosed debt, employer benefits, goals, concerns. Prioritise the 5-8 most important."),
  explainClaims: z4.array(explainClaimSchema).default([]).describe("Every annotation across the document must have a matching explainClaim with the same anchorId. The body is what's shown when the user clicks the phrase."),
  notes: z4.string().optional().describe("Anything else worth flagging \u2014 unusual patterns, data quality caveats, etc.")
});

// server/modules/analysis/analyse.ts
var client2 = new Anthropic2();
async function analyseStatements(input) {
  const body = buildUserMessage(input.statements, input.conversationProfile, input.flaggedIssues);
  const response = await client2.messages.parse({
    model: input.model,
    // Lowered from 16000 — observed outputs are ~3.5k tokens. The high
    // ceiling was costing latency without ever being needed.
    max_tokens: 6e3,
    system: [
      {
        type: "text",
        text: input.systemPrompt,
        cache_control: { type: "ephemeral" }
      }
    ],
    messages: [
      {
        role: "user",
        content: body
      }
    ],
    output_config: { format: zodOutputFormat2(analysisSchema) }
  });
  if (!response.parsed_output) {
    throw new Error("Analysis returned no parsed output");
  }
  const result = sanitizeAnalysisResult(response.parsed_output);
  return {
    result,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0
    }
  };
}
function sanitizeAnalysisResult(result) {
  const r = result;
  if (!r || typeof r !== "object") return result;
  const claims = r.explainClaims ?? [];
  const claimAnchors = new Set(claims.map((c) => c.anchorId));
  const annotationAnchors = /* @__PURE__ */ new Set();
  const filterAnns = (anns) => (anns ?? []).filter((a) => {
    if (claimAnchors.has(a.anchorId)) {
      annotationAnchors.add(a.anchorId);
      return true;
    }
    return false;
  });
  const sanitised = {
    ...r,
    lifeSnapshotAnnotations: filterAnns(r.lifeSnapshotAnnotations),
    income: r.income ? { ...r.income, summaryAnnotations: filterAnns(r.income.summaryAnnotations) } : r.income,
    spending: r.spending ? { ...r.spending, summaryAnnotations: filterAnns(r.spending.summaryAnnotations) } : r.spending,
    savings: r.savings ? { ...r.savings, summaryAnnotations: filterAnns(r.savings.summaryAnnotations) } : r.savings,
    // Drop claims that no annotation references — they'd be unreachable.
    explainClaims: claims.filter((c) => annotationAnchors.has(c.anchorId))
  };
  return sanitised;
}
function buildUserMessage(statements2, profile, flaggedIssues) {
  const header = `You are being given ${statements2.length} extracted bank statements covering a period of months. Analyse the whole set together, not one at a time.

`;
  const body = statements2.map((s, i) => `## Statement ${i + 1} \u2014 ${s.filename}
\`\`\`json
${JSON.stringify(s.extraction)}
\`\`\``).join("\n\n");
  const profileObj = profile ?? {};
  const hasProfile = profileObj && Object.keys(profileObj).some((k) => {
    const v = profileObj[k];
    if (typeof v === "string") return v.trim().length > 0;
    if (Array.isArray(v)) return v.length > 0;
    return v != null;
  });
  const flagsArr = Array.isArray(flaggedIssues) ? flaggedIssues : [];
  if (!hasProfile && flagsArr.length === 0) return header + body;
  const tail = ["", "## What the user has told us so far (incorporate this)"];
  if (hasProfile) {
    tail.push("```json", JSON.stringify(profileObj), "```");
  }
  if (flagsArr.length > 0) {
    tail.push("", "Flagged issues:", ...flagsArr.map((f) => `- ${f}`));
  }
  tail.push(
    "",
    "Treat these as authoritative corrections / context. They override any default reading of the raw transactions."
  );
  return header + body + "\n\n" + tail.join("\n");
}

// server/modules/analysis/refresh.ts
import { and as and4, eq as eq7, isNull } from "drizzle-orm";
async function refreshCanvas1Analysis(userId) {
  const sts = await db.select().from(statements).where(and4(eq7(statements.userId, userId), eq7(statements.status, "extracted")));
  if (sts.length === 0) throw new Error("no_statements");
  const prompt = await getActivePrompt("analysis");
  if (!prompt) throw new Error("no_active_analysis_prompt");
  const [conv] = await db.select().from(conversations).where(eq7(conversations.userId, userId)).limit(1);
  const [created] = await db.insert(analyses).values({
    userId,
    status: "analysing",
    promptVersionId: prompt.id,
    sourceStatementIds: sts.map((s) => s.id)
  }).returning();
  void (async () => {
    try {
      const { result, usage } = await analyseStatements({
        systemPrompt: prompt.content,
        model: prompt.model,
        statements: sts.map((s) => ({ filename: s.filename, extraction: s.extractionResult })),
        conversationProfile: conv?.profile ?? null,
        flaggedIssues: conv?.flaggedIssues ?? []
      });
      await db.update(analyses).set({
        status: "done",
        result,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheCreationTokens: usage.cacheCreationTokens,
        completedAt: /* @__PURE__ */ new Date()
      }).where(eq7(analyses.id, created.id));
      await persistAnalysisClaims(created.id, result);
      await db.update(subSteps).set({
        contentJson: { analysisId: created.id },
        updatedAt: /* @__PURE__ */ new Date()
      }).where(
        and4(
          eq7(subSteps.userId, userId),
          eq7(subSteps.canvasKey, "picture"),
          isNull(subSteps.supersededAt)
        )
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown_error";
      console.error("[refreshCanvas1Analysis] failed:", err);
      await db.update(analyses).set({ status: "failed", errorMessage: message, completedAt: /* @__PURE__ */ new Date() }).where(eq7(analyses.id, created.id));
    }
  })();
  return { analysisId: created.id, status: "analysing" };
}
async function persistAnalysisClaims(analysisId, result) {
  const r = result;
  const claims = r.explainClaims ?? [];
  if (claims.length === 0) return;
  const phraseByAnchor = /* @__PURE__ */ new Map();
  for (const a of r.lifeSnapshotAnnotations ?? []) phraseByAnchor.set(a.anchorId, a.phrase);
  for (const a of r.income?.summaryAnnotations ?? []) phraseByAnchor.set(a.anchorId, a.phrase);
  for (const a of r.spending?.summaryAnnotations ?? []) phraseByAnchor.set(a.anchorId, a.phrase);
  for (const a of r.savings?.summaryAnnotations ?? []) phraseByAnchor.set(a.anchorId, a.phrase);
  await db.insert(analysisClaims).values(
    claims.map((c) => ({
      analysisId,
      kind: "explain",
      anchorId: c.anchorId,
      label: phraseByAnchor.get(c.anchorId) ?? c.label,
      body: c.body,
      evidenceRefs: { refs: c.evidenceRefs, chartKind: c.chartKind }
    }))
  );
}

// server/routes/analysis.ts
var router5 = Router5();
router5.use(isAuthenticated);
router5.get("/api/analysis/latest", async (req, res) => {
  const user = req.user;
  const [row] = await db.select().from(analyses).where(and5(eq8(analyses.userId, user.id), eq8(analyses.status, "done"))).orderBy(desc5(analyses.createdAt)).limit(1);
  res.json(row ?? null);
});
router5.get("/api/analysis/:id/claims", async (req, res) => {
  const user = req.user;
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid_id" });
  const [row] = await db.select().from(analyses).where(and5(eq8(analyses.id, id), eq8(analyses.userId, user.id))).limit(1);
  if (!row) return res.status(404).json({ error: "not_found" });
  const claims = await db.select().from(analysisClaims).where(eq8(analysisClaims.analysisId, id));
  res.json(claims);
});
router5.post("/api/analysis/run", async (req, res) => {
  const user = req.user;
  const sts = await db.select().from(statements).where(and5(eq8(statements.userId, user.id), eq8(statements.status, "extracted")));
  if (sts.length === 0) {
    return res.status(400).json({ error: "no_statements" });
  }
  const prompt = await getActivePrompt("analysis");
  if (!prompt) {
    return res.status(500).json({ error: "no_active_analysis_prompt" });
  }
  const [created] = await db.insert(analyses).values({
    userId: user.id,
    status: "analysing",
    promptVersionId: prompt.id,
    sourceStatementIds: sts.map((s) => s.id)
  }).returning();
  audit({ req, action: "analysis.start", resourceType: "analysis", resourceId: String(created.id) });
  try {
    const { result, usage } = await analyseStatements({
      systemPrompt: prompt.content,
      model: prompt.model,
      statements: sts.map((s) => ({ filename: s.filename, extraction: s.extractionResult }))
    });
    const [finished] = await db.update(analyses).set({
      status: "done",
      result,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheCreationTokens: usage.cacheCreationTokens,
      completedAt: /* @__PURE__ */ new Date()
    }).where(eq8(analyses.id, created.id)).returning();
    await persistAnalysisClaims(created.id, result);
    audit({
      req,
      action: "analysis.success",
      resourceType: "analysis",
      resourceId: String(created.id),
      detail: { usage }
    });
    res.json(finished);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    await db.update(analyses).set({ status: "failed", errorMessage: message, completedAt: /* @__PURE__ */ new Date() }).where(eq8(analyses.id, created.id));
    audit({
      req,
      action: "analysis.failure",
      resourceType: "analysis",
      resourceId: String(created.id),
      outcome: "failure",
      detail: { message }
    });
    res.status(500).json({ error: "analysis_failed", message });
  }
});
router5.post("/api/analysis/refresh", async (req, res) => {
  const user = req.user;
  try {
    const result = await refreshCanvas1Analysis(user.id);
    audit({ req, action: "analysis.refresh_start", resourceType: "analysis", resourceId: String(result.analysisId) });
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    res.status(400).json({ error: "refresh_failed", message });
  }
});
var analysis_default = router5;

// server/routes/qa.ts
import { Router as Router6 } from "express";
import { z as z6 } from "zod";
import { and as and10, asc as asc2, desc as desc9, eq as eq14 } from "drizzle-orm";

// server/modules/qa/persistTurn.ts
import { and as and9, eq as eq13 } from "drizzle-orm";

// server/modules/qa/chat.ts
import Anthropic3 from "@anthropic-ai/sdk";
import { zodOutputFormat as zodOutputFormat3 } from "@anthropic-ai/sdk/helpers/zod";

// server/modules/qa/schema.ts
import { z as z5 } from "zod/v4";
var qaProfileSchema = z5.object({
  corrections: z5.array(z5.string()).describe("Things the user said were wrong in their story. Short statements, one per correction."),
  otherAccounts: z5.string().describe("Notes on accounts not visible in the uploaded statements (other banks, savings, investments, credit cards). Empty string if not yet discussed."),
  incomeContext: z5.string().describe("Notes on income stability, source concentration, side income. Empty string if not yet discussed."),
  debt: z5.string().describe("Notes on debts not visible in statements (store accounts, family loans, other bank credit cards). Empty string if not yet discussed."),
  medicalCover: z5.string().describe("Notes on medical aid / hospital cover status. Empty string if not yet discussed."),
  lifeCover: z5.string().describe("Notes on life cover and who depends on the user's income. Empty string if not yet discussed."),
  incomeProtection: z5.string().describe("Notes on income protection cover. Empty string if not yet discussed."),
  retirement: z5.string().describe("Notes on retirement savings \u2014 RA, employer fund, provident fund, etc. Empty string if not yet discussed."),
  tax: z5.string().describe("Notes on tax situation \u2014 PAYE, provisional, VAT, company salary. Empty string if not yet discussed."),
  property: z5.string().describe("Notes on property ownership, bonds, rental. Empty string if not yet discussed."),
  goals: z5.array(z5.string()).describe("What the user wants \u2014 VERBATIM in their own words. Do not reword into financial jargon."),
  lifeContext: z5.string().describe("Notes on dependents, partner, living situation, life stage. Empty string if not yet discussed."),
  will: z5.string().describe("Notes on will / estate planning. Empty string if not yet discussed.")
});
var qaProfileUpdateSchema = qaProfileSchema;
var qaTurnResultSchema = z5.object({
  reply: z5.string().describe(
    "What to say back to the user. Short \u2014 a few sentences, never a wall of text. No formatting (no bullets, bold, headers, lists). Conversational. One question at a time, never two."
  ),
  profileUpdates: qaProfileUpdateSchema.describe(
    "Your full current view of the profile. For topics you didn't address this turn, pass an empty string (or empty array for corrections/goals). The server merges: non-empty strings overwrite existing notes, arrays are appended and deduped."
  ),
  newFlaggedIssues: z5.array(z5.string()).describe(
    "NEW key issues to flag from what the user just said. One short sentence each. Do not repeat previously flagged issues. Empty array if nothing new to flag."
  ),
  status: z5.enum(["continuing", "minimum_viable", "complete"]).describe(
    "continuing = more to gather; minimum_viable = enough for a picture but could gather more; complete = nothing essential left to gather."
  ),
  triggerRefresh: z5.boolean().default(false).describe(
    "Set true when the user has just made a substantive correction to a fact that the rendered analysis depends on (e.g. 'that's not salary, it's self-funding from my business'; 'my real income is R30k, not R10k'; 'please update the picture based on what I just told you'). When true, the server kicks off a fresh analysis with the updated profile in context, and the rendered story re-renders. Set FALSE for soft acknowledgements, clarifying questions, and small chat updates that don't change the analysis."
  ),
  regenerateReason: z5.string().optional().describe(
    "When triggerRefresh=true, a one-sentence summary of what the user corrected \u2014 the next analysis pass uses this as a hint. e.g. 'User corrected income: actual salary is R30k/month from The Herbal Horse, fragmented across multiple deposits.'"
  )
});
function emptyProfile() {
  return {
    corrections: [],
    otherAccounts: "",
    incomeContext: "",
    debt: "",
    medicalCover: "",
    lifeCover: "",
    incomeProtection: "",
    retirement: "",
    tax: "",
    property: "",
    goals: [],
    lifeContext: "",
    will: ""
  };
}

// server/modules/qa/chat.ts
var client3 = new Anthropic3();
async function runQaTurn(input) {
  const { stable, dynamic } = buildContextBlocks(input);
  const response = await client3.messages.parse({
    model: input.model,
    // Ally's reply is supposed to be short ("a few sentences, never a wall of
    // text"). Capping at 800 helps the model commit faster instead of using
    // the full thinking budget — meaningful latency win.
    max_tokens: 800,
    system: [
      {
        type: "text",
        text: input.systemPrompt,
        cache_control: { type: "ephemeral" }
      }
    ],
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: stable, cache_control: { type: "ephemeral" } },
          { type: "text", text: dynamic }
        ]
      },
      ...input.history.map((m) => ({ role: m.role, content: m.content })),
      ...input.latestUser !== null ? [{ role: "user", content: input.latestUser }] : []
    ],
    output_config: { format: zodOutputFormat3(qaTurnResultSchema) }
  });
  if (!response.parsed_output) {
    throw new Error("QA turn returned no parsed output");
  }
  return {
    result: response.parsed_output,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0
    }
  };
}
function buildContextBlocks(input) {
  const stable = buildStableContext(input);
  const dynamic = buildDynamicContext(input);
  return { stable, dynamic };
}
function buildStableContext(input) {
  const who = input.user.firstName ? `You're speaking with ${input.user.firstName}.` : `You're speaking with a user whose first name you don't know \u2014 avoid using a name.`;
  const statementsBlock = input.statements.length === 0 ? "(no statements uploaded yet)" : input.statements.map((s) => formatStatementLine(s)).join("\n");
  const sections = [who, "", `## Current phase: ${input.phase}`];
  if (input.phase === "bring_it_in") {
    sections.push(
      "They are uploading statements. You do NOT have an analysis yet \u2014 don't pretend to. Your job here is to reassure, answer process questions (why statements, what format, what if they have fewer than 12, privacy), and encourage them to keep uploading. Do NOT drive through gaps yet \u2014 that's for the next phase."
    );
  } else if (input.phase === "analysing") {
    sections.push(
      `They've finished uploading and clicked "show me my picture". The analysis is running in the background right now and will finish shortly. You do NOT have the analysis yet. Do NOT ask for more statements \u2014 they're done with that. Do NOT drive through gaps \u2014 you don't have the story yet. If they ask what to do next, tell them the analysis is running (should take about a minute) and then you'll go through the story together. Stay light.`
    );
  } else {
    sections.push(
      "They've uploaded statements and the analysis has run. The story on the left is yours. Your job now is to drive through the gaps \u2014 corrections first, then what statements couldn't show, then safety nets, goals, life context."
    );
  }
  sections.push("", "## Statements so far", statementsBlock, "");
  if (input.statementDetails && input.statementDetails.length > 0) {
    sections.push(
      "## Full statement detail (every transaction)",
      "Use this to enumerate evidence when the user asks about specific transactions, dates, deposits, or contests a number. Quote actual amounts and dates rather than summarising.",
      ""
    );
    for (const d of input.statementDetails) {
      sections.push(`### ${d.filename}`, "```json", JSON.stringify(d.extraction), "```", "");
    }
  }
  if (input.analysis) {
    sections.push(
      "## Their financial story (from the Analysis phase)",
      "```json",
      JSON.stringify(input.analysis),
      "```",
      ""
    );
  }
  return sections.join("\n");
}
function buildDynamicContext(input) {
  const trimmedProfile = compactProfile(input.profile);
  const profileBlock = Object.keys(trimmedProfile).length === 0 ? "(nothing established yet)" : "```json\n" + JSON.stringify(trimmedProfile) + "\n```";
  const sections = [
    "## What you've already learned from them (running profile)",
    profileBlock,
    "",
    "## Issues you've already flagged (don't repeat these)",
    input.flaggedIssues.length === 0 ? "(none yet)" : input.flaggedIssues.map((f) => `- ${f}`).join("\n"),
    ""
  ];
  if (input.historyTruncated) {
    sections.push(
      "## Memory note",
      "Earlier turns of this conversation have been trimmed \u2014 you only see the recent messages below. Everything meaningful from earlier is captured in the running profile above. If the user references something older that isn't in the profile, it's fine to ask again.",
      ""
    );
  }
  const opening = input.latestUser === null ? input.phase === "first_take_gaps" ? "The conversation hasn't started yet. Greet them warmly, acknowledge the story they've just read, state privacy in one line, set the expectation that this takes about 10 minutes, and ask your first correction-check question." : input.phase === "analysing" ? "The conversation hasn't started yet. Greet them warmly and tell them the analysis is running \u2014 it'll be ready in a minute." : "The conversation hasn't started yet. Greet them warmly, explain in one or two sentences why you need their bank statements, and invite them to drop pdfs on the left. Privacy in one line. Ask if they have any questions before they start." : "The conversation history follows. Respond to their most recent message.";
  sections.push(opening);
  return sections.join("\n");
}
function compactProfile(p) {
  const out = {};
  for (const [k, v] of Object.entries(p)) {
    if (typeof v === "string" && v.trim().length > 0) out[k] = v;
    else if (Array.isArray(v) && v.length > 0) out[k] = v;
  }
  return out;
}
function formatStatementLine(s) {
  if (s.status === "extracted") {
    const bits = [s.filename];
    if (s.bankName) bits.push(s.bankName);
    if (s.periodStart && s.periodEnd) bits.push(`${s.periodStart} \u2192 ${s.periodEnd}`);
    if (s.transactionCount != null) bits.push(`${s.transactionCount} transactions`);
    return `- ${bits.join(" \xB7 ")}`;
  }
  return `- ${s.filename} (${s.status})`;
}

// server/modules/qa/mergeProfile.ts
function mergeProfile(existing, updates) {
  if (!updates) return existing;
  return {
    corrections: concatDedup(existing.corrections, updates.corrections),
    otherAccounts: preferUpdate(existing.otherAccounts, updates.otherAccounts),
    incomeContext: preferUpdate(existing.incomeContext, updates.incomeContext),
    debt: preferUpdate(existing.debt, updates.debt),
    medicalCover: preferUpdate(existing.medicalCover, updates.medicalCover),
    lifeCover: preferUpdate(existing.lifeCover, updates.lifeCover),
    incomeProtection: preferUpdate(existing.incomeProtection, updates.incomeProtection),
    retirement: preferUpdate(existing.retirement, updates.retirement),
    tax: preferUpdate(existing.tax, updates.tax),
    property: preferUpdate(existing.property, updates.property),
    goals: concatDedup(existing.goals, updates.goals),
    lifeContext: preferUpdate(existing.lifeContext, updates.lifeContext),
    will: preferUpdate(existing.will, updates.will)
  };
}
function mergeFlaggedIssues(existing, incoming) {
  if (!incoming || incoming.length === 0) return existing;
  return concatDedup(existing, incoming);
}
function preferUpdate(existing, update) {
  if (typeof update !== "string") return existing;
  return update.trim().length > 0 ? update : existing;
}
function concatDedup(existing, incoming) {
  if (!incoming || incoming.length === 0) return existing;
  const seen = new Set(existing);
  const out = [...existing];
  for (const s of incoming) {
    if (!seen.has(s)) {
      out.push(s);
      seen.add(s);
    }
  }
  return out;
}

// server/modules/stateChange/handlers.ts
import { eq as eq12 } from "drizzle-orm";

// server/modules/record/index.ts
import { and as and6, asc, desc as desc6, eq as eq9, isNull as isNull2, or } from "drizzle-orm";
async function ensureRecord(userId) {
  const [existing] = await db.select().from(record).where(eq9(record.userId, userId)).limit(1);
  if (existing) {
    const attrs = existing.attributes ?? {};
    if (!attrs.migratedFromLegacy) {
      await lazyBackfillFromLegacy(userId, existing.id);
      await db.update(record).set({
        attributes: { ...attrs, migratedFromLegacy: true },
        updatedAt: /* @__PURE__ */ new Date()
      }).where(eq9(record.id, existing.id));
    }
    return existing;
  }
  const [created] = await db.insert(record).values({ userId }).returning();
  await lazyBackfillFromLegacy(userId, created.id);
  await db.update(record).set({
    attributes: { migratedFromLegacy: true },
    updatedAt: /* @__PURE__ */ new Date()
  }).where(eq9(record.id, created.id));
  return created;
}
async function lazyBackfillFromLegacy(userId, recordId) {
  const [conv] = await db.select().from(conversations).where(eq9(conversations.userId, userId)).limit(1);
  if (conv) {
    const profile = conv.profile ?? {};
    for (const [key, value] of Object.entries(profile)) {
      if (!value || typeof value === "string" && value.trim() === "") continue;
      await db.insert(recordNotes).values({
        recordId,
        userId,
        category: key,
        kind: "fact",
        label: humanise(key),
        body: typeof value === "string" ? value : JSON.stringify(value),
        sourceKind: "ally_generated",
        sourceCanvas: "picture",
        attributes: { migratedFrom: "conversations.profile" }
      });
    }
    const flags = conv.flaggedIssues ?? [];
    for (const flag of flags) {
      const text2 = typeof flag === "string" ? flag : JSON.stringify(flag);
      await db.insert(recordNotes).values({
        recordId,
        userId,
        kind: "flag",
        label: text2.slice(0, 80),
        body: text2,
        sourceKind: "ally_generated",
        sourceCanvas: "picture",
        attributes: { migratedFrom: "conversations.flaggedIssues" }
      });
    }
  }
  const [draft] = await db.select().from(analysisDrafts).where(and6(eq9(analysisDrafts.userId, userId), isNull2(analysisDrafts.supersededAt))).orderBy(desc6(analysisDrafts.createdAt)).limit(1);
  if (draft) {
    const claims = await db.select().from(analysisClaims).where(eq9(analysisClaims.draftId, draft.id));
    for (const c of claims) {
      await db.insert(recordNotes).values({
        recordId,
        userId,
        category: c.category ?? null,
        kind: c.kind === "note" ? "fact" : "observation",
        label: c.label,
        body: c.body,
        evidenceRefs: c.evidenceRefs,
        sourceKind: "ally_generated",
        sourceCanvas: "analysis",
        attributes: { migratedFrom: "analysis_claims", anchorId: c.anchorId }
      });
    }
  }
}
async function writeNote(input) {
  const root = await ensureRecord(input.userId);
  const [note] = await db.insert(recordNotes).values({
    recordId: root.id,
    userId: input.userId,
    category: input.category ?? null,
    tags: input.tags,
    kind: input.kind,
    label: input.label,
    body: input.body ?? null,
    evidenceRefs: input.evidenceRefs,
    attributes: input.attributes,
    confidence: input.confidence != null ? String(input.confidence) : null,
    sourceKind: input.sourceKind ?? "ally_generated",
    sourceCanvas: input.sourceCanvas ?? null,
    sourceSubStepId: input.sourceSubStepId ?? null,
    sourceMessageId: input.sourceMessageId ?? null
  }).returning();
  if (input.segmentIds && input.segmentIds.length > 0) {
    await db.insert(recordNoteSegments).values(
      input.segmentIds.map((segmentId) => ({ noteId: note.id, segmentId }))
    );
  }
  return note;
}
async function supersedeNote(userId, oldNoteId, replacement) {
  const replacementNote = await writeNote(replacement);
  await db.update(recordNotes).set({
    status: "superseded",
    supersededAt: /* @__PURE__ */ new Date(),
    supersededBy: replacementNote.id,
    updatedAt: /* @__PURE__ */ new Date()
  }).where(and6(eq9(recordNotes.id, oldNoteId), eq9(recordNotes.userId, userId)));
  return replacementNote;
}
async function softDeleteNote(userId, noteId) {
  await db.update(recordNotes).set({ status: "deletion_pending", updatedAt: /* @__PURE__ */ new Date() }).where(and6(eq9(recordNotes.id, noteId), eq9(recordNotes.userId, userId)));
}
async function listNotes(filter) {
  await ensureRecord(filter.userId);
  const statusClause = filter.includeDeletionPending ? or(eq9(recordNotes.status, "active"), eq9(recordNotes.status, "declined")) : eq9(recordNotes.status, "active");
  if (filter.segmentId != null) {
    const rows = await db.select({ note: recordNotes }).from(recordNoteSegments).innerJoin(recordNotes, eq9(recordNotes.id, recordNoteSegments.noteId)).where(
      and6(
        eq9(recordNoteSegments.segmentId, filter.segmentId),
        eq9(recordNotes.userId, filter.userId),
        statusClause,
        filter.category ? eq9(recordNotes.category, filter.category) : void 0,
        filter.kind ? eq9(recordNotes.kind, filter.kind) : void 0
      )
    ).orderBy(desc6(recordNotes.establishedAt)).limit(filter.limit ?? 200);
    return rows.map((r) => r.note);
  }
  return db.select().from(recordNotes).where(
    and6(
      eq9(recordNotes.userId, filter.userId),
      statusClause,
      filter.category ? eq9(recordNotes.category, filter.category) : void 0,
      filter.kind ? eq9(recordNotes.kind, filter.kind) : void 0
    )
  ).orderBy(desc6(recordNotes.establishedAt)).limit(filter.limit ?? 200);
}
async function listSegments(userId) {
  await ensureRecord(userId);
  return db.select().from(recordSegments).where(eq9(recordSegments.userId, userId)).orderBy(asc(recordSegments.startedAt));
}
async function triggerMetaSynthesis(userId, trigger, context) {
  await ensureRecord(userId);
  await db.insert(recordSynthesisJobs).values({
    userId,
    triggerKind: trigger,
    contextJson: context,
    status: "pending"
  });
}
function humanise(key) {
  const spaced = key.replace(/[_-]/g, " ").trim();
  if (!spaced) return key;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// server/modules/checklist/derive.ts
import { and as and7, desc as desc7, eq as eq10 } from "drizzle-orm";
var PICTURE_FIELDS = [
  { key: "retirement", label: "Retirement", importance: "core" },
  { key: "debt", label: "Debt", importance: "core" },
  { key: "lifeCover", label: "Life cover", importance: "core" },
  { key: "medicalCover", label: "Medical cover", importance: "core" },
  { key: "incomeProtection", label: "Income protection", importance: "core" },
  { key: "incomeContext", label: "Income", importance: "core" },
  { key: "otherAccounts", label: "Other accounts", importance: "core" },
  { key: "tax", label: "Tax", importance: "nice" },
  { key: "property", label: "Property", importance: "nice" },
  { key: "lifeContext", label: "Life context (dependants, partner)", importance: "nice" },
  { key: "will", label: "Will / estate", importance: "nice" },
  { key: "goals", label: "Goals", importance: "core" }
];
async function deriveChecklist(userId, subStep) {
  if (subStep.beat !== "discuss") {
    return { canvas: subStep.canvasKey, beat: subStep.beat, items: [], agreementReady: true };
  }
  if (subStep.canvasKey === "picture") {
    return derivePictureChecklist(userId, subStep);
  }
  if (subStep.canvasKey === "analysis") {
    return deriveAnalysisChecklist(userId, subStep);
  }
  return { canvas: subStep.canvasKey, beat: subStep.beat, items: [], agreementReady: true };
}
async function derivePictureChecklist(userId, subStep) {
  const [conv] = await db.select().from(conversations).where(eq10(conversations.userId, userId)).limit(1);
  const profile = conv?.profile ?? emptyProfile();
  const skipped = await db.select().from(recordNotes).where(and7(eq10(recordNotes.userId, userId), eq10(recordNotes.kind, "skipped_gap")));
  const skippedByCategory = /* @__PURE__ */ new Map();
  for (const n of skipped) {
    if (n.category) skippedByCategory.set(n.category, n.body);
  }
  const items = PICTURE_FIELDS.map(({ key, label, importance }) => {
    if (skippedByCategory.has(key)) {
      return {
        key,
        label,
        status: "skipped",
        reason: skippedByCategory.get(key),
        importance
      };
    }
    const value = profile[key];
    const covered = Array.isArray(value) ? value.length > 0 : typeof value === "string" && value.trim().length > 0;
    if (covered) {
      const evidence = Array.isArray(value) ? value.join("; ") : value;
      return {
        key,
        label,
        status: "covered",
        evidence: evidence.length > 120 ? evidence.slice(0, 117) + "..." : evidence,
        importance
      };
    }
    return { key, label, status: "pending", importance };
  });
  const agreementReady = items.filter((i) => i.importance === "core").every((i) => i.status !== "pending");
  return { canvas: "picture", beat: "discuss", items, agreementReady };
}
async function deriveAnalysisChecklist(userId, subStep) {
  const content = subStep.contentJson ?? {};
  if (!content.draftId) {
    return { canvas: "analysis", beat: "discuss", items: [], agreementReady: false };
  }
  const [draft] = await db.select().from(analysisDrafts).where(eq10(analysisDrafts.id, content.draftId)).limit(1);
  if (!draft) {
    return { canvas: "analysis", beat: "discuss", items: [], agreementReady: false };
  }
  const prose = draft.prose ?? {};
  const sections = prose.sections ?? [];
  const [conv] = await db.select().from(analysisConversations).where(eq10(analysisConversations.draftId, draft.id)).orderBy(desc7(analysisConversations.startedAt)).limit(1);
  const userTurnCount = conv ? (await db.select().from(analysisConversationMessages).where(
    and7(
      eq10(analysisConversationMessages.analysisConversationId, conv.id),
      eq10(analysisConversationMessages.role, "user")
    )
  )).length : 0;
  const skipped = await db.select().from(recordNotes).where(and7(eq10(recordNotes.userId, userId), eq10(recordNotes.kind, "skipped_gap")));
  const skippedByCategory = /* @__PURE__ */ new Map();
  for (const n of skipped) {
    if (n.category) skippedByCategory.set(n.category, n.body);
  }
  const hasEngagement = userTurnCount > 0;
  const items = sections.map((s) => {
    const key = `section_${s.id}`;
    if (skippedByCategory.has(key)) {
      return { key, label: s.heading ?? s.id, status: "skipped", reason: skippedByCategory.get(key), importance: "core" };
    }
    return {
      key,
      label: s.heading ?? humaniseSectionId(s.id),
      status: hasEngagement ? "covered" : "pending",
      importance: "core"
    };
  });
  const agreementReady = items.length === 0 ? true : items.every((i) => i.status !== "pending");
  return { canvas: "analysis", beat: "discuss", items, agreementReady };
}
function humaniseSectionId(s) {
  return s.replace(/[_-]/g, " ").replace(/^./, (c) => c.toUpperCase());
}

// server/modules/stateChange/messages.ts
import { desc as desc8, eq as eq11 } from "drizzle-orm";
var OPENERS = {
  picture_live: "Done. That's your picture, agreed. I'll be here if anything changes \u2014 just shout.",
  analysis_live: "Agreed. That's your analysis on the record. I'm here if you want to come back to it.",
  picture_discuss_redo: "Okay \u2014 pulling this back open. What's changed?",
  analysis_discuss_redo: "Pulling this back open. Tell me what we need to look at again."
};
var REOPENERS = {
  picture_discuss: "Welcome back. We were in the middle of going through your picture \u2014 want to keep going from where we left off, or is there something else on your mind?",
  analysis_discuss: "Welcome back. We were going through your analysis together \u2014 want to pick up where we left off?"
};
var TOPIC_STARTERS = {
  retirement: "Let's talk about retirement. Have you got anything in place \u2014 an RA, a pension at work, anything you're putting away for later?",
  debt: "Let's talk about debt. Anything I should know about? Loans, credit cards, store accounts, money owed to family \u2014 whatever's on the books.",
  lifeCover: "Let's talk about life cover. The honest question is: if you weren't here tomorrow, would the people who depend on you be okay? What's in place?",
  medicalCover: "Let's talk about medical aid. Have you got hospital cover or full medical aid sorted? Or is that one of the things on the to-do list?",
  incomeProtection: "Let's talk about income protection. If you couldn't work for a few months \u2014 illness, injury \u2014 what would happen to the money coming in?",
  incomeContext: "Let's talk about income. The statements show what's coming in, but I want the texture \u2014 is it steady, lumpy, do you depend on one source or several?",
  otherAccounts: "Let's talk about your other accounts. Anything I'm not seeing in the statements \u2014 savings, investments, business accounts, crypto, anything held offshore?",
  tax: "Let's talk about tax. Are you on PAYE, provisional, both? Anything that needs sorting out for SARS at the moment?",
  property: "Let's talk about property. Do you own where you live, rent, have a bond, rental properties? Whatever's relevant.",
  lifeContext: "Let's talk about who's in your life. Partner, dependants, anyone who counts on what you bring in \u2014 paint me the picture.",
  will: "Let's talk about wills and estate. Have you got a will in place? Up to date? It's the question nobody likes asking but it matters.",
  goals: "Let's talk about what you actually want. Big or small, near or far \u2014 what would make next year, or the next ten years, feel like a win?"
};
async function postAllyMessage(input) {
  if (input.canvas === "picture") {
    const [conv] = await db.select().from(conversations).where(eq11(conversations.userId, input.userId)).limit(1);
    if (!conv) return null;
    const [msg] = await db.insert(conversationMessages).values({
      conversationId: conv.id,
      role: "assistant",
      content: input.content,
      isTransition: input.isTransition ?? true
    }).returning();
    return msg.id;
  }
  if (input.canvas === "analysis") {
    const [conv] = await db.select().from(analysisConversations).where(eq11(analysisConversations.userId, input.userId)).orderBy(desc8(analysisConversations.startedAt)).limit(1);
    if (!conv) return null;
    const [msg] = await db.insert(analysisConversationMessages).values({
      analysisConversationId: conv.id,
      role: "assistant",
      content: input.content,
      isTransition: input.isTransition ?? true
    }).returning();
    return msg.id;
  }
  return null;
}
var STALE_AFTER_MS = 4 * 60 * 60 * 1e3;
function isStale(latest) {
  if (!latest) return false;
  return Date.now() - new Date(latest).getTime() > STALE_AFTER_MS;
}

// server/modules/stateChange/handlers.ts
async function writeNotesFromTurn(ctx) {
  const p = ctx.payload;
  if (!p || typeof p !== "object") return;
  if (p.canvas === "picture") {
    for (const [field, change] of Object.entries(p.deltas ?? {})) {
      if (change.after == null || change.after === "") continue;
      const body = typeof change.after === "string" ? change.after : JSON.stringify(change.after);
      const arrayMatch = field.match(/^(goals|corrections)_\d+$/);
      const category = arrayMatch ? arrayMatch[1] : field;
      const label = body.length > 80 ? body.slice(0, 77) + "..." : body;
      await writeNote({
        userId: ctx.userId,
        kind: change.kind,
        category,
        label,
        body,
        sourceKind: "ally_generated",
        sourceCanvas: "picture",
        sourceSubStepId: p.sourceSubStepId ?? ctx.subStepId ?? null,
        sourceMessageId: p.sourceMessageId ?? null,
        attributes: {
          previousValue: change.before ?? null,
          legacyConversationMessageId: p.legacyConversationMessageId ?? null
        }
      });
    }
    for (const flag of p.newFlaggedIssues ?? []) {
      if (!flag) continue;
      await writeNote({
        userId: ctx.userId,
        kind: "flag",
        label: flag.length > 80 ? flag.slice(0, 77) + "..." : flag,
        body: flag,
        sourceKind: "ally_generated",
        sourceCanvas: "picture",
        sourceSubStepId: p.sourceSubStepId ?? ctx.subStepId ?? null,
        sourceMessageId: p.sourceMessageId ?? null,
        attributes: {
          legacyConversationMessageId: p.legacyConversationMessageId ?? null
        }
      });
    }
    return;
  }
  if (p.canvas === "analysis") {
    for (const n of p.noteUpdates ?? []) {
      if (!n.label || !n.body) continue;
      await writeNote({
        userId: ctx.userId,
        kind: "fact",
        category: n.category,
        label: n.label,
        body: n.body,
        evidenceRefs: n.evidenceRefs,
        sourceKind: "ally_generated",
        sourceCanvas: "analysis",
        sourceSubStepId: p.sourceSubStepId ?? ctx.subStepId ?? null,
        sourceMessageId: p.sourceMessageId ?? null,
        attributes: {
          legacyConversationMessageId: p.legacyConversationMessageId ?? null
        }
      });
    }
  }
}
async function writeAnalyseSynthesisNote(ctx) {
  const p = ctx.payload ?? {};
  const canvas = p.canvas ?? ctx.canvas ?? "picture";
  const label = canvas === "picture" ? "First-take story written" : "Analysis written";
  const body = p.summary ?? (p.claimsCount != null ? `${p.claimsCount} insights captured.` : "Synthesis pass completed.");
  await writeNote({
    userId: ctx.userId,
    kind: "observation",
    category: "summary",
    label,
    body,
    sourceKind: "ally_generated",
    sourceCanvas: canvas,
    sourceSubStepId: ctx.subStepId ?? null,
    attributes: {
      analysisId: p.analysisId ?? null,
      draftId: p.draftId ?? null
    }
  });
}
async function writeAgreementDecision(ctx) {
  const p = ctx.payload ?? {};
  const canvas = p.canvas ?? ctx.canvas ?? "picture";
  const label = canvas === "picture" ? "Agreed: this is my picture" : "Agreed: this analysis is right";
  await writeNote({
    userId: ctx.userId,
    kind: "decision",
    category: "decision",
    label,
    body: p.summary ?? null,
    sourceKind: "user_stated",
    sourceCanvas: canvas,
    sourceSubStepId: ctx.subStepId ?? null,
    attributes: {
      analysisId: p.analysisId ?? null,
      draftId: p.draftId ?? null
    }
  });
}
async function triggerSynthesisAfterAgree(ctx) {
  await triggerMetaSynthesis(ctx.userId, "discuss_agreed", {
    subStepId: ctx.subStepId ?? null,
    canvas: ctx.canvas ?? null
  });
}
async function writeReopenDecision(ctx) {
  const p = ctx.payload ?? {};
  const canvas = p.canvas ?? ctx.canvas ?? "picture";
  const label = canvas === "picture" ? "Reopened: picture pulled back into discussion" : "Reopened: analysis pulled back into discussion";
  await writeNote({
    userId: ctx.userId,
    kind: "decision",
    category: "decision",
    label,
    body: p.reason ?? null,
    sourceKind: "user_stated",
    sourceCanvas: canvas,
    sourceSubStepId: ctx.subStepId ?? null
  });
}
async function writeAdvanceMarker(ctx) {
  const p = ctx.payload ?? {};
  const canvas = p.canvas ?? ctx.canvas ?? "picture";
  if (canvas !== "picture") return;
  await writeNote({
    userId: ctx.userId,
    kind: "decision",
    category: "decision",
    label: "Said that's all my docs",
    body: p.statementCount != null ? `Closed Gather with ${p.statementCount} statement${p.statementCount === 1 ? "" : "s"}.` : null,
    sourceKind: "user_stated",
    sourceCanvas: "picture",
    sourceSubStepId: ctx.subStepId ?? null
  });
}
async function postAgreedOpener(ctx) {
  const canvas = ctx.canvas ?? "picture";
  const recap = await buildAgreementRecap(ctx);
  const opener = OPENERS[`${canvas}_live`];
  const content = recap ? `${recap}

${opener ?? ""}`.trim() : opener;
  if (!content) return;
  await postAllyMessage({ userId: ctx.userId, canvas, content });
}
async function buildAgreementRecap(ctx) {
  if (!ctx.subStepId) return null;
  try {
    const [sub] = await db.select().from(subSteps).where(eq12(subSteps.id, ctx.subStepId)).limit(1);
    if (!sub) return null;
    const checklist = await deriveChecklist(ctx.userId, sub);
    const covered = checklist.items.filter((i) => i.status === "covered");
    const skipped = checklist.items.filter((i) => i.status === "skipped");
    if (covered.length === 0 && skipped.length === 0) return null;
    const parts = [];
    if (covered.length > 0) {
      const list = covered.map((i) => i.label.toLowerCase()).join(", ");
      parts.push(`We covered ${list}.`);
    }
    if (skipped.length > 0) {
      const list = skipped.map((i) => `${i.label.toLowerCase()}${i.reason ? ` (${i.reason})` : ""}`).join("; ");
      parts.push(`You parked ${list} for now \u2014 they're noted as skipped, not gone.`);
    }
    return parts.join(" ");
  } catch (err) {
    console.warn("[buildAgreementRecap] fell back to deterministic opener:", err);
    return null;
  }
}
async function postReopenOpener(ctx) {
  const canvas = ctx.canvas ?? "picture";
  const content = OPENERS[`${canvas}_discuss_redo`];
  if (!content) return;
  await postAllyMessage({ userId: ctx.userId, canvas, content });
}
async function postSessionReopener(ctx) {
  const canvas = ctx.canvas ?? "picture";
  const beat = ctx.payload?.beat ?? "discuss";
  if (beat !== "discuss") return;
  const content = REOPENERS[`${canvas}_${beat}`];
  if (!content) return;
  await postAllyMessage({ userId: ctx.userId, canvas, content });
}
async function postTopicStarter(ctx) {
  const p = ctx.payload ?? {};
  const canvas = p.canvas ?? ctx.canvas ?? "picture";
  const template = TOPIC_STARTERS[p.itemKey];
  const content = template ?? `Let's talk about ${p.itemLabel ?? p.itemKey}. Tell me what's there \u2014 or what isn't.`;
  await postAllyMessage({ userId: ctx.userId, canvas, content });
}

// server/modules/stateChange/index.ts
var REGISTRY = {
  chat_turn_taken: [writeNotesFromTurn],
  analyse_completed: [writeAnalyseSynthesisNote],
  discuss_agreed: [
    writeAgreementDecision,
    triggerSynthesisAfterAgree,
    postAgreedOpener
  ],
  live_reopened: [writeReopenDecision, postReopenOpener],
  gather_advanced: [writeAdvanceMarker],
  session_resumed: [postSessionReopener],
  topic_initiated: [postTopicStarter]
};
async function onStateChange(ctx) {
  const list = REGISTRY[ctx.trigger];
  if (!list || list.length === 0) {
    console.warn(`[stateChange] no handlers for trigger: ${ctx.trigger}`);
    return;
  }
  await Promise.all(
    list.map(async (h) => {
      try {
        await h(ctx);
      } catch (err) {
        const message = err instanceof Error ? err.message : "unknown_error";
        console.error(
          `[stateChange] ${ctx.trigger} handler failed:`,
          h.name || "anonymous",
          message
        );
      }
    })
  );
}

// server/modules/qa/persistTurn.ts
async function runAndPersistTurn(input) {
  const { result, usage } = await runQaTurn({
    systemPrompt: input.prompt.content,
    model: input.prompt.model,
    user: input.user,
    phase: input.phase,
    analysis: input.analysis,
    statements: input.statements,
    statementDetails: input.statementDetails,
    profile: input.profile,
    flaggedIssues: input.flaggedIssues,
    history: input.history,
    historyTruncated: input.historyTruncated,
    latestUser: input.latestUser
  });
  const [assistantMessage] = await db.insert(conversationMessages).values({
    conversationId: input.conversationId,
    role: "assistant",
    content: result.reply,
    profileUpdates: result.profileUpdates,
    status: result.status,
    isTransition: input.isTransition ?? false,
    promptVersionId: input.prompt.id,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheCreationTokens: usage.cacheCreationTokens
  }).returning();
  const mergedProfile = mergeProfile(input.profile, result.profileUpdates);
  const mergedFlags = mergeFlaggedIssues(input.flaggedIssues, result.newFlaggedIssues);
  const newStatus = result.status === "complete" ? "complete" : "active";
  const [conversation] = await db.update(conversations).set({
    profile: mergedProfile,
    flaggedIssues: mergedFlags,
    status: newStatus,
    updatedAt: /* @__PURE__ */ new Date(),
    completedAt: newStatus === "complete" ? /* @__PURE__ */ new Date() : null
  }).where(and9(eq13(conversations.id, input.conversationId), eq13(conversations.userId, input.userId))).returning();
  const deltas = diffProfile(input.profile, mergedProfile);
  const newFlags = mergedFlags.filter((f) => !input.flaggedIssues.includes(f));
  if (Object.keys(deltas).length > 0 || newFlags.length > 0) {
    onStateChange({
      userId: input.userId,
      trigger: "chat_turn_taken",
      canvas: "picture",
      payload: {
        canvas: "picture",
        deltas,
        newFlaggedIssues: newFlags,
        // record_notes.source_message_id has an FK to sub_step_messages, but
        // qa chat still writes to the legacy conversation_messages table.
        // Pass null on the FK and stash the legacy id in attributes for
        // traceability until the chat moves to sub_step_messages.
        sourceMessageId: null,
        legacyConversationMessageId: assistantMessage.id,
        sourceSubStepId: null
      }
    }).catch(() => {
    });
  }
  if (result.triggerRefresh) {
    refreshCanvas1Analysis(input.userId).catch((err) => {
      console.warn("[runAndPersistTurn] auto-refresh failed:", err);
    });
  }
  return { conversation, assistantMessage };
}
function diffProfile(prior, merged) {
  const out = {};
  const stringFields = [
    "otherAccounts",
    "incomeContext",
    "debt",
    "medicalCover",
    "lifeCover",
    "incomeProtection",
    "retirement",
    "tax",
    "property",
    "lifeContext",
    "will"
  ];
  for (const f of stringFields) {
    const before = prior[f];
    const after = merged[f];
    if (typeof after === "string" && after.trim().length > 0 && after !== before) {
      out[f] = { before: before ?? null, after, kind: "fact" };
    }
  }
  const newCorrections = merged.corrections.filter((c) => !prior.corrections.includes(c));
  newCorrections.forEach((c, i) => {
    out[`corrections_${i}`] = { before: null, after: c, kind: "concern" };
  });
  const newGoals = merged.goals.filter((g) => !prior.goals.includes(g));
  newGoals.forEach((g, i) => {
    out[`goals_${i}`] = { before: null, after: g, kind: "intention" };
  });
  return out;
}

// server/routes/qa.ts
function derivePhase(buildCompletedAt, analysisResult) {
  if (!buildCompletedAt) return "bring_it_in";
  if (!analysisResult) return "analysing";
  return "first_take_gaps";
}
function summariseStatements(rows) {
  return rows.map((s) => {
    const r = s.extractionResult ?? null;
    return {
      filename: s.filename,
      status: s.status,
      bankName: r?.bankName ?? null,
      periodStart: r?.statementPeriodStart ?? null,
      periodEnd: r?.statementPeriodEnd ?? null,
      transactionCount: Array.isArray(r?.transactions) ? r.transactions.length : null
    };
  });
}
function detailsFor(rows) {
  return rows.filter((s) => s.status === "extracted" && s.extractionResult != null).map((s) => ({ filename: s.filename, extraction: s.extractionResult }));
}
var router6 = Router6();
router6.use(isAuthenticated);
var messageBodySchema = z6.object({
  content: z6.string().min(1).max(5e3)
});
var MAX_HISTORY_MESSAGES = 6;
router6.get("/api/qa/conversation", async (req, res) => {
  const user = req.user;
  const [conversation] = await db.select().from(conversations).where(eq14(conversations.userId, user.id)).limit(1);
  if (!conversation) {
    return res.json({ conversation: null, messages: [] });
  }
  const [latestAnalysis] = await db.select().from(analyses).where(and10(eq14(analyses.userId, user.id), eq14(analyses.status, "done"))).orderBy(desc9(analyses.createdAt)).limit(1);
  const currentPhase = derivePhase(user.buildCompletedAt, latestAnalysis?.result);
  const needsTransitionOpener = currentPhase === "first_take_gaps" && latestAnalysis?.id !== void 0 && latestAnalysis.id !== conversation.analysisIdAtStart;
  if (needsTransitionOpener && latestAnalysis?.result) {
    const prompt = await getActivePrompt("qa");
    if (prompt) {
      const userStatements = await db.select().from(statements).where(eq14(statements.userId, user.id));
      const runningProfile = conversation.profile ?? emptyProfile();
      const runningFlags = conversation.flaggedIssues ?? [];
      try {
        await runAndPersistTurn({
          conversationId: conversation.id,
          userId: user.id,
          prompt,
          user: { firstName: user.firstName, email: user.email },
          phase: currentPhase,
          analysis: latestAnalysis.result,
          statements: summariseStatements(userStatements),
          statementDetails: detailsFor(userStatements),
          profile: runningProfile,
          flaggedIssues: runningFlags,
          history: [],
          historyTruncated: false,
          latestUser: null,
          isTransition: true
        });
        await db.update(conversations).set({ analysisIdAtStart: latestAnalysis.id, updatedAt: /* @__PURE__ */ new Date() }).where(eq14(conversations.id, conversation.id));
        audit({
          req,
          action: "qa.phase_transition_opener",
          resourceType: "conversation",
          resourceId: String(conversation.id),
          detail: { phase: currentPhase, analysisId: latestAnalysis.id }
        });
      } catch (err) {
        console.error("[qa.conversation] transition opener failed:", err);
      }
    }
  }
  const [latestMsg] = await db.select({ createdAt: conversationMessages.createdAt }).from(conversationMessages).where(eq14(conversationMessages.conversationId, conversation.id)).orderBy(desc9(conversationMessages.createdAt)).limit(1);
  if (conversation.status === "active" && isStale(latestMsg?.createdAt ?? null)) {
    await onStateChange({
      userId: user.id,
      trigger: "session_resumed",
      canvas: "picture",
      payload: { canvas: "picture", beat: "discuss" }
    });
  }
  const [refreshed] = await db.select().from(conversations).where(eq14(conversations.id, conversation.id)).limit(1);
  const messages = await loadMessages(conversation.id);
  res.json({ conversation: refreshed ?? conversation, messages });
});
router6.post("/api/qa/start", async (req, res) => {
  const user = req.user;
  const [existing] = await db.select().from(conversations).where(eq14(conversations.userId, user.id)).limit(1);
  if (existing) {
    const existingMessages = await loadMessages(existing.id);
    if (existingMessages.length > 0) {
      return res.json({ conversation: existing, messages: existingMessages });
    }
  }
  const [latestAnalysis] = await db.select().from(analyses).where(and10(eq14(analyses.userId, user.id), eq14(analyses.status, "done"))).orderBy(desc9(analyses.createdAt)).limit(1);
  const userStatements = await db.select().from(statements).where(eq14(statements.userId, user.id));
  const phase = derivePhase(user.buildCompletedAt, latestAnalysis?.result);
  const promptKey = phase === "first_take_gaps" ? "qa" : "qa_bring_it_in";
  const prompt = await getActivePrompt(promptKey);
  if (!prompt) {
    return res.status(500).json({ error: "no_active_qa_prompt", detail: { promptKey } });
  }
  const profile = emptyProfile();
  const created = existing ? existing : (await db.insert(conversations).values({
    userId: user.id,
    status: "active",
    profile,
    flaggedIssues: [],
    analysisIdAtStart: latestAnalysis?.id ?? null
  }).returning())[0];
  audit({
    req,
    action: existing ? "qa.conversation_restart_opener" : "qa.conversation_start",
    resourceType: "conversation",
    resourceId: String(created.id),
    detail: { analysisId: latestAnalysis?.id ?? null }
  });
  try {
    const { conversation, assistantMessage } = await runAndPersistTurn({
      conversationId: created.id,
      userId: user.id,
      prompt,
      user: { firstName: user.firstName, email: user.email },
      phase,
      analysis: latestAnalysis?.result ?? null,
      statements: summariseStatements(userStatements),
      statementDetails: detailsFor(userStatements),
      profile,
      flaggedIssues: [],
      history: [],
      historyTruncated: false,
      latestUser: null,
      isTransition: true
    });
    res.json({ conversation, messages: [assistantMessage] });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    console.error("[qa.start] Claude call failed:", err);
    audit({
      req,
      action: "qa.conversation_start_failed",
      resourceType: "conversation",
      resourceId: String(created.id),
      outcome: "failure",
      detail: { message }
    });
    res.status(500).json({ error: "qa_start_failed", message });
  }
});
router6.post("/api/qa/message", async (req, res) => {
  const user = req.user;
  const parsed = messageBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_input", detail: parsed.error.flatten() });
  }
  const [conversation] = await db.select().from(conversations).where(eq14(conversations.userId, user.id)).limit(1);
  if (!conversation) {
    return res.status(404).json({ error: "no_conversation" });
  }
  if (conversation.status === "complete") {
    return res.status(400).json({ error: "conversation_complete" });
  }
  const [latestAnalysis] = await db.select().from(analyses).where(and10(eq14(analyses.userId, user.id), eq14(analyses.status, "done"))).orderBy(desc9(analyses.createdAt)).limit(1);
  const userStatements = await db.select().from(statements).where(eq14(statements.userId, user.id));
  const phase = derivePhase(user.buildCompletedAt, latestAnalysis?.result);
  const promptKey = phase === "first_take_gaps" ? "qa" : "qa_bring_it_in";
  const prompt = await getActivePrompt(promptKey);
  if (!prompt) {
    return res.status(500).json({ error: "no_active_qa_prompt", detail: { promptKey } });
  }
  const [userMsg] = await db.insert(conversationMessages).values({
    conversationId: conversation.id,
    role: "user",
    content: parsed.data.content
  }).returning();
  audit({
    req,
    action: "qa.message_send",
    resourceType: "conversation",
    resourceId: String(conversation.id)
  });
  const priorMessages = await loadMessages(conversation.id);
  const fullHistory = priorMessages.filter((m) => m.id !== userMsg.id).map((m) => ({ role: m.role, content: m.content }));
  const historyForModel = fullHistory.slice(-MAX_HISTORY_MESSAGES);
  const historyTruncated = fullHistory.length > historyForModel.length;
  const runningProfile = conversation.profile ?? emptyProfile();
  const runningFlags = conversation.flaggedIssues ?? [];
  try {
    const { conversation: updated, assistantMessage } = await runAndPersistTurn({
      conversationId: conversation.id,
      userId: user.id,
      prompt,
      user: { firstName: user.firstName, email: user.email },
      phase,
      analysis: latestAnalysis?.result ?? null,
      statements: summariseStatements(userStatements),
      statementDetails: detailsFor(userStatements),
      profile: runningProfile,
      flaggedIssues: runningFlags,
      history: historyForModel,
      historyTruncated,
      latestUser: parsed.data.content
    });
    if (updated.status === "complete") {
      audit({
        req,
        action: "qa.conversation_complete",
        resourceType: "conversation",
        resourceId: String(conversation.id)
      });
    }
    res.json({ conversation: updated, userMessage: userMsg, assistantMessage });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    console.error("[qa.message] Claude call failed:", err);
    audit({
      req,
      action: "qa.message_failed",
      resourceType: "conversation",
      resourceId: String(conversation.id),
      outcome: "failure",
      detail: { message }
    });
    res.status(500).json({ error: "qa_message_failed", message });
  }
});
router6.post("/api/qa/pause", async (req, res) => {
  const user = req.user;
  const [updated] = await db.update(conversations).set({ status: "paused", updatedAt: /* @__PURE__ */ new Date() }).where(and10(eq14(conversations.userId, user.id), eq14(conversations.status, "active"))).returning();
  if (!updated) {
    return res.status(404).json({ error: "no_active_conversation" });
  }
  audit({
    req,
    action: "qa.conversation_pause",
    resourceType: "conversation",
    resourceId: String(updated.id)
  });
  res.json(updated);
});
router6.post("/api/qa/complete", async (req, res) => {
  const user = req.user;
  const [updated] = await db.update(conversations).set({ status: "complete", completedAt: /* @__PURE__ */ new Date(), updatedAt: /* @__PURE__ */ new Date() }).where(eq14(conversations.userId, user.id)).returning();
  if (!updated) {
    return res.status(404).json({ error: "no_conversation" });
  }
  audit({
    req,
    action: "qa.conversation_complete",
    resourceType: "conversation",
    resourceId: String(updated.id),
    detail: { source: "manual" }
  });
  res.json(updated);
});
async function loadMessages(conversationId) {
  return db.select().from(conversationMessages).where(eq14(conversationMessages.conversationId, conversationId)).orderBy(asc2(conversationMessages.createdAt), asc2(conversationMessages.id));
}
var qa_default = router6;

// server/routes/analysisDraft.ts
import { Router as Router7 } from "express";
import { and as and12, desc as desc11, eq as eq16, isNull as isNull4 } from "drizzle-orm";

// server/modules/analysisDraft/claude.ts
import Anthropic4 from "@anthropic-ai/sdk";
import { zodOutputFormat as zodOutputFormat4 } from "@anthropic-ai/sdk/helpers/zod";
var client4 = new Anthropic4();
async function runStructuredCall(input) {
  const response = await client4.messages.parse({
    model: input.model,
    // Default lowered from 16000 — observed outputs are ~3-5k. Callers can
    // override (e.g. analysis_chat sets 1500). Lower ceiling = faster commit.
    max_tokens: input.maxTokens ?? 6e3,
    system: [
      {
        type: "text",
        text: input.systemPrompt,
        cache_control: { type: "ephemeral" }
      }
    ],
    messages: [
      {
        role: "user",
        content: input.userMessage
      }
    ],
    output_config: { format: zodOutputFormat4(input.outputSchema) }
  });
  if (!response.parsed_output) {
    throw new Error("Structured call returned no parsed output");
  }
  return {
    parsed: response.parsed_output,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0
    }
  };
}
function sumUsage(usages) {
  return usages.reduce(
    (acc, u) => ({
      inputTokens: acc.inputTokens + u.inputTokens,
      outputTokens: acc.outputTokens + u.outputTokens,
      cacheReadTokens: acc.cacheReadTokens + u.cacheReadTokens,
      cacheCreationTokens: acc.cacheCreationTokens + u.cacheCreationTokens
    }),
    { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 }
  );
}

// server/modules/analysisDraft/schema.ts
import { z as z7 } from "zod/v4";
var evidenceRefSchema = z7.object({
  kind: z7.string().describe("Source kind. Canonical values: 'transaction' | 'profile' | 'analysis' | 'conversation' | 'statement'. Loose enum \u2014 Anthropic's structured output occasionally emits adjacent values (e.g. 'fact', 'summary') and a strict enum kills the whole pipeline; downstream code treats kind as a hint, not a hard contract."),
  ref: z7.string().describe("Opaque identifier \u2014 transaction id, profile path like 'family.dependents', statement id, etc.")
});
var keyFactSchema = z7.object({
  statement: z7.string().describe("A single observation in Ally's voice. Plain, specific, not preachy."),
  evidenceRefs: z7.array(evidenceRefSchema).describe("Where this observation comes from. Never leave empty \u2014 if there's no evidence, don't write the fact.")
});
var factsSectionSchema = z7.object({
  id: z7.string().describe("Slug \u2014 'income' | 'spending' | 'family_obligations' | 'whats_missing' | etc. Stable across generations so re-renders can re-use claims."),
  salience: z7.number().int().min(1).max(10).describe("How much this section matters for THIS person. 10 = opens or near-opens the story. 1 = mention in passing. Drives dynamic ordering."),
  emotionalRegister: z7.enum(["gentle", "honest", "warm", "hopeful", "grounding", "celebratory", "matter_of_fact"]).describe("Tone this section should land with \u2014 set by what the user revealed in conversation."),
  headline: z7.string().describe("One-sentence summary in Ally's voice. The essence of this section if the user read nothing else."),
  keyFacts: z7.array(keyFactSchema),
  gaps: z7.array(z7.string()).describe("What we DON'T know in this area but would want to. These seed future notes/questions \u2014 they do not become claims in this draft.")
});
var analysisFactsSchema = z7.object({
  openingRecognition: z7.object({
    whatTheyreCarrying: z7.string().describe("The emotional weight the user is holding, named specifically. Draws from what they revealed in conversation. NOT data \u2014 the feeling behind the data. Example: 'You just signed a bond. It's bigger than you expected, and you're carrying three people who are depending on you working out.'"),
    emotionalRegister: z7.enum(["gentle", "honest", "warm", "hopeful", "grounding", "celebratory", "matter_of_fact"])
  }),
  emotionalTrajectory: z7.enum([
    "heavy_to_light",
    "steady",
    "celebratory",
    "grounding",
    "challenging_but_hopeful"
  ]).describe("The arc the story/comic should follow, per PRD \xA76.5. Most users: heavy_to_light."),
  sections: z7.array(factsSectionSchema).describe("Dynamic \u2014 only include sections this user has evidence for. Ordered by salience descending. Expect 4-8 sections; not every user gets every category."),
  notesToRaise: z7.array(z7.object({
    anchorId: z7.string().describe("Stable slug, e.g. 'note_retirement' or 'note_house_bond'. Prose and panels reference these when they emit note-kind annotations."),
    category: z7.string().describe("'house' | 'retirement' | 'medical_aid' | 'crypto' | 'goals' | 'family' | etc."),
    label: z7.string().describe("Short title for the note, e.g. 'Retirement'"),
    body: z7.string().describe("Short factual body, e.g. 'Provident fund through employer, no visible contributions outside that.'"),
    evidenceRefs: z7.array(evidenceRefSchema)
  })).describe("The facts that should become Notes / Record of Advice entries \u2014 dated, attributed, referenceable.")
});
var annotationSchema2 = z7.object({
  kind: z7.enum(["explain", "note"]),
  phrase: z7.string().describe("The exact text substring from the surrounding copy to highlight. Must appear verbatim in the paragraph/anchor text."),
  anchorId: z7.string().describe("Stable id referencing a claim (explain) or note (note). Prose and panels MAY share anchor ids when they reference the same underlying fact.")
});
var proseParagraphSchema = z7.object({
  text: z7.string(),
  annotations: z7.array(annotationSchema2).default([])
});
var proseSectionSchema = z7.object({
  id: z7.string().describe("Matches the facts section id."),
  heading: z7.string().optional().describe("Optional \u2014 many sections work better without one. Only use when it earns its place."),
  paragraphs: z7.array(proseParagraphSchema)
});
var analysisProseSchema = z7.object({
  sections: z7.array(proseSectionSchema).describe("Ordered. The first section IS the opening recognition \u2014 it must not open with numbers or financial facts."),
  explainClaims: z7.array(z7.object({
    anchorId: z7.string(),
    label: z7.string().describe("The pill/highlight copy."),
    body: z7.string().describe("One-sentence restatement of the claim, shown in Explain mode header."),
    evidenceRefs: z7.array(evidenceRefSchema),
    chartKind: z7.enum([
      "none",
      "balance_by_month",
      "spend_by_category",
      "income_over_time",
      "cash_flow_shape"
    ]).describe("Which evidence visual (if any) Explain mode should render. 'none' = text + transactions only.")
  })).describe("Every explain-kind annotation in the prose must have a matching claim here.")
});
var proportionSchema = z7.object({
  parts: z7.array(z7.object({
    label: z7.string(),
    weight: z7.number().describe("Relative weight \u2014 the renderer normalises these to fractions.")
  }))
});
var panelBeatSchema = z7.object({
  id: z7.string().describe("Stable id, e.g. 'income_shape', 'bond_weight'. Matches facts section ids when the beat is tied to one."),
  anchorCopy: z7.string().describe("ONE short sentence \u2014 the line of text under/beside the panel illustration. Under ~90 chars."),
  metaphor: z7.enum([
    "tap_and_basin",
    "holes_in_basin",
    "shield",
    "road_ahead",
    "weights_carried",
    "hands_reaching",
    "crossroads",
    "scale",
    "lamp_lit",
    "empty_chair",
    "open_door",
    "stacked_stones",
    "none"
  ]).describe("The visual metaphor to use. 'none' = copy-only beat (opener or beat of silence). Extend the enum only when a new metaphor is earned."),
  proportion: proportionSchema.optional().describe("Optional proportional visual (e.g., income vs commitments). Rendered deterministically."),
  annotations: z7.array(annotationSchema2).default([])
});
var analysisPanelsSchema = z7.object({
  beats: z7.array(panelBeatSchema).describe("Ordered top-to-bottom. The first beat IS the opening recognition."),
  explainClaims: z7.array(z7.object({
    anchorId: z7.string(),
    label: z7.string(),
    body: z7.string(),
    evidenceRefs: z7.array(evidenceRefSchema),
    chartKind: z7.enum([
      "none",
      "balance_by_month",
      "spend_by_category",
      "income_over_time",
      "cash_flow_shape"
    ])
  })).describe("Every explain-kind annotation in panels must have a matching claim here. MAY duplicate prose claims if the same anchor is used in both formats.")
});
var analysisChatTurnSchema = z7.object({
  reply: z7.string().describe("Ally's response to the user in plain conversational text. One-to-three paragraphs."),
  action: z7.enum([
    "reply_only",
    "request_regenerate",
    "mark_complete"
  ]).describe("What this turn should do. reply_only = conversation continues. request_regenerate = the user has corrected something substantive and Ally will rewrite the draft. mark_complete = the user has agreed the draft is right (moves to 'agreed')."),
  regenerateReason: z7.string().optional().describe("When action=request_regenerate, the short reason that will drive the next generation pass \u2014 a plain-language summary of what changed."),
  noteUpdates: z7.array(z7.object({
    category: z7.string(),
    label: z7.string(),
    body: z7.string(),
    evidenceRefs: z7.array(evidenceRefSchema).default([])
  })).default([]).describe("Notes established or updated on this turn. Each becomes a new Record-of-Advice entry; prior versions stay in history.")
});

// server/modules/analysisDraft/facts.ts
async function generateFacts(input) {
  const userMessage = buildUserMessage2(input);
  const { parsed, usage } = await runStructuredCall({
    systemPrompt: input.systemPrompt,
    model: input.model,
    userMessage,
    outputSchema: analysisFactsSchema,
    // Power users (12+ months of business data) generate Facts outputs that
    // exceed the 6000-token shared default. Saw this for savannah's prd run:
    // Anthropic stopped mid-string at ~24k chars. Prose/panels are bounded by
    // narrative shape, so they keep the lower default.
    maxTokens: 16e3
  });
  return { facts: parsed, usage };
}
function buildUserMessage2(input) {
  return [
    "# Canvas 1 outputs \u2014 produce the structured facts for Canvas 2.",
    "",
    "## Statements (summary)",
    "```json",
    JSON.stringify(input.statementSummaries, null, 2),
    "```",
    "",
    "## First-take analysis (from Canvas 1)",
    "```json",
    JSON.stringify(input.firstTakeAnalysis, null, 2),
    "```",
    "",
    "## Conversation profile (everything the user confirmed, corrected, or revealed in Q&A)",
    "```json",
    JSON.stringify(input.conversationProfile, null, 2),
    "```",
    "",
    "## Flagged issues (things Ally noticed during Q&A)",
    "```json",
    JSON.stringify(input.flaggedIssues, null, 2),
    "```"
  ].join("\n");
}

// server/modules/analysisDraft/prose.ts
async function generateProse(input) {
  const userMessage = [
    "# Facts (ground truth) \u2014 render Format A prose from this.",
    "```json",
    JSON.stringify(input.facts, null, 2),
    "```"
  ].join("\n");
  const { parsed, usage } = await runStructuredCall({
    systemPrompt: input.systemPrompt,
    model: input.model,
    userMessage,
    outputSchema: analysisProseSchema
  });
  return { prose: parsed, usage };
}

// server/modules/analysisDraft/panels.ts
async function generatePanels(input) {
  const userMessage = [
    "# Facts (ground truth) \u2014 render Format B comic beats from this.",
    "```json",
    JSON.stringify(input.facts, null, 2),
    "```"
  ].join("\n");
  const { parsed, usage } = await runStructuredCall({
    systemPrompt: input.systemPrompt,
    model: input.model,
    userMessage,
    outputSchema: analysisPanelsSchema
  });
  return { panels: parsed, usage };
}

// server/modules/analysisDraft/build.ts
async function buildAnalysisDraft(input) {
  const { facts, usage: factsUsage } = await generateFacts({
    systemPrompt: input.prompts.facts.content,
    model: input.prompts.facts.model,
    firstTakeAnalysis: input.firstTakeAnalysis,
    conversationProfile: input.conversationProfile,
    flaggedIssues: input.flaggedIssues,
    statementSummaries: input.statementSummaries
  });
  const [proseResult, panelsResult] = await Promise.all([
    generateProse({
      systemPrompt: input.prompts.prose.content,
      model: input.prompts.prose.model,
      facts
    }),
    generatePanels({
      systemPrompt: input.prompts.panels.content,
      model: input.prompts.panels.model,
      facts
    })
  ]);
  const claims = extractClaims(proseResult.prose, panelsResult.panels, facts);
  const notes = facts.notesToRaise.map((n) => ({
    anchorId: n.anchorId,
    category: n.category,
    label: n.label,
    body: n.body,
    evidenceRefs: n.evidenceRefs
  }));
  return {
    facts,
    prose: proseResult.prose,
    panels: panelsResult.panels,
    claims,
    notes,
    usage: sumUsage([factsUsage, proseResult.usage, panelsResult.usage]),
    promptVersionIds: {
      facts: input.prompts.facts.id,
      prose: input.prompts.prose.id,
      panels: input.prompts.panels.id
    }
  };
}
function extractClaims(prose, panels, facts) {
  const seen = /* @__PURE__ */ new Map();
  for (const section of prose.sections) {
    for (const paragraph of section.paragraphs) {
      for (const ann of paragraph.annotations ?? []) {
        addAnnotation(seen, ann, prose, panels, facts);
      }
    }
  }
  for (const beat of panels.beats) {
    for (const ann of beat.annotations ?? []) {
      addAnnotation(seen, ann, prose, panels, facts);
    }
  }
  return Array.from(seen.values());
}
function addAnnotation(acc, ann, prose, panels, facts) {
  if (acc.has(ann.anchorId)) return;
  if (ann.kind === "explain") {
    const claim = prose.explainClaims.find((c) => c.anchorId === ann.anchorId) ?? panels.explainClaims.find((c) => c.anchorId === ann.anchorId);
    acc.set(ann.anchorId, {
      kind: "explain",
      anchorId: ann.anchorId,
      label: claim?.label ?? ann.phrase,
      category: null,
      body: claim?.body ?? null,
      evidenceRefs: claim ? { refs: claim.evidenceRefs, chartKind: claim.chartKind } : null
    });
  } else {
    const note = facts.notesToRaise.find((n) => n.anchorId === ann.anchorId);
    acc.set(ann.anchorId, {
      kind: "note",
      anchorId: ann.anchorId,
      label: note?.label ?? ann.phrase,
      category: note?.category ?? null,
      body: note?.body ?? null,
      evidenceRefs: note ? { refs: note.evidenceRefs } : null
    });
  }
}

// server/modules/analysisDraft/refresh.ts
import { and as and11, desc as desc10, eq as eq15, isNull as isNull3 } from "drizzle-orm";
function summariseStatements2(rows) {
  return rows.map((s) => {
    const r = s.extractionResult ?? null;
    return {
      filename: s.filename,
      bankName: r?.bankName ?? null,
      periodStart: r?.statementPeriodStart ?? null,
      periodEnd: r?.statementPeriodEnd ?? null,
      transactionCount: Array.isArray(r?.transactions) ? r.transactions.length : null
    };
  });
}
async function refreshCanvas2Draft(userId) {
  const [c1Conversation] = await db.select().from(conversations).where(eq15(conversations.userId, userId)).orderBy(desc10(conversations.updatedAt)).limit(1);
  if (!c1Conversation) throw new Error("no_conversation");
  const [c1Analysis] = await db.select().from(analyses).where(and11(eq15(analyses.userId, userId), eq15(analyses.status, "done"))).orderBy(desc10(analyses.createdAt)).limit(1);
  if (!c1Analysis) throw new Error("no_analysis");
  const userStatements = await db.select().from(statements).where(eq15(statements.userId, userId));
  const [factsPrompt, prosePrompt, panelsPrompt] = await Promise.all([
    getActivePrompt("analysis_facts"),
    getActivePrompt("analysis_prose"),
    getActivePrompt("analysis_panels")
  ]);
  if (!factsPrompt || !prosePrompt || !panelsPrompt) {
    throw new Error("no_active_prompts");
  }
  await db.update(analysisDrafts).set({ status: "superseded", supersededAt: /* @__PURE__ */ new Date() }).where(
    and11(
      eq15(analysisDrafts.userId, userId),
      isNull3(analysisDrafts.supersededAt)
    )
  );
  const [created] = await db.insert(analysisDrafts).values({
    userId,
    sourceConversationId: c1Conversation.id,
    sourceAnalysisId: c1Analysis.id,
    status: "thinking"
  }).returning();
  void (async () => {
    try {
      const out = await buildAnalysisDraft({
        prompts: {
          facts: { id: factsPrompt.id, content: factsPrompt.content, model: factsPrompt.model },
          prose: { id: prosePrompt.id, content: prosePrompt.content, model: prosePrompt.model },
          panels: { id: panelsPrompt.id, content: panelsPrompt.content, model: panelsPrompt.model }
        },
        firstTakeAnalysis: c1Analysis.result,
        conversationProfile: c1Conversation.profile,
        flaggedIssues: c1Conversation.flaggedIssues ?? [],
        statementSummaries: summariseStatements2(userStatements)
      });
      await db.update(analysisDrafts).set({
        status: "ready",
        facts: out.facts,
        prose: out.prose,
        panels: out.panels,
        inputTokens: out.usage.inputTokens,
        outputTokens: out.usage.outputTokens,
        cacheReadTokens: out.usage.cacheReadTokens,
        cacheCreationTokens: out.usage.cacheCreationTokens,
        promptVersionIds: out.promptVersionIds,
        generatedAt: /* @__PURE__ */ new Date()
      }).where(eq15(analysisDrafts.id, created.id));
      if (out.claims.length > 0) {
        await db.insert(analysisClaims).values(
          out.claims.map((c) => ({
            draftId: created.id,
            kind: c.kind,
            anchorId: c.anchorId,
            label: c.label,
            category: c.category,
            body: c.body,
            evidenceRefs: c.evidenceRefs
          }))
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown_error";
      console.error("[refreshCanvas2Draft] build failed:", err);
      await db.update(analysisDrafts).set({ status: "failed", errorMessage: message }).where(eq15(analysisDrafts.id, created.id));
    }
  })();
  return { draftId: created.id, status: "thinking" };
}

// server/routes/analysisDraft.ts
var router7 = Router7();
router7.use(isAuthenticated);
function summariseStatements3(rows) {
  return rows.map((s) => {
    const r = s.extractionResult ?? null;
    return {
      filename: s.filename,
      bankName: r?.bankName ?? null,
      periodStart: r?.statementPeriodStart ?? null,
      periodEnd: r?.statementPeriodEnd ?? null,
      transactionCount: Array.isArray(r?.transactions) ? r.transactions.length : null
    };
  });
}
async function getCurrentDraft(userId) {
  const [row] = await db.select().from(analysisDrafts).where(and12(eq16(analysisDrafts.userId, userId), isNull4(analysisDrafts.supersededAt))).orderBy(desc11(analysisDrafts.createdAt)).limit(1);
  return row ?? null;
}
router7.post("/api/analysis-draft/generate", async (req, res) => {
  const user = req.user;
  const existing = await getCurrentDraft(user.id);
  if (existing && existing.status !== "failed") {
    return res.json(existing);
  }
  const [c1Conversation] = await db.select().from(conversations).where(and12(eq16(conversations.userId, user.id), eq16(conversations.status, "complete"))).orderBy(desc11(conversations.completedAt)).limit(1);
  if (!c1Conversation) return res.status(400).json({ error: "canvas_1_not_agreed" });
  const [c1Analysis] = await db.select().from(analyses).where(and12(eq16(analyses.userId, user.id), eq16(analyses.status, "done"))).orderBy(desc11(analyses.createdAt)).limit(1);
  if (!c1Analysis) return res.status(400).json({ error: "no_analysis" });
  const userStatements = await db.select().from(statements).where(eq16(statements.userId, user.id));
  const [factsPrompt, prosePrompt, panelsPrompt] = await Promise.all([
    getActivePrompt("analysis_facts"),
    getActivePrompt("analysis_prose"),
    getActivePrompt("analysis_panels")
  ]);
  if (!factsPrompt || !prosePrompt || !panelsPrompt) {
    return res.status(500).json({ error: "no_active_prompts" });
  }
  const [created] = await db.insert(analysisDrafts).values({
    userId: user.id,
    sourceConversationId: c1Conversation.id,
    sourceAnalysisId: c1Analysis.id,
    status: "thinking"
  }).returning();
  audit({
    req,
    action: "analysis_draft.generate.start",
    resourceType: "analysis_draft",
    resourceId: String(created.id)
  });
  try {
    const out = await buildAnalysisDraft({
      prompts: {
        facts: { id: factsPrompt.id, content: factsPrompt.content, model: factsPrompt.model },
        prose: { id: prosePrompt.id, content: prosePrompt.content, model: prosePrompt.model },
        panels: { id: panelsPrompt.id, content: panelsPrompt.content, model: panelsPrompt.model }
      },
      firstTakeAnalysis: c1Analysis.result,
      conversationProfile: c1Conversation.profile,
      flaggedIssues: c1Conversation.flaggedIssues ?? [],
      statementSummaries: summariseStatements3(userStatements)
    });
    const [finished] = await db.update(analysisDrafts).set({
      status: "ready",
      facts: out.facts,
      prose: out.prose,
      panels: out.panels,
      inputTokens: out.usage.inputTokens,
      outputTokens: out.usage.outputTokens,
      cacheReadTokens: out.usage.cacheReadTokens,
      cacheCreationTokens: out.usage.cacheCreationTokens,
      promptVersionIds: out.promptVersionIds,
      generatedAt: /* @__PURE__ */ new Date()
    }).where(and12(eq16(analysisDrafts.id, created.id), eq16(analysisDrafts.userId, user.id))).returning();
    if (out.claims.length > 0) {
      await db.insert(analysisClaims).values(
        out.claims.map((c) => ({
          draftId: created.id,
          kind: c.kind,
          anchorId: c.anchorId,
          label: c.label,
          category: c.category,
          body: c.body,
          evidenceRefs: c.evidenceRefs
        }))
      );
    }
    const inlinedAnchorIds = new Set(
      out.claims.filter((c) => c.kind === "note").map((c) => c.anchorId)
    );
    const unreferencedNotes = out.notes.filter((n) => !inlinedAnchorIds.has(n.anchorId));
    if (unreferencedNotes.length > 0) {
      await db.insert(analysisClaims).values(
        unreferencedNotes.map((n) => ({
          draftId: created.id,
          kind: "note",
          anchorId: n.anchorId,
          label: n.label,
          category: n.category,
          body: n.body,
          evidenceRefs: n.evidenceRefs
        }))
      );
    }
    audit({
      req,
      action: "analysis_draft.generate.success",
      resourceType: "analysis_draft",
      resourceId: String(created.id),
      detail: { usage: out.usage }
    });
    res.json(finished);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    console.error("[analysis_draft.generate] build failed:", err);
    await db.update(analysisDrafts).set({ status: "failed", errorMessage: message }).where(and12(eq16(analysisDrafts.id, created.id), eq16(analysisDrafts.userId, user.id)));
    audit({
      req,
      action: "analysis_draft.generate.failure",
      resourceType: "analysis_draft",
      resourceId: String(created.id),
      outcome: "failure",
      detail: { message }
    });
    res.status(500).json({ error: "generate_failed", message });
  }
});
router7.get("/api/analysis-draft/current", async (req, res) => {
  const user = req.user;
  const draft = await getCurrentDraft(user.id);
  res.json(draft ?? null);
});
router7.get("/api/analysis-draft/:id", async (req, res) => {
  const user = req.user;
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid_id" });
  const [row] = await db.select().from(analysisDrafts).where(and12(eq16(analysisDrafts.id, id), eq16(analysisDrafts.userId, user.id))).limit(1);
  if (!row) return res.status(404).json({ error: "not_found" });
  res.json(row);
});
router7.post("/api/analysis-draft/:id/agree", async (req, res) => {
  const user = req.user;
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid_id" });
  const [row] = await db.select().from(analysisDrafts).where(and12(eq16(analysisDrafts.id, id), eq16(analysisDrafts.userId, user.id))).limit(1);
  if (!row) return res.status(404).json({ error: "not_found" });
  if (row.status !== "ready") {
    return res.status(400).json({ error: "not_ready", status: row.status });
  }
  const [agreed] = await db.update(analysisDrafts).set({ status: "agreed", agreedAt: /* @__PURE__ */ new Date() }).where(and12(eq16(analysisDrafts.id, id), eq16(analysisDrafts.userId, user.id))).returning();
  await db.update(analysisConversations).set({ status: "complete", completedAt: /* @__PURE__ */ new Date(), updatedAt: /* @__PURE__ */ new Date() }).where(
    and12(
      eq16(analysisConversations.userId, user.id),
      eq16(analysisConversations.draftId, id),
      eq16(analysisConversations.status, "active")
    )
  );
  audit({
    req,
    action: "analysis_draft.agree",
    resourceType: "analysis_draft",
    resourceId: String(id)
  });
  res.json(agreed);
});
router7.post("/api/analysis-draft/:id/reopen", async (req, res) => {
  const user = req.user;
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid_id" });
  const [row] = await db.select().from(analysisDrafts).where(and12(eq16(analysisDrafts.id, id), eq16(analysisDrafts.userId, user.id))).limit(1);
  if (!row) return res.status(404).json({ error: "not_found" });
  if (row.status !== "ready" && row.status !== "agreed") {
    return res.status(400).json({ error: "not_reopenable", status: row.status });
  }
  await db.update(analysisDrafts).set({ status: "superseded", supersededAt: /* @__PURE__ */ new Date() }).where(and12(eq16(analysisDrafts.id, id), eq16(analysisDrafts.userId, user.id)));
  audit({
    req,
    action: "analysis_draft.reopen",
    resourceType: "analysis_draft",
    resourceId: String(id)
  });
  res.json({ ok: true });
});
router7.post("/api/analysis-draft/refresh", async (req, res) => {
  const user = req.user;
  try {
    const result = await refreshCanvas2Draft(user.id);
    audit({
      req,
      action: "analysis_draft.refresh.start",
      resourceType: "analysis_draft",
      resourceId: String(result.draftId)
    });
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    res.status(400).json({ error: "refresh_failed", message });
  }
});
router7.get("/api/analysis-draft/:id/claims", async (req, res) => {
  const user = req.user;
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid_id" });
  const [draft] = await db.select().from(analysisDrafts).where(and12(eq16(analysisDrafts.id, id), eq16(analysisDrafts.userId, user.id))).limit(1);
  if (!draft) return res.status(404).json({ error: "not_found" });
  const rows = await db.select().from(analysisClaims).where(eq16(analysisClaims.draftId, id));
  res.json(rows);
});
var analysisDraft_default = router7;

// server/routes/analysisConversation.ts
import { Router as Router8 } from "express";
import { z as z8 } from "zod";
import { and as and13, asc as asc3, desc as desc12, eq as eq17 } from "drizzle-orm";

// server/modules/analysisDraft/chat.ts
async function runAnalysisChatTurn(input) {
  const userMessage = buildUserMessage3(input);
  const { parsed, usage } = await runStructuredCall({
    systemPrompt: input.systemPrompt,
    model: input.model,
    userMessage,
    outputSchema: analysisChatTurnSchema,
    // Lowered from 4000 — analysis_chat replies + noteUpdates fit comfortably
    // in 1500 tokens. The previous ceiling was forcing the model to plan for
    // a much larger response than ever materialised.
    maxTokens: 1500
  });
  return { turn: parsed, usage };
}
function buildUserMessage3(input) {
  return [
    "# The current draft (what the user is looking at)",
    "```json",
    JSON.stringify({
      draftId: input.draft.id,
      status: input.draft.status,
      facts: input.draft.facts,
      prose: input.draft.prose,
      panels: input.draft.panels
    }),
    "```",
    "",
    "# Record of advice so far",
    "```json",
    JSON.stringify(input.notes),
    "```",
    "",
    "# Conversation history (this refining thread)",
    ...input.history.map((m) => `**${m.role}:** ${m.content}`),
    "",
    "# Latest user message",
    input.latestUser
  ].join("\n");
}

// server/routes/analysisConversation.ts
var router8 = Router8();
router8.use(isAuthenticated);
var MAX_HISTORY_MESSAGES2 = 16;
router8.get("/api/analysis-conversation", async (req, res) => {
  const user = req.user;
  const [conv] = await db.select().from(analysisConversations).where(eq17(analysisConversations.userId, user.id)).orderBy(desc12(analysisConversations.startedAt)).limit(1);
  if (!conv) return res.json({ conversation: null, messages: [] });
  const [latestMsg] = await db.select({ createdAt: analysisConversationMessages.createdAt }).from(analysisConversationMessages).where(eq17(analysisConversationMessages.analysisConversationId, conv.id)).orderBy(desc12(analysisConversationMessages.createdAt)).limit(1);
  if (conv.status === "active" && isStale(latestMsg?.createdAt ?? null)) {
    await onStateChange({
      userId: user.id,
      trigger: "session_resumed",
      canvas: "analysis",
      payload: { canvas: "analysis", beat: "discuss" }
    });
  }
  const messages = await loadMessages2(conv.id);
  res.json({ conversation: conv, messages });
});
router8.post("/api/analysis-conversation/start", async (req, res) => {
  const user = req.user;
  const [draft] = await db.select().from(analysisDrafts).where(and13(eq17(analysisDrafts.userId, user.id), eq17(analysisDrafts.status, "ready"))).orderBy(desc12(analysisDrafts.createdAt)).limit(1);
  if (!draft) return res.status(400).json({ error: "no_ready_draft" });
  const [existing] = await db.select().from(analysisConversations).where(
    and13(
      eq17(analysisConversations.userId, user.id),
      eq17(analysisConversations.draftId, draft.id)
    )
  ).limit(1);
  if (existing) {
    const messages = await loadMessages2(existing.id);
    return res.json({ conversation: existing, messages });
  }
  const [created] = await db.insert(analysisConversations).values({
    userId: user.id,
    draftId: draft.id,
    status: "active",
    profile: {}
  }).returning();
  const [opener] = await db.insert(analysisConversationMessages).values({
    analysisConversationId: created.id,
    role: "assistant",
    content: `Here it is. Have a read \u2014 take your time.

If anything's off, tell me and I'll fix it. When it lands right, tap "This is me".`,
    isTransition: true
  }).returning();
  audit({
    req,
    action: "analysis_conversation.start",
    resourceType: "analysis_conversation",
    resourceId: String(created.id)
  });
  res.json({ conversation: created, messages: [opener] });
});
var messageBodySchema2 = z8.object({
  content: z8.string().min(1).max(5e3)
});
router8.post("/api/analysis-conversation/message", async (req, res) => {
  const user = req.user;
  const parsed = messageBodySchema2.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_input", detail: parsed.error.flatten() });
  }
  const [conv] = await db.select().from(analysisConversations).where(
    and13(
      eq17(analysisConversations.userId, user.id),
      eq17(analysisConversations.status, "active")
    )
  ).orderBy(desc12(analysisConversations.startedAt)).limit(1);
  if (!conv) return res.status(404).json({ error: "no_active_conversation" });
  const [draft] = await db.select().from(analysisDrafts).where(and13(eq17(analysisDrafts.id, conv.draftId), eq17(analysisDrafts.userId, user.id))).limit(1);
  if (!draft || draft.status !== "ready" && draft.status !== "agreed") {
    return res.status(400).json({ error: "draft_not_available", status: draft?.status });
  }
  const prompt = await getActivePrompt("analysis_chat");
  if (!prompt) return res.status(500).json({ error: "no_active_analysis_chat_prompt" });
  const [userMsg] = await db.insert(analysisConversationMessages).values({
    analysisConversationId: conv.id,
    role: "user",
    content: parsed.data.content
  }).returning();
  audit({
    req,
    action: "analysis_conversation.message_send",
    resourceType: "analysis_conversation",
    resourceId: String(conv.id)
  });
  const allMessages = await loadMessages2(conv.id);
  const priorHistory = allMessages.filter((m) => m.id !== userMsg.id).map((m) => ({ role: m.role, content: m.content }));
  const history = priorHistory.slice(-MAX_HISTORY_MESSAGES2);
  const noteRows = await db.select().from(analysisClaims).where(and13(eq17(analysisClaims.draftId, draft.id), eq17(analysisClaims.kind, "note")));
  const notes = noteRows.map((n) => ({
    category: n.category ?? "other",
    label: n.label,
    body: n.body ?? "",
    // TODO (Part 6): track actual established-at per note once analysis_notes table exists.
    establishedAt: ""
  }));
  try {
    const { turn, usage } = await runAnalysisChatTurn({
      systemPrompt: prompt.content,
      model: prompt.model,
      draft: {
        id: draft.id,
        status: draft.status,
        facts: draft.facts,
        prose: draft.prose,
        panels: draft.panels
      },
      notes,
      history,
      latestUser: parsed.data.content
    });
    const [assistantMsg] = await db.insert(analysisConversationMessages).values({
      analysisConversationId: conv.id,
      role: "assistant",
      content: turn.reply,
      status: turn.action === "mark_complete" ? "complete" : null,
      promptVersionId: prompt.id,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheCreationTokens: usage.cacheCreationTokens
    }).returning();
    if (turn.noteUpdates.length > 0) {
      await db.insert(analysisClaims).values(
        turn.noteUpdates.map((n, idx) => ({
          draftId: draft.id,
          kind: "note",
          anchorId: `note_turn_${assistantMsg.id}_${idx}`,
          label: n.label,
          category: n.category,
          body: n.body,
          evidenceRefs: { refs: n.evidenceRefs }
        }))
      );
      onStateChange({
        userId: user.id,
        trigger: "chat_turn_taken",
        canvas: "analysis",
        payload: {
          canvas: "analysis",
          noteUpdates: turn.noteUpdates,
          sourceMessageId: null,
          legacyConversationMessageId: assistantMsg.id,
          sourceSubStepId: null
        }
      }).catch(() => {
      });
    }
    if (turn.action === "request_regenerate") {
      refreshCanvas2Draft(user.id).catch((err) => {
        console.warn("[analysis_conversation] auto-refresh failed:", err);
      });
      audit({
        req,
        action: "analysis_draft.regenerate_requested",
        resourceType: "analysis_draft",
        resourceId: String(draft.id),
        detail: { reason: turn.regenerateReason }
      });
    } else if (turn.action === "mark_complete") {
      audit({
        req,
        action: "analysis_conversation.agreement_hint",
        resourceType: "analysis_conversation",
        resourceId: String(conv.id)
      });
    }
    await db.update(analysisConversations).set({ updatedAt: /* @__PURE__ */ new Date() }).where(eq17(analysisConversations.id, conv.id));
    const [updatedConv] = await db.select().from(analysisConversations).where(eq17(analysisConversations.id, conv.id)).limit(1);
    res.json({
      conversation: updatedConv,
      userMessage: userMsg,
      assistantMessage: assistantMsg,
      action: turn.action,
      regenerateReason: turn.regenerateReason ?? null
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    console.error("[analysis_conversation.message] Claude call failed:", err);
    audit({
      req,
      action: "analysis_conversation.message_failed",
      resourceType: "analysis_conversation",
      resourceId: String(conv.id),
      outcome: "failure",
      detail: { message }
    });
    res.status(500).json({ error: "message_failed", message });
  }
});
async function loadMessages2(conversationId) {
  return db.select().from(analysisConversationMessages).where(eq17(analysisConversationMessages.analysisConversationId, conversationId)).orderBy(
    asc3(analysisConversationMessages.createdAt),
    asc3(analysisConversationMessages.id)
  );
}
var analysisConversation_default = router8;

// server/routes/subStep.ts
import { Router as Router9 } from "express";
import { z as z9 } from "zod";
import { and as and15, asc as asc4, desc as desc14, eq as eq19, isNull as isNull6, sql as sql3 } from "drizzle-orm";

// server/modules/subStep/orchestrator.ts
import { and as and14, desc as desc13, eq as eq18, isNull as isNull5 } from "drizzle-orm";
async function getCurrentSubStep(userId) {
  const existing = await currentForUser(userId);
  if (existing) return existing;
  return await lazyBackfill(userId);
}
async function currentForUser(userId) {
  const rows = await db.select().from(subSteps).where(and14(eq18(subSteps.userId, userId), isNull5(subSteps.supersededAt))).orderBy(desc13(subSteps.startedAt)).limit(1);
  return rows[0] ?? null;
}
async function lazyBackfill(userId) {
  const [user] = await db.select().from(users).where(eq18(users.id, userId)).limit(1);
  if (!user) throw new Error(`User not found: ${userId}`);
  const stmts = await db.select().from(statements).where(eq18(statements.userId, userId));
  const [latestAnalysis] = await db.select().from(analyses).where(and14(eq18(analyses.userId, userId), eq18(analyses.status, "done"))).orderBy(desc13(analyses.createdAt)).limit(1);
  const [conv] = await db.select().from(conversations).where(eq18(conversations.userId, userId)).limit(1);
  const [latestDraft] = await db.select().from(analysisDrafts).where(and14(eq18(analysisDrafts.userId, userId), isNull5(analysisDrafts.supersededAt))).orderBy(desc13(analysisDrafts.createdAt)).limit(1);
  const derived = deriveCurrentFromLegacy({
    hasStatements: stmts.length > 0,
    hasBuildCompletedAt: !!user.buildCompletedAt,
    latestAnalysisId: latestAnalysis?.id ?? null,
    conversationStatus: conv?.status ?? null,
    statementIds: stmts.map((s) => s.id),
    latestDraftId: latestDraft?.id ?? null,
    latestDraftStatus: latestDraft?.status ?? null
  });
  const [created] = await db.insert(subSteps).values({
    userId,
    canvasKey: derived.canvas,
    beat: derived.beat,
    instance: 1,
    status: derived.status,
    driver: derived.driver,
    contentJson: derived.contentJson
  }).returning();
  return created;
}
function deriveCurrentFromLegacy(input) {
  if (input.conversationStatus === "complete") {
    if (input.latestDraftStatus === "agreed") {
      return {
        canvas: "analysis",
        beat: "live",
        status: "in_progress",
        driver: "both",
        contentJson: { draftId: input.latestDraftId, analysisId: input.latestAnalysisId }
      };
    }
    if (input.latestDraftStatus === "ready") {
      return {
        canvas: "analysis",
        beat: "discuss",
        status: "in_progress",
        driver: "both",
        contentJson: { draftId: input.latestDraftId, analysisId: input.latestAnalysisId }
      };
    }
    if (input.latestDraftStatus === "thinking" || input.latestDraftStatus === "failed") {
      return {
        canvas: "analysis",
        beat: "analyse",
        status: "in_progress",
        driver: "ally",
        contentJson: { draftId: input.latestDraftId, analysisId: input.latestAnalysisId }
      };
    }
    return {
      canvas: "analysis",
      beat: "analyse",
      status: "in_progress",
      driver: "ally",
      contentJson: { analysisId: input.latestAnalysisId }
    };
  }
  if (!input.hasStatements) {
    return {
      canvas: "picture",
      beat: "gather",
      status: "not_started",
      driver: "person",
      contentJson: { statementIds: [] }
    };
  }
  if (!input.hasBuildCompletedAt) {
    return {
      canvas: "picture",
      beat: "gather",
      status: "in_progress",
      driver: "person",
      contentJson: { statementIds: input.statementIds }
    };
  }
  if (input.latestAnalysisId === null) {
    return {
      canvas: "picture",
      beat: "analyse",
      status: "in_progress",
      driver: "ally",
      contentJson: {}
    };
  }
  return {
    canvas: "picture",
    beat: "discuss",
    status: "in_progress",
    driver: "both",
    contentJson: { analysisId: input.latestAnalysisId }
  };
}
async function advanceSubStep(userId, currentId, options = {}) {
  const [current] = await db.select().from(subSteps).where(and14(eq18(subSteps.id, currentId), eq18(subSteps.userId, userId))).limit(1);
  if (!current) throw new Error("sub-step not found");
  const nextBeat = nextBeatAfter(current.beat);
  if (!nextBeat) throw new Error(`no beat after ${current.beat}`);
  await db.update(subSteps).set({ status: "agreed", agreedAt: /* @__PURE__ */ new Date(), updatedAt: /* @__PURE__ */ new Date() }).where(eq18(subSteps.id, current.id));
  const [created] = await db.insert(subSteps).values({
    userId,
    canvasKey: current.canvasKey,
    beat: nextBeat,
    instance: current.instance,
    status: "in_progress",
    driver: driverForBeat(current.canvasKey, nextBeat),
    contentJson: options.contentJson ?? current.contentJson ?? null,
    predecessorId: current.id
  }).returning();
  return created;
}
async function agreeSubStep(userId, currentId) {
  const [current] = await db.select().from(subSteps).where(and14(eq18(subSteps.id, currentId), eq18(subSteps.userId, userId))).limit(1);
  if (!current) throw new Error("sub-step not found");
  if (current.beat !== "discuss") throw new Error("can only agree a discuss beat");
  await db.update(subSteps).set({ status: "agreed", agreedAt: /* @__PURE__ */ new Date(), updatedAt: /* @__PURE__ */ new Date() }).where(eq18(subSteps.id, current.id));
  const [live] = await db.insert(subSteps).values({
    userId,
    canvasKey: current.canvasKey,
    beat: "live",
    instance: current.instance,
    status: "in_progress",
    driver: "both",
    contentJson: current.contentJson,
    predecessorId: current.id
  }).returning();
  return live;
}
async function reopenSubStep(userId, currentId) {
  const [current] = await db.select().from(subSteps).where(and14(eq18(subSteps.id, currentId), eq18(subSteps.userId, userId))).limit(1);
  if (!current) throw new Error("sub-step not found");
  if (current.beat !== "live") throw new Error("can only reopen a live beat");
  await db.update(subSteps).set({ status: "superseded", supersededAt: /* @__PURE__ */ new Date(), updatedAt: /* @__PURE__ */ new Date() }).where(eq18(subSteps.id, current.id));
  const [discuss] = await db.insert(subSteps).values({
    userId,
    canvasKey: current.canvasKey,
    beat: "discuss",
    instance: current.instance + 1,
    status: "in_progress",
    driver: "both",
    contentJson: current.contentJson,
    predecessorId: current.id
  }).returning();
  return discuss;
}
async function markAnalyseError(userId, subStepId, errorMessage) {
  await db.update(subSteps).set({ errorMessage, updatedAt: /* @__PURE__ */ new Date() }).where(and14(eq18(subSteps.id, subStepId), eq18(subSteps.userId, userId)));
}
async function clearAnalyseError(userId, subStepId) {
  await db.update(subSteps).set({ errorMessage: null, updatedAt: /* @__PURE__ */ new Date() }).where(and14(eq18(subSteps.id, subStepId), eq18(subSteps.userId, userId)));
}
function nextBeatAfter(beat) {
  if (beat === "gather") return "analyse";
  if (beat === "analyse") return "discuss";
  if (beat === "discuss") return "live";
  return null;
}
function driverForBeat(canvas, beat) {
  if (beat === "gather") return canvas === "picture" || canvas === "progress" ? "person" : "ally";
  if (beat === "analyse") return "ally";
  return "both";
}

// server/routes/subStep.ts
var router9 = Router9();
router9.use(isAuthenticated);
router9.get("/api/sub-step/current", async (req, res) => {
  const user = req.user;
  try {
    const sub = await getCurrentSubStep(user.id);
    const messages = await loadMessages3(sub.id);
    void maybeKickoffAnalyse(user.id, sub);
    res.json({ subStep: sub, messages });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    res.status(500).json({ error: "sub_step_load_failed", message });
  }
});
router9.post("/api/sub-step/:id/advance", async (req, res) => {
  const user = req.user;
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid_id" });
  try {
    const [prior] = await db.select().from(subSteps).where(and15(eq19(subSteps.id, id), eq19(subSteps.userId, user.id))).limit(1);
    const next = await advanceSubStep(user.id, id);
    audit({
      req,
      action: "sub_step.advance",
      resourceType: "sub_step",
      resourceId: String(next.id),
      detail: { from: id, toBeat: next.beat }
    });
    if (prior?.beat === "gather") {
      const content = prior.contentJson ?? {};
      onStateChange({
        userId: user.id,
        trigger: "gather_advanced",
        subStepId: prior.id,
        canvas: prior.canvasKey,
        payload: {
          canvas: prior.canvasKey,
          statementCount: Array.isArray(content.statementIds) ? content.statementIds.length : null
        }
      }).catch(() => {
      });
    }
    void maybeKickoffAnalyse(user.id, next);
    res.json(next);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    res.status(500).json({ error: "advance_failed", message });
  }
});
router9.get("/api/sub-step/:id/checklist", async (req, res) => {
  const user = req.user;
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid_id" });
  const [sub] = await db.select().from(subSteps).where(and15(eq19(subSteps.id, id), eq19(subSteps.userId, user.id))).limit(1);
  if (!sub) return res.status(404).json({ error: "not_found" });
  try {
    const checklist = await deriveChecklist(user.id, sub);
    res.json(checklist);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    res.status(500).json({ error: "checklist_failed", message });
  }
});
var skipBodySchema = z9.object({
  itemKey: z9.string().min(1),
  itemLabel: z9.string().min(1),
  // Reason is optional — the user may skip without giving one. We record the
  // absence so the audit trail still shows the explicit choice.
  reason: z9.string().max(500).optional()
});
router9.post("/api/sub-step/:id/skip", async (req, res) => {
  const user = req.user;
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid_id" });
  const parsed = skipBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_input", detail: parsed.error.flatten() });
  }
  const [sub] = await db.select().from(subSteps).where(and15(eq19(subSteps.id, id), eq19(subSteps.userId, user.id))).limit(1);
  if (!sub) return res.status(404).json({ error: "not_found" });
  const reason = parsed.data.reason?.trim() || null;
  await writeNote({
    userId: user.id,
    kind: "skipped_gap",
    category: parsed.data.itemKey,
    label: `Skipped: ${parsed.data.itemLabel}`,
    body: reason,
    sourceKind: "user_stated",
    sourceCanvas: sub.canvasKey,
    sourceSubStepId: sub.id,
    attributes: { skippedWithoutReason: reason === null }
  });
  audit({
    req,
    action: "sub_step.checklist_skip",
    resourceType: "sub_step",
    resourceId: String(id),
    detail: { itemKey: parsed.data.itemKey, reason: reason ?? "(none given)" }
  });
  res.json({ ok: true });
});
var discussTopicSchema = z9.object({
  itemKey: z9.string().min(1),
  itemLabel: z9.string().optional()
});
router9.post("/api/sub-step/:id/discuss-topic", async (req, res) => {
  const user = req.user;
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid_id" });
  const parsed = discussTopicSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_input", detail: parsed.error.flatten() });
  }
  const [sub] = await db.select().from(subSteps).where(and15(eq19(subSteps.id, id), eq19(subSteps.userId, user.id))).limit(1);
  if (!sub) return res.status(404).json({ error: "not_found" });
  await onStateChange({
    userId: user.id,
    trigger: "topic_initiated",
    subStepId: sub.id,
    canvas: sub.canvasKey,
    payload: {
      canvas: sub.canvasKey,
      itemKey: parsed.data.itemKey,
      itemLabel: parsed.data.itemLabel
    }
  });
  audit({
    req,
    action: "sub_step.checklist_topic_initiated",
    resourceType: "sub_step",
    resourceId: String(id),
    detail: { itemKey: parsed.data.itemKey }
  });
  res.json({ ok: true });
});
router9.post("/api/sub-step/:id/agree", async (req, res) => {
  const user = req.user;
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid_id" });
  try {
    const live = await agreeSubStep(user.id, id);
    if (live.canvasKey === "picture") {
      await db.update(conversations).set({ status: "complete", completedAt: /* @__PURE__ */ new Date(), updatedAt: /* @__PURE__ */ new Date() }).where(and15(eq19(conversations.userId, user.id), eq19(conversations.status, "active")));
    } else if (live.canvasKey === "analysis") {
      const content = live.contentJson ?? {};
      if (content.draftId) {
        await db.update(analysisDrafts).set({ status: "agreed", agreedAt: /* @__PURE__ */ new Date() }).where(
          and15(eq19(analysisDrafts.id, content.draftId), eq19(analysisDrafts.userId, user.id))
        );
      }
    }
    audit({
      req,
      action: "sub_step.agree",
      resourceType: "sub_step",
      resourceId: String(id)
    });
    {
      const content = live.contentJson ?? {};
      onStateChange({
        userId: user.id,
        trigger: "discuss_agreed",
        subStepId: id,
        canvas: live.canvasKey,
        payload: {
          canvas: live.canvasKey,
          analysisId: content.analysisId ?? null,
          draftId: content.draftId ?? null
        }
      }).catch(() => {
      });
    }
    if (live.canvasKey === "picture") {
      await startCanvas2ForUser(user.id).catch((err) => {
        console.error("[sub_step.agree] startCanvas2 failed:", err);
      });
    }
    res.json(live);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    res.status(500).json({ error: "agree_failed", message });
  }
});
router9.post("/api/sub-step/:id/reopen", async (req, res) => {
  const user = req.user;
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid_id" });
  try {
    const discuss = await reopenSubStep(user.id, id);
    await db.update(conversations).set({ status: "active", completedAt: null, updatedAt: /* @__PURE__ */ new Date() }).where(eq19(conversations.userId, user.id));
    audit({
      req,
      action: "sub_step.reopen",
      resourceType: "sub_step",
      resourceId: String(id)
    });
    onStateChange({
      userId: user.id,
      trigger: "live_reopened",
      subStepId: id,
      canvas: discuss.canvasKey,
      payload: { canvas: discuss.canvasKey }
    }).catch(() => {
    });
    res.json(discuss);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    res.status(500).json({ error: "reopen_failed", message });
  }
});
router9.post("/api/sub-step/:id/retry", async (req, res) => {
  const user = req.user;
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid_id" });
  await clearAnalyseError(user.id, id);
  audit({ req, action: "sub_step.retry", resourceType: "sub_step", resourceId: String(id) });
  const [fresh] = await db.select().from(subSteps).where(eq19(subSteps.id, id)).limit(1);
  if (fresh) void maybeKickoffAnalyse(user.id, fresh);
  res.json({ ok: true });
});
var messageBodySchema3 = z9.object({
  content: z9.string().min(1).max(5e3)
});
router9.post("/api/sub-step/:id/message", async (req, res) => {
  const user = req.user;
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid_id" });
  const parsed = messageBodySchema3.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_input", detail: parsed.error.flatten() });
  }
  const [sub] = await db.select().from(subSteps).where(and15(eq19(subSteps.id, id), eq19(subSteps.userId, user.id))).limit(1);
  if (!sub) return res.status(404).json({ error: "not_found" });
  if (sub.canvasKey !== "picture" || sub.beat !== "discuss") {
    return res.status(400).json({ error: "chat_not_supported_for_beat" });
  }
  const [userMsg] = await db.insert(subStepMessages).values({ subStepId: sub.id, role: "user", content: parsed.data.content }).returning();
  res.json({ subStep: sub, userMessage: userMsg });
});
async function loadMessages3(subStepId) {
  return db.select().from(subStepMessages).where(eq19(subStepMessages.subStepId, subStepId)).orderBy(asc4(subStepMessages.createdAt), asc4(subStepMessages.id));
}
async function runPictureAnalyse(userId, subStepId) {
  const [sub] = await db.select().from(subSteps).where(eq19(subSteps.id, subStepId)).limit(1);
  if (!sub || sub.beat !== "analyse" || sub.canvasKey !== "picture") return;
  const sts = await db.select().from(statements).where(and15(eq19(statements.userId, userId), eq19(statements.status, "extracted")));
  if (sts.length === 0) {
    await markAnalyseError(userId, subStepId, "no_statements");
    return;
  }
  const prompt = await getActivePrompt("analysis");
  if (!prompt) {
    await markAnalyseError(userId, subStepId, "no_active_analysis_prompt");
    return;
  }
  const [analysis] = await db.insert(analyses).values({
    userId,
    status: "analysing",
    promptVersionId: prompt.id,
    sourceStatementIds: sts.map((s) => s.id)
  }).returning();
  try {
    const { result, usage } = await analyseStatements({
      systemPrompt: prompt.content,
      model: prompt.model,
      statements: sts.map((s) => ({ filename: s.filename, extraction: s.extractionResult }))
    });
    await db.update(analyses).set({
      status: "done",
      result,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheCreationTokens: usage.cacheCreationTokens,
      completedAt: /* @__PURE__ */ new Date()
    }).where(eq19(analyses.id, analysis.id));
    await persistCanvas1Claims(analysis.id, result);
    await db.update(subSteps).set({
      contentJson: { analysisId: analysis.id },
      updatedAt: /* @__PURE__ */ new Date()
    }).where(eq19(subSteps.id, subStepId));
    onStateChange({
      userId,
      trigger: "analyse_completed",
      subStepId,
      canvas: "picture",
      payload: { canvas: "picture", analysisId: analysis.id }
    }).catch(() => {
    });
    await advanceSubStep(userId, subStepId, {
      contentJson: { analysisId: analysis.id }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    console.error("[runPictureAnalyse] failed:", err);
    await db.update(analyses).set({ status: "failed", errorMessage: message, completedAt: /* @__PURE__ */ new Date() }).where(eq19(analyses.id, analysis.id));
    await markAnalyseError(userId, subStepId, message);
  }
}
async function maybeKickoffAnalyse(userId, sub) {
  if (sub.beat !== "analyse" || sub.status !== "in_progress" || sub.errorMessage) return;
  const content = sub.contentJson ?? {};
  if (sub.canvasKey === "picture") {
    if (content.analysisId) return;
    const claimed = await tryClaimAnalyse(sub.id);
    if (!claimed) return;
    runPictureAnalyse(userId, sub.id).catch(async (err) => {
      console.error("[maybeKickoffAnalyse] picture failed:", err);
      await releaseAnalyseClaim(sub.id);
    });
    return;
  }
  if (sub.canvasKey === "analysis") {
    if (content.draftId) return;
    const claimed = await tryClaimAnalyse(sub.id);
    if (!claimed) return;
    runAnalysisAnalyse(userId, sub.id).catch(async (err) => {
      console.error("[maybeKickoffAnalyse] analysis failed:", err);
      await releaseAnalyseClaim(sub.id);
    });
    return;
  }
}
async function tryClaimAnalyse(subStepId) {
  const result = await db.execute(sql3`
    UPDATE sub_steps
    SET content_json = jsonb_set(
      coalesce(content_json, '{}'::jsonb),
      '{analyseRunning}',
      'true'::jsonb
    ),
    updated_at = NOW()
    WHERE id = ${subStepId}
      AND coalesce(content_json->>'analyseRunning', 'false') = 'false'
      AND content_json->>'analysisId' IS NULL
      AND content_json->>'draftId' IS NULL
    RETURNING id
  `);
  return (result.rowCount ?? 0) > 0;
}
async function releaseAnalyseClaim(subStepId) {
  await db.execute(sql3`
    UPDATE sub_steps
    SET content_json = (content_json - 'analyseRunning'),
        updated_at = NOW()
    WHERE id = ${subStepId}
  `);
}
async function startCanvas2ForUser(userId) {
  const [existing] = await db.select().from(subSteps).where(
    and15(
      eq19(subSteps.userId, userId),
      eq19(subSteps.canvasKey, "analysis"),
      isNull6(subSteps.supersededAt)
    )
  ).limit(1);
  if (existing) return;
  const [gather] = await db.insert(subSteps).values({
    userId,
    canvasKey: "analysis",
    beat: "gather",
    instance: 1,
    status: "in_progress",
    driver: "ally",
    contentJson: {}
  }).returning();
  const analyse = await advanceSubStep(userId, gather.id);
  runAnalysisAnalyse(userId, analyse.id).catch(
    (err) => console.error("[startCanvas2ForUser] runAnalysisAnalyse failed:", err)
  );
}
async function runAnalysisAnalyse(userId, subStepId) {
  const [sub] = await db.select().from(subSteps).where(eq19(subSteps.id, subStepId)).limit(1);
  if (!sub || sub.canvasKey !== "analysis" || sub.beat !== "analyse") return;
  const [factsPrompt, prosePrompt, panelsPrompt] = await Promise.all([
    getActivePrompt("analysis_facts"),
    getActivePrompt("analysis_prose"),
    getActivePrompt("analysis_panels")
  ]);
  if (!factsPrompt || !prosePrompt || !panelsPrompt) {
    await markAnalyseError(userId, subStepId, "no_active_analysis_prompts");
    return;
  }
  const [c1Conversation] = await db.select().from(conversations).where(and15(eq19(conversations.userId, userId), eq19(conversations.status, "complete"))).orderBy(desc14(conversations.completedAt)).limit(1);
  if (!c1Conversation) {
    await markAnalyseError(userId, subStepId, "canvas_1_not_agreed");
    return;
  }
  const [c1Analysis] = await db.select().from(analyses).where(and15(eq19(analyses.userId, userId), eq19(analyses.status, "done"))).orderBy(desc14(analyses.createdAt)).limit(1);
  if (!c1Analysis) {
    await markAnalyseError(userId, subStepId, "no_canvas_1_analysis");
    return;
  }
  const userStatements = await db.select().from(statements).where(eq19(statements.userId, userId));
  const [draft] = await db.insert(analysisDrafts).values({
    userId,
    sourceConversationId: c1Conversation.id,
    sourceAnalysisId: c1Analysis.id,
    status: "thinking"
  }).returning();
  try {
    const out = await buildAnalysisDraft({
      prompts: {
        facts: { id: factsPrompt.id, content: factsPrompt.content, model: factsPrompt.model },
        prose: { id: prosePrompt.id, content: prosePrompt.content, model: prosePrompt.model },
        panels: { id: panelsPrompt.id, content: panelsPrompt.content, model: panelsPrompt.model }
      },
      firstTakeAnalysis: c1Analysis.result,
      conversationProfile: c1Conversation.profile,
      flaggedIssues: c1Conversation.flaggedIssues ?? [],
      statementSummaries: summariseStatements4(userStatements)
    });
    await db.update(analysisDrafts).set({
      status: "ready",
      facts: out.facts,
      prose: out.prose,
      panels: out.panels,
      inputTokens: out.usage.inputTokens,
      outputTokens: out.usage.outputTokens,
      cacheReadTokens: out.usage.cacheReadTokens,
      cacheCreationTokens: out.usage.cacheCreationTokens,
      promptVersionIds: out.promptVersionIds,
      generatedAt: /* @__PURE__ */ new Date()
    }).where(eq19(analysisDrafts.id, draft.id));
    if (out.claims.length > 0) {
      await db.insert(analysisClaims).values(
        out.claims.map((c) => ({
          draftId: draft.id,
          kind: c.kind,
          anchorId: c.anchorId,
          label: c.label,
          category: c.category,
          body: c.body,
          evidenceRefs: c.evidenceRefs
        }))
      );
    }
    const inlined = new Set(out.claims.filter((c) => c.kind === "note").map((c) => c.anchorId));
    const extraNotes = out.notes.filter((n) => !inlined.has(n.anchorId));
    if (extraNotes.length > 0) {
      await db.insert(analysisClaims).values(
        extraNotes.map((n) => ({
          draftId: draft.id,
          kind: "note",
          anchorId: n.anchorId,
          label: n.label,
          category: n.category,
          body: n.body,
          evidenceRefs: n.evidenceRefs
        }))
      );
    }
    await db.update(subSteps).set({
      contentJson: { draftId: draft.id, analysisId: c1Analysis.id },
      updatedAt: /* @__PURE__ */ new Date()
    }).where(eq19(subSteps.id, subStepId));
    onStateChange({
      userId,
      trigger: "analyse_completed",
      subStepId,
      canvas: "analysis",
      payload: {
        canvas: "analysis",
        draftId: draft.id,
        analysisId: c1Analysis.id,
        claimsCount: out.claims.length
      }
    }).catch(() => {
    });
    await advanceSubStep(userId, subStepId, {
      contentJson: { draftId: draft.id, analysisId: c1Analysis.id }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    console.error("[runAnalysisAnalyse] failed:", err);
    await db.update(analysisDrafts).set({ status: "failed", errorMessage: message }).where(eq19(analysisDrafts.id, draft.id));
    await markAnalyseError(userId, subStepId, message);
  }
}
function summariseStatements4(rows) {
  return rows.map((s) => {
    const r = s.extractionResult ?? null;
    return {
      filename: s.filename,
      bankName: r?.bankName ?? null,
      periodStart: r?.statementPeriodStart ?? null,
      periodEnd: r?.statementPeriodEnd ?? null,
      transactionCount: Array.isArray(r?.transactions) ? r.transactions.length : null
    };
  });
}
async function persistCanvas1Claims(analysisId, result) {
  const r = result;
  const claims = r.explainClaims ?? [];
  if (claims.length === 0) return;
  const phraseByAnchor = /* @__PURE__ */ new Map();
  for (const a of r.lifeSnapshotAnnotations ?? []) phraseByAnchor.set(a.anchorId, a.phrase);
  for (const a of r.income?.summaryAnnotations ?? []) phraseByAnchor.set(a.anchorId, a.phrase);
  for (const a of r.spending?.summaryAnnotations ?? []) phraseByAnchor.set(a.anchorId, a.phrase);
  for (const a of r.savings?.summaryAnnotations ?? []) phraseByAnchor.set(a.anchorId, a.phrase);
  await db.insert(analysisClaims).values(
    claims.map((c) => ({
      analysisId,
      kind: "explain",
      anchorId: c.anchorId,
      label: phraseByAnchor.get(c.anchorId) ?? c.label,
      body: c.body,
      evidenceRefs: { refs: c.evidenceRefs, chartKind: c.chartKind }
    }))
  );
}
var subStep_default = router9;

// server/routes/record.ts
import { Router as Router10 } from "express";
import { z as z10 } from "zod";
var router10 = Router10();
router10.use(isAuthenticated);
router10.get("/api/record", async (req, res) => {
  const user = req.user;
  try {
    const root = await ensureRecord(user.id);
    const [segments, notes] = await Promise.all([
      listSegments(user.id),
      listNotes({ userId: user.id, limit: 50 })
    ]);
    res.json({ record: root, segments, notes });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    res.status(500).json({ error: "record_load_failed", message });
  }
});
var listNotesQuery = z10.object({
  segmentId: z10.coerce.number().optional(),
  category: z10.string().optional(),
  kind: z10.string().optional(),
  limit: z10.coerce.number().min(1).max(500).optional()
});
router10.get("/api/record/notes", async (req, res) => {
  const user = req.user;
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
      limit: parsed.data.limit
    });
    res.json(notes);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    res.status(500).json({ error: "notes_load_failed", message });
  }
});
router10.get("/api/record/segments", async (req, res) => {
  const user = req.user;
  try {
    const segments = await listSegments(user.id);
    res.json(segments);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    res.status(500).json({ error: "segments_load_failed", message });
  }
});
var writeNoteBody = z10.object({
  category: z10.string().optional(),
  tags: z10.array(z10.string()).optional(),
  kind: z10.string().min(1),
  label: z10.string().min(1).max(200),
  body: z10.string().max(1e4).optional(),
  evidenceRefs: z10.unknown().optional(),
  attributes: z10.unknown().optional(),
  confidence: z10.number().min(0).max(1).optional(),
  sourceCanvas: z10.string().optional(),
  sourceSubStepId: z10.number().optional(),
  sourceMessageId: z10.number().optional(),
  segmentIds: z10.array(z10.number()).optional()
});
router10.post("/api/record/notes", async (req, res) => {
  const user = req.user;
  const parsed = writeNoteBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_input", detail: parsed.error.flatten() });
  }
  try {
    const note = await writeNote({
      userId: user.id,
      sourceKind: "user_stated",
      ...parsed.data
    });
    audit({ req, action: "record.note.create", resourceType: "record_note", resourceId: String(note.id) });
    res.json(note);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    res.status(500).json({ error: "note_create_failed", message });
  }
});
router10.patch("/api/record/notes/:id/supersede", async (req, res) => {
  const user = req.user;
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
      ...parsed.data
    });
    audit({
      req,
      action: "record.note.supersede",
      resourceType: "record_note",
      resourceId: String(id),
      detail: { newId: note.id }
    });
    res.json(note);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    res.status(500).json({ error: "note_supersede_failed", message });
  }
});
router10.post("/api/record/notes/:id/delete", async (req, res) => {
  const user = req.user;
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid_id" });
  try {
    await softDeleteNote(user.id, id);
    audit({
      req,
      action: "record.note.soft_delete",
      resourceType: "record_note",
      resourceId: String(id)
    });
    res.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    res.status(500).json({ error: "note_delete_failed", message });
  }
});
var record_default = router10;

// server/routes/tips.ts
import { Router as Router11 } from "express";

// server/modules/tips/index.ts
var TEMPLATES = {
  retirement: (n) => ({
    title: "About your retirement",
    body: `You mentioned: "${n.label}". Worth knowing \u2014 even a 1% bump in your contribution rate, started today, can change the picture by tens of thousands by the time you're 60. Compound interest doesn't care about effort, only time.`
  }),
  debt: (n) => ({
    title: "About your debt",
    body: `You said: "${n.label}". When you're ready to look at this, the trick most people miss is paying the highest-interest one first, not the biggest. Counterintuitive, but it costs you less over a year.`
  }),
  property: (n) => ({
    title: "About your bond",
    body: `You mentioned the bond. One small thing worth knowing \u2014 paying just R500 extra a month off the principal can take years off the bond and save more interest than you'd think. Worth a check sometime.`
  }),
  goals: (n) => ({
    title: "Holding your goal",
    body: `You said: "${n.label}". I'm holding this. When we get to the analysis, I'll show you what the numbers say about how reachable it is. No judgement \u2014 just clarity.`
  }),
  medicalCover: () => ({
    title: "Medical cover",
    body: `You shared where you are with medical aid. Quietly important \u2014 one hospital admission without cover can wipe out years of savings. We'll come back to this when we look at protection.`
  }),
  lifeCover: () => ({
    title: "Life cover",
    body: `You shared where you are with life cover. The honest test isn't 'do I have it' \u2014 it's 'would the people who depend on me be okay if I weren't here'. We'll work that out together.`
  }),
  otherAccounts: () => ({
    title: "Other accounts",
    body: `You mentioned accounts beyond what's in the statements. I've noted them \u2014 when we get to the analysis I'll factor them in so the picture is whole, not just what the bank shows.`
  })
};
async function getTipsForUser(userId) {
  const notes = await listNotes({ userId, limit: 100 });
  const tips = [];
  const seenCategories = /* @__PURE__ */ new Set();
  for (const n of notes) {
    if (!n.category || seenCategories.has(n.category)) continue;
    const tpl = TEMPLATES[n.category];
    if (!tpl) continue;
    const out = tpl({ label: n.label, body: n.body });
    tips.push({
      id: `tip_${n.category}_${n.id}`,
      title: out.title,
      body: out.body,
      source: "personal"
    });
    seenCategories.add(n.category);
    if (tips.length >= 6) break;
  }
  return tips;
}

// server/routes/tips.ts
var router11 = Router11();
router11.use(isAuthenticated);
router11.get("/api/tips", async (req, res) => {
  const user = req.user;
  try {
    const tips = await getTipsForUser(user.id);
    res.json(tips);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    res.status(500).json({ error: "tips_failed", message });
  }
});
var tips_default = router11;

// server/routes/index.ts
function registerRoutes(app2) {
  app2.use(auth_default);
  app2.use("/api/admin", admin_default);
  app2.use("/api/admin", prompts_default);
  app2.use(statements_default);
  app2.use(analysis_default);
  app2.use(qa_default);
  app2.use(analysisDraft_default);
  app2.use(analysisConversation_default);
  app2.use(subStep_default);
  app2.use(record_default);
  app2.use(tips_default);
}

// server/api.ts
var app = express();
app.set("trust proxy", 1);
app.use(helmet());
app.use(
  cors({
    origin: [process.env.PUBLIC_URL ?? ""],
    credentials: true
  })
);
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(
  "/api",
  rateLimit({ windowMs: 15 * 60 * 1e3, limit: 200, standardHeaders: true, legacyHeaders: false })
);
setupAuth(app);
registerRoutes(app);
app.use((err, _req, res, _next) => {
  console.error("[api] error:", err);
  res.status(500).json({ error: "internal_error" });
});
var api_default = app;
export {
  api_default as default
};
