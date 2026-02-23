#!/usr/bin/env -S npx tsx
import * as hl from '@nktkas/hyperliquid';
import { config } from 'dotenv';
import * as path from 'path';

config({ path: path.resolve(process.cwd(), '.env') });

// ============================================================
// WHALE ADDRESSES — synced from whale_tracker.py
// Tiers 1-3 only (Tier 4 Market Makers excluded)
// ============================================================

interface WhaleEntry {
  name: string;
  tier: 'CONVICTION' | 'FUND' | 'ACTIVE';
  weight: number;
}

// ============================================================
// VIP INTEL — separate deep tracking for key wallets
// These wallets showed exceptional timing on short entries
// ============================================================

const VIP_WALLETS: Record<string, { name: string; note: string }> = {
  '0x06cecfbac34101ae41c88ebc2450f8602b3d164b': {
    name: 'Kraken A',
    note: 'BTC short @$87K (Nov 25), SOL short @$133 (Jan 8)',
  },
  '0x56cd86d6ef24a3f51ce6992b7f1db751b0a0276a': {
    name: 'Kraken B',
    note: 'SOL short @$193 (Oct 28), XRP short @$2.60 (Oct 28) — best timing',
  },
  '0x880ac484a1743862989a441d6d867238c7aa311c': {
    name: 'Token Millionaire',
    note: 'XMR $10M + HYPE $9M shorts (Feb 7) — $20M+ in one evening',
  },
};

const WHALES: Record<string, WhaleEntry> = {
  // === TIER 1: CONVICTION TRADERS ===
  '0xb317d2bc2d3d2df5fa441b5bae0ab9d8b07283ae': { name: 'Bitcoin OG (WATCH)', tier: 'CONVICTION', weight: 0.10 },
  '0x2ea18c23f72a4b6172c55b411823cdc5335923f4': { name: 'Bitcoin OG #2 (WATCH)', tier: 'CONVICTION', weight: 0.10 },
  '0xd7a678fcf72c1b602850ef2f3e2d668ec41fa0ed': { name: 'Winner d7a678 (WATCH)', tier: 'CONVICTION', weight: 0.10 },
  '0x3c363e96d22c056d748f199fb728fc80d70e461a': { name: 'SM 3c363e', tier: 'CONVICTION', weight: 0.80 },
  '0xa312114b5795dff9b8db50474dd57701aa78ad1e': { name: 'Generał', tier: 'CONVICTION', weight: 1.0 },
  '0x35d1151ef1aab579cbb3109e69fa82f94ff5acb1': { name: 'Major', tier: 'CONVICTION', weight: 0.95 },
  '0x5d2f4460ac3514ada79f5d9838916e508ab39bb7': { name: 'Pułkownik', tier: 'CONVICTION', weight: 0.95 },
  '0x45d26f28196d226497130c4bac709d808fed4029': { name: 'Wice-Generał', tier: 'CONVICTION', weight: 0.9 },
  '0x06cecfbac34101ae41c88ebc2450f8602b3d164b': { name: 'Kraken A', tier: 'CONVICTION', weight: 0.85 },
  '0x6bea81d7a0c5939a5ce5552e125ab57216cc597f': { name: 'Porucznik SOL2', tier: 'CONVICTION', weight: 0.80 },
  '0x936cf4fb95c30ce83f658b5bbb247e4bb381bb0f': { name: 'Porucznik SOL3', tier: 'CONVICTION', weight: 0.75 },
  '0x71dfc07de32c2ebf1c4801f4b1c9e40b76d4a23d': { name: 'Kapitan BTC', tier: 'CONVICTION', weight: 0.9 },
  '0x519c721de735f7c9e6146d167852e60d60496a47': { name: 'ZEC Conviction', tier: 'CONVICTION', weight: 0.85 },
  '0xea6670ebdb4a388a8cfc16f6497bf4f267b061ee': { name: 'Porucznik ea66', tier: 'CONVICTION', weight: 0.85 },
  '0x92e9773ad2b4ba6e2e57e7fc1f9305aef80ab6c2': { name: 'BTC/LIT Trader', tier: 'CONVICTION', weight: 0.80 },
  '0x56cd86d6ef24a3f51ce6992b7f1db751b0a0276a': { name: 'Kraken B', tier: 'CONVICTION', weight: 0.85 },
  '0x1e771e1b95c86491299d6e2a5c3b3842d03b552e': { name: 'SM 1e771e', tier: 'CONVICTION', weight: 0.75 },
  '0x091159a8106b077c13e89bc09701117e8b5f129a': { name: 'SM 091159', tier: 'CONVICTION', weight: 0.85 },
  '0x0b23968e02c549f99ff77b6471be3a78cbfff37b': { name: 'SM 0b2396 (WATCH)', tier: 'ACTIVE', weight: 0.40 },

  // === TIER 2: INSTITUTIONAL / FUNDS ===
  '0xcac19662ec88d23fa1c81ac0e8570b0cf2ff26b3': { name: 'Galaxy Digital', tier: 'FUND', weight: 0.85 },
  '0x8def9f50456c6c4e37fa5d3d57f108ed23992dae': { name: 'Laurent Zeimes', tier: 'FUND', weight: 0.8 },
  '0xc4241dc9bfeb5126c0766df35a87ed3fbd630c78': { name: 'Arrington XRP', tier: 'FUND', weight: 0.7 },
  '0x418aa6bf98a2b2bc93779f810330d88cde488888': { name: '58bro.eth', tier: 'FUND', weight: 0.8 },

  // === TIER 3: ACTIVE TRADERS ===
  '0x9eec98d048d06d9cd75318fffa3f3960e081daab': { name: 'ETH Whale', tier: 'ACTIVE', weight: 0.85 },
  '0xfeec88b13fc0be31695069f02bac18538a154e9c': { name: 'Kapitan feec', tier: 'ACTIVE', weight: 0.80 },
  '0xfce053a5e461683454bf37ad66d20344c0e3f4c0': { name: 'Kapitan fce0', tier: 'ACTIVE', weight: 0.80 },
  '0x99b1098d9d50aa076f78bd26ab22e6abd3710729': { name: 'Kapitan 99b1', tier: 'ACTIVE', weight: 0.80 },
  '0xc7290b4b308431a985fa9e3e8a335c2f7650517c': { name: 'SM c7290b', tier: 'ACTIVE', weight: 0.65 },
  '0x570b09e27a87f9acbce49f85056745d29b3ee3c6': { name: 'SM 570b09', tier: 'ACTIVE', weight: 0.60 },
  '0xe2823659be02e0f48a4660e4da008b5e1abfdf29': { name: 'SM e28236', tier: 'ACTIVE', weight: 0.60 },
  '0x179c17d04be626561b0355a248d6055a80456aa5': { name: 'SM 179c17', tier: 'ACTIVE', weight: 0.60 },
  '0xe4d83945c0322f3d340203a7129b7eb5cacae847': { name: 'SM e4d839', tier: 'ACTIVE', weight: 0.60 },
  '0xb1694de2324433778487999bd86b1acb3335ebc4': { name: 'SM b1694d', tier: 'ACTIVE', weight: 0.55 },
  '0xa4be91acc74feabab71b8878b66b8f5277212520': { name: 'SM a4be91', tier: 'ACTIVE', weight: 0.55 },
  '0x6a7a17046df7d3e746ce97d67dc1c6c55e27ce75': { name: 'SM 6a7a17', tier: 'ACTIVE', weight: 0.50 },
  '0xa6cb81271418b9f41295fff54be05f6250c7cbf6': { name: 'SM a6cb81', tier: 'ACTIVE', weight: 0.50 },
  '0x0980b34ade9476dba81bcdb0f865a333793ad1c2': { name: 'SM 0980b3', tier: 'ACTIVE', weight: 0.50 },
  '0x782e432267376f377585fc78092d998f8442ab83': { name: 'SM 782e43', tier: 'ACTIVE', weight: 0.50 },
  '0xdca131ba8f428bd2f90ae962e4cb2d226312505e': { name: 'SM dca131', tier: 'ACTIVE', weight: 0.55 },
  '0x649156ebf0a350deb18a1e4835873defd4dc5349': { name: 'donkstrategy.eth', tier: 'ACTIVE', weight: 0.55 },
  '0xe82bc65677e46b6626a8e779ac263221db039c2d': { name: 'SM e82bc6', tier: 'ACTIVE', weight: 0.55 },
  '0x84abc08c0ea62e687c370154de1f38ea462f4d37': { name: 'SM 84abc0', tier: 'ACTIVE', weight: 0.50 },
  '0x61f2bb695d81ac9fce0b1d01fd45cc6b2925a571': { name: 'SM 61f2bb', tier: 'ACTIVE', weight: 0.50 },
  '0xdbcc96bcada067864902aad14e029fe7c422f147': { name: 'SM dbcc96', tier: 'ACTIVE', weight: 0.50 },
};

// ============================================================
// TYPES
// ============================================================

interface WalletResult {
  address: string;
  whale: WhaleEntry;
  equity: number;
  totalUPnl: number;
  positions: { coin: string; side: 'LONG' | 'SHORT'; valueUsd: number; uPnl: number; entryPx: number; leverage: number }[];
}

interface VipResult {
  address: string;
  name: string;
  note: string;
  equity: number;
  totalUPnl: number;
  positions: { coin: string; side: 'LONG' | 'SHORT'; valueUsd: number; uPnl: number; entryPx: number; leverage: number; pnlPct: number }[];
}

interface CoinAggregate {
  longUsd: number;
  shortUsd: number;
  longUPnl: number;
  shortUPnl: number;
}

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
  return addr.slice(2, 8);
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

const TIER_LABEL: Record<string, string> = {
  CONVICTION: 'TIER 1: CONVICTION',
  FUND: 'TIER 2: FUNDS',
  ACTIVE: 'TIER 3: ACTIVE',
};

const TIER_ORDER = ['CONVICTION', 'FUND', 'ACTIVE'] as const;

const MIN_POSITION_VALUE = 100_000; // Only show positions > $100K
const MAX_POSITIONS_PER_WALLET = 10; // Cap positions shown per wallet
const MIN_AGGREGATE_VALUE = 1_000_000; // Only show coins > $1M in aggregate

// ============================================================
// FETCH ALL WHALE DATA
// ============================================================

async function fetchAllWhales(info: hl.InfoClient): Promise<WalletResult[]> {
  const entries = Object.entries(WHALES);
  const results: WalletResult[] = [];
  const BATCH_SIZE = 5;
  const BATCH_DELAY_MS = 200;

  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);

    const settled = await Promise.allSettled(
      batch.map(async ([address, whale]) => {
        const user = address.toLowerCase() as `0x${string}`;
        const state = await info.clearinghouseState({ user });

        const equity = parseFloat(state.marginSummary.accountValue);
        let totalUPnl = 0;
        const positions: WalletResult['positions'] = [];

        for (const ap of state.assetPositions) {
          const p = ap.position;
          const szi = parseFloat(p.szi);
          if (szi === 0) continue;

          const uPnl = parseFloat(p.unrealizedPnl);
          totalUPnl += uPnl;

          // Calculate position value = |size| * entry price
          const entryPx = parseFloat(p.entryPx);
          const valueUsd = Math.abs(szi) * entryPx;
          const leverage = p.leverage ? parseInt(p.leverage.value) : 0;

          positions.push({
            coin: p.coin,
            side: szi > 0 ? 'LONG' : 'SHORT',
            valueUsd,
            uPnl,
            entryPx,
            leverage,
          });
        }

        // Sort positions by value descending
        positions.sort((a, b) => b.valueUsd - a.valueUsd);

        return { address, whale, equity, totalUPnl, positions };
      })
    );

    for (const result of settled) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      }
      // Rejected = closed account / API error — silently skip
    }

    // Rate-limit between batches
    if (i + BATCH_SIZE < entries.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  return results;
}

// ============================================================
// FETCH VIP WALLETS (separate deep tracking)
// ============================================================

async function fetchVipWallets(info: hl.InfoClient): Promise<VipResult[]> {
  const entries = Object.entries(VIP_WALLETS);
  const results: VipResult[] = [];

  const settled = await Promise.allSettled(
    entries.map(async ([address, vip]) => {
      const user = address.toLowerCase() as `0x${string}`;
      const state = await info.clearinghouseState({ user });

      const equity = parseFloat(state.marginSummary.accountValue);
      let totalUPnl = 0;
      const positions: VipResult['positions'] = [];

      for (const ap of state.assetPositions) {
        const p = ap.position;
        const szi = parseFloat(p.szi);
        if (szi === 0) continue;

        const uPnl = parseFloat(p.unrealizedPnl);
        totalUPnl += uPnl;

        const entryPx = parseFloat(p.entryPx);
        const valueUsd = Math.abs(szi) * entryPx;
        const leverage = p.leverage ? parseInt(p.leverage.value) : 0;
        const pnlPct = valueUsd > 0 ? (uPnl / valueUsd) * 100 : 0;

        positions.push({
          coin: p.coin,
          side: szi > 0 ? 'LONG' : 'SHORT',
          valueUsd,
          uPnl,
          entryPx,
          leverage,
          pnlPct,
        });
      }

      positions.sort((a, b) => b.valueUsd - a.valueUsd);

      return { address, name: vip.name, note: vip.note, equity, totalUPnl, positions };
    })
  );

  for (const result of settled) {
    if (result.status === 'fulfilled') {
      results.push(result.value);
    }
  }

  return results;
}

// ============================================================
// FORMAT VIP INTEL SECTION
// ============================================================

function formatVipSection(vips: VipResult[]): string[] {
  const messages: string[] = [];
  const DISCORD_LIMIT = 1950;

  let current = '';
  let inCodeBlock = false;

  function flush() {
    if (current.trim()) {
      // Close code block if open before splitting
      if (inCodeBlock) {
        current += '```\n';
      }
      messages.push(current.trim());
      current = '';
      // Re-open code block in new message if we were inside one
      if (inCodeBlock) {
        current = '```\n';
      }
    }
  }

  function append(text: string) {
    if ((current + text).length > DISCORD_LIMIT) {
      flush();
    }
    current += text;
  }

  append('**=== VIP INTEL (Deep Tracking) ===**\n');

  for (const v of vips) {
    if (v.equity < 100) {
      append(`**${v.name}**: CLOSED\n`);
      continue;
    }

    let header = `\n**${v.name}** — ${fmtUsdNoSign(v.equity)} equity | uPnl ${fmtUsd(v.totalUPnl)}\n`;
    header += `> _${v.note}_\n`;
    header += '```\n';
    append(header);
    inCodeBlock = true;

    for (const p of v.positions) {
      const pnlSign = p.pnlPct >= 0 ? '+' : '';
      const pnlStr = `${pnlSign}${p.pnlPct.toFixed(1)}%`;
      const entryStr = p.entryPx < 0.01 ? `$${p.entryPx.toPrecision(4)}` : p.entryPx < 1 ? `$${p.entryPx.toFixed(4)}` : p.entryPx >= 1000 ? `$${p.entryPx.toFixed(0)}` : `$${p.entryPx.toFixed(2)}`;
      const line = `${p.side.padEnd(5)} ${p.coin.padEnd(10)} ${fmtUsdNoSign(p.valueUsd).padStart(8)} @ ${entryStr.padStart(8)} ${p.leverage}x  ${fmtUsd(p.uPnl).padStart(8)} (${pnlStr})\n`;
      append(line);
    }

    current += '```\n';
    inCodeBlock = false;
  }

  flush();
  return messages;
}

// ============================================================
// FORMAT REPORT
// ============================================================

function formatReport(results: WalletResult[]): string[] {
  const now = new Date();
  const timeStr = now.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  const messages: string[] = [];
  const DISCORD_LIMIT = 1950;

  let current = `**SM Whale Report -- ${timeStr}**\n`;

  function flush() {
    if (current.trim()) {
      messages.push(current.trim());
      current = '';
    }
  }

  function append(text: string) {
    if ((current + text).length > DISCORD_LIMIT) {
      flush();
    }
    current += text;
  }

  // Group by tier
  for (const tierKey of TIER_ORDER) {
    const tierWallets = results.filter(r => r.whale.tier === tierKey);
    const activeWallets = tierWallets.filter(r => r.equity > 100 && r.positions.length > 0);
    if (activeWallets.length === 0) continue;

    const tierLabel = TIER_LABEL[tierKey];
    append(`\n**=== ${tierLabel} (${activeWallets.length} wallets) ===**\n`);

    for (const w of activeWallets) {
      let line = `**${w.whale.name}** (${shortAddr(w.address)}): ${fmtUsdNoSign(w.equity)} eq`;
      if (w.totalUPnl !== 0) line += ` | uPnl ${fmtUsd(w.totalUPnl)}`;
      line += '\n';

      const bigPositions = w.positions.filter(p => p.valueUsd >= MIN_POSITION_VALUE);
      if (bigPositions.length > 0) {
        const shown = bigPositions.slice(0, MAX_POSITIONS_PER_WALLET);
        const hidden = bigPositions.length - shown.length;
        const posStrs = shown.map(p => {
          const pnlStr = Math.abs(p.uPnl) >= 1000 ? ` (${fmtUsd(p.uPnl)})` : '';
          return `${p.side} ${p.coin} ${fmtUsdNoSign(p.valueUsd)}${pnlStr}`;
        });
        if (hidden > 0) posStrs.push(`+${hidden} more`);
        line += `> ${posStrs.join(' | ')}\n`;
      } else if (w.positions.length > 0) {
        line += `> ${w.positions.length} small positions (<$100K each)\n`;
      } else {
        line += '> No positions\n';
      }

      append(line);
    }
  }

  flush();

  // ============================================================
  // AGGREGATE SUMMARY — per-coin long vs short
  // ============================================================

  const coinAgg: Record<string, CoinAggregate> = {};

  for (const w of results) {
    for (const p of w.positions) {
      if (!coinAgg[p.coin]) coinAgg[p.coin] = { longUsd: 0, shortUsd: 0, longUPnl: 0, shortUPnl: 0 };
      if (p.side === 'LONG') {
        coinAgg[p.coin].longUsd += p.valueUsd;
        coinAgg[p.coin].longUPnl += p.uPnl;
      } else {
        coinAgg[p.coin].shortUsd += p.valueUsd;
        coinAgg[p.coin].shortUPnl += p.uPnl;
      }
    }
  }

  // Sort coins by total notional value
  const sortedCoins = Object.entries(coinAgg)
    .map(([coin, agg]) => ({ coin, ...agg, total: agg.longUsd + agg.shortUsd }))
    .filter(c => c.total >= MIN_AGGREGATE_VALUE)
    .sort((a, b) => b.total - a.total);

  if (sortedCoins.length > 0) {
    const lines: string[] = [];
    for (const c of sortedCoins) {
      const totalSide = c.shortUsd > c.longUsd ? 'SHORT' : 'LONG';
      const dominant = Math.max(c.shortUsd, c.longUsd);
      const pctDominant = c.total > 0 ? ((dominant / c.total) * 100).toFixed(0) : '0';
      const totalUPnl = c.longUPnl + c.shortUPnl;
      const pnlStr = Math.abs(totalUPnl) >= 1000 ? ` uPnl ${fmtUsd(totalUPnl)}` : '';
      lines.push(`${c.coin.padEnd(10)} ${fmtUsdNoSign(c.shortUsd).padStart(8)} SHORT vs ${fmtUsdNoSign(c.longUsd).padStart(8)} LONG  (${pctDominant}% ${totalSide})${pnlStr}`);
    }

    // Split aggregate into chunks that fit Discord limit
    let chunk = '**=== AGGREGATE SUMMARY ===**\n```\n';
    for (const line of lines) {
      if ((chunk + line + '\n```').length > DISCORD_LIMIT) {
        chunk += '```';
        messages.push(chunk);
        chunk = '```\n';
      }
      chunk += line + '\n';
    }
    chunk += '```';
    messages.push(chunk);
  }

  return messages;
}

// ============================================================
// DISCORD POSTING
// ============================================================

async function postToDiscord(webhookUrl: string, content: string): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`Discord webhook failed (${res.status}): ${body}`);
  }
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

  console.log(`Fetching positions for ${Object.keys(WHALES).length} whale + ${Object.keys(VIP_WALLETS).length} VIP addresses...`);

  const transport = new hl.HttpTransport();
  const info = new hl.InfoClient({ transport });

  const [results, vipResults] = await Promise.all([
    fetchAllWhales(info),
    fetchVipWallets(info),
  ]);

  const activeCount = results.filter(r => r.equity > 100).length;
  const closedCount = results.length - activeCount;

  console.log(`Fetched ${results.length} wallets (${activeCount} active, ${closedCount} closed/empty) + ${vipResults.length} VIPs`);

  const whaleMessages = formatReport(results);
  const vipMessages = formatVipSection(vipResults);
  const messages = [...whaleMessages, ...vipMessages];

  for (const msg of messages) {
    console.log(msg);
    console.log('---');
  }

  if (webhookUrl && !dryRun) {
    for (let i = 0; i < messages.length; i++) {
      await postToDiscord(webhookUrl, messages[i]);
      if (i < messages.length - 1) await sleep(500); // Rate limit between messages
    }
    console.log(`Sent ${messages.length} message(s) to Discord`);
  } else {
    console.log('[DRY RUN] Skipping Discord post');
  }
}

main().catch(async err => {
  const errMsg = `Whale report error: ${String(err.message || err)}`;
  console.error(errMsg);

  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (webhookUrl) {
    await postToDiscord(webhookUrl, errMsg).catch(() => {});
  }
  process.exit(1);
});
