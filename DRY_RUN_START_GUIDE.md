# 🚀 DRY RUN Start Guide

## Quick Start (Na serwerze)

```bash
# 1. Wejście na serwer
ssh root@mm-bot-ny1  # lub Twoje IP/nazwa

# 2. Przejście do katalogu bota
cd /root/hyperliquid-mm-bot-complete

# 3. Automatyczny start w DRY_RUN
./scripts/start-dry-run.sh
```

## Manual Start (Jeśli automatyczny nie działa)

### 1. Ustawienie .env

```bash
cd /root/hyperliquid-mm-bot-complete
nano .env
```

**Upewnij się, że masz:**
```bash
DRY_RUN=true
ENABLE_MULTI_LAYER=true
SPREAD_PROFILE=conservative
BEHAVIOURAL_RISK_MODE=normal
ROTATION_ENABLED=false
NANSEN_ENABLED=true
NANSEN_CONFLICT_CHECK_ENABLED=true
CHASE_MODE_ENABLED=false
```

**W nano:**
- `Ctrl+O` → Enter → `Ctrl+X`

### 2. Restart bota

```bash
# Jeśli używasz systemd:
systemctl restart mm-bot.service
systemctl status mm-bot.service --no-pager

# Lub ręcznie:
npm start
```

### 3. Weryfikacja DRY_RUN

```bash
# Szybka weryfikacja:
./scripts/verify-dry-run.sh

# Lub ręcznie:
grep "PAPER TRADING MODE" bot.log | tail -n 5
```

**Powinno być:**
```
📄 PAPER TRADING MODE - No real money at risk
```

**NIE powinno być:**
```
💰 LIVE TRADING MODE - REAL MONEY AT RISK!
```

## Monitoring

### Podstawowy monitoring:
```bash
tail -f bot.log | grep -E 'SNAPSHOT|RISK|NANSEN|BehaviouralRisk|SOFT SL|DAILY LOSS'
```

### Z kolorami:
```bash
./scripts/monitor-logs.sh bot.log
```

### Sprawdzenie aktywności:
```bash
# Czy pętla MM chodzi:
grep "executePairMM" bot.log | tail -n 10

# Ostatnie logi:
tail -n 80 bot.log
```

## Co sprawdzić w pierwszych 15 minutach

### ✅ 1. Multi-layer enabled:
```
🏛️  Multi-layer grid enabled: ...
```

### ✅ 2. Spread profile:
```
🎚️ Spread profile: conservative (env SPREAD_PROFILE=conservative)
```

### ✅ 3. Snapshot logi:
```
[SNAPSHOT] pair=ZEC profile=conservative mode=multi-layer invSkew=... base=40.0bps profiled=40.0bps bidFinal=... askFinal=...
```

### ✅ 4. Brak errorów:
- Żadnych czerwonych linii w monitorze
- Brak "ERROR" w logach

### ✅ 5. Notional ZEC < 6k:
- Sprawdź pozycje (jeśli masz skrypt):
```bash
npx tsx check-positions.ts
```

## Troubleshooting

### Problem: Bot nie startuje

```bash
# Sprawdź logi systemd:
journalctl -u mm-bot.service -n 50 --no-pager

# Sprawdź czy .env jest poprawny:
./scripts/verify-env.sh
```

### Problem: "LIVE TRADING MODE" w logach

```bash
# Sprawdź .env:
grep DRY_RUN .env

# Sprawdź czy systemd używa właściwego .env:
systemctl show mm-bot.service | grep Environment

# Jeśli trzeba, edytuj service file:
systemctl edit mm-bot.service
```

### Problem: Brak logów [SNAPSHOT]

```bash
# Sprawdź czy multi-layer jest włączony:
grep "Multi-layer grid enabled" bot.log

# Sprawdź czy bot wykonuje executePairMM:
grep "executePairMM" bot.log | tail -10
```

## Red Flags - Jeśli zobaczysz, STOP:

1. ❌ **Spread < 5 bps** → bot wystawia "darmowe opcje"
2. ❌ **Spread > 200 bps** → bot nic nie filluje
3. ❌ **Notional ZEC > 10k** → guard nie działa
4. ❌ **SOFT SL HIT co 5 minut** → limity za ciasne
5. ❌ **BehaviouralRisk suspend non-stop** → problem z danymi
6. ❌ **Brak logów [SNAPSHOT]** → snapshot log nie działa
7. ❌ **"LIVE TRADING MODE"** → bot NIE jest w DRY_RUN!

## Green Flags - Wszystko OK:

1. ✅ **"PAPER TRADING MODE"** w logach
2. ✅ **Spready w zakresie 20-80 bps** dla większości przypadków
3. ✅ **[SNAPSHOT] logi pojawiają się regularnie**
4. ✅ **Brak SOFT SL HIT** (lub bardzo rzadko)
5. ✅ **BehaviouralRisk działa selektywnie** (tylko przy realnym FOMO/knife)
6. ✅ **Multi-layer grid enabled** w logach

## Next Steps

1. **Dziś:** Uruchom w DRY_RUN, obserwuj przez 1-2 godziny
2. **Jutro:** Przejrzyj logi z całego dnia
3. **Po 1 dniu:** Jeśli wszystko OK → `DRY_RUN=false`
4. **Po 3-5 dniach:** Jeśli PnL stabilny → rozważ `SPREAD_PROFILE=aggressive`

---

**Status:** ✅ Gotowe do pierwszego uruchomienia w DRY_RUN

