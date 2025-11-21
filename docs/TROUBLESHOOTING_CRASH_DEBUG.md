# MM Bot – Crash / Restart Debug Checklist

Ten dokument pomaga **odróżnić prawdziwy crash** od:
- normalnego restartu,
- wolnego startu,
- złej interpretacji logów.

Zakładamy, że masz aliasy:
- `mm-ssh`
- `mm-health`
- `mm-logs`
- `mm-logs-focus`

---

## 0. Upewnij się, że jesteś na właściwym serwerze

Na Macu:

```bash
mm-ssh
# alias: ssh root@207.246.92.212
```

**Typowy fałszywy alarm:**
- `cd /root/hyperliquid-mm-bot-complete` na Macu → `no such file or directory`
- ➜ to NIE jest crash bota, tylko zła maszyna 😉

---

## 1. Czy proces naprawdę nie żyje?

```bash
mm-health
# albo ręcznie:
pm2 status | grep mm-bot
```

Zwróć uwagę na pola:
- **status**:
  - `online` → proces żyje
  - `stopped` → zatrzymany ręcznie (np. `pm2 stop`)
  - `errored` → faktyczny problem
- **uptime**:
  - rośnie stabilnie → OK
  - ciągle `0s` / `1s` / `2s` → crash-loop / ciągłe restarty
- **restarts**:
  - duża liczba (np. 390) → historia, nie „teraz się crashuje"

**Jeśli:**
- `status = online`
- `uptime >= 30s`

→ to nie jest crash, tylko bot działa i trzeba patrzeć w logi, nie w PM2 licznik.

---

## 2. Szybkie logi: czy bot coś robi?

```bash
mm-logs-focus
```

Szukaj takich rzeczy:
- **normalna praca**:
  - `[INFO] L1 BUY: ...`
  - `[CAP] ... size capped: steps=...`
  - `quant_evt=submit ... ok=1 err=none`
  - status / PnL / health
- **ostrzeżenia (nie crash)**:
  - `⚠️  Order below min notional: ... < $10`
  - to TYLKO informacja, że zlecenie zostało odrzucone lokalnie, bot nie wysłał go do API.

**Jeśli widzisz:**
- ciągły strumień `L1 BUY` / `CAP` / `quant_evt=submit` → bot działa i traduje.

---

## 3. Init vs normalna praca

Bot ma dwa „tryby" w logach:

### 3.1. Faza startu (init)

W pobliżu startu zobaczysz:
- `🤖 Hyperliquid MM Bot initialized`
- `✅ Live trading initialized`
- `Base order size: $...`
- `Maker spread: ... bps`
- `Rotation interval: ...`
- `📊 Loaded N pairs from env`

**Jeśli tego NIE widzisz w ostatnich liniach**, to nie znaczy, że init się nie udał – mogło być:
- w starszej części logu (przewiń głębiej),
- albo minęło trochę czasu i logi zostały „zepchnięte" przez normalne eventy.

### 3.2. Faza pracy (main loop)

Typowe logi:
- `🧭 Rotation input: ...`
- `🏛️  XXX Multi-Layer: ...`
- `[CAP] ...`
- `quant_evt=submit ... ok=1 err=none`
- status / PnL co jakiś czas

**Jeśli widzisz tylko tę fazę**, to znaczy: bot już dawno po init i działa.

---

## 4. Jak wykryć PRAWDZIWY crash w logach

Użyj:

```bash
mm-logs
# lub:
pm2 logs mm-bot --lines 200 --nostream
```

**Szukaj twardych błędów:**
- `Fatal error: ...` (z `main().catch`)
- `Error placing order [...]` z wyjątkiem:
  - znanych, miękkich błędów typu `Order below min notional` (one są obsłużone)
- `TypeError`, `ReferenceError`, `SyntaxError`, itp. z stack trace'em
- `exit code 1` w PM2 (status: `errored`)

**Jeśli w logach masz TYLKO:**
- `ExperimentalWarning`
- `⚠️  Order below min notional`
- `[CAP] ...`
- `quant_evt=submit ... ok=1 err=none`

→ to nie jest crash, tylko normalne działanie.

---

## 5. Sprawdź, czy graceful shutdown zadziałał, czy był twardy kill

**Ręczny test:**

```bash
pm2 stop mm-bot
# lub:
kill -TERM $(pm2 pid mm-bot)
```

Potem:

```bash
mm-logs-focus
```

**Szukaj:**
- `🛑 Stop requested: sigterm / sigint / kill-switch`
- `🛑 MM main loop stopped (stopRequested=true)`
- `✅ MM bot main() finished cleanly`

**Jeśli to widzisz:**
- shutdown był graceful,
- bot sam wyszedł z pętli,
- PM2 widzi normalne zakończenie (exit code 0).

**Prawdziwy problem byłby wtedy, gdyby:**
- brak logów `Stop requested`,
- od razu `Fatal error` + `process.exit(1)`,
- status: `errored` w PM2.

---

## 6. Szybki sanity check kodu (tylko jeśli grzebiesz w TS)

Na serwerze:

```bash
cd /root/hyperliquid-mm-bot-complete

# 1) Tylko jedno process.exit – w main().catch:
grep -n 'process\.exit' src/mm_hl.ts

# 2) Flaga shutdown:
grep -c 'stopRequested' src/mm_hl.ts

# 3) Metoda:
grep -c 'requestStop' src/mm_hl.ts
```

**Oczekiwane:**
- `process.exit` → tylko 1 linia, na dole (w `main().catch`).
- `stopRequested` → kilka wystąpień (pole + warunki + log).
- `requestStop` → definicja + wywołania (SIGINT, SIGTERM, kill-switch).

**Jeśli przypadkiem dodałeś `process.exit(...)` gdzieś w środku logiki** → to MOŻE powodować twarde crashe.

---

## 7. Szybkie drzewko decyzyjne

**Wygląda jak crash?**

1. `pm2 status | grep mm-bot`
   - `online` + `uptime > 30s` → idź do logów, nie ma crasha.
   - `errored` lub `uptime ~0s` i rośnie licznik restartów → patrz logi pod `Fatal error` / stack trace.

2. W `mm-logs-focus`:
   - widzisz `L1 BUY` / `CAP` / `quant_evt=submit (ok=1, err=none)` → bot działa.
   - widzisz tylko fatalne wyjątki → to jest prawdziwy problem.

3. Zatrzymaj ręcznie i poszukaj:
   - `Stop requested...`
   - `MM main loop stopped...`
   - `MM bot main() finished cleanly`

**Jeśli te trzy logi są** → to nie crash, tylko eleganckie wyłączenie.

---

## 8. TL;DR

**Zanim uznasz że „bot się crashuje":**

1. Sprawdź status w PM2.
2. Sprawdź czy idą zlecenia (`quant_evt=submit ... ok=1 err=none`).
3. Sprawdź czy widzisz logi graceful shutdown przy stopie.
4. Szukaj `Fatal error` zamiast liczyć restarty.

**Większość „crashy" jakie widzieliśmy do tej pory okazywała się:**
- restartami wywołanymi ręcznie (`pm2 restart`),
- powolnym startem,
- lub filtrem na logi, który nie łapał właściwych linii.

---

## 9. Next: Metryki Prometheus (TODO)

W przyszłości można dodać rozdział o tym, jakie metryki eksportować do Prometheusa, żeby automatycznie odróżnić:
- „bot nie żyje" (process down)
- „bot żyje, ale nic nie handluje" (no orders submitted in last 5min)
- „bot ma problem z API" (high error rate on order placement)
