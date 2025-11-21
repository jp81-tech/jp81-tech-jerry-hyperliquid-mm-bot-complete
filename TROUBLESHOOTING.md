# 🔧 HL MM Bot – Troubleshooting & Diagnostics

**Ostatnia aktualizacja:** 2025‑11‑21  
**Setup:** systemd + `mm-bot.service`, inventory guard + UNWIND mode, Slack alerts

Ten plik jest Twoją kartką „na lodówkę” – ma Ci pozwolić w **60 sekund** sprawdzić:

1. Czy bot **w ogóle działa**.
2. Czy bot **handluje** (wysyła zlecenia / ma filly).
3. Czy nie blokują go **guardy**: inventory, UNWIND, daily caps, PnL.
4. Jak **zinterpretować logi** i co zmienić w `.env`.

---

## 🚀 0. Szybkie logowanie na serwer

Na Macu (lokalnie):

```bash
ssh jerry@65.109.92.187
```

Jeśli pyta o hasło – wpisujesz hasło użytkownika `jerry` na serwerze.

Po zalogowaniu zobaczysz prompt w stylu:

```bash
jerry@hl-mm:~$
```

Do pracy z botem **zawsze przechodzimy** do katalogu projektu:

```bash
cd /home/jerry/hyperliquid-mm-bot-complete
```

---

## 1️⃣ Czy bot działa? (systemd)

Sprawdzenie statusu usługi:

```bash
systemctl status mm-bot.service
```

### Interpretacja:

Przykład OK:

```text
Active: active (exited)
...
CGroup: /system.slice/mm-bot.service
        ├─313045 "npm start"
        └─313058 node --loader ts-node/esm src/mm_hl.ts
```

Lub:

```text
Active: active (running)
```

To oznacza, że **start-bot.sh** poszedł, a Node z `src/mm_hl.ts` działa.

Przykład problemu:

```text
Active: failed (Result: exit-code)
``` 

Wtedy od razu:

```bash
journalctl -u mm-bot.service -n 50 --no-pager
```

Szukasz ostatniej linijki z `Error` / `Exception` – to jest powód crasha (brak `.env`, błąd TS, brak API, itd.).

### Szybki restart bota

```bash
systemctl restart mm-bot.service
sleep 3
systemctl status mm-bot.service
```

Po restarcie **status musi być active**, inaczej najpierw rozwiąż błąd z `journalctl`.

---

## 2️⃣ Czy bot faktycznie handluje? (logi HL)

W katalogu projektu:

```bash
cd /home/jerry/hyperliquid-mm-bot-complete
```

Podgląd wysyłanych zleceń i fillów:

```bash
tail -f bot.log | egrep 'quant_evt=submit|quant_evt=fill'
```

### Na co patrzeć:

Przykładowe linie:

```text
quant_evt=submit ts=... pair=ZEC side=buy ... ok=1 err=none
quant_evt=submit ts=... pair=UNI side=sell ... ok=1 err=none
quant_evt=fill   ts=... pair=ZEC side=buy ... px=... sz=...
```

**Interpretacja:**
- `quant_evt=submit` – bot wysłał zlecenie na HL (dobrze).
- `quant_evt=fill` – zlecenie zostało zrealizowane (trading żyje).
- Jeśli przez dłuższy czas są tylko stare linie, a nie pojawia się nic nowego → bot prawdopodobnie stoi (sprawdź §1 i guardy w §3).

Możesz rozszerzyć filtr o guardy/unwind:

```bash
tail -f bot.log | egrep 'quant_evt=submit|quant_evt=fill|INVENTORY_GUARD|UNWIND_MODE|NOTIONAL_CAP'
```

---

## 3️⃣ Inventory Guard + UNWIND – dlaczego bot czasem NIC nie wysyła

### 3.1. Caps w `.env`

W projekcie:

```bash
grep '_INVENTORY_CAP_COINS' .env
```

Przykład:

```text
ZEC_INVENTORY_CAP_COINS=120
UNI_INVENTORY_CAP_COINS=200
VIRTUAL_INVENTORY_CAP_COINS=3000
```

To są **limity pozycji** (w coinach). Inventory guard patrzy na:

```text
curPos  – aktualny size pozycji
max     – cap z .env
projected – pozycja po zleceniu
```

### 3.2. Komunikaty z inventory guarda

Przykładowy log:

```text
[INVENTORY_GUARD] VIRTUAL skip order. side=buy size=33.0 curPos=5565.8 projected=5598.8 max=3000 reason=[INVENTORY_GUARD] order would increase exposure beyond limit
```

**Jak czytać:**
- `side=buy` – próba DOKUPIENIA.
- `curPos=5565.8` – już masz 5565.8 VIRTUAL.
- `max=3000` – cap ustawiony na 3000.
- `projected=5598.8` – po tym zleceniu miałbyś jeszcze więcej.

➡️ Guard słusznie blokuje – **nie zwiększa ekspozycji ponad limit**.

W nowej logice SELL, które **zmniejszają** pozycję, są dozwolone.

Przykład poprawnego działania:

```text
[UNWIND_MODE] VIRTUAL active. side=sell curPos=5565.8 max=3000 mode=auto
quant_evt=submit ts=... pair=VIRTUAL side=sell ... ok=1 err=none
```

Tu:
- UNWIND mówi: *jesteśmy powyżej capa, więc priorytetem są SELLe*.
- Widać, że SELL faktycznie wychodzi (`quant_evt=submit ... side=sell`).

### 3.3. Sprawdzenie otwartych pozycji

Żeby spiąć to z realnym stanem na HL:

```bash
npx tsx check-positions.ts
```

Przykładowy output:

```text
UNI | LONG
  Size:          704.4000 coins
  Entry:         $6.41
  Margin Used:   $4444.55
  Unrealized PnL: $-71.76

VIRTUAL | LONG
  Size:          7855.8000 coins
  Entry:         $0.956
  Margin Used:   $7316.73
  Unrealized PnL: $-197.11

ZEC | LONG
  Size:          6.3000 coins
  Entry:         $625.00
  Margin Used:   $4042.01
  Unrealized PnL: +$104.47
```

**Interpretacja:**
- Jeśli **Size > cap** z `.env` → guard będzie trzymał parę w trybie UNWIND (tylko SELLe, aż spadnie poniżej limitu).
- Jeśli **Size < cap** → para może znowu normalnie kwotować w dwie strony.

---

## 4️⃣ UNWIND_MODE – kiedy bot powinien sam „odwinąć” UNI/VIRTUAL

Konfiguracja w `.env`:

```bash
grep 'UNWIND_' .env
```

Przykład:

```text
UNWIND_MODE=auto
UNWIND_COINS=UNI,VIRTUAL
UNWIND_AUTO_THRESHOLD_MULT=1
```

### Tryby:
- `UNWIND_MODE=manual` – bot NIE włącza automatycznie unwindu; robisz rzeczy ręcznie.
- `UNWIND_MODE=auto` – jeśli pozycja przekracza cap, bot preferuje SELLe aż zejdzie poniżej limitu.

W logu widać to tak:

```text
[UNWIND_MODE] VIRTUAL active. side=sell curPos=5565.8 max=3000 mode=auto
quant_evt=submit ts=... pair=VIRTUAL side=sell ... ok=1 err=none
```

To jest **pożądany stan**, kiedy masz za duże VIRTUAL i chcesz, żeby sam schodził.

Jeśli widzisz tylko:

```text
[UNWIND_MODE] VIRTUAL active. side=buy ...
[INVENTORY_GUARD] VIRTUAL skip order. side=buy ...
```

i **brak SELL**, to znaczy że coś jest nie tak – wtedy:

1. Sprawdź, czy na pewno masz **nową wersję `mm_hl.ts`** z poprawioną logiką inventory.
2. Sprawdź, czy nie ma innego guarda (np. pair scheduling) blokującego tę parę.

---

## 5️⃣ Daily Notional Caps (SOFT) – monitoring obrotu

Bot ma dzienne limity obrotu na parę.

W `.env`:

```bash
grep '_DAILY_NOTIONAL_CAP_USD' .env
```

Przykład:

```text
ZEC_DAILY_NOTIONAL_CAP_USD=2000000
UNI_DAILY_NOTIONAL_CAP_USD=300000
VIRTUAL_DAILY_NOTIONAL_CAP_USD=600000
GLOBAL_DAILY_NOTIONAL_CAP_USD=3000000
```

W logach zobaczysz np.:

```text
[NOTIONAL_CAP] (SOFT) pair=ZEC side=buy used=1261140.68 cap=60000.00 → logging only, NOT blocking
```

**Interpretacja:**
- `used` – ile USD obrotu wygenerował bot dziś na tej parze.
- `cap` – ustalony limit.
- `(SOFT)` – to jest **monitoring**, NIE blokuje zleceń (nie ma `return { success: false }`).

Tu decyzja jest po Twojej stronie:
- Jeśli chcesz hard‑stop po przekroczeniu cap → w kodzie można przywrócić `return { success: false }` w bloku NOTIONAL_CAP.
- Jeśli chcesz tylko widzieć, że token robi ogromny volumen → `(SOFT)` jest idealne.

---

## 6️⃣ Daily PnL / Drawdown – czy bot nie jest „zablokowany” przez straty

Niektóre blokady zależą od PnL.

### 6.1. Szybki podgląd PnL

Jeśli masz skrypt `daily_pnl_report` (systemd/cron): znajdziesz raport na Slacku w kanale PnL. 

Manualny check z loga:

```bash
grep 'Daily PnL report' -n bot.log | tail -5
```

Przykład:

```text
Daily PnL report (2025-11-21 06:05:12 UTC)
  Daily PnL: $-66.20
  Anchor: $0.00
  Total PnL: $-835646.38
```

### 6.2. Limity w `.env`

```bash
grep 'MAX_DAILY_LOSS_USD' .env
grep 'DAILY_THRESHOLD_' .env
```

Przykładowe znaczenie:
- `MAX_DAILY_LOSS_USD` – poniżej tej wartości bot może przejść w tryb ochronny.
- `DAILY_THRESHOLD_WARN/CRIT/GOOD` – progi do alertów.

Jeśli istnieją twarde blokady PnL (w kodzie), zobaczysz w logach komunikat o osiągnięciu limitu i zatrzymaniu tradingu do końca dnia.

---

## 7️⃣ Test Slacka – czy alerty dochodzą

W katalogu projektu:

```bash
npx tsx -r dotenv/config -e "import('./src/utils/slack_router.js').then(m => m.sendRiskAlert('🚨 TEST RISK ALERT')).then(() => console.log('OK')).catch(console.error)"
```

**Interpretacja:**
- Jeśli dostajesz `OK` w terminalu i wiadomość na kanale Slack → webhook działa.
- Jeśli widzisz błąd `Slack webhook error: status=404 body=no_service` → URL w `.env` jest zły lub webhook skasowany.

Do debugowania:

```bash
grep 'SLACK_WEBHOOK' .env
```

Sprawdzasz, czy wartości odpowiadają tym z konfiguracji Slacka.

---

## 8️⃣ Kluczowe pliki i ścieżki w aktualnym setupie

- **Repo:** `/home/jerry/hyperliquid-mm-bot-complete`
- **Główny plik bota:** `src/mm_hl.ts`
- **Config:** `.env`
- **Log runtime:** `bot.log`
- **Skrypty diagnostyczne:**
  - `check-positions.ts` – szybki podgląd otwartych pozycji na HL.
  - `scripts/trade_history_report.ts` – raport trades → Slack (2× dziennie).
- **Systemd:**
  - Service: `/etc/systemd/system/mm-bot.service`
  - Trade report timer: `/etc/systemd/system/trade-history-report.timer`

---

## 9️⃣ Najczęstsze scenariusze i co robić

### Scenariusz A – „Bot działa, ale nie ma nowych trade’ów od godziny”

1. `systemctl status mm-bot.service` – musi być active.
2. `tail -f bot.log | egrep 'quant_evt=submit|quant_evt=fill'` – brak nowych linii → patrz niżej.
3. Dodaj do filtra `INVENTORY_GUARD|UNWIND_MODE` – szukaj guardów.
4. `npx tsx check-positions.ts` – czy któraś para nie jest mocno powyżej cap.
5. Jeśli cap jest zbyt niski (np. UNI_INVENTORY_CAP_COINS=0):
   - edytuj `.env` (np. na 200 / 900 / 3000),
   - `systemctl restart mm-bot.service`.

### Scenariusz B – „Bot trzyma dużą stratną pozycję, a Ty chcesz, żeby z niej zszedł”

1. Upewnij się, że:
   - `UNWIND_MODE=auto`
   - `UNWIND_COINS` zawiera tę parę (np. `UNI,VIRTUAL`).
2. Ustaw **sensowny cap** w `_INVENTORY_CAP_COINS` (docelowy size po unwindzie).
3. `systemctl restart mm-bot.service`.
4. Obserwuj:

```bash
tail -f bot.log | egrep 'UNWIND_MODE|INVENTORY_GUARD|quant_evt=submit'
```

Powinno być widać SELL dla tej pary aż do zejścia poniżej limitu.

### Scenariusz C – „Log mówi o NOTIONAL_CAP (SOFT)”

- To jest **sygnał**, nie blokada.
- Możesz zwiększyć cap w `.env`, jeśli akceptujesz większy dzienny obrót.
- Jeśli chcesz twardy stop, trzeba w `src/mm_hl.ts` aktywować `return { success: false }` w bloku NOTIONAL_CAP.

---

## 🔚 Podsumowanie – kolejność debugowania

1. `systemctl status mm-bot.service`  → czy bot żyje.
2. `tail -f bot.log | egrep 'submit|fill'` → czy są nowe zlecenia/fill’e.
3. `tail -f bot.log | egrep 'INVENTORY_GUARD|UNWIND_MODE|NOTIONAL_CAP'` → czy guardy nie blokują.
4. `npx tsx check-positions.ts` → rozmiar realnych pozycji vs capy.
5. `.env` → caps, UNWIND, limity PnL, Slack webhooks.

Jeśli utkniesz na którymś z kroków, możesz skopiować fragment loga + `.env` i na tej podstawie łatwo zdiagnozujemy kolejną warstwę.

---

**Autor:** ND helper (agresywny profil, HL MM)  
**Kontekst:** systemd + UNWIND + inventory guard + Slack reporting
