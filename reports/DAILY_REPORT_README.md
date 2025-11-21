# Daily Rotation Report

Automatyczny codzienny raport analizujący tokeny z rotacji.

## 📊 Co zawiera raport?

### 1. Metryki tokenów
- **Volume 24h USD** - wolumen handlowy
- **Active Traders** - liczba aktywnych traderów
- **Base Score** - metryka płynności/volatility (0-40)
- **Nansen Boost** - sygnał smart money (+0 do +3)
- **Total Score** - suma base + nansen

### 2. Obliczanie spreadu (10-40 bps)

**Wagi:**
- Volume 24h: **35%**
- Active Traders: **25%**
- Base Score: **30%**
- Nansen Boost: **10%**

**Formuła:**
```
composite_score = weighted_sum(normalized_metrics)
spread_bps = 40 - (composite_score * 30)
```

**Przykłady:**
- **Najlepsze metryki** (composite = 1.0) → ~10 bps (wąski spread)
- **Najgorsze metryki** (composite = 0.0) → ~40 bps (szeroki spread)

### 3. Override spreads

Jeśli w `.env` jest zdefiniowany:
```bash
SPREAD_OVERRIDE_TAO=15
```

To wartość override (15 bps) ma **pierwszeństwo** nad obliczonym spreadem.

### 4. Confluence tokeny

Tokeny które są **jednocześnie**:
- ✅ W top 3 rotacji (według base score)
- ✅ Mają Nansen BUYING signal

Dostają **2.0x boost kapitału** ($2,400 zamiast $1,200).

## 📁 Lokalizacja raportów

```
/root/hyperliquid-mm-bot-complete/reports/
├── rotation_report_2025-11-08.json       # Dzisiejszy raport (JSON)
├── rotation_report_2025-11-08.md         # Dzisiejszy raport (Markdown)
├── latest_rotation_report.json           # Ostatni raport (JSON)
└── latest_rotation_report.md             # Ostatni raport (Markdown)
```

## 🔄 Harmonogram

Raport generowany jest automatycznie **codziennie o 00:05 UTC** przez cron:

```bash
5 0 * * * /usr/local/bin/mm-daily-report
```

## 🛠️ Użycie

### Ręczne uruchomienie

```bash
# Uruchom raport teraz
mm-daily-report

# Lub bezpośrednio
cd /root/hyperliquid-mm-bot-complete
npx tsx scripts/daily_rotation_report.ts
```

### Sprawdzenie logów

```bash
tail -f runtime/daily_report.log
```

### Wyświetlenie ostatniego raportu

```bash
cat reports/latest_rotation_report.md
```

### Analiza JSON

```bash
cat reports/latest_rotation_report.json | jq '.[] | select(.inRotation == true)'
```

## 📊 Przykładowy raport

```markdown
# DAILY ROTATION REPORT
Generated: 2025-11-08T00:05:00.000Z
Date: 2025-11-08

## Current Rotation
Pairs: VIRTUAL, TAO, ZEC

## Token Metrics

| Token   | Score | Base | Nansen | Side    | Volume | Traders | Spread | Override | Final | Pos         | Rot |
|---------|-------|------|--------|---------|--------|---------|--------|----------|-------|-------------|-----|
| TAO     |  33.4 | 31.3 | +2.12  | 🟢 BUY  |  5.16M |    2311 |     26 |        - |    26 | -           | #2  ✅ |
| ZEC     |  29.7 | 27.5 | +2.25  | 🟢 BUY  | 12.00M |    3965 |     24 |        - |    24 | LONG $10127 | #3  ✅ |
| VIRTUAL |  26.8 | 24.7 | +2.09  | 🟢 BUY  |  5.19M |    1662 |     29 |        - |    29 | -           | #1  ✅ |

## Confluence Tokens
- **TAO**: Score 33.44, 5.16M buying, 2311 traders
- **ZEC**: Score 29.73, 12.00M buying, 3965 traders
- **VIRTUAL**: Score 26.79, 5.19M buying, 1662 traders
```

## 🔍 Interpretacja

### Score
- **>30**: Wybitny token (TAO: 33.4)
- **25-30**: Solidny token (ZEC: 29.7, VIRTUAL: 26.8)
- **<10**: Słaby token (ASTER: 5.5)

### Spread
- **10-20 bps**: Bardzo wąski (najlepsze metryki)
- **20-30 bps**: Normalny (TAO: 26, ZEC: 24)
- **30-40 bps**: Szeroki (słabsze metryki)

### Nansen Side
- 🟢 **BUYING**: Smart money kupuje → sygnał pozytywny
- 🔴 **SELLING**: Smart money sprzedaje → sygnał negatywny

### Confluence (✅)
- Tokeny oznaczone ✅ dostają **2.0x kapitału**
- W przykładzie: TAO, ZEC, VIRTUAL

## 📈 Wykorzystanie do analizy

### 1. Porównanie dzień do dnia

```bash
diff reports/rotation_report_2025-11-07.md \
     reports/rotation_report_2025-11-08.md
```

### 2. Tracking score changes

```bash
# Wczoraj
jq '.[] | {symbol, totalScore}' reports/rotation_report_2025-11-07.json

# Dzisiaj
jq '.[] | {symbol, totalScore}' reports/rotation_report_2025-11-08.json
```

### 3. Analiza spreadów

```bash
jq '.[] | {symbol, calculatedSpreadBps, finalSpreadBps}' \
   reports/latest_rotation_report.json
```

### 4. Confluence tracking

```bash
jq '.[] | select(.isConfluence == true) | {symbol, totalScore, nansenVolume}' \
   reports/latest_rotation_report.json
```

## ⚙️ Konfiguracja

### Zmiana czasu generowania

```bash
# Edytuj crontab
crontab -e

# Zmień godzinę (np. 06:00 UTC)
0 6 * * * /usr/local/bin/mm-daily-report
```

### Dodanie override spreadu

W `.env`:
```bash
SPREAD_OVERRIDE_TAO=15
SPREAD_OVERRIDE_ZEC=12
```

### Dostosowanie wag

Edytuj `scripts/daily_rotation_report.ts`, sekcja `calculateSpread`:

```typescript
const weights = {
  volume: 0.35,    // 35% wagi dla volume
  traders: 0.25,   // 25% wagi dla traders
  base: 0.30,      // 30% wagi dla base score
  nansen: 0.10     // 10% wagi dla Nansen
}
```

## 🎯 Use Cases

1. **Poranna analiza** - sprawdź raport o 00:05 UTC każdego dnia
2. **Optymalizacja spreadów** - użyj obliczonych spreadów do fine-tuningu
3. **Tracking confluence** - monitoruj które tokeny dostają 2x boost
4. **Trend analysis** - porównuj raporty z kilku dni
5. **Position sizing** - sprawdź rozkład kapitału vs confluence

---

**Autor**: Claude Code
**Wersja**: 1.0
**Data**: 2025-11-08
