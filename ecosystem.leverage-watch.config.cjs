module.exports = {
  apps: [{
    name: 'leverage-watch',
    script: '/root/hyperliquid-mm-bot-complete/leverage-on-change.sh',
    cwd: '/root/hyperliquid-mm-bot-complete',
    watch: ['runtime/active_pairs.json'],
    watch_delay: 3000,
    ignore_watch: ['node_modules', '.git', 'logs', 'data', 'src', '*.log'],
    autorestart: false,
    max_restarts: 5,
    min_uptime: '5s',
    restart_delay: 2000
  }]
};
