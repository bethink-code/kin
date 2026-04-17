import type { Express } from "express";
import authRouter from "./auth";
import adminRouter from "./admin";
import statementsRouter from "./statements";
import promptsRouter from "./prompts";
import analysisRouter from "./analysis";

export function registerRoutes(app: Express) {
  app.use(authRouter);
  app.use(adminRouter);
  app.use(statementsRouter);
  app.use(promptsRouter);
  app.use(analysisRouter);
}
