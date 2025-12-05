import { telegramBot } from './telegram_bot.js';

export interface Notifier {
  info(msg: string): void
  warn(msg: string): void
  error(msg: string): void
}

export class ConsoleNotifier implements Notifier {
  info(msg: string) {
    console.log(`[INFO] ${msg}`);

    // Selectively forward important info to Telegram
    if (
      msg.includes('[SMART ROTATION]') ||
      msg.includes('[DAILY STATS]') ||
      msg.includes('PROFIT') ||
      msg.includes('[NANSEN KILL SWITCH]') ||
      msg.includes('🚨')
    ) {
      telegramBot.send(msg, 'info');
    }
  }

  warn(msg: string) {
    console.warn(`[WARN] ${msg}`);
    telegramBot.send(msg, 'warn');
  }

  error(msg: string) {
    console.error(`[ERROR] ${msg}`);
    telegramBot.send(msg, 'error');
  }
}
