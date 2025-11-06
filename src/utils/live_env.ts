import fs from "fs";

function readDotEnv(): string | undefined {
  try { return fs.readFileSync(".env", "utf8"); } catch { return undefined; }
}

export function getEnvNumber(name: string, def: number): number {
  const v = process.env[name];
  if (v !== undefined && v !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  const txt = readDotEnv();
  if (txt) {
    const m = txt.match(new RegExp(`^${name}=([^\\n\\r]+)`, "m"));
    if (m) {
      const n = Number(m[1].trim());
      if (Number.isFinite(n)) return n;
    }
  }
  return def;
}

export function getEnvPairCapUSD(pair: string, prefix: "PAIR_MAX_NOTIONAL_USD_" | "PAIR_MIN_NOTIONAL_USD_"): number | undefined {
  const key = `${prefix}${pair.toUpperCase()}`;
  const v = getEnvNumber(key, NaN);
  return Number.isFinite(v) ? v : undefined;
}
