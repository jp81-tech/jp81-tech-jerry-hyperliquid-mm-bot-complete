#!/bin/bash
# Skrypt do połączenia z serwerem i uruchomienia bota w DRY_RUN

echo "🚀 Łączenie z serwerem i uruchamianie bota w DRY_RUN..."
echo ""

SERVER="root@207.246.92.212"
BOT_DIR="/root/hyperliquid-mm-bot-complete"

echo "📋 Komendy do wykonania:"
echo ""
echo "1️⃣ Połącz się z serwerem:"
echo "   ssh $SERVER"
echo ""
echo "2️⃣ Przejdź do katalogu bota:"
echo "   cd $BOT_DIR"
echo ""
echo "3️⃣ Uruchom automatyczny start:"
echo "   ./scripts/start-dry-run.sh"
echo ""
echo "4️⃣ W drugim oknie Terminala (monitoring):"
echo "   ssh $SERVER"
echo "   cd $BOT_DIR"
echo "   tail -f bot.log | grep -E 'SNAPSHOT|RISK|NANSEN|PAPER TRADING|LIVE TRADING'"
echo ""
echo "---"
echo ""
echo "💡 Możesz też skopiować i wkleić wszystkie komendy naraz:"
echo ""
echo "ssh $SERVER 'cd $BOT_DIR && ./scripts/start-dry-run.sh'"
echo ""
echo "---"
echo ""
read -p "Czy chcesz, żebym spróbował połączyć się teraz? (yes/no): " connect

if [ "$connect" = "yes" ]; then
  echo ""
  echo "🔌 Łączenie z serwerem..."
  ssh $SERVER "cd $BOT_DIR && pwd && ls -la scripts/start-dry-run.sh 2>/dev/null || echo 'Skrypt nie istnieje'"
else
  echo ""
  echo "✅ Skopiuj komendy powyżej i wykonaj je ręcznie w Terminalu"
fi

