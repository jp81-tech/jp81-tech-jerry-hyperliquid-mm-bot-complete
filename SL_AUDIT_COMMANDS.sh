#!/bin/bash
# 🛡️ SL Audit - Quick Commands Reference
# Użycie: skopiuj komendy i wklej na serwerze

cd /root/hyperliquid-mm-bot-complete

echo "🛡️ SL AUDIT - QUICK COMMANDS"
echo "================================"
echo ""

# 0. Live podgląd
echo "0️⃣ LIVE PODGLĄD (Ctrl+C żeby wyjść):"
echo "journalctl -u mm-bot.service -f --no-pager | egrep 'SL|NANSEN|RISK|cooldown|DAILY'"
echo ""

# 1. Freeze mode
echo "1️⃣ FREEZE MODE:"
echo "journalctl -u mm-bot.service --since 'today' --no-pager | grep -i 'freeze\\|locked pairs'"
echo ""

# 2. Soft SL checks
echo "2️⃣ SOFT SL CHECKS (uPnL + maxLoss):"
echo "journalctl -u mm-bot.service --since '2 hours ago' --no-pager | egrep 'Soft SL check|maxLoss|uPnL' | grep -E 'ZEC|UNI|VIRTUAL'"
echo ""

# 3. Soft SL hits
echo "3️⃣ SOFT SL HITS (gdy przekroczy limit):"
echo "journalctl -u mm-bot.service --since '6 hours ago' --no-pager | egrep 'SOFT SL HIT|Soft SL.*HIT|position closed.*soft SL' | grep -E 'ZEC|UNI|VIRTUAL'"
echo ""

# 4. Soft SL cooldowny
echo "4️⃣ SOFT SL COOLDOWNY:"
echo "journalctl -u mm-bot.service --since '2 hours ago' --no-pager | egrep 'cooldown|COOLDOWN' | grep -E 'ZEC|UNI|VIRTUAL'"
echo ""

# 5. Nansen risk levels
echo "5️⃣ NANSEN RISK LEVELS:"
echo "journalctl -u mm-bot.service --since '2 hours ago' --no-pager | egrep 'NANSEN.*risk|marked as.*AVOID|marked as.*CAUTION|marked as.*OK' | grep -E 'ZEC|UNI|VIRTUAL'"
echo ""

# 6. Nansen conflict SL
echo "6️⃣ NANSEN CONFLICT SL:"
echo "journalctl -u mm-bot.service --since '12 hours ago' --no-pager | egrep 'CONFLICT|Conflict detected|severity=' | grep -E 'ZEC|UNI|VIRTUAL'"
echo ""

# 7. Cost-benefit skip
echo "7️⃣ COST-BENEFIT SKIP:"
echo "journalctl -u mm-bot.service --since '24 hours ago' --no-pager | egrep 'Skip.*close|Skip conflict' | grep -E 'ZEC|UNI|VIRTUAL'"
echo ""

# 8. Daily SL
echo "8️⃣ DAILY SL:"
echo "journalctl -u mm-bot.service --since 'today' --no-pager | egrep 'DAILY|daily.*loss|Daily.*limit|safe mode'"
echo ""

# 9. Wszystkie SL eventy z ostatnich 12h
echo "9️⃣ WSZYSTKIE SL EVENTY (12h):"
echo "journalctl -u mm-bot.service --since '12 hours ago' --no-pager | egrep 'SL|RISK|cooldown' | grep -E 'ZEC|UNI|VIRTUAL'"
echo ""

# 10. Tylko ZEC SL z dzisiaj
echo "🔟 TYLKO ZEC SL (dzisiaj):"
echo "journalctl -u mm-bot.service --since 'today' --no-pager | egrep 'SL|RISK|cooldown' | grep 'ZEC'"
echo ""

# 11. Nansen sygnały dla VIRTUAL
echo "1️⃣1️⃣ NANSEN SYGNAŁY VIRTUAL:"
echo "journalctl -u mm-bot.service --since 'yesterday' --until 'today' --no-pager | egrep 'NANSEN' | grep 'VIRTUAL'"
echo ""

# 12. Maksymalny notional ZEC
echo "1️⃣2️⃣ MAKSYMALNY NOTIONAL ZEC:"
echo "journalctl -u mm-bot.service --since 'yesterday' --no-pager | grep 'ZEC' | grep -E 'notional|position.*value' | grep -oE '[0-9]{4,}' | sort -n | tail -5"
echo ""

# 13. Większe straty bez reakcji SL
echo "1️⃣3️⃣ WIĘKSZE STRATY BEZ REAKCJI SL:"
echo "journalctl -u mm-bot.service --since 'yesterday' --no-pager | egrep 'uPnL.*-[0-9]{3,}' | grep -v 'SL\\|RISK\\|cooldown'"
echo ""

echo "================================"
echo "✅ Gotowe! Skopiuj komendy i użyj na serwerze."

