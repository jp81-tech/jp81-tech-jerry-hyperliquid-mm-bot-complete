# 🚀 QUICK START: DRY RUN - Krok po kroku

## ⚡ Szybkie uruchomienie (skopiuj i wklej)

### Krok 1: Połącz się z serwerem
```bash
ssh root@mm-bot-ny1
```

*(Jeśli masz inną nazwę/IP serwera, użyj swojej)*

### Krok 2: Przejdź do katalogu bota
```bash
cd /root/hyperliquid-mm-bot-complete
```

### Krok 3: Uruchom automatyczny start
```bash
./scripts/start-dry-run.sh
```

---

## 📋 Co zrobi skrypt `start-dry-run.sh`:

1. ✅ Sprawdzi czy `.env` istnieje
2. ✅ Ustawi `DRY_RUN=true` w `.env`
3. ✅ Zweryfikuje i ustawi krytyczne ustawienia:
   - `ENABLE_MULTI_LAYER=true`
   - `SPREAD_PROFILE=conservative`
   - `BEHAVIOURAL_RISK_MODE=normal`
   - `ROTATION_ENABLED=false`
   - `CHASE_MODE_ENABLED=false`
4. ✅ Zrestartuje systemd service (lub pokaże instrukcję ręcznego startu)
5. ✅ Zweryfikuje, czy bot jest w DRY_RUN mode

---

## 🔍 Po uruchomieniu - sprawdź logi

### W tym samym oknie SSH (po uruchomieniu skryptu):
```bash
tail -f bot.log | grep -E 'SNAPSHOT|RISK|NANSEN|BehaviouralRisk|PAPER TRADING|LIVE TRADING'
```

### Lub w drugim oknie SSH:
```bash
ssh root@mm-bot-ny1
cd /root/hyperliquid-mm-bot-complete
./scripts/monitor-logs.sh bot.log
```

---

## ✅ Co powinieneś zobaczyć:

### 1. Potwierdzenie DRY_RUN:
```
📄 PAPER TRADING MODE - No real money at risk
```

**NIE powinno być:**
```
💰 LIVE TRADING MODE - REAL MONEY AT RISK!
```

### 2. Multi-layer enabled:
```
🏛️  Multi-layer grid enabled: ...
```

### 3. Spread profile:
```
🎚️ Spread profile: conservative (env SPREAD_PROFILE=conservative)
```

### 4. Snapshot logi (po kilku minutach):
```
[SNAPSHOT] pair=ZEC profile=conservative mode=multi-layer invSkew=... base=40.0bps profiled=40.0bps bidFinal=... askFinal=...
```

---

## ⚠️ Jeśli coś pójdzie nie tak:

### Problem: "Permission denied" przy uruchomieniu skryptu
```bash
chmod +x scripts/start-dry-run.sh
chmod +x scripts/verify-dry-run.sh
chmod +x scripts/monitor-logs.sh
```

### Problem: Skrypt nie znajduje .env
```bash
# Sprawdź czy jesteś w właściwym katalogu:
pwd
# Powinno być: /root/hyperliquid-mm-bot-complete

# Sprawdź czy .env istnieje:
ls -la .env
```

### Problem: Systemd service nie istnieje
```bash
# Sprawdź status:
systemctl status mm-bot.service

# Jeśli service nie istnieje, uruchom ręcznie:
npm start
```

### Problem: Bot nie startuje
```bash
# Sprawdź logi systemd:
journalctl -u mm-bot.service -n 50 --no-pager

# Lub sprawdź czy są błędy w bot.log:
tail -50 bot.log | grep -i error
```

---

## 🔍 Szybka weryfikacja (po starcie):

### Sprawdź czy bot jest w DRY_RUN:
```bash
./scripts/verify-dry-run.sh
```

### Lub ręcznie:
```bash
# Sprawdź .env:
grep DRY_RUN .env

# Sprawdź logi:
grep "PAPER TRADING MODE" bot.log | tail -1
```

---

## 📊 Monitoring w czasie rzeczywistym:

### Opcja 1: Monitor z kolorami
```bash
./scripts/monitor-logs.sh bot.log
```

### Opcja 2: Podstawowy tail
```bash
tail -f bot.log
```

### Opcja 3: Filtrowany (tylko ważne eventy)
```bash
tail -f bot.log | grep -E 'SNAPSHOT|RISK|NANSEN|BehaviouralRisk|SOFT SL|DAILY LOSS|ERROR|WARN'
```

---

## 🎯 Checklist - pierwsze 15 minut:

- [ ] Bot uruchomiony (sprawdź `systemctl status` lub `ps aux | grep node`)
- [ ] "PAPER TRADING MODE" w logach (NIE "LIVE TRADING MODE")
- [ ] "Multi-layer grid enabled" w logach
- [ ] "Spread profile: conservative" w logach
- [ ] [SNAPSHOT] logi pojawiają się (po kilku minutach)
- [ ] Brak ERROR w logach
- [ ] Spready w rozsądnym zakresie (20-80 bps w większości przypadków)

---

## 📝 Jeśli chcesz podzielić się logami:

Wklej fragment loga (20-40 linii), a przejrzę i powiem:
- ✅ Czy na pewno działa DRY_RUN
- ✅ Czy multi-layer się podniósł
- ✅ Czy risk-management działa poprawnie

---

**Gotowe! Uruchom komendy powyżej i daj znać, co widzisz w logach.** 🚀

