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
      telegramBot.send(msg, 'info').catch(e => console.error('[Telegram] Failed to send info:', e.message));
    }
  }

  warn(msg: string) {
    console.warn(`[WARN] ${msg}`);
    telegramBot.send(msg, 'warn').catch(e => console.error('[Telegram] Failed to send warn:', e.message));
  }

  error(msg: string) {
    console.error(`[ERROR] ${msg}`);
    telegramBot.send(msg, 'error').catch(e => console.error('[Telegram] Failed to send error:', e.message));
  }
}
