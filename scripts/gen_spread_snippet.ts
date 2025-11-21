import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

type SpreadOverride = {
  asset: string;
  bps?: number;
  bidBps?: number;
  askBps?: number;
  reason?: string;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const overridesPath = path.join(__dirname, "..", "spread_overrides.json");

function loadOverrides(): SpreadOverride[] {
  if (!fs.existsSync(overridesPath)) {
    return [];
  }
  return JSON.parse(fs.readFileSync(overridesPath, "utf8"));
}

function formatOverride(o: SpreadOverride): string {
  const parts: string[] = [];
  if (typeof o.bps === "number") parts.push(`bps=${o.bps}`);
  if (typeof o.bidBps === "number") parts.push(`bid=${o.bidBps}`);
  if (typeof o.askBps === "number") parts.push(`ask=${o.askBps}`);
  if (o.reason) parts.push(`reason=${o.reason}`);
  const summary = parts.length ? parts.join(", ") : "(no values)";
  return `${o.asset}: ${summary}`;
}

function main() {
  const overrides = loadOverrides();
  if (!overrides.length) {
    process.stdout.write("No spread overrides found.\n");
    return;
  }
  const lines = overrides
    .sort((a, b) => a.asset.localeCompare(b.asset))
    .map(formatOverride);
  process.stdout.write(["📊 Spread Overrides", "", ...lines].join("\n"));
}

main();
