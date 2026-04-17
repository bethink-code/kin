import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { setupAuth } from "./auth";
import { registerRoutes } from "./routes";

const app = express();
app.set("trust proxy", 1);

app.use(helmet());

app.use(
  cors({
    origin: [process.env.PUBLIC_URL ?? ""],
    credentials: true,
  })
);

app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(
  "/api",
  rateLimit({ windowMs: 15 * 60 * 1000, limit: 200, standardHeaders: true, legacyHeaders: false })
);

setupAuth(app);
registerRoutes(app);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[api] error:", err);
  res.status(500).json({ error: "internal_error" });
});

export default app;
