import 'dotenv/config'
import axios from 'axios'

const API_KEY = process.env.NANSEN_API_KEY || ''
const BASE_URL = 'https://api.nansen.ai/api/v1'

async function test() {
  console.log("🔍 Fetching Nansen Perp Screener data for ZEC and UNI...\n")
  
  const now = new Date()
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  
  try {
    const res = await axios.post(
      `${BASE_URL}/perp-screener`,
      {
        date: {
          from: sevenDaysAgo.toISOString(),
          to: now.toISOString()
        },
        pagination: { page: 1, per_page: 100 }
      },
      {
        headers: {
          'apiKey': API_KEY,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      }
    )
    
    const allTokens = res.data.data
    console.log(`📊 Total tokens in screener: ${allTokens.length}\n`)
    
    const zec = allTokens.find((t: any) => t.token_symbol === "ZEC")
    const uni = allTokens.find((t: any) => t.token_symbol === "UNI")
    
    if (zec) {
      console.log("═══════════════════════════════════════════════════════════")
      console.log("🟡 ZEC (Zcash) - Nansen Perp Data (last 7 days)")
      console.log("═══════════════════════════════════════════════════════════")
      console.log(`Volume (7d):          $${zec.volume?.toLocaleString() || 'N/A'}`)
      console.log(`Buy Volume:           $${zec.buy_volume?.toLocaleString() || 'N/A'}`)
      console.log(`Sell Volume:          $${zec.sell_volume?.toLocaleString() || 'N/A'}`)
      console.log(`Buy/Sell Pressure:    $${zec.buy_sell_pressure?.toLocaleString() || 'N/A'}`)
      console.log(`Trader Count:         ${zec.trader_count || 'N/A'}`)
      console.log(`Mark Price:           $${zec.mark_price || 'N/A'}`)
      console.log(`Funding Rate:         ${(zec.funding * 100)?.toFixed(6) || 'N/A'}%`)
      console.log(`Open Interest:        $${zec.open_interest?.toLocaleString() || 'N/A'}`)
      console.log("")
      
      if (zec.buy_volume && zec.sell_volume) {
        const buyRatio = (zec.buy_volume / (zec.buy_volume + zec.sell_volume) * 100)
        console.log(`📈 Buy Ratio:          ${buyRatio.toFixed(2)}%`)
        console.log(`📉 Sell Ratio:         ${(100 - buyRatio).toFixed(2)}%`)
        
        if (buyRatio > 55) {
          console.log(`🔥 BULLISH SIGNAL: More buying pressure (+${(buyRatio - 50).toFixed(1)}pp)`)
        } else if (buyRatio < 45) {
          console.log(`❄️  BEARISH SIGNAL: More selling pressure (-${(50 - buyRatio).toFixed(1)}pp)`)
        } else {
          console.log("⚖️  NEUTRAL: Balanced pressure")
        }
      }
      console.log("")
    } else {
      console.log("❌ ZEC not found in Nansen data\n")
    }
    
    if (uni) {
      console.log("═══════════════════════════════════════════════════════════")
      console.log("🦄 UNI (Uniswap) - Nansen Perp Data (last 7 days)")
      console.log("═══════════════════════════════════════════════════════════")
      console.log(`Volume (7d):          $${uni.volume?.toLocaleString() || 'N/A'}`)
      console.log(`Buy Volume:           $${uni.buy_volume?.toLocaleString() || 'N/A'}`)
      console.log(`Sell Volume:          $${uni.sell_volume?.toLocaleString() || 'N/A'}`)
      console.log(`Buy/Sell Pressure:    $${uni.buy_sell_pressure?.toLocaleString() || 'N/A'}`)
      console.log(`Trader Count:         ${uni.trader_count || 'N/A'}`)
      console.log(`Mark Price:           $${uni.mark_price || 'N/A'}`)
      console.log(`Funding Rate:         ${(uni.funding * 100)?.toFixed(6) || 'N/A'}%`)
      console.log(`Open Interest:        $${uni.open_interest?.toLocaleString() || 'N/A'}`)
      console.log("")
      
      if (uni.buy_volume && uni.sell_volume) {
        const buyRatio = (uni.buy_volume / (uni.buy_volume + uni.sell_volume) * 100)
        console.log(`📈 Buy Ratio:          ${buyRatio.toFixed(2)}%`)
        console.log(`📉 Sell Ratio:         ${(100 - buyRatio).toFixed(2)}%`)
        
        if (buyRatio > 55) {
          console.log(`🔥 BULLISH SIGNAL: More buying pressure (+${(buyRatio - 50).toFixed(1)}pp)`)
        } else if (buyRatio < 45) {
          console.log(`❄️  BEARISH SIGNAL: More selling pressure (-${(50 - buyRatio).toFixed(1)}pp)`)
        } else {
          console.log("⚖️  NEUTRAL: Balanced pressure")
        }
      }
      console.log("")
    } else {
      console.log("❌ UNI not found in Nansen data\n")
    }
    
    console.log("═══════════════════════════════════════════════════════════")
    console.log("🏆 Top 10 Tokens by Buy/Sell Pressure (Smart Money Flow)")
    console.log("═══════════════════════════════════════════════════════════")
    
    const sorted = [...allTokens].sort((a: any, b: any) => 
      Math.abs(b.buy_sell_pressure || 0) - Math.abs(a.buy_sell_pressure || 0)
    )
    
    sorted.slice(0, 10).forEach((t: any, idx: number) => {
      const pressure = t.buy_sell_pressure || 0
      const direction = pressure > 0 ? "🟢 BUY " : "🔴 SELL"
      const buyVol = t.buy_volume || 0
      const sellVol = t.sell_volume || 0
      const buyRatio = buyVol + sellVol > 0 ? (buyVol / (buyVol + sellVol) * 100) : 50
      const pressureM = (Math.abs(pressure) / 1e6).toFixed(1)
      console.log(`${(idx + 1).toString().padStart(2)}.  ${t.token_symbol.padEnd(8)} ${direction} $${pressureM.padStart(7)}M (${buyRatio.toFixed(1)}% buy)`)
    })
    
    console.log("\n═══════════════════════════════════════════════════════════")
    console.log("💡 INTERPRETATION FOR MM BOT:")
    console.log("═══════════════════════════════════════════════════════════")
    console.log("• Buy/Sell Pressure = Net smart money flow direction")
    console.log("• Buy Ratio > 55% = Tighten ask spreads (more buyers)")
    console.log("• Buy Ratio < 45% = Tighten bid spreads (more sellers)")
    console.log("• High trader_count = More liquidity, safer to quote")
    console.log("• High open_interest = More established market, more fills")
    console.log("═══════════════════════════════════════════════════════════\n")
    
  } catch (error: any) {
    console.error("❌ Error:", error.message)
    if (error.response) {
      console.error("Status:", error.response.status)
      console.error("Data:", JSON.stringify(error.response.data))
    }
  }
}

test()
