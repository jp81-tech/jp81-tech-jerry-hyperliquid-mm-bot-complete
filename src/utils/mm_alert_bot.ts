import axios from 'axios';
import { getNansenProAPI, NansenProAPI } from '../integrations/nansen_pro.js';
import { MARKET_MAKERS, WhaleEntity } from '../data/whale_wallets.js';

interface ActivePosition {
  trader_address: string;
  trader_label: string;
  token: string;
  side: string;
  size: number;
  value_usd: number;
  entry_price: number;
  leverage: number;
  unrealized_pnl: number;
}

enum LiquidityRisk {
  SAFE = "SAFE 🟢",
  MODERATE = "MODERATE 🟡",
  RISKY = "RISKY 🟠",
  CRITICAL = "CRITICAL 🔴",
  RUG_DETECTED = "RUG PULL 💀"
}

interface LiquiditySnapshot {
  timestamp: number;
  liquidityUsd: number;
  marketCapUsd: number;
  ratio: number;
}

const TRACKED_TOKENS: Record<string, { min_position_usd: number; min_alert_usd: number }> = {
  "VIRTUAL": { min_position_usd: 100000, min_alert_usd: 50000 },
  "ZEC": { min_position_usd: 500000, min_alert_usd: 100000 },
  "MON": { min_position_usd: 50000, min_alert_usd: 25000 },
  "HYPE": { min_position_usd: 200000, min_alert_usd: 100000 },
  "MONO": { min_position_usd: 50000, min_alert_usd: 25000 } // MONO on BNB
};

export class MMAlertBot {
  private slackWebhook: string;
  private nansen: NansenProAPI;
  private alertCooldowns: Map<string, number> = new Map();
  private seenPerpTxs: Set<string> = new Set();

  // Position Tracking Cache: Token -> Trader -> Position
  private positionsCache: Map<string, Map<string, ActivePosition>> = new Map();

  // Liquidity History: Token -> Snapshots
  private liquidityHistory: Map<string, LiquiditySnapshot[]> = new Map();

  private readonly COOLDOWN_MS = 300000; // 5 minutes

  constructor() {
    this.slackWebhook = process.env.SLACK_WEBHOOK_URL || '';
    this.nansen = getNansenProAPI();
  }

  private async sendSlack(message: string) {
    if (!this.slackWebhook) return;
    try {
      await axios.post(this.slackWebhook, { text: message });
    } catch (e) {
      console.error('[MMAlertBot] Failed to send Slack message:', e);
    }
  }

  // === ROTATION ALERTS ===

  async onRotation(newPairs: string[], reason: string) {
    if (newPairs.length === 0) return;

    let msg = `🔄 *MM ROTATION ALERT*\n`;
    msg += `New Active Pairs: *${newPairs.join(', ')}*\n`;
    msg += `Reason: _${reason}_\n\n`;

    msg += `📊 *NANSEN INSIGHTS (God Mode):*\n`;

    for (const pair of newPairs) {
      msg += await this.getTokenReport(pair);
    }

    await this.sendSlack(msg);
  }

  private async getTokenReport(symbol: string): Promise<string> {
    let report = `> *${symbol}*\n`;

    // 1. Top Trader PnL
    const perpSignals = await this.nansen.getTopTradersForToken(symbol, 5);
    if (perpSignals && perpSignals.length > 0) {
        const topTrader = perpSignals[0];
        report += `> 🏆 Top Trader PnL: $${(topTrader.total_pnl_usd || 0).toLocaleString()}\n`;
    }

    return report + `\n`;
  }

  // === WHALE TRACKER & MONITORING ===

  private canAlert(key: string): boolean {
    const lastAlert = this.alertCooldowns.get(key) || 0;
    if (Date.now() - lastAlert < this.COOLDOWN_MS) return false;
    this.alertCooldowns.set(key, Date.now());
    return true;
  }

  // Safe no-op for large transfers (stub – implement when needed)
  private async checkLargeTransfers(_token: { symbol: string; address: string; chain: string }) {
    return;
  }

  /**
   * Main Monitoring Loop
   */
  async checkWhaleActivity(tokens: { symbol: string; address: string; chain: string }[]) {
    console.log('🐋 Checking Whale & Risk Activity...');

    // 1. Check On-Chain Transfers (Original Logic)
    for (const token of tokens) {
      await this.checkLargeTransfers(token);
    }

    // 2. Check Perp Trades & Positions (New Logic)
    for (const [symbol, config] of Object.entries(TRACKED_TOKENS)) {
        await this.checkPerpTrades(symbol, config.min_alert_usd);
        await this.checkPositionChanges(symbol, config.min_position_usd);
    }

    // 3. Check Liquidity Changes (Advanced)
    await this.checkLiquidity(tokens);

    // 4. Check Smart Money Flows (Risk Detector)
    await this.checkSmartMoneyFlows(tokens);

    // 5. Check AI Risk Signals
    await this.checkRiskSignals(tokens);
  }

  async checkLiquidity(tokens: { symbol: string; address: string; chain: string }[]) {
    for (const token of tokens) {
      if (!token.address || token.address.startsWith('0xeee')) continue; // Skip native

      try {
        const overview = await this.nansen.getTokenOverview(token.address, token.chain);
        if (!overview) continue;

        const currentLiq = overview.liquidity_usd || 0;
        const mcap = overview.market_cap_usd || overview.fdv_usd || 0; // Fallback to FDV

        if (currentLiq === 0) continue;

        // Create Snapshot
        const snapshot: LiquiditySnapshot = {
            timestamp: Date.now(),
            liquidityUsd: currentLiq,
            marketCapUsd: mcap,
            ratio: mcap > 0 ? currentLiq / mcap : 0
        };

        // Initialize history if needed
        if (!this.liquidityHistory.has(token.symbol)) {
            this.liquidityHistory.set(token.symbol, []);
        }
        const history = this.liquidityHistory.get(token.symbol)!;
        history.push(snapshot);

        // Keep last ~24h (assuming 5m intervals = 288 snapshots)
        if (history.length > 300) history.shift();

        // ANALYZE RISK

        // 1. Find comparison snapshots
        const oneHourAgo = history.find(s => s.timestamp >= Date.now() - 3600000); // ~1h
        const prevSnapshot = history.length > 1 ? history[history.length - 2] : null;

        let riskLevel = LiquidityRisk.SAFE;
        let reasons: string[] = [];

        // A. Liq/MCap Ratio Check
        if (snapshot.ratio > 0) {
            if (snapshot.ratio < 0.02) { // < 2%
                riskLevel = LiquidityRisk.CRITICAL;
                reasons.push(`Low Liquidity Ratio: ${(snapshot.ratio * 100).toFixed(1)}% (<2%)`);
            } else if (snapshot.ratio < 0.05) { // 2-5%
                riskLevel = LiquidityRisk.RISKY;
                reasons.push(`Risky Liquidity Ratio: ${(snapshot.ratio * 100).toFixed(1)}%`);
            }
        }

        // B. Liquidity Drop Check (vs 1h ago)
        if (oneHourAgo) {
            const dropPct = ((currentLiq - oneHourAgo.liquidityUsd) / oneHourAgo.liquidityUsd) * 100;

            if (dropPct < -50) {
                riskLevel = LiquidityRisk.RUG_DETECTED;
                reasons.push(`RUG PULL DETECTED: Liq dropped ${dropPct.toFixed(1)}% in 1h!`);
            } else if (dropPct < -20) {
                riskLevel = LiquidityRisk.CRITICAL;
                reasons.push(`CRITICAL DROP: Liq dropped ${dropPct.toFixed(1)}% in 1h`);
            } else if (dropPct < -10) {
                if (riskLevel === LiquidityRisk.SAFE) riskLevel = LiquidityRisk.MODERATE;
                reasons.push(`Warning: Liq dropped ${dropPct.toFixed(1)}% in 1h`);
            }
        }

        // Alert Logic
        if (riskLevel !== LiquidityRisk.SAFE) {
            // Only alert if risk changed or is CRITICAL/RUG (with cooldown)
            // Or if previous was safe

            const alertKey = `liq_risk_${token.symbol}_${riskLevel}`;
            if (this.canAlert(alertKey) || riskLevel === LiquidityRisk.RUG_DETECTED) {
                const msg = `${riskLevel === LiquidityRisk.RUG_DETECTED ? '🚨' : '⚠️'} *LIQUIDITY MONITOR: ${token.symbol}*\n` +
                            `Status: *${riskLevel}*\n` +
                            `Liquidity: $${Math.round(currentLiq).toLocaleString()}\n` +
                            `Liq/MCap Ratio: ${(snapshot.ratio * 100).toFixed(1)}%\n` +
                            `Details: ${reasons.join(', ')}`;

                await this.sendSlack(msg);
            }
        }

      } catch (e) {
          console.error(`[LiqMonitor] Error for ${token.symbol}:`, e);
      }
    }
  }

  async checkRiskSignals(tokens: { symbol: string; address: string; chain: string }[]) {
    // Group by chain
    const byChain: Record<string, string[]> = {};
    for (const t of tokens) {
        if (!t.address || t.address.startsWith('0xeee') || t.address.length < 10) continue;
        if (!byChain[t.chain]) byChain[t.chain] = [];
        byChain[t.chain].push(t.address);
    }

    for (const [chain, addresses] of Object.entries(byChain)) {
         if (['hyperevm', 'bitcoin'].includes(chain)) continue; // Skip unsupported chains

         try {
             const flows = await this.nansen.getFlowIntelligence(addresses, chain);

             for (const flow of flows) {
                 let riskScore = 0;
                 const smFlow = flow.smart_money_flow_usd || 0;
                 const exFlow = flow.exchange_flow_usd || 0; // Positive = Net Deposits to CEX
                 const whaleFlow = flow.whale_flow_usd || 0;

                 // Risk Scoring Logic
                 if (smFlow < -50000) riskScore += 30; // SM Dumping
                 if (exFlow > 100000) riskScore += 25; // CEX Deposits (Sell Pressure)
                 if (whaleFlow < -100000) riskScore += 25; // Whales Dumping

                 // Total Flow check
                 if (flow.total_flow_usd < -200000) riskScore += 20;

                 const symbol = flow.token_symbol || 'Unknown';

                 if (riskScore >= 50) {
                     const alertKey = `risk_${symbol}_${Math.floor(Date.now() / 3600000)}`; // Alert once per hour
                     if (this.canAlert(alertKey)) {
                         const riskLevel = riskScore >= 75 ? '🚨 CRITICAL' : '⚠️ HIGH';
                         const msg = `${riskLevel} *RISK DETECTED* (Score: ${riskScore}/100)\n` +
                                     `Token: *${symbol}*\n` +
                                     `🧠 SM Flow: $${Math.round(smFlow).toLocaleString()}\n` +
                                     `🏦 CEX Flow: $${Math.round(exFlow).toLocaleString()}\n` +
                                     `🐳 Whale Flow: $${Math.round(whaleFlow).toLocaleString()}`;
                         await this.sendSlack(msg);
                     }
                 }
             }
         } catch (e) {
             // Silent fail for risk check to not spam logs
         }
    }
  }

  async checkSmartMoneyFlows(tokens: { symbol: string; address: string; chain: string }[]) {
    // Group tokens by chain for batch requests
    const byChain: Record<string, string[]> = {};
    for (const t of tokens) {
        // Skip natives/invalid for this endpoint
        if (!t.address || t.address.startsWith('0xeee') || t.address.length < 10) continue;

        if (!byChain[t.chain]) byChain[t.chain] = [];
        byChain[t.chain].push(t.address);
    }

    for (const [chain, addresses] of Object.entries(byChain)) {
        // Skip chains likely not supported by standard EVM netflow endpoint yet
        if (['solana', 'hyperevm', 'bitcoin'].includes(chain)) continue;

        try {
            const flows = await this.nansen.getSmartMoneyNetflows(addresses, chain);

            for (const flow of flows) {
                // Try to resolve symbol back to our config
                const tokenConfig = tokens.find(t => t.address.toLowerCase() === (flow as any).token_address?.toLowerCase())
                                 || tokens.find(t => t.symbol === flow.token_symbol);
                const symbol = tokenConfig?.symbol || flow.token_symbol;

                const netflow = flow.netflow_usd;

                // Alert Thresholds: >$100k Pump, <-$50k Dump
                if (netflow < -50000) {
                    const alertKey = `sm_dump_${symbol}_${Math.floor(Date.now() / 14400000)}`; // Once every 4h
                    if (this.canAlert(alertKey)) {
                        const msg = `🧠🚨 *SMART MONEY DUMPING* ${symbol}\n` +
                                    `Chain: ${chain}\n` +
                                    `Netflow (24h): 🔴 $${Math.round(netflow).toLocaleString()}`;
                        await this.sendSlack(msg);
                    }
                } else if (netflow > 100000) {
                    const alertKey = `sm_pump_${symbol}_${Math.floor(Date.now() / 14400000)}`;
                    if (this.canAlert(alertKey)) {
                        const msg = `🧠💚 *SMART MONEY ACCUMULATING* ${symbol}\n` +
                                    `Chain: ${chain}\n` +
                                    `Netflow (24h): 🟢 +$${Math.round(netflow).toLocaleString()}`;
                        await this.sendSlack(msg);
                    }
                }
            }
        } catch (e) {
            console.error(`[MMAlertBot] SM Flows check failed for ${chain}:`, e);
        }
    }
  }

  private async checkPerpTrades(token: string, minUsd: number) {
      // Logic handled by checkPositionChanges which provides better context
  }

  private async checkPositionChanges(token: string, minUsd: number) {
      const positions = await this.nansen.getTgmPerpPositions(token, 'hyperliquid', minUsd);

      if (!this.positionsCache.has(token)) {
          this.positionsCache.set(token, new Map());
      }
      const tokenCache = this.positionsCache.get(token)!;
      const currentTraders = new Set<string>();

      for (const pos of positions) {
          // Map Nansen response to ActivePosition
          // API response keys might vary (snake_case vs camelCase). Using typical Nansen keys.
          const traderAddr = (pos.address || (pos as any).trader_address || '').toLowerCase();
          if (!traderAddr) continue;

          currentTraders.add(traderAddr);

          const newPos: ActivePosition = {
              trader_address: traderAddr,
              trader_label: this.resolveTraderLabel(traderAddr, (pos as any).trader_label),
              token: token,
              side: pos.side || 'unknown',
              size: parseFloat((pos as any).position_size || '0'),
              value_usd: pos.position_value_usd,
              entry_price: pos.entry_price,
              leverage: pos.leverage,
              unrealized_pnl: pos.unrealized_pnl
          };

          const cachedPos = tokenCache.get(traderAddr);

          if (!cachedPos) {
              // NEW POSITION
              const alertKey = `new_${traderAddr}_${token}`;
              if (this.canAlert(alertKey)) {
                  const sideEmoji = newPos.side.toLowerCase() === 'long' ? "🟢 LONG" : "🔴 SHORT";
                  const priority = newPos.value_usd > 1000000 ? "high" : "normal";

                  const msg = `📈 *NEW POSITION OPENED*\n` +
                              `Token: *${token}*\n` +
                              `Side: ${sideEmoji}\n` +
                              `Value: $${Math.round(newPos.value_usd).toLocaleString()}\n` +
                              `Entry: $${newPos.entry_price.toFixed(4)}\n` +
                              `Trader: ${newPos.trader_label}`;

                  await this.sendSlack(msg);
              }
          } else {
              // UPDATE (Check for Flip or Significant Size Change)
              if (cachedPos.side.toLowerCase() !== newPos.side.toLowerCase()) {
                  // FLIP
                  const alertKey = `flip_${traderAddr}_${token}`;
                  if (this.canAlert(alertKey)) {
                      const oldSide = cachedPos.side.toLowerCase() === 'long' ? "🟢 LONG" : "🔴 SHORT";
                      const newSide = newPos.side.toLowerCase() === 'long' ? "🟢 LONG" : "🔴 SHORT";

                      const msg = `🔄 *POSITION FLIP*\n` +
                                  `Token: *${token}*\n` +
                                  `Trader: ${newPos.trader_label}\n` +
                                  `Action: ${oldSide} ➡️ ${newSide}\n` +
                                  `New Value: $${Math.round(newPos.value_usd).toLocaleString()}`;

                      await this.sendSlack(msg);
                  }
              }
          }

          tokenCache.set(traderAddr, newPos);
      }

      // CHECK FOR CLOSED POSITIONS
      for (const [traderAddr, cachedPos] of tokenCache.entries()) {
          if (!currentTraders.has(traderAddr)) {
              // Position closed (or dropped below minUsd filter)
              // If it was significant, alert
              if (cachedPos.value_usd > minUsd) {
                  const alertKey = `close_${traderAddr}_${token}`;
                  if (this.canAlert(alertKey)) {
                       const sideEmoji = cachedPos.side.toLowerCase() === 'long' ? "🟢 LONG" : "🔴 SHORT";
                       const pnlEmoji = cachedPos.unrealized_pnl > 0 ? "✅" : "❌";

                       const msg = `📉 *POSITION CLOSED*\n` +
                                   `Token: *${token}*\n` +
                                   `Side: ${sideEmoji}\n` +
                                   `Value: $${Math.round(cachedPos.value_usd).toLocaleString()}\n` +
                                   `Est. PnL: ${pnlEmoji} $${Math.round(cachedPos.unrealized_pnl).toLocaleString()}\n` +
                                   `Trader: ${cachedPos.trader_label}`;

                       await this.sendSlack(msg);
                  }
              }
              tokenCache.delete(traderAddr);
          }
      }
  }

  private resolveTraderLabel(address: string, apiLabel?: string): string {
      // Check known MMs first
      for (const mm of Object.values(MARKET_MAKERS)) {
          if (this.getAllAddressesForMM(mm).has(address)) {
              return `${mm.emoji} ${mm.name}`;
          }
      }
      return apiLabel || address.substring(0, 8);
  }

  private async analyzeTransfer(tx: any, token: { symbol: string }) {
    const from = tx.from_address?.toLowerCase();
    const to = tx.to_address?.toLowerCase();
    const fromLabel = tx.from_label || '';
    const toLabel = tx.to_label || '';
    const valueUsd = tx.value_usd || 0;
    const txHash = tx.tx_hash?.substring(0, 10);

    // Check against all MMs
    for (const [mmId, mmData] of Object.entries(MARKET_MAKERS)) {
      const mmAddresses = this.getAllAddressesForMM(mmData);

      const isMMSender = mmAddresses.has(from) || fromLabel.toLowerCase().includes(mmData.name.toLowerCase());
      const isMMReceiver = mmAddresses.has(to) || toLabel.toLowerCase().includes(mmData.name.toLowerCase());

      if (isMMSender || isMMReceiver) {
        const alertKey = `${mmId}_${token.symbol}_${txHash}`;

        if (this.canAlert(alertKey)) {
          const action = isMMSender ? "📤 SOLD/SENT" : "📥 BOUGHT/RCVD";
          const emoji = isMMSender ? "🔴" : "🟢";

          const msg = `${emoji} *WHALE ALERT: ${mmData.emoji} ${mmData.name}*\n` +
                      `Token: *${token.symbol}*\n` +
                      `Action: ${action} $${Math.round(valueUsd).toLocaleString()}\n` +
                      `From: ${fromLabel || from?.substring(0,8)}\n` +
                      `To: ${toLabel || to?.substring(0,8)}\n` +
                      `TX: ${txHash}`;

          console.log(`🐋 [WHALE] ${msg.replace(/\*/g, '')}`);
          await this.sendSlack(msg);
        }
      }
    }
  }

  private getAllAddressesForMM(mm: WhaleEntity): Set<string> {
    const addresses = new Set<string>();
    for (const chainAddrs of Object.values(mm.addresses)) {
      chainAddrs.forEach(a => addresses.add(a.toLowerCase()));
    }
    return addresses;
  }
}

export const mmAlertBot = new MMAlertBot();
