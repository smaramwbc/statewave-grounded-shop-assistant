import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { StatewaveStore } from "statewave-core";
import { runIngestion } from "./ingest/run.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, "..", "data", "db.json");

const store = new StatewaveStore({ persistPath: DB_PATH });

// First boot / empty DB: run the ingestion job automatically so `npm run dev`
// works with zero setup steps. On subsequent boots this is a no-op (deduped).
if (store.compileSubject("shop:products").length === 0) {
  runIngestion({ store });
}

export { store, DB_PATH };
