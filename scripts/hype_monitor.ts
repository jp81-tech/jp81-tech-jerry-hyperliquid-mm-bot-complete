#!/usr/bin/env tsx
/**
 * HYPE Smart Money Monitor
 *
 * Monitors HYPE positions, detects major SM events, and sends Telegram alerts.
 *
 * Usage:
 *   npx tsx scripts/hype_monitor.ts
 *
 * Features:
 * - SM flip detection (long → short or vice versa)
 * - Institutional positioning (Galaxy, Manifold, LD Capital)
 * - Massive PnL swings (>$1M in 1h)
 * - Capitulation detection (underwater >$2M)
 */

import { readFileSync, writeFileSync } from 'fs'
import { telegramBot } from '../src/utils/telegram_bot.js'

// ============================================================
// CONFIGURATION
// ============================================================

const CONFIG = {
    CHECK_INTERVAL_MS: 30 * 60 * 1000,  // 30 minutes
    TOKEN: 'HYPE',

    // Thresholds
    FLIP_RATIO_THRESHOLD: 3,              // Ratio change >3x = flip
    INSTITUTIONAL_MIN_USD: 500_000,       // Min $500k to be "institutional"
    PNL_SWING_THRESHOLD: 1_000_000,       // >$1M PnL change = major event
    CAPITULATION_THRESHOLD: -2_000_000,   // <-$2M uPnL = capitulation
    DISTRIBUTION_THRESHOLD: -1_000_000,   // Position reduction >$1M = distribution

    // State file
    STATE_FILE: '/tmp/hype_monitor_state.json',

    // Institutional addresses (funds to watch)
    INSTITUTIONS: [
        { name: 'Galaxy Digital', addresses: ['0x87dc67', '0x9dc75a'] },
        { name: 'LD Capital', addresses: ['0x570b09'] },
        { name: 'Manifold Trading', addresses: ['0xc12f6e'] },
        { name: 'Arrington XRP', addresses: ['0x8def9f'] }
    ]
}

// ============================================================
// TYPES
// ============================================================

interface HYPEPosition {
    address: string
    label: string
    side: 'Long' | 'Short'
    size: number          // HYPE tokens
    valueUsd: number
    entryPrice: number
    unrealizedPnl: number
    leverage: string
}

interface HYPESnapshot {
    timestamp: number
    price: number
    longValueUsd: number
    shortValueUsd: number
    longCount: number
    shortCount: number
    longsUpnl: number
    shortsUpnl: number
    ratio: number         // long/short ratio
    netPositionUsd: number
    positions: HYPEPosition[]
    institutionalShorts: HYPEPosition[]
    institutionalLongs: HYPEPosition[]
}

interface MonitorState {
    lastSnapshot: HYPESnapshot | null
    lastAlertTime: Record<string, number>  // event type -> timestamp
}

// ============================================================
// STATE MANAGEMENT
// ============================================================

function loadState(): MonitorState {
    try {
        const raw = readFileSync(CONFIG.STATE_FILE, 'utf8')
        return JSON.parse(raw)
    } catch {
        return {
            lastSnapshot: null,
            lastAlertTime: {}
        }
    }
}

function saveState(state: MonitorState): void {
    try {
        writeFileSync(CONFIG.STATE_FILE, JSON.stringify(state, null, 2))
    } catch (error) {
        console.error('[HYPE Monitor] Failed to save state:', error)
    }
}

// ============================================================
// DATA FETCHING
// ============================================================

async function fetchHYPEPositions(): Promise<HYPEPosition[]> {
    // TODO: Replace with actual Nansen API call
    // For now, return mock data or read from cache

    // Placeholder: read from a cache file if available
    try {
        const cacheFile = '/tmp/hype_positions_cache.json'
        const data = JSON.parse(readFileSync(cacheFile, 'utf8'))
        return data.positions || []
    } catch {
        console.warn('[HYPE Monitor] No position cache available - awaiting manual update')
        return []
    }
}

async function fetchCurrentPrice(): Promise<number> {
    try {
        // Fetch from Hyperliquid API
        const response = await fetch('https://api.hyperliquid.xyz/info', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'allMids' })
        })
        const data = await response.json()
        const hypePrice = data['HYPE']
        return hypePrice ? parseFloat(hypePrice) : 0
    } catch {
        return 0
    }
}

// ============================================================
// ANALYSIS
// ============================================================

function buildSnapshot(positions: HYPEPosition[], price: number): HYPESnapshot {
    let longValueUsd = 0
    let shortValueUsd = 0
    let longCount = 0
    let shortCount = 0
    let longsUpnl = 0
    let shortsUpnl = 0

    const institutionalShorts: HYPEPosition[] = []
    const institutionalLongs: HYPEPosition[] = []

    for (const pos of positions) {
        if (pos.side === 'Long') {
            longValueUsd += pos.valueUsd
            longCount++
            longsUpnl += pos.unrealizedPnl

            if (isInstitutional(pos.address) && pos.valueUsd >= CONFIG.INSTITUTIONAL_MIN_USD) {
                institutionalLongs.push(pos)
            }
        } else {
            shortValueUsd += pos.valueUsd
            shortCount++
            shortsUpnl += pos.unrealizedPnl

            if (isInstitutional(pos.address) && pos.valueUsd >= CONFIG.INSTITUTIONAL_MIN_USD) {
                institutionalShorts.push(pos)
            }
        }
    }

    const ratio = shortValueUsd === 0 ? (longValueUsd > 0 ? 999 : 1) : longValueUsd / shortValueUsd
    const netPositionUsd = longValueUsd - shortValueUsd

    return {
        timestamp: Date.now(),
        price,
        longValueUsd,
        shortValueUsd,
        longCount,
        shortCount,
        longsUpnl,
        shortsUpnl,
        ratio,
        netPositionUsd,
        positions,
        institutionalShorts,
        institutionalLongs
    }
}

function isInstitutional(address: string): boolean {
    const addrLower = address.toLowerCase()
    return CONFIG.INSTITUTIONS.some(inst =>
        inst.addresses.some(instAddr => addrLower.includes(instAddr.toLowerCase()))
    )
}

function getInstitutionName(address: string): string | null {
    const addrLower = address.toLowerCase()
    for (const inst of CONFIG.INSTITUTIONS) {
        if (inst.addresses.some(instAddr => addrLower.includes(instAddr.toLowerCase()))) {
            return inst.name
        }
    }
    return null
}

// ============================================================
// EVENT DETECTION
// ============================================================

interface DetectedEvent {
    type: 'FLIP' | 'INSTITUTIONAL_SHORT' | 'INSTITUTIONAL_LONG' | 'PNL_SWING' | 'CAPITULATION' | 'DISTRIBUTION' | 'RECOVERY'
    severity: 'HIGH' | 'MEDIUM' | 'LOW'
    message: string
    data?: any
}

function detectEvents(current: HYPESnapshot, previous: HYPESnapshot | null): DetectedEvent[] {
    const events: DetectedEvent[] = []

    if (!previous) return events

    // 1. FLIP DETECTION
    const ratioChange = Math.abs(current.ratio - previous.ratio) / Math.max(previous.ratio, 0.01)
    if (ratioChange >= CONFIG.FLIP_RATIO_THRESHOLD) {
        const direction = current.netPositionUsd > 0 ? 'LONG' : 'SHORT'
        const prevDirection = previous.netPositionUsd > 0 ? 'LONG' : 'SHORT'

        if (direction !== prevDirection) {
            events.push({
                type: 'FLIP',
                severity: 'HIGH',
                message: `🔄 SM FLIP: ${prevDirection} → ${direction}\n` +
                    `Ratio: ${previous.ratio.toFixed(1)}:1 → ${current.ratio.toFixed(1)}:1\n` +
                    `Net: $${formatUsd(previous.netPositionUsd)} → $${formatUsd(current.netPositionUsd)}`,
                data: { previous: previous.ratio, current: current.ratio }
            })
        }
    }

    // 2. INSTITUTIONAL POSITIONING
    const newInstitutionalShorts = current.institutionalShorts.filter(s =>
        !previous.institutionalShorts.some(p => p.address === s.address)
    )

    for (const inst of newInstitutionalShorts) {
        const instName = getInstitutionName(inst.address)
        events.push({
            type: 'INSTITUTIONAL_SHORT',
            severity: 'HIGH',
            message: `🏦 ${instName || 'Institution'} OPENED SHORT\n` +
                `Size: ${inst.size.toFixed(0)} HYPE ($${formatUsd(inst.valueUsd)})\n` +
                `Entry: $${inst.entryPrice.toFixed(2)}`,
            data: inst
        })
    }

    const newInstitutionalLongs = current.institutionalLongs.filter(l =>
        !previous.institutionalLongs.some(p => p.address === l.address)
    )

    for (const inst of newInstitutionalLongs) {
        const instName = getInstitutionName(inst.address)
        events.push({
            type: 'INSTITUTIONAL_LONG',
            severity: 'HIGH',
            message: `🏦 ${instName || 'Institution'} OPENED LONG\n` +
                `Size: ${inst.size.toFixed(0)} HYPE ($${formatUsd(inst.valueUsd)})\n` +
                `Entry: $${inst.entryPrice.toFixed(2)}`,
            data: inst
        })
    }

    // 3. PNL SWING
    const pnlChange = (current.longsUpnl + current.shortsUpnl) - (previous.longsUpnl + previous.shortsUpnl)
    if (Math.abs(pnlChange) >= CONFIG.PNL_SWING_THRESHOLD) {
        events.push({
            type: 'PNL_SWING',
            severity: 'MEDIUM',
            message: `💰 MASSIVE PNL SWING: ${pnlChange > 0 ? '+' : ''}$${formatUsd(pnlChange)}\n` +
                `Longs: $${formatUsd(current.longsUpnl)} (${current.longsUpnl > 0 ? '🟢' : '🔴'})\n` +
                `Shorts: $${formatUsd(current.shortsUpnl)} (${current.shortsUpnl > 0 ? '🟢' : '🔴'})`,
            data: { pnlChange }
        })
    }

    // 4. CAPITULATION
    if (current.longsUpnl <= CONFIG.CAPITULATION_THRESHOLD && previous.longsUpnl > CONFIG.CAPITULATION_THRESHOLD) {
        events.push({
            type: 'CAPITULATION',
            severity: 'HIGH',
            message: `💀 LONG CAPITULATION\n` +
                `Longs underwater: $${formatUsd(current.longsUpnl)}\n` +
                `Price: $${current.price.toFixed(2)}\n` +
                `→ Potential bottom forming`,
            data: { longsUpnl: current.longsUpnl }
        })
    }

    // 5. DISTRIBUTION (large position reduction)
    const positionReduction = previous.longValueUsd - current.longValueUsd
    if (positionReduction >= Math.abs(CONFIG.DISTRIBUTION_THRESHOLD)) {
        events.push({
            type: 'DISTRIBUTION',
            severity: 'HIGH',
            message: `🔴 DISTRIBUTION DETECTED\n` +
                `SM longs reduced: -$${formatUsd(positionReduction)}\n` +
                `From: $${formatUsd(previous.longValueUsd)} → $${formatUsd(current.longValueUsd)}\n` +
                `→ Smart Money exiting`,
            data: { reduction: positionReduction }
        })
    }

    // 6. RECOVERY
    if (current.longsUpnl > -500_000 && previous.longsUpnl <= CONFIG.CAPITULATION_THRESHOLD) {
        events.push({
            type: 'RECOVERY',
            severity: 'MEDIUM',
            message: `🟢 RECOVERY: Longs improving\n` +
                `PnL: $${formatUsd(previous.longsUpnl)} → $${formatUsd(current.longsUpnl)}\n` +
                `→ Bottom may be in`,
            data: { recovery: current.longsUpnl - previous.longsUpnl }
        })
    }

    return events
}

// ============================================================
// ALERTING
// ============================================================

async function sendAlert(event: DetectedEvent, snapshot: HYPESnapshot): Promise<void> {
    const emoji = {
        FLIP: '🔄',
        INSTITUTIONAL_SHORT: '🏦🔴',
        INSTITUTIONAL_LONG: '🏦🟢',
        PNL_SWING: '💰',
        CAPITULATION: '💀',
        DISTRIBUTION: '🔴',
        RECOVERY: '🟢'
    }

    const header = `${emoji[event.type]} <b>HYPE ALERT: ${event.type.replace('_', ' ')}</b>\n\n`
    const body = event.message

    const footer = `\n\n📊 <b>Current State:</b>\n` +
        `Price: $${snapshot.price.toFixed(2)}\n` +
        `Longs: $${formatUsd(snapshot.longValueUsd)} (${snapshot.longCount} traders)\n` +
        `Shorts: $${formatUsd(snapshot.shortValueUsd)} (${snapshot.shortCount} traders)\n` +
        `Net: $${formatUsd(snapshot.netPositionUsd)} ${snapshot.netPositionUsd > 0 ? 'LONG' : 'SHORT'}\n` +
        `Ratio L/S: ${snapshot.ratio.toFixed(1)}:1\n\n` +
        `⏰ ${new Date().toLocaleString('pl-PL')}`

    const fullMessage = header + body + footer

    try {
        await telegramBot.send(fullMessage, event.severity === 'HIGH' ? 'error' : 'warn')
        console.log(`[HYPE Monitor] Alert sent: ${event.type}`)
    } catch (error) {
        console.error('[HYPE Monitor] Failed to send alert:', error)
    }
}

async function sendStatusReport(snapshot: HYPESnapshot): Promise<void> {
    const signal = getSignal(snapshot)

    const message = `📊 <b>HYPE Status Report</b>\n\n` +
        `🎯 Signal: ${signal.emoji} ${signal.text}\n` +
        `💰 Price: $${snapshot.price.toFixed(2)}\n\n` +
        `<b>Smart Money:</b>\n` +
        `🟢 Longs: $${formatUsd(snapshot.longValueUsd)} (${snapshot.longCount})\n` +
        `   uPnL: $${formatUsd(snapshot.longsUpnl)} ${snapshot.longsUpnl > 0 ? '✅' : '❌'}\n` +
        `🔴 Shorts: $${formatUsd(snapshot.shortValueUsd)} (${snapshot.shortCount})\n` +
        `   uPnL: $${formatUsd(snapshot.shortsUpnl)} ${snapshot.shortsUpnl > 0 ? '✅' : '❌'}\n\n` +
        `📈 Ratio L/S: ${snapshot.ratio.toFixed(1)}:1\n` +
        `⚖️  Net Position: $${formatUsd(snapshot.netPositionUsd)} ${snapshot.netPositionUsd > 0 ? 'LONG' : 'SHORT'}\n\n` +
        `🏦 Institutions:\n` +
        `   Shorts: ${snapshot.institutionalShorts.length} ($${formatUsd(snapshot.institutionalShorts.reduce((s, p) => s + p.valueUsd, 0))})\n` +
        `   Longs: ${snapshot.institutionalLongs.length} ($${formatUsd(snapshot.institutionalLongs.reduce((s, p) => s + p.valueUsd, 0))})\n\n` +
        `⏰ ${new Date().toLocaleString('pl-PL')}`

    try {
        await telegramBot.send(message, 'info')
        console.log('[HYPE Monitor] Status report sent')
    } catch (error) {
        console.error('[HYPE Monitor] Failed to send status:', error)
    }
}

function getSignal(snapshot: HYPESnapshot): { emoji: string; text: string } {
    // Capitulation
    if (snapshot.longsUpnl <= CONFIG.CAPITULATION_THRESHOLD) {
        return { emoji: '🟢', text: 'POTENTIAL BOTTOM (Capitulation)' }
    }

    // Strong shorts winning
    if (snapshot.shortsUpnl > 2_000_000 && snapshot.ratio < 1) {
        return { emoji: '🔴', text: 'TOP IS IN (SM Shorts Crushing)' }
    }

    // Institutional shorts
    if (snapshot.institutionalShorts.length >= 2 && snapshot.ratio < 1) {
        return { emoji: '🔴', text: 'DISTRIBUTION (Institutional Shorts)' }
    }

    // Strong longs winning
    if (snapshot.longsUpnl > 2_000_000 && snapshot.ratio > 5) {
        return { emoji: '🟢', text: 'STRONG UPTREND (SM Longs Winning)' }
    }

    // Neutral
    if (Math.abs(snapshot.netPositionUsd) < 1_000_000) {
        return { emoji: '⚪', text: 'NEUTRAL (Balanced)' }
    }

    return { emoji: '🟡', text: 'MIXED SIGNALS' }
}

// ============================================================
// MAIN LOOP
// ============================================================

async function runCheck(): Promise<void> {
    console.log(`[HYPE Monitor] Running check at ${new Date().toLocaleString()}`)

    try {
        const state = loadState()

        // Fetch data
        const positions = await fetchHYPEPositions()
        if (positions.length === 0) {
            console.warn('[HYPE Monitor] No positions data - skipping check')
            return
        }

        const price = await fetchCurrentPrice()
        if (price === 0) {
            console.warn('[HYPE Monitor] Could not fetch price - skipping check')
            return
        }

        // Build snapshot
        const snapshot = buildSnapshot(positions, price)

        // Detect events
        const events = detectEvents(snapshot, state.lastSnapshot)

        // Send alerts for high-priority events
        for (const event of events) {
            // Throttle: max 1 alert per event type per hour
            const lastAlert = state.lastAlertTime[event.type] || 0
            const hourAgo = Date.now() - 60 * 60 * 1000

            if (event.severity === 'HIGH' || lastAlert < hourAgo) {
                await sendAlert(event, snapshot)
                state.lastAlertTime[event.type] = Date.now()
            }
        }

        // Send status report every 4 hours
        const lastStatus = state.lastAlertTime['STATUS_REPORT'] || 0
        const fourHoursAgo = Date.now() - 4 * 60 * 60 * 1000

        if (lastStatus < fourHoursAgo) {
            await sendStatusReport(snapshot)
            state.lastAlertTime['STATUS_REPORT'] = Date.now()
        }

        // Update state
        state.lastSnapshot = snapshot
        saveState(state)

        console.log(`[HYPE Monitor] Check complete - ${events.length} events detected`)

    } catch (error) {
        console.error('[HYPE Monitor] Error during check:', error)
    }
}

function formatUsd(value: number): string {
    if (Math.abs(value) >= 1_000_000) {
        return `${(value / 1_000_000).toFixed(1)}M`
    }
    if (Math.abs(value) >= 1_000) {
        return `${(value / 1_000).toFixed(0)}K`
    }
    return value.toFixed(0)
}

// ============================================================
// STARTUP
// ============================================================

async function main() {
    console.log('🚀 HYPE Smart Money Monitor starting...')
    console.log(`   Check interval: ${CONFIG.CHECK_INTERVAL_MS / 60000} minutes`)
    console.log(`   Token: ${CONFIG.TOKEN}`)
    console.log(`   State file: ${CONFIG.STATE_FILE}`)

    // Initial check
    await runCheck()

    // Schedule periodic checks
    setInterval(runCheck, CONFIG.CHECK_INTERVAL_MS)

    console.log('✅ HYPE Monitor active - watching for major SM events')
}

main().catch(error => {
    console.error('❌ HYPE Monitor fatal error:', error)
    process.exit(1)
})
