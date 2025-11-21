// src/utils/clipSizing.ts
import { riskConfig } from "./riskConfig";

export type ClipContext = {
  pair: string;
  midPx: number;
  vol24h: number;
};

export function computeClipUsd(ctx: ClipContext): number {
  const { dynamicClip, clipMinUsd, clipMaxUsd, clipVolFactor } = riskConfig;

  if (!dynamicClip) {
    return clipMaxUsd;
  }

  const vol = Math.max(ctx.vol24h, 0.1);
  const volPenalty = 1 + clipVolFactor * (vol / 10);
  const raw = clipMaxUsd / volPenalty;

  return Math.max(clipMinUsd, Math.min(clipMaxUsd, raw));
}
