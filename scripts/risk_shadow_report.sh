#!/usr/bin/env bash
cd /root/hyperliquid-mm-bot-complete

timestamp="$(date -Iseconds)"

python3 << 'PY' | sed "s/^/[$timestamp] /" | tee -a data/risk_shadow_summary.log
import json, os

path = "data/risk_shadow.log"
if not os.path.exists(path):
    print("RISK_SHADOW: brak pliku data/risk_shadow.log")
    raise SystemExit(0)

pairs = {}
total = 0

with open(path) as f:
    for line in f:
        if "[RISK_SHADOW]" not in line:
            continue
        i = line.find("{")
        if i == -1:
            continue
        try:
            obj = json.loads(line[i:])
        except json.JSONDecodeError:
            continue

        total += 1
        pair = obj.get("pair", "UNKNOWN")
        pnl = obj.get("pnlUsd")
        d = pairs.setdefault(pair, {
            "count": 0,
            "min": None,
            "max": None,
            "lt_10": 0,
            "lt_20": 0,
            "lt_30": 0,
        })
        d["count"] += 1
        if isinstance(pnl, (int, float)):
            d["min"] = pnl if d["min"] is None or pnl < d["min"] else d["min"]
            d["max"] = pnl if d["max"] is None or pnl > d["max"] else d["max"]
            if pnl <= -10: d["lt_10"] += 1
            if pnl <= -20: d["lt_20"] += 1
            if pnl <= -30: d["lt_30"] += 1

print("RISK_SHADOW HOURLY SUMMARY")
print("total_events:", total)
for pair, d in sorted(pairs.items()):
    print(f"{pair}: count={d['count']}, minPnL={d['min']}, maxPnL={d['max']}, "
          f"<=-10$={d['lt_10']}, <=-20$={d['lt_20']}, <=-30$={d['lt_30']}")
PY
