#!/usr/bin/env -S npx tsx
import * as hl from '@nktkas/hyperliquid';
import { config } from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

config({ path: path.resolve(process.cwd(), '.env') });

// ============================================================
// WHALE ADDRESSES — synced from daily-whale-report.ts (post-audit 23.02)
// Tiers 1-3 only (Tier 4 Market Makers excluded)
// ============================================================

interface WhaleEntry {
  name: string;
  tier: 'CONVICTION' | 'FUND' | 'ACTIVE';
  weight: number;
}

const WHALES: Record<string, WhaleEntry> = {
  // === TIER 1: CONVICTION TRADERS ===
  '0xb317d2bc2d3d2df5fa441b5bae0ab9d8b07283ae': { name: 'Bitcoin OG (WATCH)', tier: 'CONVICTION', weight: 0.10 },
  '0x2ea18c23f72a4b6172c55b411823cdc5335923f4': { name: 'Bitcoin OG #2 (WATCH)', tier: 'CONVICTION', weight: 0.10 },
  '0xd7a678fcf72c1b602850ef2f3e2d668ec41fa0ed': { name: 'Winner d7a678 (WATCH)', tier: 'CONVICTION', weight: 0.10 },
  '0x3c363e96d22c056d748f199fb728fc80d70e461a': { name: 'SM 3c363e', tier: 'CONVICTION', weight: 0.80 },
  '0xa312114b5795dff9b8db50474dd57701aa78ad1e': { name: 'Genera\u0142', tier: 'CONVICTION', weight: 1.0 },
  '0x35d1151ef1aab579cbb3109e69fa82f94ff5acb1': { name: 'Major', tier: 'CONVICTION', weight: 0.95 },
  '0x5d2f4460ac3514ada79f5d9838916e508ab39bb7': { name: 'Pu\u0142kownik', tier: 'CONVICTION', weight: 0.95 },
  '0x45d26f28196d226497130c4bac709d808fed4029': { name: 'Wice-Genera\u0142', tier: 'CONVICTION', weight: 0.9 },
  '0x06cecfbac34101ae41c88ebc2450f8602b3d164b': { name: 'Kraken A \u2B50', tier: 'CONVICTION', weight: 0.90 },
  '0x6bea81d7a0c5939a5ce5552e125ab57216cc597f': { name: 'Porucznik SOL2', tier: 'CONVICTION', weight: 0.80 },
  '0x936cf4fb95c30ce83f658b5bbb247e4bb381bb0f': { name: 'Porucznik SOL3', tier: 'CONVICTION', weight: 0.75 },
  '0x71dfc07de32c2ebf1c4801f4b1c9e40b76d4a23d': { name: 'Kapitan BTC', tier: 'CONVICTION', weight: 0.9 },
  '0x519c721de735f7c9e6146d167852e60d60496a47': { name: 'ZEC Conviction', tier: 'CONVICTION', weight: 0.85 },
  '0xea6670ebdb4a388a8cfc16f6497bf4f267b061ee': { name: 'Porucznik ea66', tier: 'CONVICTION', weight: 0.85 },
  '0x92e9773ad2b4ba6e2e57e7fc1f9305aef80ab6c2': { name: 'BTC/LIT Trader', tier: 'CONVICTION', weight: 0.80 },
  '0x56cd86d6ef24a3f51ce6992b7f1db751b0a0276a': { name: 'Kraken B \u2B50', tier: 'CONVICTION', weight: 0.85 },
  '0x1e771e1b95c86491299d6e2a5c3b3842d03b552e': { name: 'SM 1e771e', tier: 'CONVICTION', weight: 0.75 },
  '0x091159a8106b077c13e89bc09701117e8b5f129a': { name: 'Kontrarian 091159 (WATCH)', tier: 'CONVICTION', weight: 0.10 },

  // === TIER 2: INSTITUTIONAL / FUNDS ===
  '0xcac19662ec88d23fa1c81ac0e8570b0cf2ff26b3': { name: 'Galaxy Digital', tier: 'FUND', weight: 0.85 },
  '0x8def9f50456c6c4e37fa5d3d57f108ed23992dae': { name: 'Laurent Zeimes', tier: 'FUND', weight: 0.8 },
  '0xc4241dc9bfeb5126c0766df35a87ed3fbd630c78': { name: 'Arrington XRP', tier: 'FUND', weight: 0.7 },
  '0x418aa6bf98a2b2bc93779f810330d88cde488888': { name: '58bro.eth', tier: 'FUND', weight: 0.8 },

  // === TIER 3: ACTIVE TRADERS ===
  '0xfeec88b13fc0be31695069f02bac18538a154e9c': { name: 'Kapitan feec \u2B50', tier: 'ACTIVE', weight: 0.80 },
  '0xfce053a5e461683454bf37ad66d20344c0e3f4c0': { name: 'Kapitan fce0 \u2B50', tier: 'ACTIVE', weight: 0.80 },
  '0x99b1098d9d50aa076f78bd26ab22e6abd3710729': { name: 'Kapitan 99b1 \u2B50', tier: 'ACTIVE', weight: 0.80 },
  '0xc7290b4b308431a985fa9e3e8a335c2f7650517c': { name: 'OG Shorter c7290b', tier: 'ACTIVE', weight: 0.65 },
  '0x570b09e27a87f9acbce49f85056745d29b3ee3c6': { name: 'Kontrarian 570b09 (WATCH)', tier: 'ACTIVE', weight: 0.10 },
  '0x179c17d04be626561b0355a248d6055a80456aa5': { name: 'SM 179c17', tier: 'ACTIVE', weight: 0.60 },
  '0xe4d83945c0322f3d340203a7129b7eb5cacae847': { name: 'SM e4d839', tier: 'ACTIVE', weight: 0.60 },
  '0xb1694de2324433778487999bd86b1acb3335ebc4': { name: 'SM b1694d', tier: 'ACTIVE', weight: 0.55 },
  '0xa4be91acc74feabab71b8878b66b8f5277212520': { name: 'SM a4be91', tier: 'ACTIVE', weight: 0.55 },
  '0x6a7a17046df7d3e746ce97d67dc1c6c55e27ce75': { name: 'SM 6a7a17', tier: 'ACTIVE', weight: 0.50 },
  '0xa6cb81271418b9f41295fff54be05f6250c7cbf6': { name: 'SM a6cb81', tier: 'ACTIVE', weight: 0.50 },
  '0x0980b34ade9476dba81bcdb0f865a333793ad1c2': { name: 'SM 0980b3', tier: 'ACTIVE', weight: 0.50 },
  '0x782e432267376f377585fc78092d998f8442ab83': { name: 'SM 782e43', tier: 'ACTIVE', weight: 0.50 },
  '0xdca131ba8f428bd2f90ae962e4cb2d226312505e': { name: 'SM dca131', tier: 'ACTIVE', weight: 0.55 },
  '0x649156ebf0a350deb18a1e4835873defd4dc5349': { name: 'donkstrategy.eth', tier: 'ACTIVE', weight: 0.65 },
  '0xe82bc65677e46b6626a8e779ac263221db039c2d': { name: 'SM e82bc6', tier: 'ACTIVE', weight: 0.55 },
  '0x84abc08c0ea62e687c370154de1f38ea462f4d37': { name: 'SM 84abc0', tier: 'ACTIVE', weight: 0.50 },
  '0x61f2bb695d81ac9fce0b1d01fd45cc6b2925a571': { name: 'SM 61f2bb', tier: 'ACTIVE', weight: 0.50 },
  '0xdbcc96bcada067864902aad14e029fe7c422f147': { name: 'SM dbcc96', tier: 'ACTIVE', weight: 0.50 },
  // October 2025 BTC crash winners (added 23.02.2026)
  '0x8e096995c3e4a3f0bc5b3ea1cba94de2aa4d70c9': { name: 'Oct Winner 8e0969', tier: 'ACTIVE', weight: 0.65 },
  '0x856c35038594767646266bc7fd68dc26480e910d': { name: 'Oct Winner 856c35', tier: 'ACTIVE', weight: 0.60 },
  '0x4eebd8d39e82efb958e0fa9f694435c910c8518f': { name: 'Oct Winner 4eeb (WATCH)', tier: 'ACTIVE', weight: 0.10 },
};

// ============================================================
// TYPES
// ============================================================

interface PositionSnapshot {
  coin: string;
  side: 'LONG' | 'SHORT';
  valueUsd: number;
  uPnl: number;
  entryPx: number;
  leverage: number;
}

interface WalletSnapshot {
  positions: Record<string, PositionSnapshot>; // keyed by coin
}

type SnapshotFile = Record<string, WalletSnapshot>; // keyed by address

interface Change {
  type: 'NEW' | 'CLOSED' | 'FLIPPED' | 'INCREASED' | 'REDUCED';
  whale: string; // name
  tier: string;
  coin: string;
  side: string;
  value: number;
  uPnl?: number;
  changePct?: number; // for INCREASED/REDUCED
  fromSide?: string;  // for FLIPPED
  toSide?: string;    // for FLIPPED
  prevValue?: number; // for CLOSED
}

// ============================================================
// CONFIG
// ============================================================

const SNAPSHOT_FILE = '/tmp/whale_changes_snapshot.json';
const MIN_POSITION_VALUE = 10_000;  // $10K — lower than daily report ($100K) to catch more changes
const MIN_CHANGE_PCT = 0.10;        // 10% change threshold for INCREASED/REDUCED
const DISCORD_LIMIT = 1950;

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

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function sideEmoji(side: string): string {
  return side === 'SHORT' ? '\uD83D\uDD34' : '\uD83D\uDFE2';
}

// ============================================================
// FETCH ALL WHALE POSITIONS (same pattern as daily-whale-report)
// ============================================================

async function fetchAllPositions(info: hl.InfoClient): Promise<SnapshotFile> {
  const entries = Object.entries(WHALES);
  const snapshot: SnapshotFile = {};
  const BATCH_SIZE = 5;
  const BATCH_DELAY_MS = 200;

  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);

    const settled = await Promise.allSettled(
      batch.map(async ([address]) => {
        const user = address.toLowerCase() as `0x${string}`;
        const state = await info.clearinghouseState({ user });

        const positions: Record<string, PositionSnapshot> = {};

        for (const ap of state.assetPositions) {
          const p = ap.position;
          const szi = parseFloat(p.szi);
          if (szi === 0) continue;

          const entryPx = parseFloat(p.entryPx);
          const valueUsd = Math.abs(szi) * entryPx;
          const uPnl = parseFloat(p.unrealizedPnl);
          const leverage = p.leverage ? parseInt(p.leverage.value) : 0;

          positions[p.coin] = {
            coin: p.coin,
            side: szi > 0 ? 'LONG' : 'SHORT',
            valueUsd,
            uPnl,
            entryPx,
            leverage,
          };
        }

        return { address, positions };
      })
    );

    for (const result of settled) {
      if (result.status === 'fulfilled') {
        snapshot[result.value.address] = { positions: result.value.positions };
      }
      // Rejected = closed account / API error — skip silently
    }

    if (i + BATCH_SIZE < entries.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  return snapshot;
}

// ============================================================
// DETECT CHANGES — ported from whale_tracker.py detect_changes()
// ============================================================

function detectChanges(current: SnapshotFile, previous: SnapshotFile): Change[] {
  const changes: Change[] = [];

  for (const [address, whale] of Object.entries(WHALES)) {
    const currWallet = current[address];
    const prevWallet = previous[address];

    const currPos = currWallet?.positions ?? {};
    const prevPos = prevWallet?.positions ?? {};

    const allCoins = new Set([...Object.keys(currPos), ...Object.keys(prevPos)]);

    for (const coin of allCoins) {
      const curr = currPos[coin];
      const prev = prevPos[coin];

      // Apply min value filter: ignore tiny positions
      const currAboveMin = curr && curr.valueUsd >= MIN_POSITION_VALUE;
      const prevAboveMin = prev && prev.valueUsd >= MIN_POSITION_VALUE;

      // NEW position
      if (currAboveMin && !prevAboveMin) {
        changes.push({
          type: 'NEW',
          whale: whale.name,
          tier: whale.tier,
          coin,
          side: curr.side,
          value: curr.valueUsd,
          uPnl: curr.uPnl,
        });
        continue;
      }

      // CLOSED position
      if (prevAboveMin && !currAboveMin) {
        changes.push({
          type: 'CLOSED',
          whale: whale.name,
          tier: whale.tier,
          coin,
          side: prev.side,
          value: prev.valueUsd,
          prevValue: prev.valueUsd,
        });
        continue;
      }

      // Both exist and above min
      if (currAboveMin && prevAboveMin) {
        // FLIPPED — side changed
        if (curr.side !== prev.side) {
          changes.push({
            type: 'FLIPPED',
            whale: whale.name,
            tier: whale.tier,
            coin,
            side: curr.side,
            value: curr.valueUsd,
            fromSide: prev.side,
            toSide: curr.side,
          });
          continue;
        }

        // INCREASED / REDUCED — significant value change
        if (prev.valueUsd > 0) {
          const changePct = (curr.valueUsd - prev.valueUsd) / prev.valueUsd;
          if (Math.abs(changePct) >= MIN_CHANGE_PCT) {
            changes.push({
              type: changePct > 0 ? 'INCREASED' : 'REDUCED',
              whale: whale.name,
              tier: whale.tier,
              coin,
              side: curr.side,
              value: curr.valueUsd,
              uPnl: curr.uPnl,
              changePct,
              prevValue: prev.valueUsd,
            });
          }
        }
      }
    }
  }

  // Sort: FLIPPED first, then NEW, CLOSED, INCREASED, REDUCED — largest value first within each type
  const typeOrder: Record<string, number> = { FLIPPED: 0, NEW: 1, CLOSED: 2, INCREASED: 3, REDUCED: 4 };
  changes.sort((a, b) => {
    const typeDiff = (typeOrder[a.type] ?? 9) - (typeOrder[b.type] ?? 9);
    if (typeDiff !== 0) return typeDiff;
    return b.value - a.value;
  });

  return changes;
}

// ============================================================
// FORMAT REPORT
// ============================================================

function formatReport(changes: Change[]): string[] {
  const now = new Date();
  const timeStr = `${now.getUTCHours().toString().padStart(2, '0')}:${now.getUTCMinutes().toString().padStart(2, '0')} UTC`;
  const walletCount = Object.keys(WHALES).length;

  // No changes case
  if (changes.length === 0) {
    return [`**\uD83D\uDCCA WHALE CHANGES REPORT (${timeStr})**\n\u2705 No significant changes \u2014 all positions stable\n_${walletCount} wallets tracked | min $10K | min 10% change_`];
  }

  const messages: string[] = [];
  let current = '';

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

  // Group changes by type
  const grouped: Record<string, Change[]> = {};
  for (const c of changes) {
    if (!grouped[c.type]) grouped[c.type] = [];
    grouped[c.type].push(c);
  }

  // Count unique wallets with changes
  const uniqueWallets = new Set(changes.map(c => c.whale));

  // Header
  append(`**\uD83D\uDCCA WHALE CHANGES REPORT (${timeStr})**\n`);
  append(`_Period: ~6h | ${walletCount} wallets tracked_\n`);

  // Section headers and formatting per type
  const sections: { type: string; emoji: string; label: string }[] = [
    { type: 'FLIPPED', emoji: '\uD83D\uDD04', label: 'FLIPPED' },
    { type: 'NEW', emoji: '\uD83C\uDD95', label: 'NEW POSITIONS' },
    { type: 'CLOSED', emoji: '\u274C', label: 'CLOSED' },
    { type: 'INCREASED', emoji: '\uD83D\uDCC8', label: 'INCREASED' },
    { type: 'REDUCED', emoji: '\uD83D\uDCC9', label: 'REDUCED' },
  ];

  for (const section of sections) {
    const items = grouped[section.type];
    if (!items || items.length === 0) continue;

    append(`\n**${section.emoji} ${section.label}:**\n`);

    for (const c of items) {
      let line = '';
      const se = sideEmoji(c.side);

      switch (c.type) {
        case 'NEW':
          line = `${se} **${c.whale}** OPENED ${c.side} ${c.coin} \u2014 ${fmtUsdNoSign(c.value)}`;
          if (c.uPnl && Math.abs(c.uPnl) >= 1000) line += ` (uPnL ${fmtUsd(c.uPnl)})`;
          break;

        case 'CLOSED':
          line = `${se} **${c.whale}** CLOSED ${c.side} ${c.coin} \u2014 was ${fmtUsdNoSign(c.prevValue!)}`;
          break;

        case 'FLIPPED':
          line = `${se} **${c.whale}** FLIPPED ${c.coin}: ${c.fromSide} \u2192 ${c.toSide} \u2014 ${fmtUsdNoSign(c.value)}`;
          break;

        case 'INCREASED':
          line = `${se} **${c.whale}** ${c.side} ${c.coin} +${Math.round(c.changePct! * 100)}% \u2192 ${fmtUsdNoSign(c.value)}`;
          if (c.uPnl && Math.abs(c.uPnl) >= 1000) line += ` (uPnL ${fmtUsd(c.uPnl)})`;
          break;

        case 'REDUCED':
          line = `${se} **${c.whale}** ${c.side} ${c.coin} ${Math.round(c.changePct! * 100)}% \u2192 ${fmtUsdNoSign(c.value)}`;
          if (c.uPnl && Math.abs(c.uPnl) >= 1000) line += ` (uPnL ${fmtUsd(c.uPnl)})`;
          break;
      }

      append(`  ${line}\n`);
    }
  }

  // Summary footer
  append(`\n\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n`);
  append(`**Summary:** ${changes.length} changes across ${uniqueWallets.size} wallets\n`);

  flush();
  return messages;
}

// ============================================================
// SNAPSHOT I/O
// ============================================================

function loadPreviousSnapshot(): SnapshotFile | null {
  try {
    if (!fs.existsSync(SNAPSHOT_FILE)) return null;
    const raw = fs.readFileSync(SNAPSHOT_FILE, 'utf-8');
    return JSON.parse(raw) as SnapshotFile;
  } catch (err) {
    console.error(`Failed to load previous snapshot: ${err}`);
    return null;
  }
}

function saveSnapshot(snapshot: SnapshotFile): void {
  const data = JSON.stringify(snapshot, null, 2);
  fs.writeFileSync(SNAPSHOT_FILE, data, 'utf-8');
}

// ============================================================
// DISCORD POSTING (same as daily-whale-report)
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

  console.log(`[whale-changes] Fetching positions for ${Object.keys(WHALES).length} wallets...`);

  const transport = new hl.HttpTransport();
  const info = new hl.InfoClient({ transport });

  // 1. Load previous snapshot
  const previous = loadPreviousSnapshot();

  // 2. Fetch current positions
  const current = await fetchAllPositions(info);
  const activeCount = Object.values(current).filter(w => Object.keys(w.positions).length > 0).length;
  console.log(`[whale-changes] Fetched ${Object.keys(current).length} wallets (${activeCount} with positions)`);

  // 3. First run — save baseline, no report
  if (!previous) {
    console.log('[whale-changes] No previous snapshot found — saving baseline. No report this run.');
    saveSnapshot(current);
    return;
  }

  // 4. Detect changes
  const changes = detectChanges(current, previous);
  console.log(`[whale-changes] Detected ${changes.length} changes`);

  // 5. Format report
  const messages = formatReport(changes);

  for (const msg of messages) {
    console.log(msg);
    console.log('---');
  }

  // 6. Post to Discord
  if (webhookUrl && !dryRun) {
    for (let i = 0; i < messages.length; i++) {
      await postToDiscord(webhookUrl, messages[i]);
      if (i < messages.length - 1) await sleep(500);
    }
    console.log(`[whale-changes] Sent ${messages.length} message(s) to Discord`);
  } else {
    console.log('[whale-changes] [DRY RUN] Skipping Discord post');
  }

  // 7. Save current as new snapshot (AFTER successful report)
  saveSnapshot(current);
  console.log('[whale-changes] Snapshot saved');
}

main().catch(async err => {
  const errMsg = `Whale changes report error: ${String(err.message || err)}`;
  console.error(errMsg);

  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (webhookUrl) {
    await postToDiscord(webhookUrl, errMsg).catch(() => {});
  }
  process.exit(1);
});
