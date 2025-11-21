#!/usr/bin/env -S npx tsx
/**
 * pair_stats.ts
 *
 * Liczy statystyki per para z logów mm-bot.service:
 * - submits per pair
 * - fills (global + szacowane per pair)
 * - fill rate
 * - submits na godzinę
 *
 * Użycie:
 *   npx tsx scripts/pair_stats.ts
 *   npx tsx scripts/pair_stats.ts --hours=10
 */

import { execSync } from "child_process";

type PairStats = {
  submits: number;
};

type ResultRow = {
  pair: string;
  submits: number;
  estFills: number;
  fillRate: number;
  submitsPerHour: number;
};

function parseHoursArg(): number {
  const arg = process.argv.find((a) => a.startsWith("--hours="));
  if (!arg) return 10;
  const v = Number(arg.split("=")[1]);
  return Number.isFinite(v) && v > 0 ? v : 10;
}

function main() {
  const hours = parseHoursArg();

  console.log(`📊 Pair stats from mm-bot.service (last ${hours}h)\n`);

  let journal: string;
  try {
    journal = execSync(
      `journalctl -u mm-bot.service --since "${hours} hours ago" --no-pager`,
      {
        encoding: "utf8",
        maxBuffer: 50 * 1024 * 1024,
      }
    );
  } catch (err) {
    console.error("❌ Nie udało się pobrać logów z journalctl:", err);
    process.exit(1);
    return;
  }

  const lines = journal.split("\n");

  const pairStats: Record<string, PairStats> = {};
  let totalSubmits = 0;

  // global fills (wszystkie pary) z "Synced X new fills"
  let globalFills = 0;

  for (const line of lines) {
    if (!line) continue;

    // 1) Submits:
    // przykładowy wzorzec:
    // "🔍 DEBUG submit: pair=ZEC size=1.45(145steps) price=516.12(51612ticks) side=sell"
    const submitMatch = line.match(/submit: pair=([A-Z0-9]+)/);
    if (submitMatch) {
      const pair = submitMatch[1];
      if (!pairStats[pair]) {
        pairStats[pair] = { submits: 0 };
      }
      pairStats[pair].submits += 1;
      totalSubmits += 1;
    }

    // 2) Fills (global):
    // przykładowy wzorzec:
    // "✅ Synced 2 new fills | PnL Δ: $0.05"
    const fillsMatch = line.match(/Synced\s+(\d+)\s+new fills/);
    if (fillsMatch) {
      const count = Number(fillsMatch[1]);
      if (Number.isFinite(count)) {
        globalFills += count;
      }
    }
  }

  const pairs = Object.keys(pairStats);
  if (!pairs.length) {
    console.log("Brak submitów w logach w tym oknie czasowym.");
    process.exit(0);
  }

  // Szacowanie fills per pair na podstawie udziału w submitach
  const results: ResultRow[] = pairs.map((pair) => {
    const submits = pairStats[pair].submits;
    const share =
      totalSubmits > 0 ? submits / totalSubmits : 0;
    const estFills = Math.round(globalFills * share);
    const fillRate =
      submits > 0 ? (estFills / submits) * 100 : 0;
    const submitsPerHour = submits / hours;

    return {
      pair,
      submits,
      estFills,
      fillRate,
      submitsPerHour,
    };
  });

  // Sortujemy po liczbie submitów malejąco
  results.sort((a, b) => b.submits - a.submits);

  // Wydruk tabeli
  const header =
    "Pair  | Submits | EstFills | FillRate% | Submits/h";
  const sep = "---------------------------------------------------";
  console.log(header);
  console.log(sep);

  for (const row of results) {
    const pair = row.pair.padEnd(4, " ");
    const submitsStr = row.submits.toString().padStart(7, " ");
    const estFillsStr = row.estFills.toString().padStart(8, " ");
    const fillRateStr = row.fillRate.toFixed(1).padStart(9, " ");
    const perHourStr = row.submitsPerHour.toFixed(1).padStart(9, " ");

    console.log(
      `${pair} | ${submitsStr} | ${estFillsStr} | ${fillRateStr} | ${perHourStr}`
    );
  }

  console.log("\nℹ️  Objaśnienia:");
  console.log(
    "  • EstFills – szacowane fills per para, na podstawie udziału w submitach."
  );
  console.log(
    "  • FillRate% – EstFills / Submits * 100."
  );
  console.log(
    "  • Submits/h – Submits / liczba godzin w oknie."
  );
  console.log(
    `  • Global fills (wszystkie pary łącznie): ${globalFills}`
  );
  console.log(
    `  • Total submits (wszystkie pary łącznie): ${totalSubmits}`
  );
}

main();
