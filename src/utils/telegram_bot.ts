import axios from 'axios';
import 'dotenv/config';

export class TelegramAlertBot {
    private token: string;
    private chatId: string;
    private enabled: boolean;

    // Skip routine status alerts from flooding Telegram
    private skipPatterns = [
        '[FOLLOW SM]',
        'BULL TRAP',
        'BULL_TRAP',
        'DEAD CAT',
        'GENERALS_OVERRIDE',
        'PURE_MM',
        'BidLocked:',
        'AskLocked:',
    ];

    constructor() {
        this.token = process.env.TELEGRAM_BOT_TOKEN || '';
        this.chatId = process.env.TELEGRAM_CHAT_ID || '';
        this.enabled = !!this.token && !!this.chatId;

        if (!this.enabled && (process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_CHAT_ID)) {
            console.warn('⚠️ Telegram bot partially configured but disabled (missing token or chat_id)');
        } else if (this.enabled) {
            console.log('✅ Telegram alert bot initialized');
        }
    }

    async send(message: string, level: 'info' | 'warn' | 'error' = 'info'): Promise<void> {
        if (!this.enabled) return;

        // Skip routine alerts
        const shouldSkip = this.skipPatterns.some(pattern => message.includes(pattern));
        if (shouldSkip) return;

        let icon = 'ℹ️';
        if (level === 'warn') icon = '⚠️';
        if (level === 'error') icon = '🚨';
        if (message.includes('PROFIT')) icon = '💰';
        if (message.includes('ROTATION')) icon = '🔄';

        // Escape HTML special chars if needed, but simple text is safer usually.
        // For now, sending as plain text or simple HTML with bold
        const text = `${icon} <b>[HL-MM]</b> ${message}`;

        try {
            await axios.post(`https://api.telegram.org/bot${this.token}/sendMessage`, {
                chat_id: this.chatId,
                text: text,
                parse_mode: 'HTML'
            });
        } catch (error: any) {
            console.error(`Failed to send Telegram alert: ${error?.message || error}`);
        }
    }
}

export const telegramBot = new TelegramAlertBot();

