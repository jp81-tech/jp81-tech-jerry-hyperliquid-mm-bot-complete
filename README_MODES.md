# Trading Mode Management

## Quick Commands



## Files Created

-  - Bear mode configuration preset
-  - Code patch to prevent chasing parabolic moves
-  - Script to activate bear mode
-  - Script to return to normal mode

## Key Differences

| Setting | Normal | Bear |
|---------|--------|------|
| Capital Usage | 80% | 35% |
| Max per Token | $1200 | $800 |
| Confluence Boost | 2.0x | 1.5x |
| Momentum Filter | 25% | 15% |

See  for full details.

## Momentum Guard

The  file contains code to prevent opening LONGs during parabolic moves.

**Not yet implemented** - requires manual code integration into .

ENV variables are already set:
-  (enabled)
-  (normal) or  (bear)
