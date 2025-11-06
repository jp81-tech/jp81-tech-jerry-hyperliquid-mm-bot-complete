# 🌙 Nocna Lista Kontrolna MM Bot

## Szybki Przegląd (jedna komenda)

```bash
ssh root@207.246.92.212
cd /root/hyperliquid-mm-bot-complete
./scripts/nocny_przeglad.sh
```

---

## 🚨 Czerwone Flagi — Natychmiastowa Reakcja

### 1. ZK Position -189 USDC (notional 7222 > cap 800) ⚠️
**Problem:** Pozycja ZK 9x ponad limit, strata -189 USDC  
**Akcja:** Natychmiastowa redukcja lub podniesienie limitu

**Opcja A — Redukcja manualnie:**
```bash
# TODO: Potrzebny taker_exit.js lub manual close przez exchange
```

**Opcja B — Podnieś limit tymczasowo (jeśli świadomie):**
```bash
cd /root/hyperliquid-mm-bot-complete
sed -i 's/^ZK_INVENTORY_CAP_USD=.*/ZK_INVENTORY_CAP_USD=8000/' .env
sed -i 's/^ZK_MAX_POSITION_USD=.*/ZK_MAX_POSITION_USD=10000/' .env
cp .env src/.env
```

### 2. HYPE & ZEC > Caps (ale zyskowne)
**Stan:** HYPE 2788 USD (+45), ZEC 5416 USD (+90)  
**Akcja:** Monitor — pozycje zyskowne, naturalne zejście OK

---

## ✅ Zielone Sygnały (Current State)

- **18 aktywnych orderów** (target: 16 = 4×4, actual: better!)
- **Layers:** HYPE 5/4 ✅, ZEC 5/4 ✅, FARTCOIN 5/4 ✅, ZK 3/4 ⚠️
- **Performance:** 198 fills/h, $10,700 turnover, -0.95 bps fees ✅
- **FARTCOIN:** W limicie (510 < 600) ✅

---

## 📋 Akcje Standardowe

### Włącz Panic Auto-Exit (gdy chcesz automation)
```bash
cd /root/hyperliquid-mm-bot-complete
sed -i 's/^PANIC_TAKER_EXECUTE=.*/PANIC_TAKER_EXECUTE=true/' .env
cp .env src/.env
```

### Dokręć Spread dla Pary (jeśli za dużo małych strat)
```bash
# Przykład: HYPE min spread 8 bps
cd /root/hyperliquid-mm-bot-complete
sed -i 's/^HYPE_MIN_L1_SPREAD_BPS=.*/HYPE_MIN_L1_SPREAD_BPS=8/' .env
cp .env src/.env
```

### Snapshot AFTER (po 45 min od BEFORE)
```bash
cd /root/hyperliquid-mm-bot-complete
./scripts/snapshot_now.sh
# Skopiuj output path, np: runtime/snapshot_20251105T060000Z
```

### Porównanie Before/After
```bash
cd /root/hyperliquid-mm-bot-complete
./scripts/compare_snapshots.sh \
  runtime/snapshot_20251105T052314Z \
  runtime/snapshot_20251105T060000Z
```

---

## 🔍 Monitorowanie Ciągłe

### Co 10-15 min sprawdzaj:
```bash
ssh root@207.246.92.212
cd /root/hyperliquid-mm-bot-complete
./scripts/nocny_przeglad.sh | tee runtime/nocny_$(date +%H%M).txt
```

### Webhook Alerts
- **Slack:** Sprawdź channel dla guardrail breach
- **Discord:** Sprawdź channel dla panic watch
- Co 3 min: guardrails_watch.ts
- Co 2 min: panic_taker.ts
- Co 15 min: alerts.ts (performance)

---

## 🎯 Progi Decyzyjne

| Metryka | Zielony | Żółty | Czerwony | Akcja |
|---------|---------|-------|----------|-------|
| Notional vs Cap | <600 | 600-1000 | >1000 | Redukcja lub podwyżka limitu |
| Unrealized PnL | >-10 USD | -10 do -35 USD | <-35 USD | Monitor / Panic exit |
| Layers per pair | ≥4 | 3 | <3 | Check spread, wait for enforcer |
| Maker share | >80% | 70-80% | <70% | Widen spreads |
| Fills/h | >150 | 100-150 | <100 | Check if market dead |

---

## 📞 Szybkie Komendy (Copy-Paste)

**Bot restart:**
```bash
ssh root@207.246.92.212 "cd /root/hyperliquid-mm-bot-complete && cp .env src/.env && pm2 restart hyperliquid-mm --update-env"
```

**Logs ostatnie 100:**
```bash
ssh root@207.246.92.212 "pm2 logs hyperliquid-mm --lines 100 --nostream"
```

**Guardrails ostatnie 40:**
```bash
ssh root@207.246.92.212 "tail -n 40 /root/hyperliquid-mm-bot-complete/runtime/guardrails.log"
```

**Crontab verify:**
```bash
ssh root@207.246.92.212 "crontab -l | grep -E '(panic|guardrails|alerts|snapshot)'"
```

---

## 📸 BEFORE Snapshot Baseline

**Path:** `runtime/snapshot_20251105T052314Z`  
**Time:** 05:23:14 UTC (23:23 CET)  
**Turnover:** $10,860  
**Fills:** 199/h  
**Layers:** HYPE(1), ZK(2), ZEC(1), FARTCOIN(2) = 6 total

**Target After 45 min:** Layers increase to 12-16, turnover steady, PnL hygiene improved

---

Generated: 2025-11-05 05:31 UTC

---

## 📊 Per-Fill PnL Histograms (NEW!)

### Quick Ad-Hoc Analysis

**Overall histogram (last 6h):**
```bash
cd /root/hyperliquid-mm-bot-complete
npx tsx scripts/perfill_hist.ts 6 0.25
```

**Per-pair breakdown (last 6h):**
```bash
cd /root/hyperliquid-mm-bot-complete
npx tsx scripts/perfill_bypair.ts 6 0.25
```

### Jak Czytać Histogram

**Zdrowe MM:**
- avg ≈ 0 lub lekko dodatnie
- <0% (odsetek strat) ≤ 55%
- p50 (median) ≥ 0
- Większość filli w przedziale -0.25..+0.25 USDC

**Problem pair (wymaga akcji):**
- avg < -0.10 USDC
- <0% > 60%
- p50 < 0
- Garb po stronie ujemnej (-0.75..-1.50)

### Akcje Naprawcze

**Jeśli garb ujemny w -0.6..-1.5 USDC:**
```bash
# Podnieś MIN_L1_SPREAD_BPS o +1-2 bps
cd /root/hyperliquid-mm-bot-complete
sed -i 's/^ZK_MIN_L1_SPREAD_BPS=.*/ZK_MIN_L1_SPREAD_BPS=8/' .env
cp .env src/.env
pm2 restart hyperliquid-mm --update-env
```

**Jeśli długi ogon ujemny (rzadkie duże straty):**
```bash
# Obniż CLIP_USD lub MAX_POSITION_USD
cd /root/hyperliquid-mm-bot-complete
sed -i 's/^ZK_CLIP_USD=.*/ZK_CLIP_USD=30/' .env
cp .env src/.env
pm2 restart hyperliquid-mm --update-env
```

### Automatyczne Raporty

**Daily report o 23:59 CET zawiera teraz:**
- Turnover/fills summary
- Per-pair PnL histograms (24h)
- 4 CSV files (jeden per para)

**Cron co 30 min (opcjonalne):**
```bash
(crontab -l | grep -v perfill_hist.ts; echo "*/30 * * * * cd /root/hyperliquid-mm-bot-complete && npx tsx scripts/perfill_hist.ts 6 0.25 >> runtime/alerts.log 2>&1") | crontab -
```

---

Updated: 2025-11-05 06:20 UTC
