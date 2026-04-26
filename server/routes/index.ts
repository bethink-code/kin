import type { Express } from "express";
import authRouter from "./auth";
import adminRouter from "./admin";
import statementsRouter from "./statements";
import promptsRouter from "./prompts";
import analysisRouter from "./analysis";
import qaRouter from "./qa";
import analysisDraftRouter from "./analysisDraft";
import analysisConversationRouter from "./analysisConversation";
import subStepRouter from "./subStep";
import recordRouter from "./record";
import tipsRouter from "./tips";

export function registerRoutes(app: Express) {
  app.use(authRouter);
  // Admin routers are mounted under /api/admin so their blanket isAdmin
  // middleware only applies to admin paths — NEVER mount these without a prefix.
  app.use("/api/admin", adminRouter);
  app.use("/api/admin", promptsRouter);
  app.use(statementsRouter);
  app.use(analysisRouter);
  app.use(qaRouter);
  // Canvas 2 — draft lifecycle + refining conversation.
  app.use(analysisDraftRouter);
  app.use(analysisConversationRouter);
  // Universal sub-step primitive (Slice 1 of the architecture rewrite).
  app.use(subStepRouter);
  // Record of conversation — long-term audit + memory layer (Slice 3).
  app.use(recordRouter);
  // Personalised tips for wait-state rotators.
  app.use(tipsRouter);
}
