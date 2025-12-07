# 🔧 MM Bot Debug & Operations Playbook

 Wersja utworzona: 2025-11-21

## 🚀 How to Read This Repo in 5 Minutes

1. **Start with the ND/Risk snapshot** — open `RISK_MANAGEMENT_COMPLETE.md` and read the “ND One-Pager – Risk Overview” plus the “Risk Quick Reference” table. That gives you the layered risk model, daily caps, and the three behavioural profiles in one screen.
2. **Use this README for operations** — the sections below are the “what to do when…” playbook (health checks, crash handling, safe shutdown). Skim “Quick Health Check” and “Checklist” to know how to babysit the bot live.
3. **Dive deeper as needed:**
   - `BEHAVIOURAL_RISK_THRESHOLDS.md` – exact numbers for Normal vs Aggressive modes.
   - `SPREAD_COMPLETE_OVERVIEW.md` – how quotes are shaped per volatility profile.
   - `ENV_CHANGES_SUMMARY.md` – canonical list of `ENV_*` knobs with recommended values.
4. **Keep the essentials handy** — `scripts/mm-bot-health.sh` for watchdog, `config_presets/*.env` for base configs, and `scripts/*.ts` (e.g. `check-positions.ts`, `daily-pnl.sh`) for on-call tooling.

Po tym masz mapę całości i możesz od razu wskoczyć w konkretny moduł (risk, spreads, ops, monitoring) bez przekopywania się przez cały kod.

## 📊 Quick Health Check

```bash
# 1. Czy bot żyje?
ps aux | grep mm_hl.ts | grep -v grep

# 2. Kiedy ostatni submit?
tail -100 bot.log | grep 'quant_evt=submit' | tail -5

# 3. Pozycje i zlecenia
npx tsx scripts/check_positions.ts
npx tsx scripts/check-all-orders.ts | head -30
```

**GOLDEN RULE:** Jeśli przez 5-10 min NIE MA nowych submitów → bot jest martwy/zawieszony!

---

## ❌ Bot przestał działać - CO ROBIĆ

### Krok 1: ZBIERZ MATERIAŁ (NIE RESTARTUJ OD RAZU!)

```bash
cd /root/hyperliquid-mm-bot-complete

# A. Czy proces żyje?
ps aux | grep mm_hl.ts | grep -v grep

# B. ZAPISZ ostatnie 200 linii logów
tail -200 bot.log > crash_$(date +%Y%m%d_%H%M).log

# C. Zobacz co było na końcu
tail -40 bot.log

# D. Zapisz timestampy
echo "Crash detected at: $(date)" >> crash_timeline.txt
```

### Krok 2: RESTART

```bash
./stop-bot.sh
sleep 3
./start-bot.sh

# Sprawdź czy ruszyło
sleep 10
tail -30 bot.log | grep 'quant_evt=submit'
```

### Krok 3: WERYFIKACJA na HL UI

Idź na https://app.hyperliquid.xyz
→ Order History
→ Czy pojawiają się **NOWE** "Open" z aktualną godziną (ostatnie 1-2 min)?

**Jeśli NIE** → bot znowu zawieszony, wróć do Kroku 1.

---

## 🛡️ Tryb "bezpieczny grid" (gdy wychodzisz)

Jeśli NIE będziesz przy komputerze przez >2h:

```bash
cd /root/hyperliquid-mm-bot-complete

# 1. Stop bota
./stop-bot.sh

# 2. Na HL UI:
#    - Cancel all open orders
#    - Close positions (lub zostaw małe, bezpieczne)
```

**Dlaczego?** Bo bot może paść i zostawić stare zlecenia, które powoli się fillują bez kontroli.

---

## 🐛 Debug Pattern - Co szukamy w crash logach

Gdy masz `crash_*.log`, szukaj:

```bash
# 1. Ostatnia iteracja pętli
grep "LOOP\[" crash_20250111_0804.log | tail -5

# 2. Czy dotarł do submitów?
grep "Multi-Layer" crash_20250111_0804.log | tail -10

# 3. Błędy
grep -i "error\|exception\|uncaught" crash_20250111_0804.log
```

**Pattern crashu (znaleziony 2025-11-11):**
- Bot loguje: `Multi-Layer: X orders` dla każdego coina
- Potem **CISZA** - brak `quant_evt=attempt/submit`
- Proces albo ginie, albo wisi

**Podejrzani:**
1. `await submitAll()` - może timeout/deadlock na API
2. Rotation cleanup - może infinite loop
3. Nansen API call - może timeout

---

## 🔍 Monitoring podczas pracy

Gdy bot pracuje, co 5-10 min sprawdzaj:

```bash
# Quick one-liner
tail -50 bot.log | grep 'quant_evt=submit' | tail -3 && date
```

Jeśli ostatni submit > 3 min temu → **ALARM!**

---

## 📁 Gdzie szukać crash logów

```bash
ls -lht crash_*.log | head -5
```

Trzymaj ostatnie 5-10 plików, starsze można skasować.

---

## 🚨 Emergency: Pozycje uciekają

Jeśli na HL widzisz że:
- Masz duże pozycje (>$5k per coin)
- Bot nie działa
- Rynek idzie przeciwko Tobie

**MANUAL INTERVENTION:**

```bash
# 1. Stop bot NATYCHMIAST
./stop-bot.sh

# 2. Na HL UI:
#    - Cancel ALL orders
#    - REDUCE positions (nie close - bo slippage!)
#    - Zostaw 20-30% rozmiaru, resztę zamknij

# 3. Daj znać komuś że coś poszło nie tak
```

---

## ✅ Checklist przed snem / wyjściem

- [ ] `./stop-bot.sh` wykonane
- [ ] Wszystkie open orders cancelled na HL
- [ ] Positions closed lub zredukowane do <$2k total
- [ ] Leverage < 1x
- [ ] Ostatni `crash_*.log` zapisany (jeśli był crash)

---

## 📝 Historia crashów

### 2025-11-11 07:31:48 - Pierwszy potwierdzony crash
- **Symptomy:** Bot pracował przez noc ~9h, ostatni submit 07:31:48
- **Znalezione:** Proces mm_hl.ts całkowicie zniknął (exit code 1)
- **Pozostałość:** ~26 zombie orders na giełdzie
- **Wzorzec:** Bot zatrzymał się po rotation + multi-layer prep, PRZED submitowaniem

### 2025-11-11 08:04:29 - Drugi crash
- **Symptomy:** Bot restarted o 08:03, ostatni submit 08:04:29
- **Pattern:** Identyczny - loguje "Multi-Layer", potem cisza
- **Czas życia:** <2 minuty
- **Diagnoza:** Prawdopodobnie deadlock w submitAll() lub unhandled promise rejection

---

## 🔧 TODO: Fixes do zrobienia

1. **Dodaj error handling w głównej pętli:**
   ```typescript
   process.on('unhandledRejection', (reason, p) => {
     console.error('UNHANDLED_REJECTION', { reason, promise: p })
   })

   process.on('uncaughtException', (err) => {
     console.error('UNCAUGHT_EXCEPTION', err)
     // opcjonalnie: process.exit(1)
   })
   ```

2. **Dodaj loop counters i checkpoints:**
   ```typescript
   let loopId = 0;
   while (true) {
     loopId++;
     this.logInfo(`LOOP[${loopId}] start`)
     // ... kod ...
     this.logInfo(`LOOP[${loopId}] after rotation`)
     this.logInfo(`LOOP[${loopId}] before submitAll`)
     await this.submitAll(...)
     this.logInfo(`LOOP[${loopId}] after submitAll - SUCCESS`)
   }
   ```

3. **Separate error log:**
   ```bash
   # W start-bot.sh
   npm start >> bot.log 2>> bot_error.log &
   ```

4. **Timeout guards na krytycznych operacjach:**
   - submitAll() - max 30s
   - rotation cleanup - max 10s
   - Nansen fetch - max 5s

---

## 🧾 CHECKLIST: Bot przestał stawiać nowe ordery – co robię?

**Przesłanki, że coś jest nie tak:**
- W Hyperliquid **brak nowych `Open` / `Cancel`** w Order History przez ≥ 5–10 minut.
- Liczba `Open Orders` stoi (np. ciągle 18–26).
- W `bot.log` timestamps się nie przesuwają albo kończą się kilka minut temu.

---

### 1️⃣ Najpierw – NIE restartuj odruchowo

**Cel:** Zachować dowody w logach i procesie, żeby wiedzieć *dlaczego* padł.

```bash
# Sprawdź czy proces w ogóle żyje
ps aux | grep mm_hl.ts | grep -v grep
```

- **Jeśli NIE MA procesu** → bot się wywalił (crashed).
- **Jeśli JEST proces** → być może wisi (hung).

---

### 2️⃣ Zanim go zabijesz – zrób snapshot crash loga

```bash
cd /root/hyperliquid-mm-bot-complete

# A. Zapisz ostatnie 200 linii (lub więcej)
tail -200 bot.log > crash_$(date +%Y%m%d_%H%M%S).log

# B. Jeśli proces wisi, możesz też zrobić `strace` (opcjonalne)
# PID=$(pgrep -f mm_hl.ts)
# sudo strace -p $PID -o strace_$(date +%Y%m%d_%H%M%S).log &

# C. Zapisz timestampy do timeline
echo "Crash detected at: $(date)" >> crash_timeline.txt
```

**Co szukać w `crash_*.log`?**
```bash
# Ostatnia iteracja pętli
grep "LOOP\[" crash_20250111_103045.log | tail -5

# Czy dotarł do submitów?
grep "Multi-Layer" crash_20250111_103045.log | tail -10
grep "quant_evt=submit" crash_20250111_103045.log | tail -10

# Błędy
grep -i "error\|exception\|uncaught" crash_20250111_103045.log
```

---

### 3️⃣ Dopiero teraz – zatrzymaj bota

```bash
./stop-bot.sh
sleep 3

# Upewnij się że proces zniknął
ps aux | grep mm_hl.ts | grep -v grep
```

---

### 4️⃣ Restart i weryfikacja

```bash
./start-bot.sh

# Poczekaj ~10-15 sekund
sleep 15

# Sprawdź czy submity ruszyły
tail -50 bot.log | grep 'quant_evt=submit' | tail -5
```

**Idź na Hyperliquid UI:**
→ Order History
→ Czy widzisz **NOWE** `Open` z aktualnym timestampem (ostatnie 1-2 min)?

- ✅ **TAK** → bot żyje
- ❌ **NIE** → bot znowu padł, wróć do kroku 1

---

### 5️⃣ Gdy wychodzisz na dłużej / noc

**Jeśli NIE będziesz przy komputerze przez >2h:**

```bash
# 1. Stop bota
./stop-bot.sh

# 2. Na Hyperliquid UI:
#    - Cancel ALL open orders
#    - Close positions (lub zostaw małe, bezpieczne <$2k total)
```

**Dlaczego?**
Bo bot może paść i zostawić stare zlecenia, które powoli się fillują bez kontroli.

---

### 6️⃣ Co zbierać do późniejszego debugowania

Trzymaj ostatnie 5-10 plików `crash_*.log`:

```bash
ls -lht crash_*.log | head -10
```

**Szukaj wspólnych wzorców:**
- Czy crash zawsze po określonym coinie? (np. zawsze po AVAX)
- Czy zawsze po rotation?
- Czy zawsze przed/po submitAll()?

Gdy znajdziesz powtarzalny pattern → możesz dodać logi/fixy w kodzie.

---

## ✅ Quick Reference Card

| Co sprawdzam?                  | Komenda                                              |
|--------------------------------|------------------------------------------------------|
| Czy bot żyje?                  | `ps aux \| grep mm_hl.ts \| grep -v grep`            |
| Kiedy ostatni submit?          | `tail -100 bot.log \| grep 'quant_evt=submit' \| tail -5` |
| Pozycje                        | `npx tsx scripts/check_positions.ts`                 |
| Zlecenia                       | `npx tsx scripts/check-all-orders.ts \| head -30`    |
| Zapisz crash log               | `tail -200 bot.log > crash_$(date +%Y%m%d_%H%M%S).log` |
| Restart                        | `./stop-bot.sh && sleep 3 && ./start-bot.sh`        |

**GOLDEN RULE:** Jeśli przez 5-10 min NIE MA nowych submitów → bot jest martwy/zawieszony!

---

## 🔍 Jak czytać crash_*.log

Każdy crash log to końcówka `bot.log` z momentu, gdy bot przestał działać.
Najważniejsze jest ustalić:
- gdzie log się *urąbał* (ostatni krok w pętli),
- czy widać stack trace (błąd),
- czy log „kończy się normalnie" (wtedy to raczej hang / deadlock).

---

### 1️⃣ Szybki skrót – co oznacza ostatni log

| Widzisz w końcówce crash_*.log | Co to oznacza | Działanie |
|---------------------------------|----------------|------------|
| `LOOP[X] before submitAll` ale brak `after submitAll` | Zawiesił się w trakcie wysyłania orderów (API deadlock / await) | Dodać timeout guard do submitAll |
| `LOOP[X] after rotation`, ale dalej nic | Wszedł w blok po rotacji, nie przeszedł do submitów | Sprawdzić `runRotation()` (promise bez resolve) |
| `UNHANDLED_REJECTION` / `UNCAUGHT_EXCEPTION` | Crash runtime Node'a | Poprawić obsługę wyjątków / złapać stack |
| `✅ ➕ pair SELL/BUY` linie, po czym cisza | Bot przestał iterować pętlę, proces żyje ale nie loopuje | Wstawić heartbeat log / watchdog |
| Ostatni timestamp z >30 min temu | Bot nie żyje / logowanie stanęło | Restart i zachować log |

---

### 2️⃣ Jak szukać błędu w crash_*.log

Najczęściej szukaj:

```bash
grep -E 'LOOP\[|Rotation|submit|UNHANDLED|ERR|EXCEPTION' crash_*.log
```

➡️ To pozwala szybko zobaczyć, na którym LOOP[x] logowanie się kończyło.

**Przykład:**
```
LOOP[12] before submitAll
```

→ bot zawisł w środku submitów (prawdopodobnie await Promise.all na orderach nie wrócił).

---

### 3️⃣ Typowe oznaki HANG-u (nie crashu)

- Brak błędu w logu,
- Ostatni timestamp np. 08:04:29 i dalej cisza,
- Proces `ps aux | grep mm_hl.ts` nadal istnieje,
- Open Orders nie aktualizują się na HL.

➡️ Wtedy wina leży w „await" bez timeoutu lub w obietnicy, która nigdy się nie resolve'uje.

---

### 4️⃣ Typowe oznaki CRASH-a

- W logu:
  ```
  UNHANDLED_REJECTION { reason: ... }
  ```
  albo
  ```
  UNCAUGHT_EXCEPTION Error: ...
  ```
- Brak procesu mm_hl.ts w `ps aux`.

➡️ Tu winny jest kod / promise z błędem bez catcha.
Trzeba przejrzeć stack trace w crash_logu (będzie w ostatnich 10 liniach).

---

### 5️⃣ Co ignorować

- Wszystkie `quant_evt=submit / attempt` → to normalne logi z handlu.
- `Rotation cleanup / rebucket` → tylko housekeeping, nie error.
- Jeśli crash_log kończy się na `sleep` → pętla w teorii skończyła iterację, ale nie rozpoczęła nowej (też typowy hang).

---

### 6️⃣ Cel końcowy

Po kilku dniach chcesz mieć 2–3 pliki `crash_*.log` i w nich:
- identyczny ostatni `LOOP[...]` → powtarzalny hang,
- albo różne miejsca + błędy → różne przyczyny.

Wtedy możesz jednoznacznie powiedzieć:

> "Bot zawsze umiera w submitAll"

albo

> "Raz crashuje po rotacji, raz w trakcie cleanupu".

I dopiero wtedy wchodzimy w kod i naprawiamy dokładny punkt.

---

## 🛠️ Przykładowa analiza crash logu

**Scenariusz:** Znalazłeś `crash_20250111_083045.log`

```bash
# Krok 1: Zobacz ostatnie 30 linii
tail -30 crash_20250111_083045.log

# Krok 2: Znajdź ostatnią iterację pętli
grep "LOOP\[" crash_20250111_083045.log | tail -5

# Krok 3: Sprawdź czy są błędy
grep -i "error\|exception\|unhandled" crash_20250111_083045.log

# Krok 4: Zobacz co było przed crashem
tail -50 crash_20250111_083045.log | grep -E "Multi-Layer|submit|Rotation"
```

**Możliwe wnioski:**
- Jeśli widzisz "Multi-Layer" ale zero "quant_evt=submit" → bot padł przed/podczas submitAll()
- Jeśli widzisz stack trace → prawdziwy crash, trzeba naprawić kod
- Jeśli brak błędów ale proces zniknął → silent crash (unhandled rejection)

---

## Server Ops Playbook: backup, watchdog, log watch, security

Ten rozdział jest ściągą do ogarniania serwera `hl-mm.jerrytrades.pl` i bota.

---

### 1. Backupy (konfiguracja + bot)

**Najważniejsze rzeczy do backupu:**

- repo bota:
  `/home/jerry/hyperliquid-mm-bot-complete`
- główna konfiguracja:
  `/home/jerry/hyperliquid-mm-bot-complete/.env`
- jednostki systemd:
  `/etc/systemd/system/mm-bot.service`
  `/etc/systemd/system/*pnl*.service|*.timer`
  `/etc/systemd/system/*health*.service|*.timer`
- konfiguracja SSH:
  `/etc/ssh/sshd_config`

**Szybki backup lokalny do tar:**

```bash
# jako root / jerry na serwerze
cd /
tar czf /root/mm-bot-backup-$(date +%Y%m%d).tar.gz \
  home/jerry/hyperliquid-mm-bot-complete/.env \
  home/jerry/hyperliquid-mm-bot-complete/systemd \
  etc/systemd/system/mm-bot.service \
  etc/systemd/system/*pnl* \
  etc/systemd/system/*health* \
  etc/ssh/sshd_config
```

**Ściągnięcie backupu na Maca:**

```bash
# na Macu
scp root@<SERVER_IP>:/root/mm-bot-backup-*.tar.gz ~/Backups/
```

---

### 2. Watchdog dla bota

Watchdog sprawdza, czy `mm-bot.service` żyje, czy log ma heartbeat i czy HL API odpowiada.

Zdefiniowane jako:

- `mm-bot-health.service`
- `mm-bot-health.timer` (co minutę)

Status timera / ostatnich runów:

```bash
sudo systemctl list-timers mm-bot-health.timer
sudo journalctl -u mm-bot-health.service -n 30 --no-pager
```

Jeśli watchdog zrestartuje bota albo HL jest martwy, wysyła alert na Slacka (webhook z `.env` – `SLACK_MM_BOT_HEALTH_WEBHOOK` lub fallback).

---

### 3. Podgląd logów (bot + systemd)

Log bota (aplikacja):

```bash
cd /home/jerry/hyperliquid-mm-bot-complete
# live trading + guardy + fills
tail -f bot.log | egrep 'quant_evt=submit|quant_evt=fill|INVENTORY_GUARD|UNWIND|NOTIONAL_CAP'
```

Log usługi (systemd):

```bash
sudo journalctl -u mm-bot.service -n 50 --no-pager
sudo journalctl -u mm-bot.service -f
```

Szybki health-check pozycji:

```bash
cd /home/jerry/hyperliquid-mm-bot-complete
npx tsx -r dotenv/config check-positions.ts
```

To pokazuje aktualne LONG/SHORT, margin i unrealized PnL per coin.

---

### 4. Security (SSH, firewall, aktualizacje)

#### 4.1 SSH (tylko klucze, bez haseł)

- logowanie na serwer odbywa się wyłącznie na kluczu:
  - użytkownik: `jerry`
  - root tylko przez `sudo` z `jerry`

Podgląd ważnych opcji:

```bash
sudo egrep 'PasswordAuthentication|PermitRootLogin|ChallengeResponseAuthentication' /etc/ssh/sshd_config
```

Oczekiwane wartości:

- `PasswordAuthentication no`
- `ChallengeResponseAuthentication no`
- `PermitRootLogin prohibit-password`

Restart SSH po zmianach:

```bash
sudo systemctl restart ssh
```

#### 4.2 Firewall (ufw + Hetzner)

Na serwerze działa `ufw` jako L2:

- allow: ssh (`22/tcp`)
- allow: node exporter (`9100/tcp`) – pod monitoring
- default: deny incoming, allow outgoing

Sprawdzenie:

```bash
sudo ufw status verbose
```

Dodatkowo w Hetzner Robot można mieć L1 firewall z analogicznymi zasadami (blokuje skanowanie jeszcze przed serwerem).

#### 4.3 Aktualizacje systemu

Minimalna rutyna:

```bash
sudo apt update
sudo apt list --upgradable
sudo apt upgrade
```

Jeśli pojawiają się komunikaty o ESM Apps, nie są krytyczne dla bota – to rozszerzone wsparcie security, można to ogarnąć osobno.

---

### 5. Szybkie komendy operacyjne

Restart bota:

```bash
cd /home/jerry/hyperliquid-mm-bot-complete
sudo systemctl restart mm-bot.service
sudo systemctl status mm-bot.service
```

Sprawdzenie, czy timery działają (PnL, trade reports, health):

```bash
sudo systemctl list-timers --no-pager | egrep 'pnl|trade-history|health|safety'
```

Force-redeploy świeżego `mm_hl.ts` z Maca na serwer:

```bash
# na Macu
scp /Users/jerry/Desktop/hyperliquid-mm-bot-complete/src/mm_hl.ts \
  root@<SERVER_IP>:/home/jerry/hyperliquid-mm-bot-complete/src/mm_hl.ts
```

Potem na serwerze restart:

```bash
cd /home/jerry/hyperliquid-mm-bot-complete
sudo systemctl restart mm-bot.service
```

---
