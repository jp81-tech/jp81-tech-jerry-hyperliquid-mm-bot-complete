#!/bin/bash
set -e

# Konfiguracja
SERVER_USER="jerry"
SERVER_IP="65.109.92.187"
REMOTE_DIR="~/hyperliquid-mm-bot-complete"

echo "🚀 Rozpoczynam deploy na serwer ($SERVER_IP)..."

# 1. Kopiowanie plików (nadpisanie kodu na serwerze)
echo "📦 Przesyłanie plików (src, scripts, config)..."
scp -r src scripts package.json tsconfig.json "$SERVER_USER@$SERVER_IP:$REMOTE_DIR/"

# 2. Akcje na serwerze (instalacja i restart)
echo "🔄 Wykonywanie akcji na serwerze..."
ssh "$SERVER_USER@$SERVER_IP" "cd $REMOTE_DIR && \
    echo '   Installing dependencies...' && \
    npm install && \
    echo '   Restarting bot...' && \
    ./stop-bot.sh || true && \
    nohup ./start-bot.sh > /dev/null 2>&1 &"

echo "✅ Deploy zakończony sukcesem! Bot został zrestartowany."
echo "   Aby podejrzeć logi, wpisz: ssh $SERVER_USER@$SERVER_IP 'tail -f $REMOTE_DIR/bot.log'"

