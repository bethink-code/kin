import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { setupAuth } from "./auth";
import { registerRoutes } from "./routes";

const app = express();
app.set("trust proxy", 1);

const isProd = process.env.NODE_ENV === "production";

app.use(
  helmet({
    contentSecurityPolicy: isProd ? undefined : false,
  })
);

app.use(
  cors({
    origin: isProd
      ? [process.env.PUBLIC_URL ?? ""]
      : ["http://localhost:5000", "http://localhost:5173"],
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
  console.error("[server] error:", err);
  res.status(500).json({ error: isProd ? "internal_error" : err.message });
});

const port = Number(process.env.PORT ?? 5000);
app.listen(port, () => {
  console.log(`[server] listening on http://localhost:${port}`);
});
