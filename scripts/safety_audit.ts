import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type ViolationType = "MISSING_FLOOR" | "INVALID_FLOOR_VALUE" | "BID_GE_ASK";

type Violation = {
  asset: string;
  type: ViolationType;
  details: string;
};

type AssetEntry = {
  floorBidBps?: number;
  floorAskBps?: number;
  [key: string]: any;
};

function loadSpreadConfig(): any {
  const configPath = path.join(__dirname, "..", "spread_config.json");
  const raw = fs.readFileSync(configPath, "utf8");
  return JSON.parse(raw);
}

function collectAssets(cfg: any): [string, AssetEntry][] {
  if (!cfg || typeof cfg !== "object") {
    return [];
  }

  if (cfg.assets && typeof cfg.assets === "object") {
    return Object.entries(cfg.assets) as [string, AssetEntry][];
  }

  return Object.entries(cfg) as [string, AssetEntry][];
}

function auditFloors(cfg: any): Violation[] {
  const violations: Violation[] = [];
  const entries = collectAssets(cfg);
  entries.sort(([a], [b]) => a.localeCompare(b));

  for (const [asset, entry] of entries) {
    if (!entry || typeof entry !== "object") continue;

    const bid = entry.floorBidBps;
    const ask = entry.floorAskBps;

    if (bid == null || ask == null) {
      violations.push({
        asset,
        type: "MISSING_FLOOR",
        details: `floorBidBps=${bid ?? "null"} floorAskBps=${ask ?? "null"}`,
      });
      continue;
    }

    if (typeof bid !== "number" || typeof ask !== "number") {
      violations.push({
        asset,
        type: "INVALID_FLOOR_VALUE",
        details: `floorBidBps=${String(bid)} floorAskBps=${String(ask)} (expected numbers)`,
      });
      continue;
    }

    if (bid <= 0 || ask <= 0) {
      violations.push({
        asset,
        type: "INVALID_FLOOR_VALUE",
        details: `floorBidBps=${bid} floorAskBps=${ask} (expected > 0)`,
      });
    }

    if (bid >= ask) {
      violations.push({
        asset,
        type: "BID_GE_ASK",
        details: `floorBidBps=${bid} >= floorAskBps=${ask}`,
      });
    }
  }

  return violations;
}

function formatReport(violations: Violation[]): string {
  const today = new Date().toISOString().slice(0, 10);

  if (violations.length === 0) {
    return [
      `🟢 Safety Audit — ${today}`,
      "",
      "Brak naruszeń / problemów z floorami w spread_config.json.",
    ].join("\n");
  }

  const lines: string[] = [];
  lines.push(`🚨 SAFETY AUDIT — ${today}`);
  lines.push("");
  lines.push("Wykryte problemy z floorami w spread_config.json:");
  lines.push("");

  for (const v of violations) {
    lines.push(v.asset);
    lines.push(`  [${v.type}] ${v.details}`);
    lines.push("");
  }

  return lines.join("\n");
}

function main() {
  try {
    const cfg = loadSpreadConfig();
    const violations = auditFloors(cfg);
    const report = formatReport(violations);
    process.stdout.write(report);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stdout.write(`🚨 SAFETY AUDIT ERROR\n${msg}\n`);
    process.exitCode = 1;
  }
}

main();

