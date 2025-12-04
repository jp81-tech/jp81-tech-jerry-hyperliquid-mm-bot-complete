
import { getNansenHyperliquidAPI } from '../src/integrations/nansen_scoring.js';
import 'dotenv/config';

async function test() {
    const api = getNansenHyperliquidAPI();
    if (!api.isEnabled()) {
        console.log('Nansen API not enabled');
        return;
    }
    console.log('Fetching Nansen data...');
    try {
        const data = await api.getPerpScreener({ limit: 100 });
        console.log('Data fetched:', data.length, 'tokens');
        const virtual = data.find(t => t.token_symbol === 'VIRTUAL' || t.token_symbol === 'VIRTUALUSDT');

        console.log('Sample tokens:', data.slice(0, 5).map(t => t.token_symbol).join(', '));

        if (virtual) {
            console.log('VIRTUAL:', virtual);
            console.log('Score:', api.getTokenScore(virtual));
        } else {
            console.log('VIRTUAL not found in top 100');
        }
    } catch (e) {
        console.error('Error:', e);
    }
}

test();
