import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const file = path.resolve(__dirname, '../../data/KILL_SWITCH_ON');

// Export function for use in bot
export async function killSwitchActive(): Promise<boolean> {
  return fs.existsSync(file);
}

// CLI interface
const cmd = process.argv[2] || '';

if (cmd === 'on') {
  fs.writeFileSync(file, '1');
  console.log('Kill switch ON.');
} else if (cmd === 'off') {
  if (fs.existsSync(file)) fs.unlinkSync(file);
  console.log('Kill switch OFF.');
} else if (cmd) {
  console.log('Usage: node --loader ts-node/esm src/utils/kill_switch.ts on|off');
}
