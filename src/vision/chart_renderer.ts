import { createCanvas } from 'canvas';

type Candle = {
    o: number;
    h: number;
    l: number;
    c: number;
    t: number;
    v: number;
};

// Helpery wskaźnikowe
function ema(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev = values[0];
  out.push(prev);
  for (let i = 1; i < values.length; i++) {
    const v = values[i];
    const next = v * k + prev * (1 - k);
    out.push(next);
    prev = next;
  }
  return out;
}

function vwap(candles: Candle[]): number[] {
  if (!candles.length) return [];
  const out: number[] = [];
  let cumPV = 0;
  let cumV = 0;
  for (const c of candles) {
    const typical = (c.h + c.l + c.c) / 3;
    cumPV += typical * c.v;
    cumV += c.v || 0.000001;
    out.push(cumPV / cumV);
  }
  return out;
}

export class ChartRenderer {
    /**
     * Renders OHLC candles + EMA/VWAP + Volume to a PNG buffer.
     * Enhanced for AI Context.
     */
    static renderCandles(candles: Candle[], width = 800, height = 400): Buffer {
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');

        // layout: 75% wysokości na price, 25% na volume
        const priceH = Math.floor(height * 0.75);
        const volH = height - priceH;

        // background
        ctx.fillStyle = '#121212';
        ctx.fillRect(0, 0, width, height);

        if (candles.length === 0) return canvas.toBuffer('image/png');

        const closes = candles.map(c => c.c);
        const vols = candles.map(c => c.v || 0);

        // EMA & VWAP
        const ema20 = ema(closes, 20);
        const ema50 = ema(closes, 50);
        const vwapArr = vwap(candles);

        // scale price
        let minPrice = Infinity;
        let maxPrice = -Infinity;
        for (const c of candles) {
            if (c.l < minPrice) minPrice = c.l;
            if (c.h > maxPrice) maxPrice = c.h;
        }
        const range = maxPrice - minPrice || 1;
        const pad = range * 0.05;
        minPrice -= pad;
        maxPrice += pad;
        const pricePerPx = (maxPrice - minPrice) / priceH;

        const candleWidth = (width / candles.length) * 0.7;
        const spacing = (width / candles.length) * 0.3;

        // ── 1) Price candles
        candles.forEach((c, i) => {
            const x = i * (candleWidth + spacing) + spacing / 2;
            const isBull = c.c >= c.o;

            const yOpen = priceH - (c.o - minPrice) / pricePerPx;
            const yClose = priceH - (c.c - minPrice) / pricePerPx;
            const yHigh = priceH - (c.h - minPrice) / pricePerPx;
            const yLow = priceH - (c.l - minPrice) / pricePerPx;

            ctx.strokeStyle = isBull ? '#26a69a' : '#ef5350';
            ctx.fillStyle = ctx.strokeStyle;

            // wick
            ctx.beginPath();
            ctx.moveTo(x + candleWidth / 2, yHigh);
            ctx.lineTo(x + candleWidth / 2, yLow);
            ctx.stroke();

            // body
            const bodyH = Math.max(1, Math.abs(yOpen - yClose));
            ctx.fillRect(x, Math.min(yOpen, yClose), candleWidth, bodyH);
        });

        // helper do rysowania linii
        const drawLine = (values: (number | undefined)[], color: string) => {
            ctx.beginPath();
            let started = false;
            values.forEach((val, i) => {
                if (val == null) return;
                const x = i * (candleWidth + spacing) + spacing / 2 + candleWidth / 2;
                const y = priceH - (val - minPrice) / pricePerPx;
                if (!started) {
                    ctx.moveTo(x, y);
                    started = true;
                } else {
                    ctx.lineTo(x, y);
                }
            });
            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            ctx.stroke();
        };

        // ── 2) EMA 20 / EMA 50 / VWAP
        drawLine(ema20, '#ffeb3b');  // EMA20 (Yellow)
        drawLine(ema50, '#82b1ff');  // EMA50 (Blue)
        drawLine(vwapArr, '#ff9800'); // VWAP (Orange)

        // ── 3) Volume panel (dół)
        const maxVol = Math.max(...vols) || 1;
        candles.forEach((c, i) => {
            const x = i * (candleWidth + spacing) + spacing / 2;
            const h = (c.v / maxVol) * (volH - 10);
            const isBull = c.c >= c.o;
            ctx.fillStyle = isBull ? '#1b5e20' : '#b71c1c'; // Darker Green/Red
            ctx.fillRect(x, height - h, candleWidth, h);
        });

        // ── 4) Tekst info
        ctx.fillStyle = '#ffffff';
        ctx.font = '12px Arial';
        ctx.fillText(`Last: ${closes[closes.length - 1].toFixed(4)}`, 10, 16);
        ctx.fillText(`Candles: ${candles.length}`, 10, 32);
        ctx.fillText(`EMA20(Y) / EMA50(B) / VWAP(O)`, 10, 48);

        return canvas.toBuffer('image/png');
    }
}
