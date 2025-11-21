# 🚀 Instalacja PM2 + Auto-restart + Mismatch Checker

## Status: Pliki gotowe do wdrożenia

Wszystkie potrzebne pliki zostały przygotowane i znajdują się na serwerze w:
```
/root/hyperliquid-mm-bot-complete/scripts/
```

---

## Krok 1: Migracja do PM2 (5 minut)

### 1.1. Uruchom skrypt migracji

```bash
cd /root/hyperliquid-mm-bot-complete
chmod +x scripts/migrate_to_pm2.sh
./scripts/migrate_to_pm2.sh
```

**Co to robi:**
- Zabija stary proces bota
- Uruchamia bota przez PM2 jako `mm-bot`
- Zapisuje konfigurację PM2
- Pokazuje status i dostępne komendy

**Oczekiwany output:**
```
🛑 Stopping current bot process...
🚀 Starting bot via PM2...
✅ Bot is now managed by PM2

Available commands:
  pm2 status mm-bot      - Check status
  pm2 logs mm-bot        - View logs
  pm2 restart mm-bot     - Restart bot
```

### 1.2. Weryfikacja

```bash
pm2 status mm-bot
pm2 logs mm-bot --lines 20
```

Powinieneś zobaczyć:
- Status: `online`
- Uptime: jakiś czas (np. `10s`)
- Logi pokazujące że bot się uruchom ił

---

## Krok 2: Dodanie Auto-restart do gen_spread_snippet.sh

### 2.1. Backup obecnego skryptu

```bash
cd /root/hyperliquid-mm-bot-complete
cp scripts/gen_spread_snippet.sh scripts/gen_spread_snippet.sh.before_pm2
```

### 2.2. Dodaj blok auto-restart

Edytuj `scripts/gen_spread_snippet.sh`:

```bash
nano scripts/gen_spread_snippet.sh
```

Na samym **KOŃCU** pliku (po wysłaniu raportu na Slacka), dodaj:

```bash
# --- AUTO-RESTART BOT WITH NEW SPREADS ---

echo ""
echo "🔄 Restarting bot to apply new spreads..."

if pm2 status mm-bot > /dev/null 2>&1; then
  pm2 restart mm-bot --update-env
  echo "✅ Bot restarted via PM2"
else
  echo "⚠️  PM2 process mm-bot not found, starting..."
  cd /root/hyperliquid-mm-bot-complete
  pm2 start npm --name mm-bot --time -- start
  pm2 save
  echo "✅ Bot started via PM2"
fi
```

Zapisz (Ctrl+O, Enter, Ctrl+X).

**Co to robi:**
- Po każdym update spreadów automatycznie restartuje bota
- Bot ładuje nowe spready z .env
- Brak już „drift" ENV vs runtime

### 2.3. Test

```bash
cd /root/hyperliquid-mm-bot-complete
./scripts/gen_spread_snippet.sh
```

Sprawdź czy na końcu widzisz:
```
🔄 Restarting bot to apply new spreads...
✅ Bot restarted via PM2
```

I sprawdź logi:
```bash
pm2 logs mm-bot --lines 10
```

Powinny pokazywać nowe `🎯` linie ze spreadami.

---

## Krok 3: Mismatch Checker - Guardian

### 3.1. Test ręczny

```bash
cd /root/hyperliquid-mm-bot-complete
BOT_LOG_PATH=/root/hyperliquid-mm-bot-complete/bot.log npx tsx scripts/check_spread_mismatch.ts
```

**Oczekiwany output gdy wszystko OK:**

```
📊 Spread Mismatch Check

SYMBOL      ENV    LOG   DIFF GLOBAL   MULT    STATUS
ASTER     32.00  32.00         35.00   0.91      MATCH
TAO       21.00  21.00         35.00   0.60      MATCH
VIRTUAL   21.00  21.00         35.00   0.60      MATCH
ZEC       21.00  21.00         35.00   0.60      MATCH

✅ ENV and LOG spreads match for all symbols.
```

**Oczekiwany output gdy jest mismatch:**

```
⚠️ Detected mismatches:
- ZEC: env=21 bps, log=10 bps (diff=-11.00)
```

Exit code: 1 (błąd)

### 3.2. (Opcjonalnie) Dodanie do crona

Jeśli chcesz automatyczny check co godzinę:

```bash
crontab -e
```

Dodaj linię:

```cron
0 * * * * cd /root/hyperliquid-mm-bot-complete && BOT_LOG_PATH=/root/hyperliquid-mm-bot-complete/bot.log npx tsx scripts/check_spread_mismatch.ts > /root/hyperliquid-mm-bot-complete/runtime/spread_mismatch_$(date +\%F_\%H).log 2>&1
```

To będzie sprawdzać zgodność co godzinę i zapisywać wyniki do `runtime/spread_mismatch_*.log`.

---

## Podsumowanie - Co masz teraz

### ✅ System PM2
- Bot działa pod nadzorem PM2
- Auto-restart po crashu
- Łatwy dostęp do logów: `pm2 logs mm-bot`
- Restart: `pm2 restart mm-bot`

### ✅ Auto-update spreadów + Auto-restart
- Co 2h (via systemd timer):
  1. Generator liczy spready
  2. Aktualizuje .env
  3. **Restartuje bota przez PM2**
  4. Bot ładuje nowe spready
  5. Wysyła raport na Slacka

### ✅ Mismatch Guardian
- Skrypt `check_spread_mismatch.ts`
- Porównuje ENV vs LOG
- Wykrywa drift
- Można podpiąć pod cron + Slack alert

---

## Komendy przydatne na co dzień

```bash
# Status bota
pm2 status mm-bot

# Logi na żywo
pm2 logs mm-bot

# Ostatnie 50 linii logów
pm2 logs mm-bot --lines 50

# Restart bota
pm2 restart mm-bot

# Stop bota
pm2 stop mm-bot

# Start bota
pm2 start mm-bot

# Analiza spreadów (config vs runtime)
cd /root/hyperliquid-mm-bot-complete
npx tsx scripts/analyze_spreads.ts

# Check mismatch (ENV vs LOG)
BOT_LOG_PATH=bot.log npx tsx scripts/check_spread_mismatch.ts
```

---

## Troubleshooting

### Bot nie startuje przez PM2

```bash
# Sprawdź error log
pm2 logs mm-bot --err

# Sprawdź czy .env istnieje
ls -lh /root/hyperliquid-mm-bot-complete/.env

# Try manual start
cd /root/hyperliquid-mm-bot-complete
npm start
```

### Auto-restart nie działa

```bash
# Sprawdź czy gen_spread_snippet.sh ma blok PM2
grep -A5 "AUTO-RESTART" scripts/gen_spread_snippet.sh

# Sprawdź logi timera
journalctl -u spread-snippet.service -n 50
```

### Mismatch checker pokazuje błędy

```bash
# Sprawdź czy bot.log istnieje
ls -lh /root/hyperliquid-mm-bot-complete/bot.log

# Sprawdź ostatnie logi z 🎯
tail -100 bot.log | grep '🎯'

# Sprawdź .env
grep SPREAD_OVERRIDE /root/hyperliquid-mm-bot-complete/.env
```

---

**Autor:** Claude Code
**Data:** 2025-11-08
**Wersja:** 1.0
