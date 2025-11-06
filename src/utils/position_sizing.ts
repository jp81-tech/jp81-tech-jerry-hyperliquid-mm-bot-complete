export type KellyInput = {
  winProb: number;
  winRatio: number;
  bankrollUsd: number;
  maxFraction?: number;
};

export function kellyFraction(inp: KellyInput): number {
  const p = Math.min(0.999, Math.max(0.001, inp.winProb));
  const r = Math.max(0.01, inp.winRatio);
  const f = p - (1 - p) / r;
  const capped = Math.max(0, Math.min(inp.maxFraction ?? 0.2, f));
  return capped;
}

export function positionSizeUSD(inp: KellyInput): number {
  const f = kellyFraction(inp);
  return Math.max(50, Math.round(inp.bankrollUsd * f));
}
