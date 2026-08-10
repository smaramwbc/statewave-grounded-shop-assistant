import "dotenv/config";
import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import chatRoutes from "./routes/chat.js";
import opsRoutes from "./routes/ops.js";
import { completionMode } from "./completion.js";
import { store } from "./store.js"; // triggers first-boot ingestion if needed

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const PORT = process.env.PORT || 4000;

const app = express();

// Only trust X-Forwarded-For when this process actually sits behind a proxy
// (set TRUST_PROXY=1 in that deployment's env). Trusting it unconditionally
// would let any client spoof the header and dodge the per-IP rate limiter;
// not trusting it when there IS a proxy in front collapses every visitor
// onto the proxy's IP and rate-limits them as one client.
if (process.env.TRUST_PROXY) {
  app.set("trust proxy", process.env.TRUST_PROXY === "1" ? 1 : process.env.TRUST_PROXY);
}

app.use(express.json());

app.use(chatRoutes);
app.use(opsRoutes);

// Serve the widget package's compiled browser JS as static ES modules — the
// widget itself is TypeScript, but a browser can only load plain JS, so
// `predev`/`prestart` compile it to dist/ first (see package.json).
app.use("/vendor/chat-widget", express.static(join(ROOT, "packages", "chat-widget", "dist")));

app.use(express.static(join(ROOT, "public")));

app.get("/healthz", (req, res) => res.json({ ok: true, completionMode }));

const server = app.listen(PORT, () => {
  console.log(`\nGreenHaven grounded shop assistant demo running:`);
  console.log(`  Storefront:  http://localhost:${PORT}/`);
  console.log(`  Ops console: http://localhost:${PORT}/ops.html`);
  console.log(`  Completion mode: ${completionMode}${completionMode === "offline-rule-based" ? " (set OPENROUTER_API_KEY or LITELLM_BASE_URL in .env for real generation)" : ""}`);
  if (!process.env.OPS_API_KEY) {
    console.warn(
      "  WARNING: OPS_API_KEY is not set — /api/ops/* is UNAUTHENTICATED. " +
        "Fine for a local demo, set OPS_API_KEY before exposing this beyond localhost."
    );
  } else {
    console.log("  Ops routes: authenticated (OPS_API_KEY set)");
  }
  if (!process.env.TRUST_PROXY) {
    console.log("  Trust proxy: off (set TRUST_PROXY=1 if this runs behind a reverse proxy/load balancer)\n");
  } else {
    console.log("");
  }
});

// Flush any debounced db.json write before the process actually exits, so a
// deploy/restart can't drop the last few seconds of episodes.
function shutdown(signal: string): void {
  console.log(`\n${signal} received, flushing store and shutting down…`);
  store.flush();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
