#!/usr/bin/env npx tsx
/**
 * Nansen API Tester - Verify all endpoints work
 */

import 'dotenv/config'
import { getNansenProAPI } from './nansen_pro.js'

async function testNansenAPI() {
  console.log('🧪 NANSEN PRO API TESTER\n')
  console.log('════════════════════════════════════════════════════════════\n')

  const nansen = getNansenProAPI()

  if (!nansen.isEnabled()) {
    console.error('❌ Nansen API is DISABLED')
    console.error('   Check: NANSEN_ENABLED=true and NANSEN_API_KEY set in .env\n')
    process.exit(1)
  }

  console.log('✅ Nansen API is enabled\n')

  // ═══════════════════════════════════════════════════════════════
  // 1. HEALTH CHECK
  // ═══════════════════════════════════════════════════════════════

  console.log('1️⃣  HEALTH CHECK')
  console.log('────────────────────────────────────────────────────────────')

  const healthy = await nansen.healthCheck()
  if (healthy) {
    console.log('✅ API is responding correctly\n')
  } else {
    console.error('❌ API health check failed\n')
    process.exit(1)
  }

  // ═══════════════════════════════════════════════════════════════
  // 2. TOP TRADERS LEADERBOARD
  // ═══════════════════════════════════════════════════════════════

  console.log('2️⃣  PERP LEADERBOARD (Top 10 Traders)')
  console.log('────────────────────────────────────────────────────────────')

  const traders = await nansen.getPerpLeaderboard(10)
  if (traders.length > 0) {
    console.log(`✅ Found ${traders.length} perp tokens with activity:\n`)
    for (let i = 0; i < Math.min(5, traders.length); i++) {
      const t = traders[i] as any
      console.log(`   ${i + 1}. ${t.token_symbol}`)
      console.log(`      Volume: $${(t.volume / 1000000).toFixed(2)}M | Buy/Sell Pressure: $${(t.buy_sell_pressure / 1000000).toFixed(2)}M`)
      console.log(`      Traders: ${t.trader_count || 'N/A'} | Price: $${t.mark_price?.toFixed(4) || 'N/A'}`)
    }
    console.log()
  } else {
    console.log('⚠️  No token data (might be rate limited or endpoint issue)\n')
  }

  // ═══════════════════════════════════════════════════════════════
  // 3. COPY-TRADING SIGNALS
  // ═══════════════════════════════════════════════════════════════

  console.log('3️⃣  COPY-TRADING SIGNALS')
  console.log('────────────────────────────────────────────────────────────')

  const signals = await nansen.getCopyTradingSignals(60, 3)
  if (signals.length > 0) {
    console.log(`✅ Generated ${signals.length} copy-trading signals:\n`)
    for (const sig of signals.slice(0, 5)) {
      const side = sig.side === 'LONG' ? '🟢' : '🔴'
      console.log(`   ${side} ${sig.token_symbol}: ${sig.side}`)
      console.log(`      Confidence: ${sig.confidence}% | Traders: ${sig.trader_count}`)
      console.log(`      Avg Entry: $${sig.avg_entry_price.toFixed(2)} | Total Position: $${(sig.total_position_usd / 1000).toFixed(1)}k`)
      console.log(`      Reason: ${sig.reason}`)
    }
    console.log()
  } else {
    console.log('⚠️  No copy-trading signals (might need more trader consensus)\n')
  }

  // ═══════════════════════════════════════════════════════════════
  // 4. SMART MONEY NETFLOWS
  // ═══════════════════════════════════════════════════════════════

  console.log('4️⃣  SMART MONEY NETFLOWS')
  console.log('────────────────────────────────────────────────────────────')

  const testTokens = ['ETH', 'BTC', 'SOL', 'MATIC']
  const netflows = await nansen.getSmartMoneyNetflows(testTokens)

  if (netflows.length > 0) {
    console.log(`✅ Smart Money data for ${netflows.length} tokens:\n`)
  } else {
    console.log('⚠️  No smart money data (endpoint might be for ERC20 only, not Hyperliquid)\n')
  }

  // ═══════════════════════════════════════════════════════════════
  // 5. TOKEN RISK ANALYSIS
  // ═══════════════════════════════════════════════════════════════

  console.log('5️⃣  TOKEN RISK ANALYSIS')
  console.log('────────────────────────────────────────────────────────────')

  const riskAnalysis = await nansen.analyzeTokenRisk('USDC')
  console.log(`   Token: USDC`)
  console.log(`   Risk Level: ${riskAnalysis.riskLevel}`)
  console.log(`   Top 10 Concentration: ${riskAnalysis.top10Concentration.toFixed(1)}%`)
  console.log(`   Smart Money Holders: ${riskAnalysis.smartMoneyHolders}`)
  console.log(`   Reason: ${riskAnalysis.reason}\n`)

  // ═══════════════════════════════════════════════════════════════
  // 6. FLOW INTELLIGENCE
  // ═══════════════════════════════════════════════════════════════

  console.log('6️⃣  FLOW INTELLIGENCE')
  console.log('────────────────────────────────────────────────────────────')

  const flows = await nansen.getFlowIntelligence(testTokens)
  if (flows.length > 0) {
    console.log(`✅ Flow intelligence for ${flows.length} tokens:\n`)
  } else {
    console.log('⚠️  No flow intelligence data\n')
  }

  // ═══════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════

  console.log('════════════════════════════════════════════════════════════')
  console.log('✅ TESTING COMPLETE\n')

  console.log('RESULTS SUMMARY:')
  console.log(`   Health Check: ${healthy ? '✅' : '❌'}`)
  console.log(`   Top Traders: ${traders.length > 0 ? '✅' : '⚠️'} (${traders.length} found)`)
  console.log(`   Copy Signals: ${signals.length > 0 ? '✅' : '⚠️'} (${signals.length} generated)`)
  console.log(`   Smart Money: ${netflows.length > 0 ? '✅' : '⚠️'} (${netflows.length} tokens)`)
  console.log(`   Token Risk: ✅`)
  console.log(`   Flow Intel: ${flows.length > 0 ? '✅' : '⚠️'} (${flows.length} tokens)\n`)

  console.log('NOTE: Some endpoints might not work for Hyperliquid specifically')
  console.log('      (e.g., smart money/flow are for on-chain tokens like ERC20)')
  console.log('      Top Traders + Copy-Trading should work for Hyperliquid perps!\n')
}

testNansenAPI().catch(err => {
  console.error('\n❌ FATAL ERROR:', err.message)
  console.error(err.stack)
  process.exit(1)
})
