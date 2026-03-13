#!/usr/bin/env npx tsx
/**
 * XGBoost Performance Monitor
 *
 * Hourly cron measuring XGBoost prediction accuracy and its estimated
 * contribution to bot PnL in basis points (bps).
 *
 * What it measures:
 *   The prediction bias in mm_hl.ts adjusts order SIZES based on h4 prediction:
 *     BEARISH → bid×(1−0.10×s), ask×(1+0.15×s)   s = min(|change|/3, 1)
 *     BULLISH → bid×(1+0.15×s), ask×(1−0.10×s)
 *   This creates net directional exposure ≈ ±(0.25 × strength) of trade volume.
 *   When direction is correct → extra exposure profits from the move.
 *   When wrong → extra exposure loses from the move.
 *
 * Attribution formula:
 *   est_bps = sign × |actual_move_bps| × strength × 0.125
 *   (0.125 = conservative half of theoretical 0.25, accounting for partial fills)
 *
 * Usage:
 *   npx tsx scripts/xgb_performance_monitor.ts            # run + Discord
 *   npx tsx scripts/xgb_performance_monitor.ts --dry-run  # console only
 *
 * Cron:
 *   0 * * * * cd ~/hyperliquid-mm-bot-complete && npx tsx scripts/xgb_performance_monitor.ts
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';

// ━━━ Config ━━━

const DISCORD_WEBHOOK = process.env.XGB_MONITOR_WEBHOOK
  || 'https://discord.com/api/webhooks/1477245696687210601/tZbQK6D4OdBk-E9AHCO9Z-FoIlaI1Rx8iCbN3_NGnNlq68xMgb6iy73Xza-iMzwnZ8me';

const PREDICTION_API = process.env.PREDICTION_API_URL || 'http://localhost:8090';
const HL_API = 'https://api.hyperliquid.xyz/info';
const STATE_FILE = '/tmp/xgb_monitor_state.json';
const DRY_RUN = process.argv.includes('--dry-run');

const TOKENS = ['BTC', 'ETH', 'SOL', 'HYPE', 'ZEC', 'XRP', 'LIT', 'FARTCOIN', 'kPEPE'];

// Bias params (must match mm_hl.ts getPredictionBias)
const BIAS_FACTOR = 0.125;   // conservative attribution factor
const MIN_CONF = 50;          // bias inactive below this
const MIN_CHANGE = 0.3;       // bias inactive below this %

// Scoring windows
const H1_MIN_MS = 50 * 60_000;
const H1_MAX_MS = 70 * 60_000;
const H4_MIN_MS = 225 * 60_000;
const H4_MAX_MS = 255 * 60_000;

// Retention
const MAX_AGE_MS = 8 * 24 * 3600_000;

// ━━━ Types ━━━

interface Prediction {
  ts: number;
  token: string;
  price: number;
  dir: string;       // BULLISH / BEARISH / NEUTRAL (derived from h4.change)
  change: number;    // h4 predicted % change
  conf: number;      // h4 confidence
  xgb_dir: string | null;   // LONG / SHORT / NEUTRAL
  xgb_conf: number | null;
  scored_h1: boolean;
  scored_h4: boolean;
}

interface Score {
  ts: number;        // when scored
  pred_ts: number;   // when predicted
  token: string;
  hz: 'h1' | 'h4';
  dir: string;       // predicted direction
  change: number;    // predicted change %
  actual: number;    // actual change %
  correct: boolean | null;  // null = NEUTRAL (excluded from accuracy)
  bias_on: boolean;
  strength: number;
  bps: number;       // estimated attribution bps
  xgb_dir: string | null;
  xgb_ok: boolean | null;
}

interface State {
  preds: Prediction[];
  scores: Score[];
}

// ━━━ Helpers ━━━

function loadState(): State {
  try {
    if (existsSync(STATE_FILE)) {
      return JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
    }
  } catch {
    console.warn('[XGB Monitor] Corrupt state file, starting fresh');
  }
  return { preds: [], scores: [] };
}

function saveState(state: State): void {
  const cutoff = Date.now() - MAX_AGE_MS;
  state.preds = state.preds.filter(p => p.ts > cutoff);
  state.scores = state.scores.filter(s => s.ts > cutoff);
  writeFileSync(STATE_FILE, JSON.stringify(state));
}

function biasStrength(changePct: number): number {
  return Math.min(Math.abs(changePct) / 3.0, 1.0);
}

function biasActive(conf: number, changePct: number): boolean {
  return conf >= MIN_CONF && Math.abs(changePct) >= MIN_CHANGE;
}

function estBps(actualPct: number, dir: string, changePct: number, conf: number): number {
  if (!biasActive(conf, changePct)) return 0;
  if (dir === 'NEUTRAL') return 0;

  const actualBps = Math.abs(actualPct) * 100;
  const s = biasStrength(changePct);

  const correct =
    (dir === 'BULLISH' && actualPct > 0) ||
    (dir === 'BEARISH' && actualPct < 0);

  return (correct ? 1 : -1) * actualBps * s * BIAS_FACTOR;
}

function dirCorrect(dir: string, actualPct: number): boolean | null {
  if (dir === 'NEUTRAL') return null;
  return (dir === 'BULLISH' && actualPct > 0) || (dir === 'BEARISH' && actualPct < 0);
}

function xgbCorrect(dir: string | null, actualPct: number): boolean | null {
  if (!dir || dir === 'NEUTRAL') return null;
  return (dir === 'LONG' && actualPct > 0) || (dir === 'SHORT' && actualPct < 0);
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

function sign(n: number): string {
  return n >= 0 ? '+' : '';
}

// ━━━ API ━━━

async function fetchPrices(): Promise<Record<string, number>> {
  const res = await fetch(HL_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'allMids' }),
  });
  const data = await res.json() as Record<string, string>;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(data)) out[k] = parseFloat(v);
  return out;
}

async function fetchPredict(token: string): Promise<any> {
  try {
    const res = await fetch(`${PREDICTION_API}/predict/${token}`, {
      signal: AbortSignal.timeout(5000),
    });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

async function fetchXGB(token: string): Promise<any> {
  try {
    const res = await fetch(`${PREDICTION_API}/predict-xgb/${token}`, {
      signal: AbortSignal.timeout(5000),
    });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

async function sendDiscord(content: string): Promise<void> {
  if (DRY_RUN) {
    console.log('[DRY RUN] Would send to Discord');
    return;
  }

  // Chunk to stay under 2000 char Discord limit
  const chunks: string[] = [];
  let cur = '';
  for (const line of content.split('\n')) {
    if (cur.length + line.length + 1 > 1950) {
      chunks.push(cur);
      cur = line;
    } else {
      cur += (cur ? '\n' : '') + line;
    }
  }
  if (cur) chunks.push(cur);

  for (let i = 0; i < chunks.length; i++) {
    try {
      const res = await fetch(DISCORD_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: chunks[i] }),
      });
      if (!res.ok) {
        console.error(`[XGB Monitor] Discord error ${res.status}: ${await res.text()}`);
      } else if (i === 0) {
        console.log(`[XGB Monitor] Discord sent OK (${chunks.length} chunk${chunks.length > 1 ? 's' : ''})`);
      }
    } catch (e) {
      console.error('[XGB Monitor] Discord send failed:', e);
    }
    if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 500));
  }
}

// ━━━ Scoring ━━━

function scorePredictions(
  state: State,
  prices: Record<string, number>,
  now: number,
): { h1: Score[]; h4: Score[] } {
  const h1: Score[] = [];
  const h4: Score[] = [];

  for (const p of state.preds) {
    const age = now - p.ts;
    const curPrice = prices[p.token];
    if (!curPrice || !p.price) continue;

    const actualPct = ((curPrice - p.price) / p.price) * 100;

    // h1 scoring
    if (!p.scored_h1 && age >= H1_MIN_MS && age <= H1_MAX_MS) {
      p.scored_h1 = true;
      const sc: Score = {
        ts: now,
        pred_ts: p.ts,
        token: p.token,
        hz: 'h1',
        dir: p.dir,
        change: p.change,
        actual: Math.round(actualPct * 1000) / 1000,
        correct: dirCorrect(p.dir, actualPct),
        bias_on: biasActive(p.conf, p.change),
        strength: biasStrength(p.change),
        bps: Math.round(estBps(actualPct, p.dir, p.change, p.conf) * 100) / 100,
        xgb_dir: p.xgb_dir,
        xgb_ok: xgbCorrect(p.xgb_dir, actualPct),
      };
      h1.push(sc);
      state.scores.push(sc);
    }

    // h4 scoring
    if (!p.scored_h4 && age >= H4_MIN_MS && age <= H4_MAX_MS) {
      p.scored_h4 = true;
      const sc: Score = {
        ts: now,
        pred_ts: p.ts,
        token: p.token,
        hz: 'h4',
        dir: p.dir,
        change: p.change,
        actual: Math.round(actualPct * 1000) / 1000,
        correct: dirCorrect(p.dir, actualPct),
        bias_on: biasActive(p.conf, p.change),
        strength: biasStrength(p.change),
        bps: Math.round(estBps(actualPct, p.dir, p.change, p.conf) * 100) / 100,
        xgb_dir: p.xgb_dir,
        xgb_ok: xgbCorrect(p.xgb_dir, actualPct),
      };
      h4.push(sc);
      state.scores.push(sc);
    }
  }

  return { h1, h4 };
}

// ━━━ Stats ━━━

interface Stats {
  total: number;
  directional: number;  // excludes NEUTRAL
  correct: number;
  accuracy: number;
  biasActive: number;
  totalBps: number;
  xgbTotal: number;
  xgbCorrect: number;
  xgbAccuracy: number;
}

function calcStats(scores: Score[]): Stats {
  const directional = scores.filter(s => s.correct !== null);
  const correct = directional.filter(s => s.correct === true).length;
  const active = scores.filter(s => s.bias_on);
  const totalBps = active.reduce((sum, s) => sum + s.bps, 0);

  const withXgb = scores.filter(s => s.xgb_ok !== null);
  const xgbOk = withXgb.filter(s => s.xgb_ok === true).length;

  return {
    total: scores.length,
    directional: directional.length,
    correct,
    accuracy: directional.length > 0 ? correct / directional.length * 100 : 0,
    biasActive: active.length,
    totalBps: Math.round(totalBps * 10) / 10,
    xgbTotal: withXgb.length,
    xgbCorrect: xgbOk,
    xgbAccuracy: withXgb.length > 0 ? xgbOk / withXgb.length * 100 : 0,
  };
}

// ━━━ Report ━━━

function buildReport(
  currentPreds: { token: string; dir: string; change: number; conf: number; xgb_dir: string | null; xgb_conf: number | null; biasOn: boolean }[],
  newH1: Score[],
  newH4: Score[],
  allScores: Score[],
  now: number,
): string {
  const timeStr = new Date(now).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const lines: string[] = [];

  lines.push(`**XGBoost Performance Monitor** — ${timeStr}`);

  // ── Current predictions ──
  lines.push('');
  lines.push('**Current Predictions (h4)**');
  lines.push('```');
  for (const p of currentPreds) {
    const dirStr = p.dir === 'NEUTRAL' ? 'NEUT' : p.dir.slice(0, 4);
    const chgStr = `${sign(p.change)}${p.change.toFixed(2)}%`;
    const confStr = typeof p.conf === 'number' ? p.conf.toFixed(0) : p.conf;
    const hybrid = `${dirStr} ${chgStr} (${confStr}%)`;
    const xStr = p.xgb_dir
      ? `${p.xgb_dir.padEnd(7)} ${p.xgb_conf?.toFixed(0)}%`
      : 'no model';
    const bias = p.biasOn ? 'ON' : 'off';
    lines.push(`${pad(p.token, 9)} ${pad(hybrid, 24)} | XGB: ${pad(xStr, 14)} | ${bias}`);
  }
  lines.push('```');

  // ── h1 scorecard ──
  if (newH1.length > 0) {
    lines.push('');
    lines.push('**h1 Scorecard** (1h ago)');
    lines.push('```');

    let ok = 0, total = 0, bpsSum = 0;
    for (const s of newH1) {
      if (s.correct === null) continue;
      total++;
      if (s.correct) ok++;
      bpsSum += s.bps;

      const icon = s.correct ? '+' : '-';
      const actual = `${sign(s.actual)}${s.actual.toFixed(3)}%`;
      const bpsStr = s.bias_on ? `${sign(s.bps)}${s.bps.toFixed(1)} bps` : 'no bias';
      lines.push(`${icon} ${pad(s.token, 9)} ${pad(s.dir.slice(0, 4), 5)} -> ${pad(actual, 9)} | ${bpsStr}`);
    }

    if (total > 0) {
      const pct = (ok / total * 100).toFixed(0);
      lines.push(`-- h1: ${ok}/${total} (${pct}%) | ${sign(bpsSum)}${bpsSum.toFixed(1)} bps`);
    }
    lines.push('```');
  }

  // ── h4 scorecard ──
  if (newH4.length > 0) {
    lines.push('');
    lines.push('**h4 Scorecard** (4h ago)');
    lines.push('```');

    let ok = 0, total = 0, bpsSum = 0;
    for (const s of newH4) {
      if (s.correct === null) continue;
      total++;
      if (s.correct) ok++;
      bpsSum += s.bps;

      const icon = s.correct ? '+' : '-';
      const actual = `${sign(s.actual)}${s.actual.toFixed(3)}%`;
      const bpsStr = s.bias_on ? `${sign(s.bps)}${s.bps.toFixed(1)} bps` : 'no bias';
      lines.push(`${icon} ${pad(s.token, 9)} ${pad(s.dir.slice(0, 4), 5)} -> ${pad(actual, 9)} | ${bpsStr}`);
    }

    if (total > 0) {
      const pct = (ok / total * 100).toFixed(0);
      lines.push(`-- h4: ${ok}/${total} (${pct}%) | ${sign(bpsSum)}${bpsSum.toFixed(1)} bps`);
    }
    lines.push('```');
  }

  // ── Rolling stats ──
  const h24 = now - 24 * 3600_000;
  const d7 = now - 7 * 24 * 3600_000;

  const h1_24h = calcStats(allScores.filter(s => s.hz === 'h1' && s.ts > h24));
  const h4_24h = calcStats(allScores.filter(s => s.hz === 'h4' && s.ts > h24));
  const h1_7d = calcStats(allScores.filter(s => s.hz === 'h1' && s.ts > d7));
  const h4_7d = calcStats(allScores.filter(s => s.hz === 'h4' && s.ts > d7));
  const all = calcStats(allScores);

  const bps24h = h1_24h.totalBps + h4_24h.totalBps;
  const bps7d = h1_7d.totalBps + h4_7d.totalBps;
  const bpsAll = all.totalBps;

  lines.push('');
  lines.push('**Running Stats**');
  lines.push('```');

  // Direction accuracy
  lines.push('Hybrid direction accuracy:');
  if (h1_24h.directional > 0 || h4_24h.directional > 0) {
    lines.push(`  24h: h1=${h1_24h.accuracy.toFixed(0)}% (${h1_24h.correct}/${h1_24h.directional})  h4=${h4_24h.accuracy.toFixed(0)}% (${h4_24h.correct}/${h4_24h.directional})`);
  }
  if (h1_7d.directional > 0 || h4_7d.directional > 0) {
    lines.push(`   7d: h1=${h1_7d.accuracy.toFixed(0)}% (${h1_7d.correct}/${h1_7d.directional})  h4=${h4_7d.accuracy.toFixed(0)}% (${h4_7d.correct}/${h4_7d.directional})`);
  }
  if (h1_24h.directional === 0 && h4_24h.directional === 0) {
    lines.push('  (collecting data — first scores after 1-4h)');
  }

  // XGB-only accuracy
  if (h4_7d.xgbTotal > 0) {
    lines.push('');
    lines.push('XGBoost-only accuracy:');
    if (h4_24h.xgbTotal > 0) {
      lines.push(`  24h: h4=${h4_24h.xgbAccuracy.toFixed(0)}% (${h4_24h.xgbCorrect}/${h4_24h.xgbTotal})`);
    }
    lines.push(`   7d: h4=${h4_7d.xgbAccuracy.toFixed(0)}% (${h4_7d.xgbCorrect}/${h4_7d.xgbTotal})`);
  }

  // Bps contribution
  lines.push('');
  lines.push('XGBoost contribution (est bps):');
  lines.push(`  24h: ${sign(bps24h)}${bps24h.toFixed(1)} bps`);
  if (bps7d !== bps24h) {
    lines.push(`   7d: ${sign(bps7d)}${bps7d.toFixed(1)} bps`);
  }
  lines.push(`  All: ${sign(bpsAll)}${bpsAll.toFixed(1)} bps (${allScores.length} scores)`);

  // Per-token 7d breakdown (h4 only, if enough data)
  const tokenH4_7d = allScores.filter(s => s.hz === 'h4' && s.ts > d7);
  if (tokenH4_7d.length >= 9) {
    lines.push('');
    lines.push('Per-token h4 edge (7d):');

    const byToken: Record<string, Score[]> = {};
    for (const s of tokenH4_7d) {
      (byToken[s.token] ||= []).push(s);
    }

    const tokenStats = Object.entries(byToken)
      .map(([token, scores]) => {
        const st = calcStats(scores);
        return { token, ...st };
      })
      .sort((a, b) => b.totalBps - a.totalBps);

    for (const t of tokenStats) {
      if (t.directional === 0) continue;
      const bpsStr = `${sign(t.totalBps)}${t.totalBps.toFixed(1)}`;
      lines.push(`  ${pad(t.token, 9)} ${t.accuracy.toFixed(0)}% (${t.correct}/${t.directional})  ${bpsStr} bps`);
    }
  }

  lines.push('```');

  // Note
  lines.push('> *bps = estimated edge from prediction bias per unit MM volume. +bps = XGBoost helped, -bps = hurt.*');

  return lines.join('\n');
}

// ━━━ Main ━━━

async function main() {
  const now = Date.now();
  const state = loadState();
  const isFirstRun = state.preds.length === 0;

  console.log(`[XGB Monitor] ${new Date(now).toISOString()} — hourly check`);

  // 1. Fetch prices
  let prices: Record<string, number>;
  try {
    prices = await fetchPrices();
  } catch (e) {
    console.error('[XGB Monitor] Failed to fetch prices, aborting:', e);
    return;
  }

  // 2. Record current predictions
  const currentPreds: {
    token: string; dir: string; change: number; conf: number;
    xgb_dir: string | null; xgb_conf: number | null; biasOn: boolean;
  }[] = [];

  let apiDown = false;

  for (const token of TOKENS) {
    const price = prices[token];
    if (!price) continue;

    const [hybrid, xgb] = await Promise.all([
      fetchPredict(token),
      fetchXGB(token),
    ]);

    if (!hybrid) {
      if (!apiDown) {
        console.warn('[XGB Monitor] prediction-api appears down');
        apiDown = true;
      }
      continue;
    }

    const h4 = hybrid?.prediction?.predictions?.h4;
    if (!h4) continue;

    // Derive direction same way as mm_hl.ts fetchPrediction()
    const dir = h4.change > 0 ? 'BULLISH' : h4.change < 0 ? 'BEARISH' : 'NEUTRAL';

    // XGB h4 prediction
    const xgbH4 = xgb?.predictions?.find((p: any) => p.horizon === 'h4');

    const pred: Prediction = {
      ts: now,
      token,
      price,
      dir,
      change: h4.change,
      conf: h4.confidence,
      xgb_dir: xgbH4?.direction ?? null,
      xgb_conf: xgbH4?.confidence ?? null,
      scored_h1: false,
      scored_h4: false,
    };
    state.preds.push(pred);

    currentPreds.push({
      token,
      dir,
      change: h4.change,
      conf: h4.confidence,
      xgb_dir: xgbH4?.direction ?? null,
      xgb_conf: xgbH4?.confidence ?? null,
      biasOn: biasActive(h4.confidence, h4.change),
    });
  }

  console.log(`[XGB Monitor] Recorded ${currentPreds.length} predictions (api ${apiDown ? 'DOWN' : 'OK'})`);

  // 3. Score old predictions
  const { h1: newH1, h4: newH4 } = scorePredictions(state, prices, now);
  console.log(`[XGB Monitor] Scored: ${newH1.length} h1, ${newH4.length} h4`);

  // 4. Build and send report
  const report = buildReport(currentPreds, newH1, newH4, state.scores, now);
  console.log(report);

  if (isFirstRun && newH1.length === 0 && newH4.length === 0) {
    console.log('[XGB Monitor] First run — baseline recorded, no Discord report yet.');
  } else {
    await sendDiscord(report);
  }

  // 5. Save state (skip in dry-run to avoid polluting real state)
  if (!DRY_RUN) {
    saveState(state);
  } else {
    console.log('[XGB Monitor] Dry run — state NOT saved.');
  }
  console.log('[XGB Monitor] Done.');
}

main().catch(err => {
  console.error('[XGB Monitor] Fatal:', err);
  process.exit(1);
});
