#!/usr/bin/env npx tsx
/**
 * Complete Nansen Hyperliquid API Endpoint Test
 * Based on official documentation
 */

import 'dotenv/config'
import axios from 'axios'

const API_KEY = process.env.NANSEN_API_KEY || ''
const BASE_URL = 'https://api.nansen.ai/api/v1'

async function testEndpoint(name: string, endpoint: string, body: any) {
  console.log(`\n🧪 ${name}`)
  console.log(`   Endpoint: ${endpoint}`)

  try {
    const response = await axios.post(
      `${BASE_URL}${endpoint}`,
      body,
      {
        headers: {
          'apiKey': API_KEY,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      }
    )

    console.log(`   ✅ Status: ${response.status}`)
    const data = JSON.stringify(response.data, null, 2)
    console.log(`   Response preview:`, data.substring(0, 300) + '...')
    return { success: true, data: response.data }
  } catch (error: any) {
    console.log(`   ❌ ${error.response?.status || 'ERROR'}: ${error.message}`)
    if (error.response?.data) {
      console.log(`   Error:`, JSON.stringify(error.response.data))
    }
    return { success: false, error: error.message }
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════')
  console.log('🔥 COMPLETE NANSEN HYPERLIQUID API ENDPOINT TESTER')
  console.log('═══════════════════════════════════════════════════════════\n')

  const now = new Date()
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000)
  const yesterday = new Date(now.getTime() - 24 * 3600 * 1000)

  const results: { [key: string]: boolean } = {}

  // Test wallet address (example from top traders)
  const testWallet = '0x0000000000000000000000000000000000000000'

  console.log('📋 TESTING ALL DOCUMENTED HYPERLIQUID ENDPOINTS:\n')

  // 1. Perp Screener (KNOWN WORKING)
  results['Perp Screener'] = (await testEndpoint(
    '1. Perp Screener',
    '/perp-screener',
    {
      date: {
        from: sevenDaysAgo.toISOString(),
        to: now.toISOString()
      },
      pagination: { page: 1, per_page: 10 }
    }
  )).success

  // 2. Hyperliquid Leaderboard
  results['Hyperliquid Leaderboard'] = (await testEndpoint(
    '2. Hyperliquid Leaderboard',
    '/hyperliquid-leaderboard',
    {
      date: {
        from: sevenDaysAgo.toISOString(),
        to: now.toISOString()
      },
      pagination: { page: 1, per_page: 10 }
    }
  )).success

  // 3. Address Perp Positions
  results['Address Perp Positions'] = (await testEndpoint(
    '3. Address Perp Positions',
    '/hyperliquid/address-perp-positions',
    {
      wallet_address: testWallet
    }
  )).success

  // 4. Address Perp Trades
  results['Address Perp Trades'] = (await testEndpoint(
    '4. Address Perp Trades',
    '/hyperliquid/address-perp-trades',
    {
      wallet_address: testWallet,
      date: {
        from: yesterday.toISOString(),
        to: now.toISOString()
      },
      pagination: { page: 1, per_page: 10 }
    }
  )).success

  // 5. Perp PnL Leaderboard (for specific token)
  results['Perp PnL Leaderboard'] = (await testEndpoint(
    '5. Perp PnL Leaderboard (for BTC)',
    '/tgm/perp-pnl-leaderboard',
    {
      token_symbol: 'BTC',
      date: {
        from: sevenDaysAgo.toISOString(),
        to: now.toISOString()
      },
      pagination: { page: 1, per_page: 10 }
    }
  )).success

  // 6. Try alternative paths
  results['Alt: /hyperliquid/perp-screener'] = (await testEndpoint(
    '6. Alternative: /hyperliquid/perp-screener',
    '/hyperliquid/perp-screener',
    {
      date: {
        from: sevenDaysAgo.toISOString(),
        to: now.toISOString()
      },
      pagination: { page: 1, per_page: 10 }
    }
  )).success

  results['Alt: /hyperliquid/leaderboard'] = (await testEndpoint(
    '7. Alternative: /hyperliquid/leaderboard',
    '/hyperliquid/leaderboard',
    {
      date: {
        from: sevenDaysAgo.toISOString(),
        to: now.toISOString()
      },
      pagination: { page: 1, per_page: 10 }
    }
  )).success

  // Summary
  console.log('\n═══════════════════════════════════════════════════════════')
  console.log('📊 RESULTS SUMMARY:')
  console.log('═══════════════════════════════════════════════════════════\n')

  for (const [name, success] of Object.entries(results)) {
    console.log(`${success ? '✅' : '❌'} ${name}`)
  }

  const successCount = Object.values(results).filter(v => v).length
  const totalCount = Object.values(results).length

  console.log(`\n🎯 Success Rate: ${successCount}/${totalCount} (${Math.round(successCount/totalCount*100)}%)`)
}

main().catch(console.error)
