module.exports = {
  apps: [{
    name: "hyperliquid-mm",
    cwd: "/root/hyperliquid-mm-bot-complete",
    script: "src/mm_hl.ts",
    interpreter: "node",
    interpreter_args: "--experimental-loader ts-node/esm --max-old-space-size=512",
    env: { 
      NODE_OPTIONS: "--max-old-space-size=512",
      TS_NODE_TRANSPILE_ONLY: "1",
      TS_NODE_IGNORE: "false"
    },
    max_memory_restart: "400M",
    kill_timeout: 120000,
    listen_timeout: 120000,
    restart_delay: 3000,
    exp_backoff_restart_delay: 3000,
    max_restarts: 10,
    min_uptime: 10000,
    autorestart: true
  }]
}
