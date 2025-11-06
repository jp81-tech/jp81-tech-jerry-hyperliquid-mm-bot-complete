# SRE Runbook: Quantization Observability

## Log Format

All `quant_evt` lines follow this structure:

### Attempt Log (before SDK call)
```
quant_evt=attempt ts=<ISO> tms=<epoch_ms> seq=<N> pair=<SYMBOL> side=<buy|sell> tif=<Alo|Gtc> ro=<0|1> cloid=<0x...> pxDec=<N> stepDec=<N> priceInt=<N> sizeInt=<N> ticks=<N> steps=<N> try=<N>
```

### Submit Log (after SDK response)
```
# Success
quant_evt=submit ts=<ISO> tms=<epoch_ms> pair=<SYMBOL> side=<buy|sell> ticks=<N> stepInt=<N> szInt=<N> ok=1 err=none

# Error
quant_evt=submit ts=<ISO> tms=<epoch_ms> pair=<SYMBOL> side=<buy|sell> ticks=<N> stepInt=<N> szInt=<N> ok=0 err=<human_label> err_code=<E_TICK|E_SIZE|E_ALO|E_TICK_SUPP|E_OTHER>
```

## Field Glossary

| Field | Type | Description |
|-------|------|-------------|
| `ts` | ISO 8601 | Human-readable UTC timestamp |
| `tms` | int64 | Epoch milliseconds (for math/joins) |
| `seq` | int | Per-process monotonic counter |
| `pair` | string | Trading pair (ASTER, SOL, etc) |
| `side` | enum | `buy` or `sell` |
| `tif` | enum | `Alo` (post-only) or `Gtc` (normal) |
| `ro` | bit | `1` = reduce-only, `0` = normal |
| `cloid` | hex | 128-bit client order ID |
| `pxDec` | int | Price decimal precision |
| `stepDec` | int | Size decimal precision |
| `priceInt` | int | Integer price (raw ticks) |
| `sizeInt` | int | Integer size (raw steps) |
| `ticks` | int | Number of price ticks |
| `steps` | int | Number of size steps |
| `try` | int | Retry attempt number |
| `ok` | bit | `1` = success, `0` = error |
| `err` | string | Human error label |
| `err_code` | enum | Machine error code |

## Error Codes

| Code | Description | Typical Cause |
|------|-------------|---------------|
| `E_TICK` | Tick size violation | Server-side spec mismatch or quantization bug |
| `E_SIZE` | Invalid size | Below minNotional or lot size mismatch |
| `E_ALO` | ALO rejection | Post-only order would cross (market moved) |
| `E_TICK_SUPP` | Auto-suppressed | 3+ tick errors in recent 30 submits (SOL only) |
| `E_OTHER` | Unknown error | Check raw error message |

## SRE One-Liners

### Latency: attempt→submit by pair/side (last 15 min)
```bash
ssh root@207.246.92.212 "cd /root/hyperliquid-mm-bot-complete && awk -v now=\$(date +%s000) -v win=900000 '/quant_evt=attempt|quant_evt=submit/{for(i=1;i<=NF;i++){split(\$i,a,\"=\");kv[a[1]]=a[2]} if(kv[\"tms\"]+0>now-win){k=kv[\"pair\"]\"_\"kv[\"side\"]; if(kv[\"quant_evt\"]==\"attempt\"){at[k]=kv[\"tms\"]+0} else if(kv[\"quant_evt\"]==\"submit\" && at[k]>0){d[k]+=kv[\"tms\"]-at[k]; n[k]++; at[k]=0}} delete kv} END{for(k in n){printf \"%s n=%d p50~%.0fms avg=%.0fms\\n\",k,n[k],d[k]/n[k],d[k]/n[k]}}' bot.log"
```

**Expected**: 200-800ms typical, <250ms ideal, >1000ms = network/API degradation

### Error rate by code (last 1000 submits)
```bash
ssh root@207.246.92.212 "cd /root/hyperliquid-mm-bot-complete && awk '/quant_evt=submit/{total++; for(i=1;i<=NF;i++){split(\$i,a,\"=\");kv[a[1]]=a[2]} if(kv[\"err_code\"]){errs[kv[\"err_code\"]]++} delete kv} END{for(e in errs){printf \"%s: %d (%.1f%%)\\n\",e,errs[e],(errs[e]/total)*100}}' bot.log | tail -1000"
```

**Expected**: E_TICK <8%, E_SIZE <1%, E_ALO variable (depends on volatility)

### Auto-suppression events (last hour)
```bash
ssh root@207.246.92.212 "cd /root/hyperliquid-mm-bot-complete && grep 'sol_suppressed_60s\|tick_size_auto_suppressed\|E_TICK_SUPP' bot.log | tail -200"
```

### Spec refresh events
```bash
ssh root@207.246.92.212 "cd /root/hyperliquid-mm-bot-complete && egrep 'SOL specs changed|Refreshed specs' bot.log | tail -200"
```

**Alert if**: ≥2 spec refreshes for same pair within 10 minutes

### Intent audit (TIF/RO/CLOID)
```bash
ssh root@207.246.92.212 "cd /root/hyperliquid-mm-bot-complete && awk '/quant_evt=attempt/{for(i=1;i<=NF;i++){split(\$i,a,\"=\");kv[a[1]]=a[2]} printf \"seq=%s pair=%s side=%s tif=%s ro=%s cloid=%s\\n\",kv[\"seq\"],kv[\"pair\"],kv[\"side\"],kv[\"tif\"],kv[\"ro\"],kv[\"cloid\"]; delete kv}' bot.log | tail -20"
```

### Error aggregation by pair
```bash
ssh root@207.246.92.212 "cd /root/hyperliquid-mm-bot-complete && awk '/quant_evt=submit/{for(i=1;i<=NF;i++){split(\$i,a,\"=\");kv[a[1]]=a[2]} if(kv[\"err_code\"]){pair_err[kv[\"pair\"]\"_\"kv[\"err_code\"]]++} delete kv} END{for(p in pair_err){printf \"%s: %d\\n\",p,pair_err[p]}}' bot.log"
```

## Alert Thresholds

| Metric | Threshold | Action |
|--------|-----------|--------|
| Tick error rate | >8% over 10 min on any pair/side | Warn ops |
| Latency avg | >250ms over 5 min | Warn ops, check network/API |
| Spec refreshes | ≥2 for same pair in 10 min | Warn ops, investigate HL changes |
| SOL E_TICK burst | ≥3 in 60s | Auto-suppresses 60s (already handled) |
| E_SIZE spike | >1% over 10 min | Critical - quantization bug likely |

## Incident Response

### E_TICK spike on SOL
1. Check spec refresh logs: `grep 'SOL specs changed' bot.log | tail -10`
2. Confirm current specs: `grep 'SOL.*tickSize' bot.log | tail -5`
3. If persists >5min, toggle: `SOL_TICK_FALLBACK=off` in `.env`, restart bot
4. Re-enable after 5-10 min

### E_ALO spike (ALO rejections)
1. Check if market volatility increased (normal during fast moves)
2. If sustained >10min with `tif=Alo`:
   - Widen maker spread: `MAKER_SPREAD_BPS=120` (from 110)
   - Or increase auto-shade: edit `autoShadeTicks` in code
3. If still persists, temporarily disable post-only: `ENABLE_POST_ONLY=false`

### Latency >500ms sustained
1. Check network: `ping api.hyperliquid.xyz`
2. Check HL status: https://status.hyperliquid.xyz
3. If network OK, reduce active layers: `ACTIVE_LAYERS=1` (already at 1)
4. Consider increasing `MM_INTERVAL_SEC` to reduce API pressure

### E_SIZE errors
1. **CRITICAL** - Should be <0.1%
2. Immediately check notional calculations in logs
3. Review recent code changes to quantization path
4. Consider emergency stop if >1% error rate

## Grafana Panel Queries (if using Loki)

### Latency P50/P95 by pair
```logql
{job="mm-bot"} |= "quant_evt=" | logfmt | tms != "" | pair != "" | unwrap tms [5m] by (pair, quant_evt)
```

### Error rate by code
```logql
rate({job="mm-bot"} |= "err_code=" | logfmt | err_code != "" [5m]) by (err_code)
```

### Order intent dashboard
```logql
{job="mm-bot"} |= "quant_evt=attempt" | logfmt | tif != "" | ro != "" | count_over_time[5m] by (tif, ro, pair)
```

## Build Version Tracking

Bot emits build hash at startup:
```
🔧 Build=dev
```

To set build version:
```bash
export BUILD_ID=$(git rev-parse --short HEAD)
# or
export GIT_COMMIT=$(git rev-parse HEAD)
```

Then restart bot to tag logs with build hash.

## Log Rotation

Logs in `bot.log` grow unbounded. Rotate with:
```bash
logrotate -f /etc/logrotate.d/mm-bot
```

Or manually:
```bash
cd /root/hyperliquid-mm-bot-complete
mv bot.log bot.log.$(date +%Y%m%d_%H%M%S)
touch bot.log
```

## Quick Health Check

```bash
ssh root@207.246.92.212 "cd /root/hyperliquid-mm-bot-complete && tail -100 bot.log | grep -E '(🔧 Build|quant_evt=)' | tail -20"
```

Should show:
- ✅ `🔧 Build=<hash>` at top
- ✅ `quant_evt=attempt` lines with all fields populated
- ✅ `quant_evt=submit` lines with `ok=1` or structured error codes
- ✅ `tms` values increasing monotonically
- ✅ `seq` values incrementing

## Contact

For questions: jerry@example.com (replace with actual contact)
