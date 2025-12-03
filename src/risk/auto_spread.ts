
export type Trend = "bull" | "bear" | "neutral" | undefined;

export type AutoSideSpreadInputs = {
  baseSpreadBps: number;
  inventoryRatio: number; // -1..1
  trend4h?: Trend;
  trend15m?: Trend;
  isFlashCrash?: boolean;

  // NEW: Vision inputs
  visualTrend?: "up" | "down" | "sideways";
  visualScore?: number; // 0..100
  riskScore?: number;   // 0..10
  squeezeRisk?: boolean;
  breakoutRisk?: boolean;
};

export type AutoSideSpreadDebug = {
  invBidMult: number;
  invAskMult: number;
  trendBidMult: number;
  trendAskMult: number;
  flashMult: number;
  unclampedBid: number;
  unclampedAsk: number;
};

export type AutoSideSpreadResult = {
  bidSpreadBps: number;
  askSpreadBps: number;
  debug: AutoSideSpreadDebug;
};

export function computeSideAutoSpread(
  inputs: AutoSideSpreadInputs
): AutoSideSpreadResult {
  const {
    baseSpreadBps,
    inventoryRatio,
    trend4h,
    trend15m,
    isFlashCrash,
    visualTrend,
    visualScore = 50,
    riskScore = 0,
    squeezeRisk = false,
    breakoutRisk = false,
  } = inputs;

  // Bezpieczny bazowy spread (nie wchodź niżej 1/2 i wyżej 2×)
  const safeBase = Math.max(2, baseSpreadBps);

  // 1) Inventory – chcemy wyjść z pozycji, nie ją powiększać
  const invAbs = Math.min(1, Math.abs(inventoryRatio));
  let invBidMult = 1.0;
  let invAskMult = 1.0;

  if (invAbs > 0) {
    const invMax = 1.5; // max 50% szerzej po stronie niechcianej
    const extra = (invMax - 1) * invAbs;

    if (inventoryRatio > 0) {
      // long – nie chcemy więcej longów → szerzej bid, lekko ciaśniej ask
      invBidMult = 1 + extra;
      invAskMult = 1 - extra * 0.3;
    } else {
      // short – odwrotnie
      invAskMult = 1 + extra;
      invBidMult = 1 - extra * 0.3;
    }
  }

  // 2) Trend – chronimy stronę „pod wiatr”
  let trendBidMult = 1.0;
  let trendAskMult = 1.0;

  const alignedBull = trend4h === "bull" && trend15m === "bull";
  const alignedBear = trend4h === "bear" && trend15m === "bear";

  const trendExtra = 1.15; // +15% szerzej po stronie pod wiatr

  if (alignedBull) {
    trendAskMult *= trendExtra;
  } else if (alignedBear) {
    trendBidMult *= trendExtra;
  }

  // --- 2b) AI Vision asymetria ---
  // wzmocnij trendAskMult / trendBidMult wg AI
  if (visualTrend === "up") {
    // przy czystym, bullish obrazie i niskim ryzyku:
    const s = (visualScore - 50) / 50; // -1..1
    if (s > 0.3 && riskScore < 5) {
      // chcemy:
      // - bid troszkę ciaśniej (chętnie kupujemy pullback)
      // - ask trochę szerzej (chronimy się przed wybiciem/runaway)
      trendBidMult *= 0.9;
      trendAskMult *= 1.1;
    }
    if (riskScore > 7 || breakoutRisk || squeezeRisk) {
      // mocne ryzyko → dodatkowe rozszerzenie ask (nie łapać noża w górę przy shortowaniu)
      trendAskMult *= 1.15;
    }
  } else if (visualTrend === "down") {
    const s = (visualScore - 50) / 50;
    if (s < -0.3 && riskScore < 5) {
      // downtrend: chętnie sprzedajemy (ask ciaśniej), bid szerzej
      trendAskMult *= 0.9;
      trendBidMult *= 1.1;
    }
    if (riskScore > 7 || breakoutRisk || squeezeRisk) {
      // mocne ryzyko → dodatkowe rozszerzenie bid (nie łapać noża)
      trendBidMult *= 1.15;
    }
  }

  // 3) Flash crash – oba spready szerzej
  const flashMult = isFlashCrash ? 1.6 : 1.0;

  // 4) Łączenie
  const midSpread = safeBase;

  const unclampedBid = midSpread * invBidMult * trendBidMult * flashMult;
  const unclampedAsk = midSpread * invAskMult * trendAskMult * flashMult;

  // 5) Clamp per strona – nie przesadzamy
  const minSide = safeBase * 0.6; // max 40% ciaśniej niż base
  const maxSide = safeBase * 1.8; // max 80% szerzej niż base

  const bidSpreadBps = Math.max(minSide, Math.min(maxSide, unclampedBid));
  const askSpreadBps = Math.max(minSide, Math.min(maxSide, unclampedAsk));

  return {
    bidSpreadBps,
    askSpreadBps,
    debug: {
      invBidMult,
      invAskMult,
      trendBidMult,
      trendAskMult,
      flashMult,
      unclampedBid,
      unclampedAsk,
    },
  };
}
