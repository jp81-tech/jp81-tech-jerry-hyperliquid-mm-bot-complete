# 🚀 Komendy do wykonania na serwerze

## Po połączeniu przez SSH:

```bash
ssh root@207.246.92.212
```

## Krok 1: Przejdź do katalogu bota
```bash
cd /root/hyperliquid-mm-bot-complete
```

## Krok 2: Uruchom automatyczny start w DRY_RUN
```bash
./scripts/start-dry-run.sh
```

## Krok 3: W drugim oknie Terminala (monitoring)
```bash
ssh root@207.246.92.212
cd /root/hyperliquid-mm-bot-complete
tail -f bot.log | grep -E 'SNAPSHOT|RISK|NANSEN|PAPER TRADING|LIVE TRADING'
```

---

## Alternatywnie - monitoring z kolorami:
```bash
./scripts/monitor-logs.sh bot.log
```

## Szybka weryfikacja DRY_RUN:
```bash
./scripts/verify-dry-run.sh
```

---

## Jeśli chcesz ręcznie edytować .env:
```bash
nano .env
```

**Kluczowe ustawienia do sprawdzenia:**
- `DRY_RUN=true`
- `ENABLE_MULTI_LAYER=true`
- `SPREAD_PROFILE=conservative`
- `BEHAVIOURAL_RISK_MODE=normal`
- `ROTATION_ENABLED=false`
- `CHASE_MODE_ENABLED=false`

**W nano:**
- `Ctrl+O` (zapisz)
- `Enter` (potwierdź)
- `Ctrl+X` (wyjdź)

