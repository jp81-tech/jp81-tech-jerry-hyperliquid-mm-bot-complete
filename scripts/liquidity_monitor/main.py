import asyncio
import os
from dotenv import load_dotenv
from liquidity_monitor import setup_liquidity_monitoring, LiquidityAlertIntegration

# Load env from parent directory if needed, or local .env
# Try loading from current dir first
load_dotenv()

# Try loading from project root if not found (assuming running from scripts/liquidity_monitor or root)
load_dotenv(os.path.join(os.path.dirname(__file__), '../../.env'))

async def main():
    telegram_bot_token = os.getenv("TELEGRAM_BOT_TOKEN")
    # Chat ID from user request or env
    chat_id = os.getenv("TELEGRAM_CHAT_ID", "645284026")

    if not telegram_bot_token:
        # Fallback to hardcoded token from previous context if available, or error
        # Assuming user has it in .env
        print("❌ Missing TELEGRAM_BOT_TOKEN environment variable")
        print("   Please add TELEGRAM_BOT_TOKEN to your .env file")
        return

    interval = int(os.getenv("LIQ_MONITOR_INTERVAL", "300"))

    monitor = setup_liquidity_monitoring(chat_id)
    integration = LiquidityAlertIntegration(monitor, telegram_bot_token)

    print(f"🚀 Liquidity Monitor started for chat {chat_id}")
    await integration.periodic_check(interval_seconds=interval)

if __name__ == "__main__":
    asyncio.run(main())

