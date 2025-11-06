#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# 1) Szybki lint na krytyczne pliki
critical=(src/mm_hl.ts src/utils/volatility_rotation.ts src/selection/allowed.ts)
npx tsc --noEmit "${critical[@]}" >/dev/null 2>&1 || {
  echo "❌ TS check failed on critical files — restoring last stable"
  git reset --hard "$(git describe --tags --abbrev=0 | sed -n '1p')" || exit 1
}

# 2) Anti-patterny, które już widzieliśmy:
#    - 'leverage:' wstrzyknięty POZA const orderRequest
#    - porzucone 'try {' / 'while (true) {' bez pary
BAD_PATTERNS=(
  "^\s*leverage:\s*Number\(process\.env\.DEFAULT_LEVERAGE"
)
for pat in "${BAD_PATTERNS[@]}"; do
  if grep -R -nE "$pat" src | grep -v "orderRequest" >/dev/null 2>&1; then
    echo "❌ Found bad leverage injection outside orderRequest — restoring stable"
    git reset --hard "$(git describe --tags --abbrev=0 | sed -n '1p')" || exit 1
  fi
done

# 3) Kontrola par nawiasów przy pętli głównej (heurystyka)
open=$(grep -n "while *(true)" -n src/mm_hl.ts | wc -l | tr -d ' ')
close=$(grep -n "}" src/mm_hl.ts | wc -l | tr -d ' ')
if [ "$open" -gt 0 ] && [ "$close" -lt 1 ]; then
  echo "❌ Brak zamknięcia bloku — restore stable"
  git reset --hard "$(git describe --tags --abbrev=0 | sed -n '1p')" || exit 1
fi

echo "✅ guard_integrity OK"
