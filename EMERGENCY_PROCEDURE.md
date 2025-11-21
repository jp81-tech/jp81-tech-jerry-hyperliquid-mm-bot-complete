# 🚨 MM Bot Emergency Procedure | Procedura Awaryjna MM Bota

**Version:** 1.0 | **Date:** 2025-11-11 | **Server:** 207.246.92.212

---

## 🔴 EMERGENCY RESPONSE | REAKCJA AWARYJNA

### EN: When you receive a Slack alert or notice bot stopped:

**⚠️ DO NOT restart immediately - collect data first!**

```bash
# 1. SSH to server
ssh root@207.246.92.212

# 2. Go to bot directory
cd /root/hyperliquid-mm-bot-complete

# 3. Collect crash data (IMPORTANT!)
./collect_crash.sh "brief description of the issue"

# 4. Review what happened
tail -50 crash_timeline.txt

# 5. Restart bot
./stop-bot.sh && sleep 3 && ./start-bot.sh

# 6. Verify it's working (wait 30 seconds)
sleep 30 && ./scripts/check_bot_alive.sh
```

### PL: Gdy dostaniesz alert na Slack lub zauważysz że bot nie działa:

**⚠️ NIE restartuj od razu - najpierw zbierz dane!**

```bash
# 1. SSH na serwer
ssh root@207.246.92.212

# 2. Przejdź do katalogu bota
cd /root/hyperliquid-mm-bot-complete

# 3. Zbierz dane crasha (WAŻNE!)
./collect_crash.sh "krótki opis problemu"

# 4. Zobacz co się stało
tail -50 crash_timeline.txt

# 5. Restartuj bota
./stop-bot.sh && sleep 3 && ./start-bot.sh

# 6. Sprawdź czy działa (poczekaj 30 sekund)
sleep 30 && ./scripts/check_bot_alive.sh
```

---

## 📊 QUICK HEALTH CHECK | SZYBKI SPRAWDZENIE ZDROWIA

### EN: Is the bot working?

```bash
cd /root/hyperliquid-mm-bot-complete

# Check process
ps aux | grep mm_hl.ts | grep -v grep

# Check recent activity (should see submits from last 5 min)
tail -50 bot.log | grep 'quant_evt=submit' | tail -5

# Health check script
./scripts/check_bot_alive.sh
```

**✅ HEALTHY:** Process running + recent submits (< 5 min old)  
**⚠️ UNHEALTHY:** No process OR no submits > 5 minutes

### PL: Czy bot działa?

```bash
cd /root/hyperliquid-mm-bot-complete

# Sprawdź proces
ps aux | grep mm_hl.ts | grep -v grep

# Sprawdź ostatnią aktywność (powinny być submity z ostatnich 5 min)
tail -50 bot.log | grep 'quant_evt=submit' | tail -5

# Skrypt health check
./scripts/check_bot_alive.sh
```

**✅ ZDROWY:** Proces działa + świeże submity (< 5 min)  
**⚠️ CHORY:** Brak procesu LUB brak submitów > 5 minut

---

## 🔍 DATA COLLECTION | ZBIERANIE DANYCH

### EN: What data to collect for debugging:

```bash
cd /root/hyperliquid-mm-bot-complete

# 1. Crash snapshot (automatic)
./collect_crash.sh "description"
# Creates: crash_YYYYMMDD_HHMMSS.log

# 2. Check crash timeline
tail -100 crash_timeline.txt

# 3. Check recent errors
grep -i 'error\|exception\|fatal' bot.log | tail -20

# 4. Check open positions
npx tsx scripts/check_positions.ts

# 5. Check open orders
npx tsx scripts/check-all-orders.ts | head -30
```

### PL: Jakie dane zebrać do debugowania:

```bash
cd /root/hyperliquid-mm-bot-complete

# 1. Snapshot crasha (automatyczny)
./collect_crash.sh "opis"
# Tworzy: crash_YYYYMMDD_HHMMSS.log

# 2. Sprawdź historię crashów
tail -100 crash_timeline.txt

# 3. Sprawdź ostatnie błędy
grep -i 'error\|exception\|fatal' bot.log | tail -20

# 4. Sprawdź otwarte pozycje
npx tsx scripts/check_positions.ts

# 5. Sprawdź otwarte zlecenia
npx tsx scripts/check-all-orders.ts | head -30
```

---

## 🛑 SAFE SHUTDOWN | BEZPIECZNE WYŁĄCZENIE

### EN: When leaving for >2 hours:

```bash
cd /root/hyperliquid-mm-bot-complete

# 1. Stop bot
./stop-bot.sh

# 2. On Hyperliquid UI (https://app.hyperliquid.xyz):
#    - Cancel ALL open orders
#    - Close positions OR reduce to safe size (<$2k total)
#    - Check leverage < 1x
```

**⚠️ Why?** Bot might crash and leave zombie orders that slowly fill without control.

### PL: Gdy wychodzisz na >2 godziny:

```bash
cd /root/hyperliquid-mm-bot-complete

# 1. Zatrzymaj bota
./stop-bot.sh

# 2. W Hyperliquid UI (https://app.hyperliquid.xyz):
#    - Anuluj WSZYSTKIE otwarte zlecenia
#    - Zamknij pozycje LUB zmniejsz do bezpiecznego rozmiaru (<$2k total)
#    - Sprawdź dźwignię < 1x
```

**⚠️ Dlaczego?** Bot może paść i zostawić zombie zlecenia, które powoli się wypełniają bez kontroli.

---

## 📱 MONITORING | MONITOROWANIE

### EN: Automatic monitoring (already configured):

- **Cron check:** Every 5 minutes
- **Slack alerts:** When bot dead/hung (>5 min no submits)
- **Logs:** `/var/log/mm_bot_monitor.log`

```bash
# View monitoring logs
tail -f /var/log/mm_bot_monitor.log

# Test health check manually
cd /root/hyperliquid-mm-bot-complete
./scripts/check_bot_alive.sh

# Check cron is running
crontab -l | grep slack_alert
```

### PL: Automatyczny monitoring (już skonfigurowany):

- **Sprawdzanie cron:** Co 5 minut
- **Alerty Slack:** Gdy bot martwy/zawieszony (>5 min bez submitów)
- **Logi:** `/var/log/mm_bot_monitor.log`

```bash
# Zobacz logi monitoringu
tail -f /var/log/mm_bot_monitor.log

# Testuj health check ręcznie
cd /root/hyperliquid-mm-bot-complete
./scripts/check_bot_alive.sh

# Sprawdź czy cron działa
crontab -l | grep slack_alert
```

---

## 🆘 CRITICAL SITUATIONS | SYTUACJE KRYTYCZNE

### EN: Bot stuck with large positions:

```bash
# 1. STOP BOT IMMEDIATELY
cd /root/hyperliquid-mm-bot-complete
./stop-bot.sh

# 2. On Hyperliquid UI:
#    - Cancel ALL orders
#    - Manually REDUCE positions (don't close all - avoid slippage!)
#    - Keep 20-30% of size, close the rest gradually

# 3. Collect crash data
./collect_crash.sh "large positions - manual intervention"

# 4. Contact support/developer with crash files
```

### PL: Bot utknął z dużymi pozycjami:

```bash
# 1. ZATRZYMAJ BOTA NATYCHMIAST
cd /root/hyperliquid-mm-bot-complete
./stop-bot.sh

# 2. W Hyperliquid UI:
#    - Anuluj WSZYSTKIE zlecenia
#    - Ręcznie ZMNIEJSZ pozycje (nie zamykaj wszystkiego - unikniesz slippage!)
#    - Zostaw 20-30% rozmiaru, resztę zamykaj stopniowo

# 3. Zbierz dane crasha
./collect_crash.sh "duże pozycje - ręczna interwencja"

# 4. Skontaktuj się ze wsparciem/developerem z plikami crash
```

---

## 📋 PRE-RESTART CHECKLIST | LISTA PRZED RESTARTEM

### EN: Before restarting bot:

- [ ] Crash data collected (`crash_*.log` created)
- [ ] Timeline updated (`crash_timeline.txt`)
- [ ] Open orders checked
- [ ] Positions checked (safe size)
- [ ] Leverage acceptable
- [ ] No manual trades conflicting with bot

### PL: Przed restartem bota:

- [ ] Dane crasha zebrane (utworzono `crash_*.log`)
- [ ] Timeline zaktualizowany (`crash_timeline.txt`)
- [ ] Sprawdzono otwarte zlecenia
- [ ] Sprawdzono pozycje (bezpieczny rozmiar)
- [ ] Dźwignia akceptowalna
- [ ] Brak ręcznych transakcji kolidujących z botem

---

## 🔗 IMPORTANT FILES & LOCATIONS | WAŻNE PLIKI I LOKALIZACJE

```
/root/hyperliquid-mm-bot-complete/
├── collect_crash.sh          ← Manual crash collection
├── crash_*.log               ← Individual crash snapshots
├── crash_timeline.txt        ← Complete crash history
├── bot.log                   ← Main bot log
├── start-bot.sh              ← Start bot
├── stop-bot.sh               ← Stop bot
├── scripts/
│   ├── check_bot_alive.sh    ← Health check
│   ├── slack_alert.sh        ← Slack alerting
│   ├── check_positions.ts    ← Check positions
│   └── check-all-orders.ts   ← Check orders
├── MONITORING_SETUP.md       ← Full monitoring docs
└── EMERGENCY_PROCEDURE.md    ← This file

/var/log/
└── mm_bot_monitor.log        ← Monitoring logs
```

---

## 📞 SUPPORT | WSPARCIE

### EN: Where to get help:

1. **Slack webhook:** Already configured (automatic alerts)
2. **Crash files:** Send `crash_*.log` + `crash_timeline.txt` to developer
3. **Monitoring logs:** `/var/log/mm_bot_monitor.log`
4. **Full documentation:** `MONITORING_SETUP.md`

### PL: Gdzie uzyskać pomoc:

1. **Webhook Slack:** Już skonfigurowany (automatyczne alerty)
2. **Pliki crash:** Wyślij `crash_*.log` + `crash_timeline.txt` do developera
3. **Logi monitoringu:** `/var/log/mm_bot_monitor.log`
4. **Pełna dokumentacja:** `MONITORING_SETUP.md`

---

## ⚡ QUICK COMMAND REFERENCE | SZYBKIE KOMENDY

```bash
# Status check | Sprawdzenie statusu
cd /root/hyperliquid-mm-bot-complete && ./scripts/check_bot_alive.sh

# Collect crash | Zbierz crash
./collect_crash.sh "description | opis"

# Restart | Restart
./stop-bot.sh && sleep 3 && ./start-bot.sh

# View logs | Zobacz logi
tail -f bot.log

# Monitoring logs | Logi monitoringu
tail -f /var/log/mm_bot_monitor.log

# Check positions | Sprawdź pozycje
npx tsx scripts/check_positions.ts

# Check orders | Sprawdź zlecenia
npx tsx scripts/check-all-orders.ts | head -30
```

---

**🔴 REMEMBER | PAMIĘTAJ:** Always collect crash data BEFORE restarting!  
**🔴 ZAWSZE:** Zbieraj dane crasha PRZED restartem!

---

*Document version: 1.0 | Last updated: 2025-11-11*  
*Server: 207.246.92.212 | Bot: Hyperliquid MM Bot*
