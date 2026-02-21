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

const WHALES: Record<string, WhaleEntry> = {
  // === TIER 1: CONVICTION TRADERS ===
  '0xb317d2bc2d3d2df5fa441b5bae0ab9d8b07283ae': { name: 'Bitcoin OG', tier: 'CONVICTION', weight: 1.0 },
  '0xbaae15f6ffe2aa6e0e9ffde6f1888c8092f4b22a': { name: 'SM baae15', tier: 'CONVICTION', weight: 0.95 },
  '0x2ed5c47a79c27c75188af495a8093c22ada4f6e7': { name: 'SM 2ed5c4', tier: 'CONVICTION', weight: 0.85 },
  '0x689f15c9047f73c974e08c70f12a5d6a19f45c15': { name: 'SM 689f15', tier: 'CONVICTION', weight: 0.85 },
  '0x3c363e96d22c056d748f199fb728fc80d70e461a': { name: 'SM 3c363e', tier: 'CONVICTION', weight: 0.80 },
  '0xa312114b5795dff9b8db50474dd57701aa78ad1e': { name: 'General a31211', tier: 'CONVICTION', weight: 1.0 },
  '0x35d1151ef1aab579cbb3109e69fa82f94ff5acb1': { name: 'Major 35d115', tier: 'CONVICTION', weight: 0.95 },
  '0x5d2f4460ac3514ada79f5d9838916e508ab39bb7': { name: 'Pulkownik 5d2f44', tier: 'CONVICTION', weight: 0.95 },
  '0x45d26f28196d226497130c4bac709d808fed4029': { name: 'Wice-General 45d26f', tier: 'CONVICTION', weight: 0.9 },
  '0x06cecfbac34101ae41c88ebc2450f8602b3d164b': { name: 'SM 06cecf', tier: 'CONVICTION', weight: 0.85 },
  '0x6bea81d7a0c5939a5ce5552e125ab57216cc597f': { name: 'SM 6bea81', tier: 'CONVICTION', weight: 0.80 },
  '0x936cf4fb95c30ce83f658b5bbb247e4bb381bb0f': { name: 'SM 936cf4', tier: 'CONVICTION', weight: 0.75 },
  '0x71dfc07de32c2ebf1c4801f4b1c9e40b76d4a23d': { name: 'SM 71dfc0', tier: 'CONVICTION', weight: 0.9 },
  '0x519c721de735f7c9e6146d167852e60d60496a47': { name: 'SM 519c72', tier: 'CONVICTION', weight: 0.85 },
  '0xea6670ebdb4a388a8cfc16f6497bf4f267b061ee': { name: 'SM ea6670', tier: 'CONVICTION', weight: 0.85 },
  '0x92e9773ad2b4ba6e2e57e7fc1f9305aef80ab6c2': { name: 'SM 92e977', tier: 'CONVICTION', weight: 0.80 },
  '0x56cd86d6ef24a3f51ce6992b7f1db751b0a0276a': { name: 'Token Mill. 56cd86', tier: 'CONVICTION', weight: 0.85 },
  '0xd7a678fcf72c1b602850ef2f3e2d668ec41fa0ed': { name: 'Winner d7a678', tier: 'CONVICTION', weight: 0.85 },
  '0x1e771e1b95c86491299d6e2a5c3b3842d03b552e': { name: 'SM 1e771e', tier: 'CONVICTION', weight: 0.75 },
  '0xa2acb1c1d689fd3785696277537a504fcea8d1d0': { name: 'Hikari', tier: 'CONVICTION', weight: 0.75 },
  '0x8a0cd16a004e21e04936a0a01c6f5a49ff937914': { name: 'SM 8a0cd1', tier: 'CONVICTION', weight: 0.75 },
  '0x091159a8106b077c13e89bc09701117e8b5f129a': { name: 'SM 091159 (Legacy)', tier: 'CONVICTION', weight: 0.75 },
  '0x0b23968e02c549f99ff77b6471be3a78cbfff37b': { name: 'SM 0b2396 (Legacy)', tier: 'CONVICTION', weight: 0.70 },

  // === TIER 2: INSTITUTIONAL / FUNDS ===
  '0xcac19662ec88d23fa1c81ac0e8570b0cf2ff26b3': { name: 'Galaxy Digital', tier: 'FUND', weight: 0.85 },
  '0x8def9f50456c6c4e37fa5d3d57f108ed23992dae': { name: 'Laurent Zeimes', tier: 'FUND', weight: 0.8 },
  '0xc4241dc9bfeb5126c0766df35a87ed3fbd630c78': { name: 'Arrington XRP', tier: 'FUND', weight: 0.7 },
  '0x418aa6bf98a2b2bc93779f810330d88cde488888': { name: '58bro.eth', tier: 'FUND', weight: 0.8 },
  '0x6f9bb7e454f5b3eb2310343f0e99269dc2bb8a1d': { name: 'Arrington Legacy', tier: 'FUND', weight: 0.6 },

  // === TIER 3: ACTIVE TRADERS ===
  '0x9eec98d048d06d9cd75318fffa3f3960e081daab': { name: 'SM 9eec98', tier: 'ACTIVE', weight: 0.85 },
  '0xfeec88b13fc0be31695069f02bac18538a154e9c': { name: 'SM feec88', tier: 'ACTIVE', weight: 0.80 },
  '0xfce053a5e461683454bf37ad66d20344c0e3f4c0': { name: 'SM fce053', tier: 'ACTIVE', weight: 0.80 },
  '0x99b1098d9d50aa076f78bd26ab22e6abd3710729': { name: 'SM 99b109', tier: 'ACTIVE', weight: 0.80 },
  '0xc7290b4b308431a985fa9e3e8a335c2f7650517c': { name: 'SM c7290b', tier: 'ACTIVE', weight: 0.65 },
  '0x570b09e27a87f9acbce49f85056745d29b3ee3c6': { name: 'SM 570b09', tier: 'ACTIVE', weight: 0.60 },
  '0xe2823659be02e0f48a4660e4da008b5e1abfdf29': { name: 'SM e28236', tier: 'ACTIVE', weight: 0.60 },
  '0x039405fa4636364e6023df1e06b085a462b9cdc9': { name: 'SM 039405', tier: 'ACTIVE', weight: 0.65 },
  '0x179c17d04be626561b0355a248d6055a80456aa5': { name: 'SM 179c17', tier: 'ACTIVE', weight: 0.60 },
  '0xbe494a5e3a719a78a45a47ab453b7b0199d9d101': { name: 'SM be494a', tier: 'ACTIVE', weight: 0.60 },
  '0xe4d83945c0322f3d340203a7129b7eb5cacae847': { name: 'SM e4d839', tier: 'ACTIVE', weight: 0.60 },
  '0xb1694de2324433778487999bd86b1acb3335ebc4': { name: 'SM b1694d', tier: 'ACTIVE', weight: 0.55 },
  '0xa4be91acc74feabab71b8878b66b8f5277212520': { name: 'SM a4be91', tier: 'ACTIVE', weight: 0.55 },
  '0x95e2687b07f0dec34462fdab6bbebcc0b3ab49c6': { name: 'SM 95e268', tier: 'ACTIVE', weight: 0.50 },
  '0x6a7a17046df7d3e746ce97d67dc1c6c55e27ce75': { name: 'SM 6a7a17', tier: 'ACTIVE', weight: 0.50 },
  '0xa6cb81271418b9f41295fff54be05f6250c7cbf6': { name: 'SM a6cb81', tier: 'ACTIVE', weight: 0.50 },
  '0x106943709714fb0e5e62b82f5013ebc762591ae1': { name: 'SM 106943', tier: 'ACTIVE', weight: 0.50 },
  '0x0980b34ade9476dba81bcdb0f865a333793ad1c2': { name: 'SM 0980b3', tier: 'ACTIVE', weight: 0.50 },
  '0x782e432267376f377585fc78092d998f8442ab83': { name: 'SM 782e43', tier: 'ACTIVE', weight: 0.50 },
  '0xdca131ba8f428bd2f90ae962e4cb2d226312505e': { name: 'SM dca131', tier: 'ACTIVE', weight: 0.55 },
  '0x649156ebf0a350deb18a1e4835873defd4dc5349': { name: 'donkstrategy.eth', tier: 'ACTIVE', weight: 0.55 },
  '0xe82bc65677e46b6626a8e779ac263221db039c2d': { name: 'SM e82bc6', tier: 'ACTIVE', weight: 0.55 },
  '0xb12f7415705d9d1cee194e73ca0f8aaffb8b77cd': { name: 'fuckingbot.eth', tier: 'ACTIVE', weight: 0.50 },
  '0x84abc08c0ea62e687c370154de1f38ea462f4d37': { name: 'SM 84abc0', tier: 'ACTIVE', weight: 0.50 },
  '0xc12f6e6f7a11604871786db86abf33fdf36fb0ad': { name: 'SM c12f6e', tier: 'ACTIVE', weight: 0.50 },
  '0x61f2bb695d81ac9fce0b1d01fd45cc6b2925a571': { name: 'SM 61f2bb', tier: 'ACTIVE', weight: 0.50 },
  '0xdbcc96bcada067864902aad14e029fe7c422f147': { name: 'SM dbcc96', tier: 'ACTIVE', weight: 0.50 },
  '0x0c4926daf1250b8da7b9fc339f304d923b94d346': { name: 'DOGE Legacy', tier: 'ACTIVE', weight: 0.50 },
  '0xe71cbf47fff309813bcea54f3ecf49a5f129264d': { name: 'LIT Long Legacy', tier: 'ACTIVE', weight: 0.50 },
};

// ============================================================
// TYPES
// ============================================================

interface WalletResult {
  address: string;
  whale: WhaleEntry;
  equity: number;
  totalUPnl: number;
  positions: { coin: string; side: 'LONG' | 'SHORT'; valueUsd: number; uPnl: number }[];
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

          positions.push({
            coin: p.coin,
            side: szi > 0 ? 'LONG' : 'SHORT',
            valueUsd,
            uPnl,
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
// FORMAT REPORT
// ============================================================

function formatReport(results: WalletResult[]): string[] {
  const now = new Date();
  const timeStr = now.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  const messages: string[] = [];

  // Header
  let header = `**SM Whale Report -- ${timeStr}**\n`;

  // Group by tier
  for (const tierKey of TIER_ORDER) {
    const tierWallets = results.filter(r => r.whale.tier === tierKey);
    // Skip tier if no wallets with positions
    const activeWallets = tierWallets.filter(r => r.equity > 100 && r.positions.length > 0);
    if (activeWallets.length === 0) continue;

    const tierLabel = TIER_LABEL[tierKey];
    let section = `\n**=== ${tierLabel} (${activeWallets.length} wallets) ===**\n`;

    for (const w of activeWallets) {
      // Wallet header line
      let line = `**${w.whale.name}** (${shortAddr(w.address)}): ${fmtUsdNoSign(w.equity)} eq`;
      if (w.totalUPnl !== 0) line += ` | uPnl ${fmtUsd(w.totalUPnl)}`;
      line += '\n';

      // Positions (only > $100K, capped at MAX_POSITIONS_PER_WALLET)
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

      section += line;
    }

    // Check if adding this section would exceed Discord limit
    // If so, push current message and start new one
    if ((header + section).length > 1900) {
      messages.push(header.trim());
      header = section;
    } else {
      header += section;
    }
  }

  // Push remaining content
  if (header.trim()) {
    messages.push(header.trim());
  }

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
    let summary = '**=== AGGREGATE SUMMARY ===**\n```\n';

    for (const c of sortedCoins) {
      const totalSide = c.shortUsd > c.longUsd ? 'SHORT' : 'LONG';
      const dominant = Math.max(c.shortUsd, c.longUsd);
      const pctDominant = c.total > 0 ? ((dominant / c.total) * 100).toFixed(0) : '0';
      const totalUPnl = c.longUPnl + c.shortUPnl;
      const pnlStr = Math.abs(totalUPnl) >= 1000 ? ` uPnl ${fmtUsd(totalUPnl)}` : '';
      summary += `${c.coin.padEnd(10)} ${fmtUsdNoSign(c.shortUsd).padStart(8)} SHORT vs ${fmtUsdNoSign(c.longUsd).padStart(8)} LONG  (${pctDominant}% ${totalSide})${pnlStr}\n`;
    }

    summary += '```';

    // Check if summary fits in last message
    const lastMsg = messages[messages.length - 1];
    if (lastMsg && (lastMsg + '\n' + summary).length <= 2000) {
      messages[messages.length - 1] = lastMsg + '\n' + summary;
    } else {
      messages.push(summary);
    }
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

  console.log(`Fetching positions for ${Object.keys(WHALES).length} whale addresses...`);

  const transport = new hl.HttpTransport();
  const info = new hl.InfoClient({ transport });

  const results = await fetchAllWhales(info);
  const activeCount = results.filter(r => r.equity > 100).length;
  const closedCount = results.length - activeCount;

  console.log(`Fetched ${results.length} wallets (${activeCount} active, ${closedCount} closed/empty)`);

  const messages = formatReport(results);

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
