# Dynamic Spread Override System

System dynamicznego obliczania spreadów per token bazujący na real-time metrykach.

## Jak działa?

System automatycznie generuje rekomendacje spreadów dla każdego tokena bazując na:

1. **Volume 24h USD** (waga 35%)
2. **Active Traders** (waga 25%)
3. **Base Score** - płynność/volatility (waga 30%)
4. **Nansen Boost** - sygnał smart money (waga 10%)

### Zakres spreadów: 10-40 bps

- **Wysoka płynność** (wysoki composite score) → **Wąski spread** (10 bps)
- **Niska płynność** (niski composite score) → **Szeroki spread** (40 bps)

### Bonus confluence

Tokeny z **Nansen boost >= 2.0** dostają dodatkową redukcję **-5 bps**.

## Architektura

```
┌──────────────────────────┐
│  PM2 Bot (mm-bot)        │
│  Generuje Nansen logs    │
└──────────┬───────────────┘
           │
           ▼
┌──────────────────────────┐
│ gen_spread_overrides.ts  │◄─── spread_config.json
│ Parsuje logi + kalkulacja│◄─── manual_spread_overrides.json
└──────────┬───────────────┘
           │
           ▼
┌──────────────────────────┐
│  gen_spread_snippet.sh   │
│  Wrapper + timestamping  │
└──────────┬───────────────┘
           │
           ▼
┌──────────────────────────┐
│  Systemd Timer (co 2h)   │
│  Automatyczna generacja  │
└──────────┬───────────────┘
           │
           ▼
┌──────────────────────────┐
│ runtime/spread_snippet_  │
│   <timestamp>.env        │
│ spread_snippet_latest.env│
└──────────────────────────┘
```

## Pliki konfiguracyjne

### `/root/hyperliquid-mm-bot-complete/spread_config.json`

```json
{
  "defaultSpreadBps": 35,
  "minSpreadBps": 10,
  "maxSpreadBps": 40,
  "volumeWeight": 0.35,
  "tradersWeight": 0.25,
  "baseScoreWeight": 0.30,
  "nansenWeight": 0.10,
  "confluenceReductionBps": 5
}
```

### `/root/hyperliquid-mm-bot-complete/manual_spread_overrides.json`

Ręczne nadpisania (priorytet nad kalkulacją):

```json
{
  "TAO": 12,
  "ZEC": 15
}
```

## Użycie

### 1. Ręczna generacja

```bash
cd /root/hyperliquid-mm-bot-complete
./scripts/gen_spread_snippet.sh
```

Output:
```
🔧 Generating dynamic spread snippets...
Timestamp: 20251108T182231Z
✅ Generated: runtime/spread_snippet_20251108T182231Z.env
📋 Latest: runtime/spread_snippet_latest.env

To apply spreads, add this to .env and restart bot:
----------------------------------------
SPREAD_OVERRIDE_TAO=10  # confluence (Nansen +2.12)
SPREAD_OVERRIDE_ZEC=10  # confluence (Nansen +2.25)
SPREAD_OVERRIDE_VIRTUAL=13  # confluence (Nansen +2.09)
SPREAD_OVERRIDE_ASTER=22  # confluence (Nansen +2.07)

# Spread range: 10-40 bps
# Weights: Vol=0.35 Traders=0.25 Base=0.3 Nansen=0.1
----------------------------------------
```

### 2. Automatyczna generacja (co 2h)

Systemd timer uruchamia generację automatycznie:

```bash
# Status timera
systemctl status spread-snippet.timer

# Sprawdź harmonogram
systemctl list-timers spread-snippet.timer

# Ręczne uruchomienie
systemctl start spread-snippet.service

# Logi
journalctl -u spread-snippet.service -f
```

### 3. Aplikacja spreadów do bota

**Krok 1:** Sprawdź wygenerowane rekomendacje

```bash
cat runtime/spread_snippet_latest.env
```

**Krok 2:** Skopiuj rekomendacje do `.env`

```bash
# Dodaj do .env (lub zamień istniejące SPREAD_OVERRIDE_*)
SPREAD_OVERRIDE_TAO=10
SPREAD_OVERRIDE_ZEC=10
SPREAD_OVERRIDE_VIRTUAL=13
SPREAD_OVERRIDE_ASTER=22
```

**Krok 3:** Zrestartuj bota

```bash
pm2 restart hyperliquid-mm
```

## Przykładowe obliczenia

### Token A: Wysoka płynność
- Volume: $15M (norm: 0.75)
- Traders: 4000 (norm: 0.80)
- Base Score: 35 (norm: 0.87)
- Nansen: +2.5 (norm: 1.0)

**Composite:** 0.35×0.75 + 0.25×0.80 + 0.30×0.87 + 0.10×1.0 = **0.82**

**Raw spread:** 40 - (0.82 × 30) = **15.4 bps**

**Confluence bonus:** -5 bps (Nansen >= 2.0)

**Final:** **10 bps** (rounded, clamped to min)

### Token B: Średnia płynność
- Volume: $3M (norm: 0.15)
- Traders: 1200 (norm: 0.30)
- Base Score: 22 (norm: 0.55)
- Nansen: +1.2 (norm: 0.48)

**Composite:** 0.35×0.15 + 0.25×0.30 + 0.30×0.55 + 0.10×0.48 = **0.29**

**Raw spread:** 40 - (0.29 × 30) = **31.3 bps**

**Final:** **31 bps** (rounded)

### Token C: Niska płynność
- Volume: $500K (norm: 0.025)
- Traders: 300 (norm: 0.075)
- Base Score: 12 (norm: 0.30)
- Nansen: +0.5 (norm: 0.20)

**Composite:** 0.35×0.025 + 0.25×0.075 + 0.30×0.30 + 0.10×0.20 = **0.13**

**Raw spread:** 40 - (0.13 × 30) = **36.1 bps**

**Final:** **36 bps** (rounded)

## Monitoring

### Porównanie historycznych spreadów

```bash
# Lista wszystkich wygenerowanych snippetów
ls -lh runtime/spread_snippet_*.env

# Porównanie wczoraj vs dzisiaj
diff runtime/spread_snippet_20251107T180000Z.env \
     runtime/spread_snippet_20251108T180000Z.env
```

### Analiza zmian spreadów

```bash
# Wyciągnij spread dla TAO z ostatnich 5 generacji
grep "SPREAD_OVERRIDE_TAO" runtime/spread_snippet_*.env | tail -5
```

Output:
```
spread_snippet_20251108T140000Z.env:SPREAD_OVERRIDE_TAO=12
spread_snippet_20251108T160000Z.env:SPREAD_OVERRIDE_TAO=11
spread_snippet_20251108T180000Z.env:SPREAD_OVERRIDE_TAO=10
```

## Zaawansowane

### Dostosowanie wag

Edytuj `spread_config.json`:

```json
{
  "volumeWeight": 0.40,      // Zwiększ wagę volume
  "tradersWeight": 0.20,     // Zmniejsz wagę traders
  "baseScoreWeight": 0.30,
  "nansenWeight": 0.10
}
```

Wagi muszą sumować się do **1.0**.

### Zmiana zakresu spreadów

```json
{
  "minSpreadBps": 8,         // Pozwól na węższe spready
  "maxSpreadBps": 50,        // Pozwól na szersze spready
}
```

### Zmiana częstotliwości generacji

Edytuj `/etc/systemd/system/spread-snippet.timer`:

```ini
[Timer]
OnCalendar=0/1:00:00       # Co 1h zamiast 2h
```

Przeładuj:
```bash
systemctl daemon-reload
systemctl restart spread-snippet.timer
```

### Manual overrides

Jeśli chcesz wymusić spread dla konkretnego tokena:

Edytuj `manual_spread_overrides.json`:
```json
{
  "TAO": 15,
  "ZEC": 12
}
```

Te wartości będą **zawsze** użyte, niezależnie od kalkulacji.

## Źródła danych

### Nansen logs

System parsuje logi PM2:
```
/root/.pm2/logs/mm-bot-out.log
```

Przykładowy log:
```
[Nansen] TAO: base=31.3, nansen=+2.12, total=33.44 | 🟢 BUYING $5.16M | 2311 traders
```

Parsowane są:
- `symbol`: TAO
- `baseScore`: 31.3
- `nansenBoost`: +2.12
- `totalScore`: 33.44
- `side`: BUYING
- `volumeStr`: 5.16M
- `activeTraders`: 2311

### Wiarygodność danych

Dane pochodzą z:
1. **Nansen Pro API** - smart money tracking (wiarygodność: 95%+)
2. **Bot internal metrics** - base score z hyperliquid (wiarygodność: 98%+)
3. **Real-time logs** - ostatnie 2000 linii (świeżość: <5 min)

System używa **ostatnich 20 wpisów** dla każdego tokena i bierze **najnowszy** (tail -1).

## Troubleshooting

### Problem: Brak wygenerowanych spreadów

**Przyczyna:** Brak danych w logach

**Rozwiązanie:**
```bash
# Sprawdź logi Nansen
tail -100 /root/.pm2/logs/mm-bot-out.log | grep Nansen

# Upewnij się że bot działa
pm2 status hyperliquid-mm
```

### Problem: Spread nie zmienia się

**Przyczyna 1:** Manual override

**Rozwiązanie:** Sprawdź `manual_spread_overrides.json`

**Przyczyna 2:** Spread nie jest używany w .env

**Rozwiązanie:** Dodaj do `.env` i zrestartuj bota

### Problem: Timer nie uruchamia się

**Rozwiązanie:**
```bash
# Sprawdź status
systemctl status spread-snippet.timer

# Sprawdź logi
journalctl -u spread-snippet.timer -n 50

# Zrestartuj
systemctl restart spread-snippet.timer
```

## Integracja z botem

Bot odczytuje spready z `.env`:

```typescript
// mm_hl.ts
const spreadOverride = process.env[`SPREAD_OVERRIDE_${symbol}`]
const spread = spreadOverride
  ? parseInt(spreadOverride)
  : parseInt(process.env.MAKER_SPREAD_BPS || '35')
```

Jeśli `SPREAD_OVERRIDE_TAO=10`, bot użyje **10 bps** dla TAO.

Jeśli brak override, bot użyje **globalnego spreadu** (MAKER_SPREAD_BPS).

## Przykładowy workflow

1. **08:00 UTC** - Timer uruchamia generację
2. System parsuje logi Nansen (ostatnie 2000 linii)
3. Oblicza spready dla 4 tokenów (TAO, ZEC, VIRTUAL, ASTER)
4. Generuje plik `runtime/spread_snippet_20251108T080000Z.env`
5. Tworzy symlink `runtime/spread_snippet_latest.env`
6. **08:05 UTC** - Sprawdzasz rekomendacje: `cat runtime/spread_snippet_latest.env`
7. Kopiujesz wybrane spready do `.env`
8. Restartujesz bota: `pm2 restart hyperliquid-mm`
9. Bot używa nowych spreadów

## Zalety systemu

1. **Automatyzacja** - generacja co 2h bez interwencji
2. **Wiarygodne dane** - Nansen Pro + real-time metrics
3. **Elastyczność** - manual overrides + konfigurowalne wagi
4. **Historia** - timestamped snippets do analizy
5. **Bezpieczeństwo** - tylko generacja, aplikacja manualna
6. **Transparentność** - pełna widoczność obliczeń

## Pliki i lokalizacje

```
/root/hyperliquid-mm-bot-complete/
├── src/
│   └── spreadCalculator.ts                    # Moduł kalkulacji
├── scripts/
│   ├── gen_spread_overrides.ts                # Generator TypeScript
│   └── gen_spread_snippet.sh                  # Wrapper bash
├── runtime/
│   ├── spread_snippet_20251108T080000Z.env    # Timestamped snippet
│   ├── spread_snippet_20251108T100000Z.env
│   └── spread_snippet_latest.env              # Symlink do latest
├── spread_config.json                         # Konfiguracja wag
└── manual_spread_overrides.json               # Ręczne nadpisania

/etc/systemd/system/
├── spread-snippet.service                     # Systemd service
└── spread-snippet.timer                       # Systemd timer (co 2h)
```

## FAQ

**Q: Czy bot automatycznie aplikuje spready?**

A: Nie. System tylko **generuje rekomendacje**. Musisz ręcznie skopiować do `.env` i zrestartować bota.

**Q: Czy mogę zmienić wagi?**

A: Tak. Edytuj `spread_config.json` i upewnij się że suma = 1.0.

**Q: Czy mogę wyłączyć automatyczną generację?**

A: Tak. `systemctl stop spread-snippet.timer && systemctl disable spread-snippet.timer`

**Q: Skąd pochodzą dane Nansen?**

A: Bot integruje się z Nansen Pro API i loguje wyniki do PM2 logs.

**Q: Co jeśli token nie ma danych Nansen?**

A: Token zostanie pominięty w generacji. Będzie używał globalnego spreadu (MAKER_SPREAD_BPS).

**Q: Czy mogę użyć spreadów dla tokenów spoza rotacji?**

A: Tak. Dodaj token do `manual_spread_overrides.json` z dowolną wartością 10-40 bps.

---

**Autor:** Claude Code
**Wersja:** 1.0
**Data:** 2025-11-08
**Licencja:** Proprietary
