#!/bin/bash
set -e

# Konfiguracja
if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
fi

SERVER_USER="${DEPLOY_USER:-jerry}"
SERVER_IP="${DEPLOY_IP:-65.109.92.187}"
REMOTE_DIR="/home/$SERVER_USER/hyperliquid-mm-bot-complete"

echo "🚀 Rozpoczynam deploy na serwer ($SERVER_IP)..."

# 1. Kopiowanie plików (nadpisanie kodu na serwerze)
echo "📦 Przesyłanie plików (src, scripts, config)..."
scp -r src scripts package.json tsconfig.json start-bot.sh stop-bot.sh "$SERVER_USER@$SERVER_IP:$REMOTE_DIR/"

# 2. Akcje na serwerze (instalacja i restart)
echo "🔄 Wykonywanie akcji na serwerze..."
ssh "$SERVER_USER@$SERVER_IP" "cd $REMOTE_DIR && \
    echo '   Installing dependencies...' && \
    npm install && \
    echo '   Restarting bot...' && \
    ./stop-bot.sh || true && \
    if [ -f ./start-bot.sh ] && [ -x ./start-bot.sh ]; then \
        nohup ./start-bot.sh > /dev/null 2>&1 & \
        echo '   ⏳ Waiting for bot to initialize...' && \
        sleep 5 && \
        if pgrep -f "mm_hl.ts" > /dev/null; then \
           echo '   ✅ Bot process found running'; \
        else \
           echo '   ❌ Error: Bot process not found. Check logs: tail -n 20 bot.log'; \
           exit 1; \
        fi \
    else \
        echo '   ❌ Error: start-bot.sh not found or not executable'; \
        exit 1; \
    fi"

echo "✅ Deploy zakończony sukcesem! Bot został zrestartowany."
echo "   Aby podejrzeć logi, wpisz: ssh $SERVER_USER@$SERVER_IP 'tail -f $REMOTE_DIR/bot.log'"

