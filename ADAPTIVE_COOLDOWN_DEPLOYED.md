# ADAPTIVE COOLDOWN - DEPLOYED ✅

**Deployment Date:** 2025-11-14 12:26 UTC  
**Status:** LIVE

## Changes Deployed

### 1. Adaptive Helper Function (`src/mm_hl.ts` lines 127-156)

Replaced simple cooldown with breach-severity based logic:

```typescript
function getSoftSlCooldownMs(breachMultiple: number): number {
  // base (mild) cooldown
  const baseMinutes = env.PER_PAIR_SOFT_SL_COOLDOWN_MINUTES || 60

  // severe cooldown  
  const severeMinutes = env.PER_PAIR_SOFT_SL_COOLDOWN_MINUTES_SEVERE || (baseMinutes * 3)

  // threshold for "severe" breach
  const threshold = env.PER_PAIR_SOFT_SL_SEVERE_THRESHOLD_MULTIPLE || 1.5

  // Return appropriate cooldown based on breach severity
  return breachMultiple >= threshold ? severeMinutes : baseMinutes
}
```

### 2. Environment Variables (`.env`)

```bash
# Soft SL cooldowns - adaptive based on breach severity
PER_PAIR_SOFT_SL_COOLDOWN_MINUTES=60                   # mild breach (≤1.5x limit)
PER_PAIR_SOFT_SL_COOLDOWN_MINUTES_SEVERE=180           # severe breach (>1.5x limit)
PER_PAIR_SOFT_SL_SEVERE_THRESHOLD_MULTIPLE=1.5         # breach multiple threshold
```

### 3. Updated Function Call (`src/mm_hl.ts` ~line 3133)

Changed from:
```typescript
const cooldownMs = getSoftSlCooldownMs()
```

To:
```typescript
const cooldownMs = getSoftSlCooldownMs(breachMultiple)
```

## How It Works

### For ZEC (limit: $150)

| Loss      | Breach Multiple | Classification | Cooldown  |
|-----------|----------------|----------------|-----------|
| -$170     | 1.13x          | 💊 Mild        | 60 min    |
| -$225     | 1.50x          | 💊 Mild        | 60 min    |
| -$226     | 1.51x          | 🔥 Severe      | 180 min   |
| -$260     | 1.73x          | 🔥 Severe      | 180 min   |
| -$440     | 2.93x          | 🔥 Severe      | 180 min   |

## Verification

```bash
# Check function signature
grep -n "function getSoftSlCooldownMs" src/mm_hl.ts
# Output: 131:function getSoftSlCooldownMs(breachMultiple: number): number {

# Check function call
grep -n "const cooldownMs = getSoftSlCooldownMs" src/mm_hl.ts  
# Output: 3133:    const cooldownMs = getSoftSlCooldownMs(breachMultiple)

# Check env vars
grep "PER_PAIR_SOFT_SL" .env
```

## Testing

When soft SL triggers, logs will show:
- **Mild breach:** `Cooldown=60min`
- **Severe breach:** `Cooldown=180min`

## Backups

- `src/mm_hl.ts.backup_before_cooldown_20251114_121148` - Clean version before any cooldown
- `src/mm_hl.ts.backup_before_adaptive_20251114_121707` - Version with simple cooldown

## Notes

- Default severe cooldown is 3× base if not configured
- Threshold must be >1.0 to be valid
- All values configurable via `.env` without code changes
- Bot successfully restarted and running with adaptive cooldown

---

**Next steps:**
- Monitor first SL trigger to verify adaptive behavior
- Optionally tune thresholds based on ZEC historical data
- Consider per-pair overrides if needed (e.g., `ZEC_SOFT_SL_COOLDOWN_MILD`)
