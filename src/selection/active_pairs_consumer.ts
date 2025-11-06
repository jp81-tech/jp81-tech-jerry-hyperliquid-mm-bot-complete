// src/selection/active_pairs_consumer.ts
import fs from "fs";
import path from "path";

export type ActivePairsFile = {
  pairs: string[];
  scores?: Record<string, number>;
  metrics?: Record<string, unknown>;
  updatedAt?: string;
};

export type ActivePairsOptions = {
  filePath?: string;             // default: runtime/active_pairs.json
  staleSec?: number;             // default: 900 (15m)
  allowlist?: Set<string>;       // optional filter
  minCount?: number;             // default: 1
  maxCount?: number;             // guardrail
};

const DEFAULT_PATH = "runtime/active_pairs.json";

export function loadActivePairs(opts: ActivePairsOptions = {}): {
  ok: boolean;
  reason?: string;
  pairs: string[];
  updatedAt?: string;
} {
  const filePath = opts.filePath ?? DEFAULT_PATH;
  const staleSec = opts.staleSec ?? 900;
  const minCount = Math.max(1, opts.minCount ?? 1);

  try {
    const stat = fs.statSync(filePath);
    const ageSec = (Date.now() - stat.mtimeMs) / 1000;
    if (ageSec > staleSec) {
      return { ok: false, reason: `stale(${Math.round(ageSec)}s)`, pairs: [] };
    }

    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as ActivePairsFile;
    if (!parsed || !Array.isArray(parsed.pairs)) {
      return { ok: false, reason: "schema", pairs: [] };
    }

    let pairs = parsed.pairs.filter(Boolean).map((s) => String(s).trim().toUpperCase());
    if (opts.allowlist && opts.allowlist.size) {
      pairs = pairs.filter((p) => opts.allowlist!.has(p));
      if (pairs.length === 0) return { ok: false, reason: "allowlist", pairs: [] };
    }

    // de-dupe & sanity size
    pairs = Array.from(new Set(pairs));
    const maxCount = opts.maxCount ?? 10;
    if (pairs.length > maxCount) pairs = pairs.slice(0, maxCount);
    if (pairs.length < minCount) return { ok: false, reason: "minCount", pairs: [] };

    return { ok: true, pairs, updatedAt: parsed.updatedAt };
  } catch (e: any) {
    if (e?.code === "ENOENT") return { ok: false, reason: "missing", pairs: [] };
    return { ok: false, reason: "error", pairs: [] };
  }
}
