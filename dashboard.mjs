import http from "http";
import fs from "fs";

// Read SM data from file
function getSmData() {
    try {
        const data = fs.readFileSync("/tmp/smart_money_data.json", "utf8");
        return JSON.parse(data);
    } catch (e) {
        return null;
    }
}

const HTML = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>War Room</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #0a0e14; color: #c9d1d9; font-family: Monaco, Consolas, monospace; }
        .header { display: flex; align-items: center; justify-content: space-between; padding: 6px 16px; background: #161b22; border-bottom: 1px solid #30363d; }
        .header h1 { color: #58a6ff; font-size: 16px; letter-spacing: 2px; }
        .tabs { display: flex; gap: 4px; }
        .tab { padding: 5px 16px; background: #21262d; border: 1px solid #30363d; border-radius: 6px; color: #8b949e; cursor: pointer; font-size: 12px; font-family: Monaco, Consolas, monospace; transition: all 0.15s; user-select: none; }
        .tab:hover { background: #30363d; color: #c9d1d9; }
        .tab.active { background: #1f6feb; border-color: #1f6feb; color: #fff; }
        .tab .tab-key { font-size: 9px; opacity: 0.5; margin-left: 4px; }
        .auto-btn { padding: 5px 10px; background: #21262d; border: 1px solid #30363d; border-radius: 6px; color: #8b949e; cursor: pointer; font-size: 11px; font-family: Monaco, Consolas, monospace; transition: all 0.15s; }
        .auto-btn:hover { background: #30363d; }
        .auto-btn.active { background: #238636; border-color: #238636; color: #fff; }
        .stats-bar { display: flex; justify-content: center; gap: 30px; padding: 5px; background: #161b22; border-bottom: 1px solid #30363d; font-size: 12px; }
        .stat-value { font-weight: bold; margin-left: 5px; }
        .grid { display: grid; grid-template-columns: repeat(3, 1fr); height: calc(100vh - 72px); overflow: hidden; }
        .panel { border-right: 1px solid #30363d; padding: 8px 10px; display: flex; flex-direction: column; overflow: hidden; }
        .panel:last-child { border-right: none; }
        .panel-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
        .panel-header h2 { font-size: 18px; color: #f0f6fc; }
        .pnl { font-size: 13px; font-weight: bold; }
        .info-row { display: flex; justify-content: space-between; padding: 3px 0; font-size: 13px; border-bottom: 1px solid #21262d; }
        .info-label { color: #8b949e; }
        .chart-wrap { flex: 1; background: #0d1117; border-radius: 6px; margin: 6px 0; min-height: 180px; }
        .prediction-box { padding: 6px 8px; background: #161b22; border-radius: 6px; font-size: 12px; margin-top: 4px; border-left: 4px solid #58a6ff; }
        .prediction-box.bullish { border-left-color: #3fb950; }
        .prediction-box.bearish { border-left-color: #f85149; }
        .prediction-box.neutral { border-left-color: #d29922; }
        .pred-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
        .pred-title { color: #58a6ff; font-size: 12px; font-weight: bold; }
        .pred-direction { font-size: 14px; font-weight: bold; }
        .pred-row { display: flex; justify-content: space-between; padding: 2px 0; }
        .signals-box { padding: 6px; background: #1a1f29; border-radius: 6px; font-size: 11px; margin-top: 4px; }
        .signals-title { color: #a371f7; margin-bottom: 3px; font-size: 11px; font-weight: bold; }
        .signal-bar { display: flex; align-items: center; gap: 6px; margin: 3px 0; }
        .signal-name { width: 90px; color: #8b949e; }
        .signal-meter { flex: 1; height: 14px; background: #21262d; border-radius: 7px; position: relative; overflow: hidden; }
        .signal-fill { position: absolute; height: 100%; border-radius: 7px; transition: width 0.3s; }
        .signal-fill.positive { background: linear-gradient(90deg, #21262d, #3fb950); right: 50%; }
        .signal-fill.negative { background: linear-gradient(270deg, #21262d, #f85149); left: 50%; }
        .signal-center { position: absolute; left: 50%; width: 2px; height: 100%; background: #484f58; transform: translateX(-50%); z-index: 1; }
        .signal-value { width: 50px; text-align: right; font-weight: bold; font-size: 12px; }
        .factors-box { padding: 4px 6px; background: #0d1117; border-radius: 6px; font-size: 11px; margin-top: 4px; }
        .factor { padding: 2px 0; color: #8b949e; }
        .factor::before { content: "\\2022 "; color: #58a6ff; }
        .green { color: #3fb950 !important; }
        .red { color: #f85149 !important; }
        .yellow { color: #d29922 !important; }
        .cyan { color: #39c5cf !important; }
        .purple { color: #a371f7 !important; }
        .api-status { position: fixed; bottom: 5px; right: 10px; font-size: 10px; padding: 3px 8px; background: #161b22; border-radius: 4px; }
        .api-status.ok { color: #3fb950; }
        .api-status.error { color: #f85149; }
    </style>
</head>
<body>
    <div class="header">
        <h1>DIAMOND HANDS WAR ROOM</h1>
        <div class="tabs">
            <div class="tab active" data-page="0" onclick="switchPage(0)">MAJORS<span class="tab-key">1</span></div>
            <div class="tab" data-page="1" onclick="switchPage(1)">SM ALTS<span class="tab-key">2</span></div>
            <div class="tab" data-page="2" onclick="switchPage(2)">kPEPE+<span class="tab-key">3</span></div>
            <button class="auto-btn" id="auto-btn" onclick="toggleAuto()">AUTO 15s</button>
        </div>
    </div>
    <div class="stats-bar" id="stats-bar">Loading...</div>
    <div class="grid" id="grid"></div>
    <div class="api-status" id="api-status">ML API: checking...</div>
    <script>
        const PAGES = [
            { name: "MAJORS", coins: ["BTC", "ETH", "SOL"] },
            { name: "SM ALTS", coins: ["HYPE", "LIT", "FARTCOIN"] },
            { name: "kPEPE+", coins: ["ZEC", "XRP", "kPEPE"] }
        ];
        const ALL_COINS = PAGES.flatMap(p => p.coins);
        const USER = "0xf4620f6fb51fa2fdf3464e0b5b8186d14bc902fe";
        const PREDICTION_API = "http://100.71.211.15:8090";
        const SM_API = "http://100.71.211.15:3000/sm-data";

        let currentPage = 0;
        let autoRotate = false;
        let autoTimer = null;
        let apiAvailable = false;
        let smData = null;
        const candles = {};
        const predictions = {};
        const priceCache = {};
        const posCache = {};

        function switchPage(idx) {
            currentPage = idx;
            document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", parseInt(t.dataset.page) === idx));
            renderPage();
            if (autoRotate) resetAutoTimer();
        }

        function toggleAuto() {
            autoRotate = !autoRotate;
            document.getElementById("auto-btn").classList.toggle("active", autoRotate);
            if (autoRotate) {
                resetAutoTimer();
            } else if (autoTimer) {
                clearInterval(autoTimer);
                autoTimer = null;
            }
        }

        function resetAutoTimer() {
            if (autoTimer) clearInterval(autoTimer);
            autoTimer = setInterval(() => {
                switchPage((currentPage + 1) % PAGES.length);
            }, 15000);
        }

        function renderPage() {
            const grid = document.getElementById("grid");
            grid.innerHTML = "";
            const coins = PAGES[currentPage].coins;
            coins.forEach(coin => {
                if (!candles[coin]) candles[coin] = [];
                const panel = document.createElement("div");
                panel.className = "panel";
                panel.innerHTML =
                    '<div class="panel-header"><h2>' + coin + '</h2><span class="pnl" id="pnl-' + coin + '">---</span></div>' +
                    '<div class="info-row"><span class="info-label">Price</span><span id="price-' + coin + '">---</span></div>' +
                    '<div class="info-row"><span class="info-label">Position</span><span id="pos-' + coin + '">---</span></div>' +
                    '<div class="info-row"><span class="info-label">Entry</span><span id="entry-' + coin + '">---</span></div>' +
                    '<div class="info-row"><span class="info-label">uPnL</span><span id="upnl-' + coin + '">---</span></div>' +
                    '<div class="info-row"><span class="info-label">SM Signal</span><span id="sm-signal-' + coin + '">---</span></div>' +
                    '<div class="chart-wrap"><canvas id="chart-' + coin + '"></canvas></div>' +
                    '<div class="prediction-box neutral" id="pred-box-' + coin + '">' +
                    '  <div class="pred-header">' +
                    '    <span class="pred-title">ML PREDICTION</span>' +
                    '    <span class="pred-direction" id="direction-' + coin + '">---</span>' +
                    '  </div>' +
                    '  <div class="pred-row"><span>1h:</span><span id="pred1h-' + coin + '">---</span></div>' +
                    '  <div class="pred-row"><span>4h:</span><span id="pred4h-' + coin + '">---</span></div>' +
                    '  <div class="pred-row"><span>12h:</span><span id="pred12h-' + coin + '">---</span></div>' +
                    '  <div class="pred-row"><span>1w:</span><span id="predw1-' + coin + '">---</span></div>' +
                    '  <div class="pred-row"><span>1m:</span><span id="predm1-' + coin + '">---</span></div>' +
                    '  <div class="pred-row"><span>Confidence:</span><span id="conf-' + coin + '">---</span></div>' +
                    '</div>' +
                    '<div class="signals-box">' +
                    '  <div class="signals-title">SIGNAL BREAKDOWN</div>' +
                    '  <div class="signal-bar"><span class="signal-name">Technical</span><div class="signal-meter"><div class="signal-center"></div><div class="signal-fill" id="sig-tech-' + coin + '"></div></div><span class="signal-value" id="sig-tech-val-' + coin + '">0%</span></div>' +
                    '  <div class="signal-bar"><span class="signal-name">Momentum</span><div class="signal-meter"><div class="signal-center"></div><div class="signal-fill" id="sig-mom-' + coin + '"></div></div><span class="signal-value" id="sig-mom-val-' + coin + '">0%</span></div>' +
                    '  <div class="signal-bar"><span class="signal-name">Smart Money</span><div class="signal-meter"><div class="signal-center"></div><div class="signal-fill" id="sig-sm-' + coin + '"></div></div><span class="signal-value" id="sig-sm-val-' + coin + '">0%</span></div>' +
                    '  <div class="signal-bar"><span class="signal-name">Volume</span><div class="signal-meter"><div class="signal-center"></div><div class="signal-fill" id="sig-vol-' + coin + '"></div></div><span class="signal-value" id="sig-vol-val-' + coin + '">0%</span></div>' +
                    '</div>' +
                    '<div class="factors-box" id="factors-' + coin + '"><div class="factor">Loading factors...</div></div>';
                grid.appendChild(panel);
            });
            // Update UI with cached data
            coins.forEach(coin => {
                updatePositionUI(coin);
                updatePredictionUI(coin);
                drawChart(coin);
            });
        }

        function updateSignalBar(coin, type, value) {
            const fill = document.getElementById("sig-" + type + "-" + coin);
            const val = document.getElementById("sig-" + type + "-val-" + coin);
            if (!fill || !val) return;
            const pct = Math.min(Math.abs(value) * 50, 50);
            fill.style.width = pct + "%";
            fill.className = "signal-fill " + (value >= 0 ? "positive" : "negative");
            val.textContent = (value >= 0 ? "+" : "") + (value * 100).toFixed(0) + "%";
            val.className = "signal-value " + (value > 0.1 ? "green" : value < -0.1 ? "red" : "");
        }

        async function fetchCandles(coin) {
            try {
                const endTime = Date.now();
                const startTime = endTime - 24 * 3600 * 1000;
                const res = await fetch("https://api.hyperliquid.xyz/info", {
                    method: "POST",
                    headers: {"Content-Type": "application/json"},
                    body: JSON.stringify({ type: "candleSnapshot", req: { coin, interval: "1h", startTime, endTime } })
                });
                const data = await res.json();
                candles[coin] = data.map(c => ({
                    t: c.t, o: parseFloat(c.o), h: parseFloat(c.h),
                    l: parseFloat(c.l), c: parseFloat(c.c), v: parseFloat(c.v)
                }));
            } catch (e) {
                console.error("Candle fetch error:", coin, e);
            }
        }

        async function fetchPrediction(coin) {
            if (!apiAvailable) return null;
            try {
                const res = await fetch(PREDICTION_API + "/predict/" + coin);
                if (!res.ok) return null;
                const data = await res.json();
                return data.prediction || data;
            } catch (e) {
                return null;
            }
        }

        async function checkApiHealth() {
            try {
                const res = await fetch(PREDICTION_API + "/health");
                apiAvailable = res.ok;
            } catch {
                apiAvailable = false;
            }
            const el = document.getElementById("api-status");
            el.textContent = "ML API: " + (apiAvailable ? "connected" : "offline");
            el.className = "api-status " + (apiAvailable ? "ok" : "error");
        }

        function drawChart(coin) {
            const canvas = document.getElementById("chart-" + coin);
            if (!canvas || !candles[coin] || candles[coin].length < 2) return;

            const ctx = canvas.getContext("2d");
            const rect = canvas.parentElement.getBoundingClientRect();
            canvas.width = rect.width;
            canvas.height = rect.height;

            const data = candles[coin];
            const pred = predictions[coin];
            const prices = data.map(c => c.c);
            const min = Math.min(...prices) * 0.997;
            const max = Math.max(...prices) * 1.003;
            const range = max - min || 1;

            const w = canvas.width;
            const h = canvas.height;
            const padX = 60;
            const padY = 15;

            ctx.clearRect(0, 0, w, h);

            // Grid lines + price labels
            ctx.strokeStyle = "#21262d";
            ctx.lineWidth = 1;
            for (let i = 0; i <= 5; i++) {
                const y = padY + (h - 2*padY) * i / 5;
                ctx.beginPath();
                ctx.moveTo(padX, y);
                ctx.lineTo(w - 5, y);
                ctx.stroke();
                const price = max - (range * i / 5);
                ctx.fillStyle = "#8b949e";
                ctx.font = "11px Monaco";
                ctx.textAlign = "right";
                ctx.fillText("$" + price.toFixed(4), padX - 6, y + 4);
            }

            // Price line
            ctx.strokeStyle = "#58a6ff";
            ctx.lineWidth = 2;
            ctx.beginPath();
            for (let i = 0; i < prices.length; i++) {
                const x = padX + (w - padX - 5) * i / (prices.length - 1);
                const y = padY + (h - 2*padY) * (1 - (prices[i] - min) / range);
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();

            // Area fill
            const lastIdx = prices.length - 1;
            const lastX = padX + (w - padX - 5);
            const lastY = padY + (h - 2*padY) * (1 - (prices[lastIdx] - min) / range);
            ctx.lineTo(lastX, h - padY);
            ctx.lineTo(padX, h - padY);
            ctx.closePath();
            const grad = ctx.createLinearGradient(0, 0, 0, h);
            grad.addColorStop(0, "rgba(88,166,255,0.15)");
            grad.addColorStop(1, "rgba(88,166,255,0.01)");
            ctx.fillStyle = grad;
            ctx.fill();

            // Current price dot
            ctx.fillStyle = "#58a6ff";
            ctx.beginPath();
            ctx.arc(lastX, lastY, 5, 0, Math.PI * 2);
            ctx.fill();

            // Prediction lines
            if (pred && pred.predictions) {
                const horizons = [
                    { key: "h1", color: "#3fb950", lbl: "h1" },
                    { key: "h4", color: "#d29922", lbl: "h4" },
                    { key: "h12", color: "#f85149", lbl: "h12" },
                    { key: "w1", color: "#a371f7", lbl: "w1" },
                    { key: "m1", color: "#39c5cf", lbl: "m1" }
                ];
                let offsetY = 0;
                horizons.forEach((hz, idx) => {
                    const targetPrice = pred.predictions[hz.key] ? pred.predictions[hz.key].price : null;
                    if (!targetPrice) return;
                    const targetY = padY + (h - 2*padY) * (1 - (targetPrice - min) / range);
                    const targetX = Math.min(w - 5, lastX + 25 + idx * 5);

                    ctx.strokeStyle = hz.color;
                    ctx.lineWidth = 2;
                    ctx.setLineDash([4, 4]);
                    ctx.beginPath();
                    ctx.moveTo(lastX, lastY);
                    ctx.lineTo(targetX, targetY);
                    ctx.stroke();
                    ctx.setLineDash([]);

                    ctx.fillStyle = hz.color;
                    ctx.beginPath();
                    ctx.arc(targetX, targetY, 4, 0, Math.PI * 2);
                    ctx.fill();

                    ctx.font = "10px Monaco";
                    ctx.fillText(hz.lbl, targetX + 6, targetY + 4);
                });
            }
        }

        function getSmSignalValue(coin) {
            if (!smData || !smData.data || !smData.data[coin]) return 0;
            const d = smData.data[coin];
            const bias = d.bias || 0.5;
            return (bias - 0.5) * 2;
        }

        function getSmSignalText(coin) {
            if (!smData || !smData.data || !smData.data[coin]) return "No data";
            const d = smData.data[coin];
            const mode = d.trading_mode || "UNKNOWN";
            const conf = d.trading_mode_confidence || 0;
            const shorts = d.current_shorts_usd || 0;
            const longs = d.current_longs_usd || 0;
            const shortM = (shorts / 1e6).toFixed(1);
            const longM = (longs / 1e6).toFixed(1);
            return mode.replace("FOLLOW_SM_", "").replace("_", " ") + " " + conf + "% (S:$" + shortM + "M L:$" + longM + "M)";
        }

        function updatePositionUI(coin) {
            const price = priceCache[coin];
            const position = posCache[coin];
            const priceEl = document.getElementById("price-" + coin);
            if (!priceEl) return;

            if (price) priceEl.textContent = "$" + price.toFixed(4);

            if (position) {
                const size = parseFloat(position.szi);
                const entry = parseFloat(position.entryPx);
                const pnl = parseFloat(position.unrealizedPnl);
                const pnlPct = entry > 0 && price ? ((price - entry) / entry * 100 * (size > 0 ? 1 : -1)) : 0;

                document.getElementById("pos-" + coin).innerHTML = '<span class="' + (size > 0 ? "green" : "red") + '">' + size.toFixed(1) + ' (' + (size > 0 ? "LONG" : "SHORT") + ')</span>';
                document.getElementById("entry-" + coin).textContent = "$" + entry.toFixed(4);
                document.getElementById("upnl-" + coin).innerHTML = '<span class="' + (pnl >= 0 ? "green" : "red") + '">$' + pnl.toFixed(2) + ' (' + pnlPct.toFixed(2) + '%)</span>';
                document.getElementById("pnl-" + coin).innerHTML = '<span class="' + (pnl >= 0 ? "green" : "red") + '">$' + pnl.toFixed(2) + '</span>';
            } else {
                const posEl = document.getElementById("pos-" + coin);
                if (posEl) posEl.textContent = "No position";
                const entryEl = document.getElementById("entry-" + coin);
                if (entryEl) entryEl.textContent = "-";
                const upnlEl = document.getElementById("upnl-" + coin);
                if (upnlEl) upnlEl.textContent = "-";
                const pnlEl = document.getElementById("pnl-" + coin);
                if (pnlEl) pnlEl.textContent = "-";
            }
        }

        function updatePredictionUI(coin) {
            const pred = predictions[coin];
            const box = document.getElementById("pred-box-" + coin);
            if (!box) return;

            // SM signal
            const smText = getSmSignalText(coin);
            const smEl = document.getElementById("sm-signal-" + coin);
            if (smEl) {
                const isShort = smText.includes("SHORT");
                smEl.innerHTML = '<span class="' + (isShort ? "red" : "green") + '">' + smText + '</span>';
            }

            if (!pred) {
                const dirEl = document.getElementById("direction-" + coin);
                if (dirEl) dirEl.textContent = "No data";
                ["pred1h","pred4h","pred12h","predw1","predm1","conf"].forEach(id => {
                    const el = document.getElementById(id + "-" + coin);
                    if (el) el.textContent = "---";
                });
                return;
            }

            const dir = pred.direction;
            const dirEl = document.getElementById("direction-" + coin);
            const arrow = dir === "BULLISH" ? "UP" : dir === "BEARISH" ? "DOWN" : "->";
            dirEl.textContent = arrow + " " + dir;
            dirEl.className = "pred-direction " + (dir === "BULLISH" ? "green" : dir === "BEARISH" ? "red" : "yellow");
            box.className = "prediction-box " + (dir === "BULLISH" ? "bullish" : dir === "BEARISH" ? "bearish" : "neutral");

            const formatPred = (p) => {
                if (!p) return "---";
                const sign = p.change >= 0 ? "+" : "";
                return sign + p.change.toFixed(2) + "% -> $" + p.price.toFixed(4);
            };

            const preds = pred.predictions || {};
            ["h1","h4","h12","w1","m1"].forEach(hz => {
                const p = preds[hz];
                const elId = hz === "w1" ? "predw1" : hz === "m1" ? "predm1" : "pred" + hz;
                const el = document.getElementById(elId + "-" + coin);
                if (el) el.innerHTML = '<span class="' + (p && p.change >= 0 ? "green" : "red") + '">' + formatPred(p) + '</span>';
            });

            const confEl = document.getElementById("conf-" + coin);
            if (confEl) confEl.innerHTML = '<span class="' + (pred.confidence > 50 ? "cyan" : "") + '">' + pred.confidence.toFixed(0) + '%</span>';

            const smValue = getSmSignalValue(coin);
            updateSignalBar(coin, "tech", pred.signals ? pred.signals.technical : 0);
            updateSignalBar(coin, "mom", pred.signals ? pred.signals.momentum : 0);
            updateSignalBar(coin, "sm", smValue);
            updateSignalBar(coin, "vol", pred.signals ? pred.signals.volume : 0);

            const factorsEl = document.getElementById("factors-" + coin);
            if (factorsEl) {
                if (pred.keyFactors && pred.keyFactors.length > 0) {
                    factorsEl.innerHTML = pred.keyFactors.map(f => '<div class="factor">' + f + '</div>').join("");
                } else {
                    factorsEl.innerHTML = '<div class="factor" style="color:#8b949e">No strong signals</div>';
                }
            }
        }

        function fallbackPrediction(coin) {
            const data = candles[coin];
            if (!data || data.length < 10) return null;
            const prices = data.map(c => c.c);
            const n = prices.length;
            let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
            for (let i = 0; i < n; i++) { sumX += i; sumY += prices[i]; sumXY += i * prices[i]; sumX2 += i * i; }
            const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
            const currentPrice = prices[n - 1];
            const slopePct = (slope / currentPrice) * 100;
            return {
                currentPrice,
                direction: slopePct > 0.05 ? "BULLISH" : slopePct < -0.05 ? "BEARISH" : "NEUTRAL",
                confidence: Math.min(Math.abs(slopePct) * 10, 50),
                predictions: {
                    h1: { price: currentPrice * (1 + slopePct * 1 / 100), change: slopePct * 1 },
                    h4: { price: currentPrice * (1 + slopePct * 4 / 100), change: slopePct * 4 },
                    h12: { price: currentPrice * (1 + slopePct * 12 / 100), change: slopePct * 12 },
                    w1: { price: currentPrice * (1 + slopePct * 168 / 100), change: slopePct * 168 },
                    m1: { price: currentPrice * (1 + slopePct * 720 / 100), change: slopePct * 720 }
                },
                signals: { technical: 0, momentum: slopePct / 5, smartMoney: 0, volume: 0 },
                keyFactors: ["Fallback: Linear Regression (ML offline)"]
            };
        }

        async function fetchData() {
            try {
                const [midsRes, posRes] = await Promise.all([
                    fetch("https://api.hyperliquid.xyz/info", {
                        method: "POST",
                        headers: {"Content-Type": "application/json"},
                        body: JSON.stringify({type: "allMids"})
                    }),
                    fetch("https://api.hyperliquid.xyz/info", {
                        method: "POST",
                        headers: {"Content-Type": "application/json"},
                        body: JSON.stringify({type: "clearinghouseState", user: USER})
                    })
                ]);
                const mids = await midsRes.json();
                const pos = await posRes.json();

                let totalPnl = 0;
                const posMap = {};
                if (pos.assetPositions) {
                    pos.assetPositions.forEach(p => {
                        posMap[p.position.coin] = p.position;
                        totalPnl += parseFloat(p.position.unrealizedPnl || 0);
                    });
                }

                document.getElementById("stats-bar").innerHTML =
                    '<span>Account: <span class="stat-value cyan">$' + parseFloat(pos.marginSummary ? pos.marginSummary.accountValue : 0).toFixed(2) + '</span></span>' +
                    '<span>Total uPnL: <span class="stat-value ' + (totalPnl >= 0 ? "green" : "red") + '">$' + totalPnl.toFixed(2) + '</span></span>' +
                    '<span>ML API: <span class="stat-value ' + (apiAvailable ? "green" : "yellow") + '">' + (apiAvailable ? "OK" : "Fallback") + '</span></span>';

                // Fetch ALL coins data (not just current page)
                for (const coin of ALL_COINS) {
                    priceCache[coin] = parseFloat(mids[coin] || 0);
                    posCache[coin] = posMap[coin] || null;

                    await fetchCandles(coin);

                    let pred = await fetchPrediction(coin);
                    if (!pred) pred = fallbackPrediction(coin);
                    predictions[coin] = pred;
                }

                // Update UI for current page
                const pageCoins = PAGES[currentPage].coins;
                pageCoins.forEach(coin => {
                    updatePositionUI(coin);
                    updatePredictionUI(coin);
                    drawChart(coin);
                });
            } catch (e) {
                console.error("Fetch error:", e);
            }
        }

        async function fetchSmData() {
            try {
                const res = await fetch(SM_API);
                if (res.ok) smData = await res.json();
            } catch (e) {
                console.log("SM API not available");
            }
        }

        // Keyboard shortcuts: 1/2/3 or arrow keys
        document.addEventListener("keydown", (e) => {
            if (e.key === "1") switchPage(0);
            else if (e.key === "2") switchPage(1);
            else if (e.key === "3") switchPage(2);
            else if (e.key === "ArrowRight") switchPage((currentPage + 1) % PAGES.length);
            else if (e.key === "ArrowLeft") switchPage((currentPage - 1 + PAGES.length) % PAGES.length);
            else if (e.key === "a" || e.key === "A") toggleAuto();
        });

        renderPage();
        checkApiHealth();
        fetchSmData();
        fetchData();

        setInterval(fetchData, 10000);
        setInterval(checkApiHealth, 30000);
        setInterval(fetchSmData, 30000);

        window.addEventListener("resize", () => {
            PAGES[currentPage].coins.forEach(coin => drawChart(coin));
        });
    </script>
</body>
</html>`;

const server = http.createServer((req, res) => {
    if (req.url === "/sm-data") {
        res.writeHead(200, {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
        });
        const smData = getSmData();
        res.end(JSON.stringify(smData || {}));
        return;
    }
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(HTML);
});

const PORT = process.env.DASHBOARD_PORT || 3000;
server.listen(PORT, () => {
    console.log("War Room Dashboard running on http://localhost:" + PORT);
});
