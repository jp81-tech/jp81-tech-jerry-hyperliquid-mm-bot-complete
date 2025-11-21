import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

type SpreadOverride = {
  asset: string;
  bps?: number;
  bidBps?: number;
  askBps?: number;
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

function groupByAsset(overrides: SpreadOverride[]): Record<string, number[]> {
  const byAsset: Record<string, number[]> = {};
  for (const o of overrides) {
    const asset = o.asset;
    if (!asset) continue;
    if (!byAsset[asset]) byAsset[asset] = [];

    const values: number[] = [];
    if (typeof o.bps === "number") values.push(o.bps);
    if (typeof o.bidBps === "number") values.push(o.bidBps);
    if (typeof o.askBps === "number") values.push(o.askBps);

    for (const v of values) {
      byAsset[asset].push(v);
    }
  }
  return byAsset;
}

function formatRow(asset: string, values: number[]): string {
  if (!values.length) {
    return `${asset.padEnd(8)} |   n/a |   n/a |   n/a`;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const last = values[values.length - 1];
  return (
    `${asset.padEnd(8)} |` +
    ` ${min.toFixed(1).padStart(5)} |` +
    ` ${max.toFixed(1).padStart(5)} |` +
    ` ${last.toFixed(1).padStart(5)}`
  );
}

function main() {
  const overrides = loadOverrides();
  if (!overrides.length) {
    console.log("No spread overrides found.");
    return;
  }
  const grouped = groupByAsset(overrides);
  const headerLines = [
    "```text",
    "COIN     |   MIN |   MAX |  LAST",
    "---------+------+------+------",
  ];
  const rows = Object.entries(grouped)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([asset, values]) => formatRow(asset, values));
  const lines = [...headerLines, ...rows, "```"];
  process.stdout.write(lines.join("\n"));
}

main();



