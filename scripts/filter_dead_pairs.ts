import * as hl from "@nktkas/hyperliquid";
import * as fs from "fs";
import * as path from "path";
import * as https from "https";

const effPath = path.join(process.cwd(), "runtime", "effective_active_pairs.json");
const markPath = path.join(process.cwd(), "runtime", ".px0_marks.json");
type Marks = Record<string, number>;

function sendSlack(webhookUrl: string, text: string): void {
  try {
    const url = new URL(webhookUrl);
    const payload = JSON.stringify({ text });
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        res.on("data", () => {});
      }
    );
    req.on("error", (err) => {
      console.error("Slack webhook error", err.message);
    });
    req.write(payload);
    req.end();
  } catch (e) {
    console.error("Slack webhook misconfigured:", (e as Error).message);
  }
}

function loadJSON<T>(p:string, def:T):T{ 
  try{ 
    return JSON.parse(fs.readFileSync(p,"utf8")) 
  } catch{ 
    return def 
  } 
}

(async () => {
  // Build universe case map
  const transport = new hl.HttpTransport();
  const info = new hl.InfoClient({ transport });
  const meta = await info.meta();
  const caseMap: Record<string, string> = {};
  for (const u of meta.universe) {
    caseMap[u.name.toLowerCase()] = u.name;
  }

  const strikesLimit = Number(process.env.PX0_MAX_STRIKES ?? "3") || 3;
  const eff = loadJSON<{pairs:string[]}>(effPath, {pairs:[]});
  const marks = loadJSON<Marks>(markPath, {});
  const keepSet = new Set<string>();
  
  for (const c0 of eff.pairs || []) {
    // Normalize to universe case
    const lower = String(c0).toLowerCase();
    const c = caseMap[lower] || String(c0).toUpperCase();
    
    const flagFile = path.join(process.cwd(),"runtime",`.px0_${c}`);
    const flag = fs.existsSync(flagFile);
    
    if (flag) {
      marks[c] = (marks[c] || 0) + 1;
      console.log(`[${c}] px0 mark ${marks[c]}/${strikesLimit}`);
    } else {
      marks[c] = 0;
    }

    if ((marks[c] || 0) < strikesLimit) {
      keepSet.add(c);
    } else {
      console.log(`[${c}] REMOVED after ${strikesLimit} consecutive px0 cycles`);
      const webhook = process.env.SLACK_PX0_WEBHOOK_URL || process.env.SLACK_WEBHOOK_WATCHDOG || process.env.SLACK_WEBHOOK_URL;
      if (webhook) {
        sendSlack(webhook, `[px0-filter] ${c} removed after ${strikesLimit} consecutive px0 cycles`);
      }
    }
  }
  
  const keep = Array.from(keepSet);

  // Clean up old marks for coins no longer in effective
  for (const c in marks) {
    if (!keepSet.has(c)) delete marks[c];
  }
  
  fs.writeFileSync(markPath, JSON.stringify(marks, null, 2));
  fs.writeFileSync(effPath, JSON.stringify({ 
    ts: new Date().toISOString(), 
    pairs: keep 
  }, null, 2));
  
  console.log("Kept pairs:", keep.join(" "));

  // Optional Slack summary alert via watchdog: how many pairs survived the filter
  const summaryWebhook =
    process.env.SLACK_WEBHOOK_WATCHDOG ||
    process.env.SLACK_PX0_WEBHOOK_URL ||
    process.env.SLACK_WEBHOOK_URL;

  if (summaryWebhook) {
    const msg = keep.length
      ? `[px0-filter] ${keep.length} pairs kept after px0 filtering: ${keep.join(" ")}`
      : `[px0-filter] WARNING: no pairs kept after px0 filtering`;
    sendSlack(summaryWebhook, msg);
  }
})();
