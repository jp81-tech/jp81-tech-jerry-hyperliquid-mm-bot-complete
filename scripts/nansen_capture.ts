import fs from "fs";
import path from "path";
import { execSync } from "child_process";

type Signal = { coin: string; score: number; seen: number; lastTs: number };

function nowMs(){ return Date.now(); }

const EXCLUDE_WORDS = new Set([
  "JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC",
  "UTC","INFO","WARN","ERROR","DEBUG","ENABLED","DISABLED","OK","FAILED",
  "TRUE","FALSE","SUCCESS","LONG","SHORT","BUY","SELL","ALERT","STARTING",
  "STOPPED","RUNNING","WAITING","PNL","USD","LIVE","DRY","TEST","PROD"
]);

function parseCoin(line: string): string | null {
  // Look for coin patterns in specific contexts
  // 1. "Nansen-aware close COIN:"
  let m = line.match(/Nansen-aware close ([A-Z][A-Z0-9]{1,9}):/);
  if (m && !EXCLUDE_WORDS.has(m[1])) return m[1];
  
  // 2. "pair=COIN" or "coin=COIN" or "coin:COIN"
  m = line.match(/(?:pair|coin)[:=]([A-Z][A-Z0-9]{1,9})\b/);
  if (m && !EXCLUDE_WORDS.has(m[1])) return m[1];
  
  return null;
}

function scoreLine(line:string): {coin:string,score:number}|null{
  const coin = parseCoin(line);
  if(!coin) return null;
  let score = 1;
  
  // Score boost from confidence
  if(/confidence[:=]\s*(\d{1,3})/i.test(line)){
    score += Math.min(100,parseInt(RegExp.$1,10))/20;
  }
  
  // Score boost from netflow
  if(/netflow[:=]\s*\$?([\d\.]+)k/i.test(line)){
    score += parseFloat(RegExp.$1)/50;
  } else if(/netflow[:=]\s*\$?([\d\.]+)m/i.test(line)){
    score += parseFloat(RegExp.$1)*20;
  }
  
  // Bonus for consensus/cluster signals
  if(/consensus|cluster|multi|3\+ traders|top\s*traders/i.test(line)) score += 2;
  
  // Bonus for strength
  if(/strong/i.test(line)) score += 1.5;
  if(/soft/i.test(line)) score += 0.5;
  
  // Bonus for actual Nansen opens (not just cleanup)
  if(/nansen.*open|nansen.*buy|nansen.*signal/i.test(line)) score += 2;
  
  // Penalty for cleanup (these are failures, not signals)
  if(/nansen-aware close.*reason=rotation_cleanup/i.test(line)) score *= 0.3;
  
  return {coin,score};
}

function readJournalctl(windowMin: number): string {
  try {
    const cmd = `journalctl -u mm-bot.service --since "${windowMin} minutes ago" --no-pager`;
    return execSync(cmd, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  } catch {
    return "";
  }
}

function readTail(file:string, maxBytes:number):string{
  try{
    const st = fs.statSync(file);
    const size = st.size;
    if(size === 0) return "";
    const start = Math.max(0, size - maxBytes);
    const fd = fs.openSync(file,"r");
    const buf = Buffer.alloc(size-start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    return buf.toString("utf8");
  }catch{
    return "";
  }
}

function main(){
  const log = process.env.NANSEN_LOG || path.join(process.cwd(),"bot.log");
  const windowMin = parseInt(process.env.NANSEN_WINDOW_MIN || "30",10);
  const windowMs = windowMin * 60 * 1000;
  
  // Read from both journalctl and bot.log
  let raw = readJournalctl(windowMin);
  const logData = readTail(log, 2_000_000);
  if (logData) raw += "\n" + logData;
  
  const lines = raw.split(/\r?\n/).filter(l=>/nansen|smart|copy|signal/i.test(l));
  const now = nowMs();
  const since = now - windowMs;

  const signals = new Map<string,Signal>();

  for(const line of lines){
    const tsMatch = line.match(/(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)/);
    const ts = tsMatch ? Date.parse(tsMatch[1]) : now;
    if(isFinite(ts) && ts < since) continue;
    const s = scoreLine(line);
    if(!s || s.score <= 0) continue;
    const prev = signals.get(s.coin) || {coin:s.coin, score:0, seen:0, lastTs:0};
    const decay = 1 - Math.min(0.9, Math.max(0, (now - ts)/windowMs)*0.9);
    prev.score += s.score*decay;
    prev.seen += 1;
    prev.lastTs = Math.max(prev.lastTs, ts);
    signals.set(s.coin, prev);
  }

  const arr = Array.from(signals.values())
    .filter(s => s.score > 0.5)
    .sort((a,b)=>b.score-a.score);
  const out = { signals: arr.slice(0, 8) };
  const outPath = path.join(process.cwd(),"runtime","nansen_signals.json");
  fs.writeFileSync(outPath, JSON.stringify(out,null,2));
  console.log(`Nansen signals written: ${outPath}`);
  for(const s of out.signals.slice(0,5)){
    console.log(`  ${s.coin.padEnd(8)} score=${s.score.toFixed(2)} seen=${s.seen}`);
  }
}
main();
