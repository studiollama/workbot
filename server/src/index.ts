import "dotenv/config";
import express from "express";
import session from "express-session";
import cors from "cors";
import authRoutes from "./routes/auth.js";
import codexRoutes from "./routes/codex.js";
import servicesRoutes from "./routes/services.js";
import mcpRoutes from "./routes/mcp.js";

declare module "express-session" {
  interface SessionData {
    apiKey?: string;
    chatgptAuth?: boolean;
    org?: string | null;
    [key: `svc_${string}`]: { token: string; user: string } | undefined;
  }
}

const app = express();
const PORT = parseInt(process.env.PORT ?? "3001", 10);

app.use(cors({ origin: "http://localhost:5173", credentials: true }));
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET ?? "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false, // dev only — set true behind HTTPS in prod
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // 24h
    },
  })
);

app.use("/api/auth", authRoutes);
app.use("/api/codex", codexRoutes);
app.use("/api/services", servicesRoutes);
app.use("/api/mcp", mcpRoutes);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
