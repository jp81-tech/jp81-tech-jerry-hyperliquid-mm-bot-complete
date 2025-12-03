import fs from "fs";
import path from "path";

export type LiquidityRisk =
    | "safe"
    | "moderate"
    | "risky"
    | "critical"
    | "rug"
    | "RUG_DETECTED"
    | "CRITICAL"
    | string;

export interface LiquidityFlag {
    risk: LiquidityRisk;
    updated_at: string;
}

export type LiquidityFlagMap = Record<string, LiquidityFlag>;

// Path relative to project root where bot runs
const DEFAULT_FLAGS_PATH = path.join(process.cwd(), 'scripts/liquidity_monitor/liquidity_flags.json');
const FLAGS_PATH = process.env.LIQ_FLAGS_PATH || DEFAULT_FLAGS_PATH;

export function loadLiquidityFlags(): LiquidityFlagMap {
    try {
        if (!fs.existsSync(FLAGS_PATH)) return {};
        const raw = fs.readFileSync(FLAGS_PATH, "utf8");
        const data = JSON.parse(raw) as LiquidityFlagMap;
        return data;
    } catch (e) {
        return {};
    }
}

export function isPairBlockedByLiquidity(
    symbol: string,
    flags: LiquidityFlagMap
): boolean {
    const flag = flags[symbol];
    if (!flag) return false;

    const risk = String(flag.risk).toUpperCase();

    // Block only on CRITICAL or RUG
    if (risk.includes("RUG") || risk.includes("CRITICAL")) return true;

    return false;
}

