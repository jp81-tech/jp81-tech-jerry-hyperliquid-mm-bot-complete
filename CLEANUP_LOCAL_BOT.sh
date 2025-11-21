#!/bin/bash
# Bezpieczne usuwanie lokalnych plików bota z Maca

echo "🗑️  CLEANUP: Usuwanie lokalnych plików bota z Maca"
echo "=================================================="
echo ""
echo "⚠️  UWAGA: Te komendy USUNĄ pliki na zawsze!"
echo ""
read -p "Czy na pewno chcesz kontynuować? (yes/no): " confirm

if [ "$confirm" != "yes" ]; then
  echo "❌ Anulowano"
  exit 1
fi

echo ""
echo "🔍 Sprawdzam co zostanie usunięte..."

# 1. Główny katalog
if [ -d ~/Desktop/hyperliquid-mm-bot-complete ]; then
  echo "   📁 ~/Desktop/hyperliquid-mm-bot-complete"
fi

# 2. Inne katalogi
if [ -d ~/my-mm-bot ]; then
  echo "   📁 ~/my-mm-bot"
fi

if [ -d ~/Desktop/hyperliquid-bot-configs ]; then
  echo "   📁 ~/Desktop/hyperliquid-bot-configs"
fi

if [ -f ~/Desktop/hyperliquid-mm-bot.zip ]; then
  echo "   📦 ~/Desktop/hyperliquid-mm-bot.zip"
fi

# 3. Pliki z kluczami
if [ -f ~/.env.live.save ]; then
  echo "   🔐 ~/.env.live.save"
fi

echo ""
read -p "Usunąć powyższe pliki? (yes/no): " final_confirm

if [ "$final_confirm" != "yes" ]; then
  echo "❌ Anulowano"
  exit 1
fi

echo ""
echo "🗑️  Usuwanie..."

# 1. Główny katalog
if [ -d ~/Desktop/hyperliquid-mm-bot-complete ]; then
  echo "   Usuwam ~/Desktop/hyperliquid-mm-bot-complete..."
  rm -rf ~/Desktop/hyperliquid-mm-bot-complete
  echo "   ✅ Usunięto"
fi

# 2. Inne katalogi
if [ -d ~/my-mm-bot ]; then
  echo "   Usuwam ~/my-mm-bot..."
  rm -rf ~/my-mm-bot
  echo "   ✅ Usunięto"
fi

if [ -d ~/Desktop/hyperliquid-bot-configs ]; then
  echo "   Usuwam ~/Desktop/hyperliquid-bot-configs..."
  rm -rf ~/Desktop/hyperliquid-bot-configs
  echo "   ✅ Usunięto"
fi

if [ -f ~/Desktop/hyperliquid-mm-bot.zip ]; then
  echo "   Usuwam ~/Desktop/hyperliquid-mm-bot.zip..."
  rm -f ~/Desktop/hyperliquid-mm-bot.zip
  echo "   ✅ Usunięto"
fi

# 3. Pliki z kluczami
if [ -f ~/.env.live.save ]; then
  echo "   Usuwam ~/.env.live.save..."
  rm -f ~/.env.live.save
  echo "   ✅ Usunięto"
fi

echo ""
echo "✅ Cleanup zakończony!"
echo ""
echo "🔍 Weryfikacja:"
echo "   Sprawdzam czy wszystko zostało usunięte..."

if [ -d ~/Desktop/hyperliquid-mm-bot-complete ] || \
   [ -d ~/my-mm-bot ] || \
   [ -d ~/Desktop/hyperliquid-bot-configs ] || \
   [ -f ~/Desktop/hyperliquid-mm-bot.zip ] || \
   [ -f ~/.env.live.save ]; then
  echo "   ⚠️  Niektóre pliki nadal istnieją:"
  [ -d ~/Desktop/hyperliquid-mm-bot-complete ] && echo "      ~/Desktop/hyperliquid-mm-bot-complete"
  [ -d ~/my-mm-bot ] && echo "      ~/my-mm-bot"
  [ -d ~/Desktop/hyperliquid-bot-configs ] && echo "      ~/Desktop/hyperliquid-bot-configs"
  [ -f ~/Desktop/hyperliquid-mm-bot.zip ] && echo "      ~/Desktop/hyperliquid-mm-bot.zip"
  [ -f ~/.env.live.save ] && echo "      ~/.env.live.save"
else
  echo "   ✅ Wszystkie pliki zostały usunięte!"
fi

echo ""
echo "📊 Sprawdź ręcznie:"
echo "   ls ~/Desktop | grep hyperliquid"
echo "   ls ~ | grep -E 'my-mm-bot|\.env'"

