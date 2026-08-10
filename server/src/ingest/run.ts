import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { StatewaveStore } from "statewave-core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "..", "data");
const DB_PATH = join(DATA_DIR, "db.json");

interface CatalogProduct {
  id: string;
  name: string;
  category: string;
  price: number;
  currency: string;
  stock: number;
  shipsInDays: number;
  light?: string;
  description: string;
  careNotes: string;
}

interface ServiceContentDoc {
  id: string;
  title: string;
  text: string;
}

export interface RunIngestionOptions {
  store?: StatewaveStore;
}

export interface IngestionResult {
  store: StatewaveStore;
  productsIngested: number;
  serviceIngested: number;
  totalProducts: number;
  totalServiceDocs: number;
}

/**
 * Periodic ingestion job: read the catalog DB + curated service content,
 * build one clean fact text per row, and ingest as Episodes. Content-hash
 * idempotency (built into StatewaveStore) makes this safe to re-run nightly —
 * unchanged rows are deduped, not duplicated.
 */
export function runIngestion({ store }: RunIngestionOptions = {}): IngestionResult {
  const s = store || new StatewaveStore({ persistPath: DB_PATH });

  const catalog: CatalogProduct[] = JSON.parse(readFileSync(join(DATA_DIR, "catalog.json"), "utf-8"));
  let productsIngested = 0;
  for (const p of catalog) {
    const stockLine = p.stock > 0 ? `In stock (${p.stock} available), ships in ~${p.shipsInDays} days.` : `Currently out of stock. ${p.careNotes}`;
    const text = [
      `Product: ${p.name} (${p.category}).`,
      `Price: $${p.price.toFixed(2)} ${p.currency}.`,
      p.light ? `Light requirement: ${p.light}.` : null,
      p.description,
      stockLine,
      p.light ? null : `Care notes: ${p.careNotes}`,
    ]
      .filter(Boolean)
      .join(" ");

    const { deduped } = s.createEpisode({
      subject: "shop:products",
      sourceId: p.id,
      text,
      metadata: { label: p.name, category: p.category, price: p.price },
    });
    if (!deduped) productsIngested++;
  }

  const serviceContent: ServiceContentDoc[] = JSON.parse(
    readFileSync(join(DATA_DIR, "service-content.json"), "utf-8")
  );
  let serviceIngested = 0;
  for (const doc of serviceContent) {
    const subject = doc.id.startsWith("guide-") ? "content:guides" : "faq:service";
    const { deduped } = s.createEpisode({
      subject,
      sourceId: doc.id,
      text: `${doc.title}: ${doc.text}`,
      metadata: { label: doc.title },
    });
    if (!deduped) serviceIngested++;
  }

  return { store: s, productsIngested, serviceIngested, totalProducts: catalog.length, totalServiceDocs: serviceContent.length };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const result = runIngestion();
  console.log(
    `Ingested ${result.productsIngested}/${result.totalProducts} product episodes, ` +
      `${result.serviceIngested}/${result.totalServiceDocs} service/guide episodes ` +
      `(remainder deduped — already up to date). DB: ${DB_PATH}`
  );
}
