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
  promptKey: text("prompt_key").notNull(), // extraction | analysis | qa | story
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
