import csv
import sys
from datetime import datetime, timedelta
from collections import defaultdict

CSV_PATH = "alerts_liquidity.csv"

def parse_float(x):
    try:
        return float(x)
    except (ValueError, TypeError):
        return None

def main():
    path = CSV_PATH
    if len(sys.argv) > 1:
        path = sys.argv[1]

    try:
        with open(path, "r") as f:
            rows = list(csv.reader(f))
    except FileNotFoundError:
        print(f"Brak pliku: {path}")
        return

    now = datetime.utcnow()
    cutoff = now - timedelta(hours=24)

    grouped = defaultdict(list)

    for row in rows:
        if not row: continue
        try:
            ts_str, kind, symbol, dex, chain, risk, liq, ratio, ch5, ch1, ch24 = row
        except ValueError: continue

        try:
            ts = datetime.fromisoformat(ts_str)
        except ValueError: continue

        if ts < cutoff: continue

        grouped[(symbol, kind)].append({
            "ts": ts,
            "dex": dex,
            "chain": chain,
            "risk": risk,
            "liq": parse_float(liq),
            "ratio": parse_float(ratio),
            "ch5": parse_float(ch5),
            "ch1": parse_float(ch1),
            "ch24": parse_float(ch24),
        })

    if not grouped:
        print("Brak alertów z ostatnich 24h.")
        return

    print(f"📊 Liquidity Alerts – ostatnie 24h (do {now.isoformat()} UTC)\n")

    for (symbol, kind), alerts in sorted(grouped.items()):
        alerts_sorted = sorted(alerts, key=lambda x: x["ts"])
        last = alerts_sorted[-1]
        count = len(alerts_sorted)

        print(f"=== {symbol} [{kind}] ===")
        print(f"Liczba alertów: {count}")
        print(f"Ostatni: {last['ts'].isoformat()}  |  {last['dex']} / {last['chain']}")
        print(f"Ostatni risk: {last['risk']}")
        if last["liq"] is not None:
            print(f"Aktualna płynność: ${last['liq']:,.0f}")
        if last["ratio"] is not None:
            print(f"Liq/MCap: {last['ratio']:.2%}")
        if kind == "risk":
            print(
                "Zmiany: "
                f"5m={last['ch5'] or 0:+.1f}%, "
                f"1h={last['ch1'] or 0:+.1f}%, "
                f"24h={last['ch24'] or 0:+.1f}%"
            )
        print()

if __name__ == "__main__":
    main()

