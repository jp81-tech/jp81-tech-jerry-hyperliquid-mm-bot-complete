# Rotation → Bot Integration (Staged, Safe, Minimal)

**Status:** Ready to execute after 24h verification
**Risk Level:** Minimal (automatic fallback to existing rotation)
**Rollback Time:** Instant (one command)

---

## What We'll Do

Wire the file-based rotation output into the bot without touching the trade engine logic:
- Add a tiny hook that reads `runtime/active_pairs.json`
- Keep using `this.rotation.getCurrentPairs()` as the fallback
- Allow instant file reload via SIGHUP
- One-line change at the active-pairs callsite

---

## 0) Preconditions (Already Done ✅)

- ✅ Daemon writes: `/root/hyperliquid-mm-bot-complete/runtime/active_pairs.json`
- ✅ Hook module exists: `src/selection/rotation_consumer_hook.ts`
- ✅ Consumer exists: `src/selection/active_pairs_consumer.ts`
- ✅ ENV ready:
  ```bash
  ACTIVE_PAIRS_FILE_PATH=runtime/active_pairs.json
  ACTIVE_PAIRS_MAX_AGE_SEC=900
  ACTIVE_PAIRS_POLL_SEC=60
  ACTIVE_PAIRS_MIN=1
  ACTIVE_PAIRS_MAX=5
  # Optional: ACTIVE_PAIRS_ALLOWLIST=SOL,ASTER,FARTCOIN,ZEC,PUMP
  ```

---

## 1) Add Fields + Setter to the Bot

**Note:** Paste line-by-line in interactive zsh; no inline comments.

### 1.1 Backup

```bash
ssh -i ~/.ssh/id_ed25519 root@207.246.92.212 '
cd /root/hyperliquid-mm-bot-complete
cp src/mm_hl.ts src/mm_hl.ts.backup.$(date +%Y%m%d_%H%M)
echo "✅ Backup created"
'
```

### 1.2 Insert Import for the Hook

This adds the hook import right after your first local import block.

```bash
ssh -i ~/.ssh/id_ed25519 root@207.246.92.212 '
cd /root/hyperliquid-mm-bot-complete
awk '"'"'
  NR==1{p=1}
  p && /^import .* from .*;/ {print; next}
  p && !seen && $0 !~ /^import .* from .*;/ {print "import { installRotationConsumer } from \"./selection/rotation_consumer_hook.js\""; seen=1}
  {print}
'"'"' src/mm_hl.ts > /tmp/mm_hl.new && mv /tmp/mm_hl.new src/mm_hl.ts
echo "✅ Import added"
'
```

### 1.3 Add Two Private Fields Inside class HyperliquidMMBot

We'll add them immediately after the `class HyperliquidMMBot {` line (found at ~line 1896).

```bash
ssh -i ~/.ssh/id_ed25519 root@207.246.92.212 '
cd /root/hyperliquid-mm-bot-complete
perl -0777 -pe '"'"'s/(class\s+HyperliquidMMBot\s*\{)/$1\n  private fileActivePairs: string[] | null = null;\n  private setFileActivePairs = (pairs: string[]) => { this.fileActivePairs = pairs };\n/s'"'"' -i src/mm_hl.ts
echo "✅ Fields added"
'
```

### 1.4 Install the Consumer in the Constructor

Your grep showed `this.rotation = new VolatilityRotation({...` around lines 1939 etc. We'll hook right after that constructor setup.

```bash
ssh -i ~/.ssh/id_ed25519 root@207.246.92.212 '
cd /root/hyperliquid-mm-bot-complete
perl -0777 -pe '"'"'
  s/(this\.rotation\s*=\s*new\s+VolatilityRotation\([\s\S]*?\);\s*)/
   $1
   + "    installRotationConsumer(this.setFileActivePairs);\n"/e
'"'"' -i src/mm_hl.ts
echo "✅ Consumer installed"
'
```

---

## 2) Swap the Callsite to Prefer File Pairs When Present

Your grep showed this call:
```typescript
const activePairs = this.rotation.getCurrentPairs()
```

We'll replace it with a fallback expression.

```bash
ssh -i ~/.ssh/id_ed25519 root@207.246.92.212 '
cd /root/hyperliquid-mm-bot-complete
perl -0777 -pe '"'"'s/const\s+activePairs\s*=\s*this\.rotation\.getCurrentPairs\(\)/const activePairs = (this.fileActivePairs && this.fileActivePairs.length ? this.fileActivePairs : this.rotation.getCurrentPairs())/g'"'"' -i src/mm_hl.ts
echo "✅ Callsite updated"
'
```

---

## 3) Sanity Checks

```bash
ssh -i ~/.ssh/id_ed25519 root@207.246.92.212 '
cd /root/hyperliquid-mm-bot-complete
node -e "require(\"fs\").accessSync(\"src/mm_hl.ts\")"
echo "=== fileActivePairs references ==="
grep -n "fileActivePairs" src/mm_hl.ts | head -3
echo "=== installRotationConsumer references ==="
grep -n "installRotationConsumer" src/mm_hl.ts | head -3
echo "=== rotation.getCurrentPairs references ==="
grep -n "rotation.getCurrentPairs" src/mm_hl.ts | head -3
'
```

You should see:
- The new fields present
- The hook installed
- The modified callsite

---

## 4) Restart with Preflight Gate

```bash
ssh -i ~/.ssh/id_ed25519 root@207.246.92.212 '
cd /root/hyperliquid-mm-bot-complete
./stop-bot.sh
./start-bot.sh
echo "✅ Bot restarted"
'
```

---

## 5) Verify Runtime Behavior

### 5.1 Confirm Startup and Polling Logs

```bash
ssh -i ~/.ssh/id_ed25519 root@207.246.92.212 '
cd /root/hyperliquid-mm-bot-complete
tail -200 bot.log | egrep "rotation_evt=apply|rotation_evt=keep|rotation_evt=skip|signal_evt=sighup" | tail -50
'
```

**Expected:**
- `rotation_evt=apply source=startup pairs=...`
- Then periodic `rotation_evt=keep source=poll` if unchanged
- `rotation_evt=skip ... reason=stale(...)` if the file gets too old

### 5.2 Force a Live Reload Without Restart

```bash
ssh -i ~/.ssh/id_ed25519 root@207.246.92.212 '
cd /root/hyperliquid-mm-bot-complete
bash scripts/reload-pairs.sh
'
```

**Expected:**
- `signal_evt=sighup action=reload_pairs`
- Followed by either `rotation_evt=apply source=sighup ...` or a skip if stale/invalid

### 5.3 Confirm E_TICK Still Zero and Trading Runs

```bash
ssh -i ~/.ssh/id_ed25519 root@207.246.92.212 '
cd /root/hyperliquid-mm-bot-complete
echo "=== E_TICK count ==="
tail -1000 bot.log | grep -c "err_code=E_TICK"
echo "=== Recent quantization ==="
tail -200 bot.log | grep "quant_evt=attempt" | tail -10
'
```

**Expected:**
- E_TICK count: 0
- Recent quantization: Normal activity on all pairs

---

## 6) Rollback (Instant)

If anything goes wrong, instant rollback:

```bash
ssh -i ~/.ssh/id_ed25519 root@207.246.92.212 '
cd /root/hyperliquid-mm-bot-complete
cp src/mm_hl.ts.backup.* src/mm_hl.ts
./stop-bot.sh
./start-bot.sh
echo "✅ Rolled back to original"
'
```

This restores the original behavior immediately.

---

## Notes and Guardrails

### Automatic Fallback
- If the daemon output is missing or stale, the hook logs `rotation_evt=skip` and the bot falls back automatically to `this.rotation.getCurrentPairs()`
- Your existing .env rotation flags can remain on; the file consumer only overrides when it has a valid, fresh pairs array

### Allowlist Protection
- You can pin which markets are ever allowed by setting `ACTIVE_PAIRS_ALLOWLIST`
- Example: `ACTIVE_PAIRS_ALLOWLIST=SOL,ASTER,FARTCOIN,ZEC,PUMP`

### Zero-Downtime Reload
- The SIGHUP path lets you atomically promote a new file without restarts
- Use `bash scripts/reload-pairs.sh` anytime

### Safety Features
- Stale file rejection (15m max age by default)
- Schema validation (ensures pairs array exists)
- Minimum pair count enforcement
- Maximum pair count limit
- Automatic fallback on any error

---

## Complete Flow (All Steps)

For copy-paste convenience, here's the complete flow:

```bash
# Step 1: Backup
ssh -i ~/.ssh/id_ed25519 root@207.246.92.212 '
cd /root/hyperliquid-mm-bot-complete
cp src/mm_hl.ts src/mm_hl.ts.backup.$(date +%Y%m%d_%H%M)
'

# Step 2: Add import
ssh -i ~/.ssh/id_ed25519 root@207.246.92.212 '
cd /root/hyperliquid-mm-bot-complete
awk '"'"'
  NR==1{p=1}
  p && /^import .* from .*;/ {print; next}
  p && !seen && $0 !~ /^import .* from .*;/ {print "import { installRotationConsumer } from \"./selection/rotation_consumer_hook.js\""; seen=1}
  {print}
'"'"' src/mm_hl.ts > /tmp/mm_hl.new && mv /tmp/mm_hl.new src/mm_hl.ts
'

# Step 3: Add fields
ssh -i ~/.ssh/id_ed25519 root@207.246.92.212 '
cd /root/hyperliquid-mm-bot-complete
perl -0777 -pe '"'"'s/(class\s+HyperliquidMMBot\s*\{)/$1\n  private fileActivePairs: string[] | null = null;\n  private setFileActivePairs = (pairs: string[]) => { this.fileActivePairs = pairs };\n/s'"'"' -i src/mm_hl.ts
'

# Step 4: Install consumer
ssh -i ~/.ssh/id_ed25519 root@207.246.92.212 '
cd /root/hyperliquid-mm-bot-complete
perl -0777 -pe '"'"'
  s/(this\.rotation\s*=\s*new\s+VolatilityRotation\([\s\S]*?\);\s*)/
   $1
   + "    installRotationConsumer(this.setFileActivePairs);\n"/e
'"'"' -i src/mm_hl.ts
'

# Step 5: Update callsite
ssh -i ~/.ssh/id_ed25519 root@207.246.92.212 '
cd /root/hyperliquid-mm-bot-complete
perl -0777 -pe '"'"'s/const\s+activePairs\s*=\s*this\.rotation\.getCurrentPairs\(\)/const activePairs = (this.fileActivePairs && this.fileActivePairs.length ? this.fileActivePairs : this.rotation.getCurrentPairs())/g'"'"' -i src/mm_hl.ts
'

# Step 6: Sanity check
ssh -i ~/.ssh/id_ed25519 root@207.246.92.212 '
cd /root/hyperliquid-mm-bot-complete
grep -n "fileActivePairs" src/mm_hl.ts | head -3
grep -n "installRotationConsumer" src/mm_hl.ts | head -3
grep -n "rotation.getCurrentPairs" src/mm_hl.ts | head -3
'

# Step 7: Restart
ssh -i ~/.ssh/id_ed25519 root@207.246.92.212 '
cd /root/hyperliquid-mm-bot-complete
./stop-bot.sh && ./start-bot.sh
'

# Step 8: Verify
ssh -i ~/.ssh/id_ed25519 root@207.246.92.212 '
cd /root/hyperliquid-mm-bot-complete
tail -200 bot.log | egrep "rotation_evt=apply|rotation_evt=keep|rotation_evt=skip" | tail -20
'
```

---

## When to Execute

**✅ Execute after 24h verification (2025-11-05) if:**
- E_TICK count remains 0
- Bot has been stable for 24+ hours
- Daemon has been writing valid active_pairs.json consistently
- Daily health report shows all green

**⏸️ Wait longer if:**
- Any E_TICK errors appear
- Bot shows instability
- Daemon output is inconsistent

---

## Expected Outcome

**Before Integration:**
- Bot uses `this.rotation.getCurrentPairs()` (existing volatility rotation)
- Daemon writes file independently (not consumed)

**After Integration:**
- Bot uses daemon's selections when file is fresh and valid
- Falls back to existing rotation if file is missing/stale
- SIGHUP reload works for zero-downtime updates
- Complete audit trail in logs (`rotation_evt=apply/keep/skip`)

---

## Success Criteria

After integration, verify:
- ✅ `rotation_evt=apply source=startup` in logs
- ✅ Periodic `rotation_evt=keep` or `rotation_evt=apply` on polls
- ✅ E_TICK count remains 0
- ✅ Trading continues normally on daemon-selected pairs
- ✅ SIGHUP reload works (`bash scripts/reload-pairs.sh`)

---

**Status:** Ready to execute post-verification
**Risk:** Minimal (automatic fallback)
**Rollback:** Instant (one backup restore command)
**Documentation:** Complete
**Next Step:** Wait for 24h verification, then decide

---

**Created:** 2025-11-04 09:00 UTC
**Ready for:** 2025-11-05 09:00+ UTC (after 24h verification)
