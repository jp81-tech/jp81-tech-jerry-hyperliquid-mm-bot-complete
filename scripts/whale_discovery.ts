#!/usr/bin/env -S npx tsx
/**
 * whale_discovery.ts — Periodic scan for new large positions on kPEPE/VIRTUAL
 *
 * Discovers new whale addresses NOT already tracked in whale_tracker.py.
 * Flags them for human review before adding to the tracker.
 *
 * Data sources:
 *   - nansen CLI: perp-pnl-leaderboard per token + overall perp leaderboard
 *   - Hyperliquid API: clearinghouseState for position details (free)
 *
 * Usage:
 *   npx tsx scripts/whale_discovery.ts              # run + Discord
 *   npx tsx scripts/whale_discovery.ts --dry-run    # console only, no Discord, no state save
 *
 * Cron:
 *   0 10 * * 0  cd ~/hyperliquid-mm-bot-complete && npx tsx scripts/whale_discovery.ts >> runtime/whale_discovery.log 2>&1
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { config } from 'dotenv';

config({ path: path.resolve(process.cwd(), '.env') });

// ============================================================
// KNOWN ADDRESSES — synced from whale-changes-report.ts (lines 20-79)
// Any address here is ALREADY tracked and will be skipped.
// ============================================================

const KNOWN_ADDRESSES = new Set([
  // TIER 1: CONVICTION
  '0xb317d2bc2d3d2df5fa441b5bae0ab9d8b07283ae',
  '0x2ea18c23f72a4b6172c55b411823cdc5335923f4',
  '0xd7a678fcf72c1b602850ef2f3e2d668ec41fa0ed',
  '0x3c363e96d22c056d748f199fb728fc80d70e461a',
  '0xa312114b5795dff9b8db50474dd57701aa78ad1e',
  '0x35d1151ef1aab579cbb3109e69fa82f94ff5acb1',
  '0x5d2f4460ac3514ada79f5d9838916e508ab39bb7',
  '0x45d26f28196d226497130c4bac709d808fed4029',
  '0x06cecfbac34101ae41c88ebc2450f8602b3d164b',
  '0x6bea81d7a0c5939a5ce5552e125ab57216cc597f',
  '0x936cf4fb95c30ce83f658b5bbb247e4bb381bb0f',
  '0x71dfc07de32c2ebf1c4801f4b1c9e40b76d4a23d',
  '0x519c721de735f7c9e6146d167852e60d60496a47',
  '0xea6670ebdb4a388a8cfc16f6497bf4f267b061ee',
  '0x92e9773ad2b4ba6e2e57e7fc1f9305aef80ab6c2',
  '0x56cd86d6ef24a3f51ce6992b7f1db751b0a0276a',
  '0x1e771e1b95c86491299d6e2a5c3b3842d03b552e',
  '0x091159a8106b077c13e89bc09701117e8b5f129a',
  // TIER 2: FUNDS
  '0xcac19662ec88d23fa1c81ac0e8570b0cf2ff26b3',
  '0x8def9f50456c6c4e37fa5d3d57f108ed23992dae',
  '0xc4241dc9bfeb5126c0766df35a87ed3fbd630c78',
  '0x418aa6bf98a2b2bc93779f810330d88cde488888',
  // TIER 3: ACTIVE
  '0xfeec88b13fc0be31695069f02bac18538a154e9c',
  '0xfce053a5e461683454bf37ad66d20344c0e3f4c0',
  '0x99b1098d9d50aa076f78bd26ab22e6abd3710729',
  '0xc7290b4b308431a985fa9e3e8a335c2f7650517c',
  '0x570b09e27a87f9acbce49f85056745d29b3ee3c6',
  '0x179c17d04be626561b0355a248d6055a80456aa5',
  '0xe4d83945c0322f3d340203a7129b7eb5cacae847',
  '0xb1694de2324433778487999bd86b1acb3335ebc4',
  '0xa4be91acc74feabab71b8878b66b8f5277212520',
  '0x6a7a17046df7d3e746ce97d67dc1c6c55e27ce75',
  '0xa6cb81271418b9f41295fff54be05f6250c7cbf6',
  '0x0980b34ade9476dba81bcdb0f865a333793ad1c2',
  '0x782e432267376f377585fc78092d998f8442ab83',
  '0xdca131ba8f428bd2f90ae962e4cb2d226312505e',
  '0x649156ebf0a350deb18a1e4835873defd4dc5349',
  '0xe82bc65677e46b6626a8e779ac263221db039c2d',
  '0x84abc08c0ea62e687c370154de1f38ea462f4d37',
  '0x61f2bb695d81ac9fce0b1d01fd45cc6b2925a571',
  '0xdbcc96bcada067864902aad14e029fe7c422f147',
  '0x8e096995c3e4a3f0bc5b3ee1cba94de2aa4d70c9',
  '0x856c35038594767646266bc7fd68dc26480e910d',
  '0x4eebd8d39e82efb958e0fa9f694435c910c8518f',
  '0x5b9306593ae710a66832c4101e019e3e96f65d0a',
  // FUNDS (added later)
  '0x7fdafde5cfb5465924316eced2d3715494c517d1',
  '0xb83de012dba672c76a7dbbbf3e459cb59d7d6e36',
  '0x5b5d51203a0f9079f8aeb098a6523a13f298c060',
  // October crash + misc
  '0x880ac484a1743862989a441d6d867238c7aa311c',
  '0x4f7634c03ec4e87e14725c84913ade523c6fad5a',
  '0x6f7d75c18e8ca7f486eb4d2690abf7b329087062',
  '0xf62edeee2a4e6bddf2dc0b0e7e044131bb55fa04',
  '0xc1471df3e2c4c5a39367ebed0572df0ceec40cc2',
  '0x218a65e2e3c2f1d0aa46ad044d2e32e48e7da9e8',
  '0xd62d484b084cdf5dd950f81f646f838dcb7d33a8',
  // HLP
  '0x010461c14e146ac35fe42271bdc1134ee31c703a',
]);

// ============================================================
// CONFIG
// ============================================================

const HL_API_URL = 'https://api.hyperliquid.xyz/info';
const SEEN_FILE = '/tmp/whale_discovery_seen.json';
const SEEN_TTL_DAYS = 30;
const NANSEN_CLI = (() => {
  const candidates = [
    process.env.NANSEN_CLI_PATH,
    '/opt/homebrew/bin/nansen',                          // macOS (homebrew)
    `${process.env.HOME}/.npm-global/bin/nansen`,        // Linux (npm global prefix)
    '/usr/local/bin/nansen',
  ].filter(Boolean) as string[];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch {}
  }
  return 'nansen'; // fallback to PATH
})();

interface TokenConfig {
  symbol: string;
  minPnlUsd: number;      // min 7d PnL to flag
  minPositionUsd: number;  // min current position to flag
}

const TOKENS: TokenConfig[] = [
  { symbol: 'kPEPE',   minPnlUsd: 10_000,  minPositionUsd: 50_000 },
  { symbol: 'VIRTUAL', minPnlUsd: 20_000,  minPositionUsd: 100_000 },
];

// ============================================================
// TYPES
// ============================================================

interface NansenLeaderEntry {
  trader_address: string;
  trader_address_label: string;
  pnl_usd_total: number;
  position_value_usd: number;
  roi_percent_total: number;
}

interface NansenGlobalEntry {
  trader_address: string;
  trader_address_label: string;
  total_pnl: number;
  account_value: number;
}

interface HlPosition {
  coin: string;
  side: 'LONG' | 'SHORT';
  valueUsd: number;
  uPnl: number;
  entryPx: number;
}

interface DiscoveredWhale {
  address: string;
  label: string;
  token: string;
  pnl7d: number;
  positionValueUsd: number;
  equity: number;
  positions: HlPosition[];
  source: string;
}

interface SeenEntry {
  firstSeen: number;
  token: string;
  label: string;
}

type SeenFile = Record<string, SeenEntry>;

// ============================================================
// HELPERS
// ============================================================

function fmtUsd(val: number): string {
  const abs = Math.abs(val);
  const sign = val >= 0 ? '+' : '-';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function fmtUsdNoSign(val: number): string {
  const abs = Math.abs(val);
  if (abs >= 1_000_000) return `$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(abs / 1_000).toFixed(0)}K`;
  return `$${abs.toFixed(0)}`;
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ============================================================
// NANSEN CLI
// ============================================================

function nansenCmd(args: string): any[] {
  try {
    const raw = execSync(`${NANSEN_CLI} ${args} --format csv`, {
      timeout: 45_000,
      encoding: 'utf-8',
    });
    return parseCsv(raw);
  } catch (err: any) {
    console.error(`[nansen] Command failed: nansen ${args}`);
    console.error(`[nansen] ${err.message?.slice(0, 200)}`);
    return [];
  }
}

function parseCsv(raw: string): any[] {
  const lines = raw.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',');
  return lines.slice(1).map(line => {
    const values = line.split(',');
    const obj: any = {};
    for (let i = 0; i < headers.length; i++) {
      const key = headers[i];
      const val = values[i] ?? '';
      const num = Number(val);
      // Keep 0x-prefixed values as strings (Ethereum addresses parse as valid hex numbers)
      obj[key] = isNaN(num) || val === '' || val.startsWith('0x') ? val : num;
    }
    return obj;
  });
}

// ============================================================
// HYPERLIQUID API (free, no auth)
// ============================================================

async function fetchClearinghouseState(address: string): Promise<{ equity: number; positions: HlPosition[] }> {
  const resp = await fetch(HL_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'clearinghouseState', user: address }),
  });
  if (!resp.ok) throw new Error(`HL API ${resp.status}`);
  const data = await resp.json() as any;

  const equity = parseFloat(data?.marginSummary?.accountValue ?? '0');
  const positions: HlPosition[] = [];

  for (const ap of (data?.assetPositions ?? [])) {
    const p = ap.position;
    const szi = parseFloat(p.szi);
    if (szi === 0) continue;
    const entryPx = parseFloat(p.entryPx);
    positions.push({
      coin: p.coin,
      side: szi > 0 ? 'LONG' : 'SHORT',
      valueUsd: Math.abs(szi) * entryPx,
      uPnl: parseFloat(p.unrealizedPnl),
      entryPx,
    });
  }

  return { equity, positions };
}

// ============================================================
// SEEN FILE (30-day TTL dedup)
// ============================================================

function loadSeen(): SeenFile {
  try {
    if (!fs.existsSync(SEEN_FILE)) return {};
    const raw = fs.readFileSync(SEEN_FILE, 'utf-8');
    const data = JSON.parse(raw) as SeenFile;
    // Prune entries older than TTL
    const cutoff = Date.now() - SEEN_TTL_DAYS * 24 * 60 * 60 * 1000;
    for (const [addr, entry] of Object.entries(data)) {
      if (entry.firstSeen < cutoff) delete data[addr];
    }
    return data;
  } catch {
    return {};
  }
}

function saveSeen(seen: SeenFile): void {
  fs.writeFileSync(SEEN_FILE, JSON.stringify(seen, null, 2), 'utf-8');
}

// ============================================================
// DISCORD
// ============================================================

async function postToDiscord(webhookUrl: string, payload: any): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`Discord webhook failed (${res.status}): ${body}`);
  }
}

// ============================================================
// MAIN DISCOVERY LOGIC
// ============================================================

async function discoverWhales(): Promise<DiscoveredWhale[]> {
  const candidates = new Map<string, { address: string; label: string; token: string; pnl: number; posValue: number; source: string }>();

  // 1. Per-token perp PnL leaderboard
  for (const tok of TOKENS) {
    console.log(`[discovery] Fetching perp-pnl-leaderboard for ${tok.symbol}...`);
    const entries = nansenCmd(`research token perp-pnl-leaderboard --symbol ${tok.symbol} --days 7 --limit 50`);
    console.log(`[discovery] ${tok.symbol}: ${entries.length} entries from leaderboard`);

    for (const e of entries) {
      const addr = (e.trader_address ?? '').toLowerCase();
      if (!addr || KNOWN_ADDRESSES.has(addr)) continue;
      const pnl = e.pnl_usd_total ?? 0;
      const posValue = Math.abs(e.position_value_usd ?? 0);
      if (pnl < tok.minPnlUsd && posValue < tok.minPositionUsd) continue;

      const key = `${addr}:${tok.symbol}`;
      if (!candidates.has(key) || (candidates.get(key)!.pnl < pnl)) {
        candidates.set(key, {
          address: addr,
          label: e.trader_address_label ?? '',
          token: tok.symbol,
          pnl,
          posValue,
          source: `perp-pnl-leaderboard/${tok.symbol}`,
        });
      }
    }
  }

  // 2. Overall perp leaderboard (cross-reference top traders)
  console.log(`[discovery] Fetching overall perp leaderboard...`);
  const globalEntries = nansenCmd('research perp leaderboard --days 7 --limit 30');
  console.log(`[discovery] Global leaderboard: ${globalEntries.length} entries`);

  for (const e of globalEntries) {
    const addr = (e.trader_address ?? '').toLowerCase();
    if (!addr || KNOWN_ADDRESSES.has(addr)) continue;
    const pnl = e.total_pnl ?? 0;
    if (pnl < 50_000) continue; // Only flag big global earners
    // Mark as global candidate — we'll check positions later
    const key = `${addr}:GLOBAL`;
    if (!candidates.has(key)) {
      candidates.set(key, {
        address: addr,
        label: e.trader_address_label ?? '',
        token: 'GLOBAL',
        pnl,
        posValue: e.account_value ?? 0,
        source: 'perp-leaderboard/global',
      });
    }
  }

  // 3. Deduplicate by address (keep best entry per address)
  const byAddress = new Map<string, typeof candidates extends Map<any, infer V> ? V : never>();
  for (const [, c] of candidates) {
    const existing = byAddress.get(c.address);
    if (!existing || c.pnl > existing.pnl) {
      byAddress.set(c.address, c);
    }
  }

  console.log(`[discovery] ${byAddress.size} unique candidate addresses after dedup`);

  // 4. Fetch HL positions for each candidate
  const discovered: DiscoveredWhale[] = [];

  for (const [addr, cand] of byAddress) {
    try {
      const { equity, positions } = await fetchClearinghouseState(addr);

      // For global candidates, check if they have kPEPE/VIRTUAL positions
      const relevantPositions = positions.filter(p =>
        TOKENS.some(t => t.symbol === p.coin)
      );

      // Skip global candidates with no relevant positions
      if (cand.token === 'GLOBAL' && relevantPositions.length === 0) continue;

      // Determine which token this whale is relevant for
      let token = cand.token;
      if (token === 'GLOBAL' && relevantPositions.length > 0) {
        // Pick the largest relevant position
        relevantPositions.sort((a, b) => b.valueUsd - a.valueUsd);
        token = relevantPositions[0].coin;
      }

      discovered.push({
        address: addr,
        label: cand.label,
        token,
        pnl7d: cand.pnl,
        positionValueUsd: cand.posValue,
        equity,
        positions: relevantPositions.length > 0 ? relevantPositions : positions.slice(0, 5),
        source: cand.source,
      });

      await sleep(200); // Rate limit HL API
    } catch (err: any) {
      console.error(`[discovery] Failed to fetch HL state for ${shortAddr(addr)}: ${err.message}`);
    }
  }

  return discovered;
}

// ============================================================
// FORMAT DISCORD EMBED
// ============================================================

function formatDiscordPayload(whales: DiscoveredWhale[], seenFilteredCount: number): any {
  const now = new Date();
  const timeStr = now.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

  if (whales.length === 0) {
    return {
      embeds: [{
        title: 'Whale Discovery — Weekly Scan',
        description: `No new whales found above thresholds.\n\n_Scanned kPEPE (PnL >$10K / pos >$50K) and VIRTUAL (PnL >$20K / pos >$100K)_`,
        color: 0x808080,
        footer: { text: `${timeStr} | Seen: ${seenFilteredCount} addresses filtered` },
      }],
    };
  }

  const fields: Array<{ name: string; value: string; inline?: boolean }> = [];

  for (const w of whales.slice(0, 10)) { // Discord limit: 25 fields, keep it reasonable
    const posLines = w.positions.slice(0, 3).map(p =>
      `${p.side === 'SHORT' ? '🔴' : '🟢'} ${p.coin}: ${p.side} ${fmtUsdNoSign(p.valueUsd)} (uPnL ${fmtUsd(p.uPnl)})`
    ).join('\n');

    fields.push({
      name: `${shortAddr(w.address)} — ${w.token}`,
      value: [
        `**Label:** ${w.label || 'Unknown'}`,
        `**7d PnL:** ${fmtUsd(w.pnl7d)} | **Equity:** ${fmtUsdNoSign(w.equity)}`,
        posLines,
        `_Source: ${w.source}_`,
      ].join('\n'),
    });
  }

  return {
    embeds: [{
      title: `Whale Discovery — ${whales.length} New Address${whales.length > 1 ? 'es' : ''}`,
      color: 0x00ff88,
      fields,
      footer: { text: `${timeStr} | Review before adding to whale_tracker.py | Seen: ${seenFilteredCount} filtered` },
    }],
  };
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  const dryRun = process.argv.includes('--dry-run');

  if (!webhookUrl && !dryRun) {
    console.error('DISCORD_WEBHOOK_URL not set. Use --dry-run to print to console only.');
    process.exit(1);
  }

  console.log(`[whale_discovery] Starting scan (${dryRun ? 'DRY RUN' : 'LIVE'})...`);

  // 1. Load seen addresses
  const seen = loadSeen();
  const seenCount = Object.keys(seen).length;
  console.log(`[whale_discovery] Loaded ${seenCount} previously seen addresses`);

  // 2. Discover candidates
  const allDiscovered = await discoverWhales();
  console.log(`[whale_discovery] Found ${allDiscovered.length} candidates before seen filter`);

  // 3. Filter out already-seen addresses
  const newWhales = allDiscovered.filter(w => !seen[w.address]);
  const seenFilteredCount = allDiscovered.length - newWhales.length;
  console.log(`[whale_discovery] ${newWhales.length} new whales after seen filter (${seenFilteredCount} filtered)`);

  // 4. Sort by PnL descending
  newWhales.sort((a, b) => b.pnl7d - a.pnl7d);

  // 5. Print to console
  for (const w of newWhales) {
    const posStr = w.positions.slice(0, 3).map(p =>
      `${p.coin} ${p.side} ${fmtUsdNoSign(p.valueUsd)}`
    ).join(' | ');
    console.log(`  NEW: ${shortAddr(w.address)} [${w.label || '?'}] ${w.token} PnL=${fmtUsd(w.pnl7d)} Equity=${fmtUsdNoSign(w.equity)} | ${posStr}`);
  }

  // 6. Post to Discord
  if (webhookUrl && !dryRun && newWhales.length >= 0) {
    const payload = formatDiscordPayload(newWhales, seenFilteredCount);
    await postToDiscord(webhookUrl, payload);
    console.log(`[whale_discovery] Sent Discord embed`);
  } else if (dryRun) {
    console.log('[whale_discovery] [DRY RUN] Skipping Discord post');
    const payload = formatDiscordPayload(newWhales, seenFilteredCount);
    console.log(JSON.stringify(payload, null, 2));
  }

  // 7. Update seen file (skip in dry-run)
  if (!dryRun) {
    for (const w of newWhales) {
      seen[w.address] = {
        firstSeen: Date.now(),
        token: w.token,
        label: w.label || 'Unknown',
      };
    }
    saveSeen(seen);
    console.log(`[whale_discovery] Saved ${Object.keys(seen).length} entries to seen file`);
  }

  console.log(`[whale_discovery] Done.`);
}

main().catch(async err => {
  const errMsg = `Whale discovery error: ${String(err.message || err)}`;
  console.error(errMsg);

  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (webhookUrl && !process.argv.includes('--dry-run')) {
    await postToDiscord(webhookUrl, { content: errMsg }).catch(() => {});
  }
  process.exit(1);
});
