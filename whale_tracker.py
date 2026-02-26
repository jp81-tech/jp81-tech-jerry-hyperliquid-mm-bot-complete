#!/usr/bin/env python3
"""
whale_tracker.py - Automatyczny tracker wielorybów Hyperliquid
Działa niezależnie od Claude MCP - używa bezpośrednio darmowego API Hyperliquid

Uruchomienie:
  - Cron: */30 * * * * /usr/bin/python3 ~/hyperliquid-mm-bot-complete/whale_tracker.py
  - Report: python3 whale_tracker.py --report
  - Test: python3 whale_tracker.py --test
"""

import requests
import json
import os
import sys
import time
import argparse
from datetime import datetime, timedelta
from pathlib import Path

# ============================================================
# KONFIGURACJA
# ============================================================

TELEGRAM_BOT_TOKEN = "8598008562:AAHqc4JCfo1LniklePaDr17Ws3tmjaZv108"
TELEGRAM_CHAT_ID = "645284026"

# Hyperliquid API (darmowe!)
HL_API_URL = "https://api.hyperliquid.xyz/info"

# Cache
CACHE_DIR = Path.home() / ".whale_tracker"
CACHE_FILE = CACHE_DIR / "positions_cache.json"
FRESHNESS_FILE = CACHE_DIR / "last_update.txt"
HISTORY_FILE = CACHE_DIR / "daily_history.json"  # 7-day trend analysis
HOURLY_HISTORY_FILE = CACHE_DIR / "hourly_history.json"  # 24h granular history for bottom detection
BOT_DATA_FILE = Path("/tmp/smart_money_data.json")
BOT_BIAS_FILE = Path("/tmp/nansen_bias.json")
WHALE_ACTIVITY_FILE = Path("/tmp/whale_activity.json")
SHORT_EXIT_LOG_FILE = Path("/tmp/short_exit_log.json")

# Bottom detection settings
HOURLY_HISTORY_HOURS = 48  # Keep 48 hours of hourly data

# Trend analysis settings
TREND_DAYS = 7  # Days to look back for trend analysis

# ============================================================
# CREDIBILITY MULTIPLIERS - Whale vs Smart Money
# ============================================================
#
# KEY INSIGHT: Big position ≠ Smart Money!
# - 🐋 Whale: Large position but UNVERIFIED track record
# - 🤓 Smart Money: Nansen-labeled with VERIFIED profitable edge
# - 🏦 Fund: Institutional player with professional management
#
# Final weight = signal_weight (size) × credibility_multiplier (skill)
# ============================================================

CREDIBILITY_MULTIPLIERS = {
    "Smart HL Perps Trader": 1.0,   # Nansen verified - FULL weight
    "All Time Smart Trader": 0.95,  # Nansen verified - Very high
    "Fund": 0.90,                    # Institutional - High weight
    "90D Smart Trader": 0.85,        # Recent track record
    "30D Smart Trader": 0.75,        # Short track record
    "Whale": 0.30,                   # Big but UNVERIFIED - reduced!
    "Unknown": 0.20,                 # No label - minimal weight
    "Market Maker": 0.0,             # IGNORE - they flip constantly
}

# ============================================================
# NANSEN SM LABELS CACHE - Quick lookup for verified addresses
# Updated: 2026-01-19 from Nansen API queries
# ============================================================
NANSEN_SM_LABELS = {
    # === MEGA WHALES / CONVICTION ===
    "0xb317d2": "Smart HL Perps Trader",  # Bitcoin OG - liquidated 31.01.2026
    "0x2ea18c": "Smart HL Perps Trader",  # Bitcoin OG #2 - same entity as OG #1
    "0xd7a678": "Smart HL Perps Trader",  # Winner d7a678 - Consistent Perps Winner

    "0xa31211": "Smart HL Perps Trader",  # General - LIT $3.3M, ASTER $2.4M, PUMP $1.7M SHORT
    "0x35d115": "Smart HL Perps Trader",  # Major - SOL $15.1M SHORT (zredukowany z $64M)
    "0x45d26f": "Smart HL Perps Trader",  # Wice-General - BTC $9.9M, ETH $2.9M SHORT (zredukowany)
    "0x5d2f44": "Smart HL Perps Trader",  # Pulkownik - puste konto $5.5M cash (zamknal BTC $46M SHORT)
    "0x71dfc0": "Smart HL Perps Trader",  # Kapitan BTC - BTC $29.2M SHORT
    "0x06cecf": "Smart HL Perps Trader",  # Kraken A ⭐ - SOL $15.2M, BTC $2.9M, HYPE $2.8M SHORT
    "0x6bea81": "Smart HL Perps Trader",  # Porucznik SOL2 - SOL shorter
    "0x936cf4": "Smart HL Perps Trader",  # Porucznik SOL3 - SOL flipnal na LONG, BTC/ETH SHORT
    "0x56cd86": "Smart HL Perps Trader",  # Kraken B ⭐ - HYPE $3.4M, SOL $1.9M, XRP $1.3M SHORT

    "0x519c72": "Smart HL Perps Trader",  # ZEC Conviction - ZEC LONG

    # === ACTIVE SM TRADERS ===
    "0xfeec88": "Smart HL Perps Trader",  # Kapitan feec ⭐ - BTC $14M SHORT (entry $101,600)
    "0xfce053": "Smart HL Perps Trader",  # Kapitan fce0 ⭐ - BTC $8.5M, ETH $3.47M SHORT
    "0x99b109": "Smart HL Perps Trader",  # Kapitan 99b1 ⭐ - mid-cap shorter (BCH/LTC/HYPE/BNB)
    "0xea6670": "Smart HL Perps Trader",  # Porucznik ea66 - BTC shorter
    "0x3c363e": "Smart HL Perps Trader",  # SM 3c363e - ETH SHORT
    "0x92e977": "Smart HL Perps Trader",  # BTC/LIT Trader
    "0x1e771e": "Smart HL Perps Trader",  # DOGE/ETH shorter
    "0x091159": "Smart HL Perps Trader",  # Kontrarian 091159 (WATCH) - flipnal LONG 23.02

    # === FUNDS ===
    "0xcac196": "Fund",  # Galaxy Digital
    "0x7fdafd": "Fund",  # Fasanara Capital
    "0x023a3d": "Fund",  # Auros Global
    "0xecb63c": "Fund",  # Wintermute
    "0x5b5d51": "Fund",  # Abraxas Capital
    "0x8def9f": "All Time Smart Trader",  # Laurent Zeimes
    "0x418aa6": "Smart HL Perps Trader",  # 58bro.eth
    "0x7717a7": "Token Millionaire",  # Token Millionaire 7717a7 - LIT LONG, algo bot from Binance
    "0x6f7d75": "Smart HL Perps Trader",  # frankfrankbank.eth - ETH $9.3M SHORT (+$3.78M)
}

def get_nansen_label(address: str) -> str:
    """
    Quick lookup for Nansen label from cache.
    Returns label or 'Unknown' if not found.
    """
    addr_prefix = address.lower()[:8]
    for known_prefix, label in NANSEN_SM_LABELS.items():
        if addr_prefix.startswith(known_prefix.lower()):
            return label
    return "Unknown"

# ============================================================
# CONTRARIAN LOGIC - Trading Mode Determination
# Based on SM positioning AND uPnL status
# ============================================================

# Trading modes
TRADING_MODES = {
    "FOLLOW_SM_LONG": "Follow SM - they're LONG and winning",
    "FOLLOW_SM_SHORT": "Follow SM - they're SHORT and winning",
    "CONTRARIAN_LONG": "Contrarian LONG - SM SHORT but underwater (squeeze potential)",
    "CONTRARIAN_SHORT": "Contrarian SHORT - SM LONG but underwater",
    "NEUTRAL": "No clear signal - mixed/balanced positions",
    "BLOCKED": "Trading blocked - high risk scenario"
}

# Thresholds for mode determination
MODE_THRESHOLDS = {
    "SHORT_DOMINANT_RATIO": 2.0,    # shorts/longs > 2.0 = SHORT dominant
    "LONG_DOMINANT_RATIO": 0.5,     # shorts/longs < 0.5 = LONG dominant
    "MIN_TOTAL_USD": 50000,         # Minimum $50k total exposure for signal
    "UNDERWATER_THRESHOLD": 0,      # uPnL < 0 = underwater
    "PNL_DOMINANT_RATIO": 3.0,      # If PnL ratio > 3.0x, treat as dominant even in NEUTRAL zone
}

# ============================================================
# CONTRARIAN SQUEEZE TIMEOUT PROTECTION
# Track how long we've been in CONTRARIAN mode without squeeze
# ============================================================
SQUEEZE_TIMEOUT_THRESHOLDS = {
    "WARNING_HOURS": 4.0,           # After 4h, start reducing confidence
    "CRITICAL_HOURS": 8.0,          # After 8h, heavily reduce confidence
    "MAX_HOURS": 12.0,              # After 12h, switch to NEUTRAL (squeeze failed)
    "CONFIDENCE_DECAY_PER_HOUR": 5, # Lose 5% confidence per hour after WARNING
}

# ============================================================
# PERPS VS SPOT DIVERGENCE DETECTION
# Compares perps flow with price momentum to detect potential traps
# When perps signal SHORT but price is rising (or vice versa) → divergence warning
# ============================================================
DIVERGENCE_THRESHOLDS = {
    "FLOW_VS_MOMENTUM_THRESHOLD": 0.3,  # If flow and momentum disagree by >30%, flag divergence
    "DIVERGENCE_CONFIDENCE_PENALTY": 15, # Reduce confidence by 15% on divergence
    "MIN_VELOCITY_FOR_SIGNAL": 100000,   # Minimum velocity ($) to consider for divergence
}

# File to track CONTRARIAN mode start times
CONTRARIAN_STATE_FILE = "/tmp/contrarian_state.json"

def load_contrarian_state() -> dict:
    """Load CONTRARIAN mode timestamps from file"""
    try:
        if os.path.exists(CONTRARIAN_STATE_FILE):
            with open(CONTRARIAN_STATE_FILE, 'r') as f:
                return json.load(f)
    except:
        pass
    return {}

def save_contrarian_state(state: dict):
    """Save CONTRARIAN mode timestamps to file"""
    try:
        with open(CONTRARIAN_STATE_FILE, 'w') as f:
            json.dump(state, f, indent=2)
    except:
        pass

def get_squeeze_duration_hours(token: str, mode: str, state: dict) -> float:
    """Get how long token has been in CONTRARIAN mode (hours)"""
    if not mode.startswith('CONTRARIAN'):
        return 0.0

    key = f"{token}_{mode}"
    if key in state:
        start_time = datetime.fromisoformat(state[key])
        duration = datetime.utcnow() - start_time
        return duration.total_seconds() / 3600
    return 0.0

def update_contrarian_state(token: str, mode: str, state: dict) -> dict:
    """Update CONTRARIAN state - track when mode started"""
    key = f"{token}_{mode}"

    if mode.startswith('CONTRARIAN'):
        # If not already tracking, start tracking
        if key not in state:
            state[key] = datetime.utcnow().isoformat()
            print(f"[CONTRARIAN] {token}: Started tracking {mode}")
    else:
        # If mode changed from CONTRARIAN, clear tracking
        for k in list(state.keys()):
            if k.startswith(f"{token}_CONTRARIAN"):
                del state[k]
                print(f"[CONTRARIAN] {token}: Cleared tracking (mode changed to {mode})")

    return state

def calculate_squeeze_timeout_penalty(duration_hours: float) -> tuple:
    """
    Calculate confidence penalty and warning based on squeeze duration
    Returns: (penalty: int, warning: str or None, should_exit: bool)
    """
    if duration_hours < SQUEEZE_TIMEOUT_THRESHOLDS["WARNING_HOURS"]:
        return 0, None, False

    if duration_hours >= SQUEEZE_TIMEOUT_THRESHOLDS["MAX_HOURS"]:
        return 50, f"⏰ SQUEEZE TIMEOUT: {duration_hours:.1f}h > {SQUEEZE_TIMEOUT_THRESHOLDS['MAX_HOURS']}h - EXITING", True

    if duration_hours >= SQUEEZE_TIMEOUT_THRESHOLDS["CRITICAL_HOURS"]:
        hours_over = duration_hours - SQUEEZE_TIMEOUT_THRESHOLDS["WARNING_HOURS"]
        penalty = int(hours_over * SQUEEZE_TIMEOUT_THRESHOLDS["CONFIDENCE_DECAY_PER_HOUR"])
        return min(40, penalty), f"⏰ SQUEEZE CRITICAL: {duration_hours:.1f}h in CONTRARIAN - reduce size!", False

    # WARNING zone
    hours_over = duration_hours - SQUEEZE_TIMEOUT_THRESHOLDS["WARNING_HOURS"]
    penalty = int(hours_over * SQUEEZE_TIMEOUT_THRESHOLDS["CONFIDENCE_DECAY_PER_HOUR"])
    return min(20, penalty), f"⏰ Squeeze taking long ({duration_hours:.1f}h)", False

def detect_perps_spot_divergence(
    sm_direction: str,       # 'long', 'short', or 'neutral' from perps
    sm_pnl_direction: str,   # 'longs_winning' or 'shorts_winning'
    velocity: float,         # Flow velocity (positive = buying, negative = selling)
    trend: str,              # 'increasing_longs', 'increasing_shorts', 'stable', 'unknown'
    longs_upnl: float,       # Current long uPnL
    shorts_upnl: float,      # Current short uPnL
) -> tuple:
    """
    Detect divergence between perps positioning and spot/flow momentum.

    DIVERGENCE SCENARIOS:
    1. SM is SHORT + profitable, but flow is strongly POSITIVE → buyers absorbing shorts
    2. SM is LONG + profitable, but flow is strongly NEGATIVE → sellers liquidating
    3. Trend opposes dominant position → potential reversal signal

    Returns: (has_divergence: bool, penalty: int, warning: str or None)
    """
    min_velocity = DIVERGENCE_THRESHOLDS["MIN_VELOCITY_FOR_SIGNAL"]
    penalty = 0
    warnings = []

    # Skip if not enough velocity to matter
    if abs(velocity) < min_velocity:
        return False, 0, None

    # Scenario 1: SM SHORT + winning, but positive flow (buyers absorbing)
    if sm_direction == 'short' and shorts_upnl > longs_upnl and velocity > min_velocity:
        # Shorts are winning but money is flowing IN (buying pressure)
        # This could mean shorts will get squeezed
        penalty = DIVERGENCE_THRESHOLDS["DIVERGENCE_CONFIDENCE_PENALTY"]
        warnings.append(f"⚠️ DIVERGENCE: SM SHORT winning but +${velocity/1000:.0f}k inflow (squeeze risk)")

    # Scenario 2: SM LONG + winning, but negative flow (sellers liquidating)
    elif sm_direction == 'long' and longs_upnl > shorts_upnl and velocity < -min_velocity:
        # Longs are winning but money is flowing OUT (selling pressure)
        # This could mean longs will get liquidated
        penalty = DIVERGENCE_THRESHOLDS["DIVERGENCE_CONFIDENCE_PENALTY"]
        warnings.append(f"⚠️ DIVERGENCE: SM LONG winning but -${abs(velocity)/1000:.0f}k outflow (dump risk)")

    # Scenario 3: Trend opposes dominant position
    if sm_direction == 'short' and trend == 'increasing_longs':
        penalty = max(penalty, 10)  # Additional 10% penalty
        warnings.append(f"⚠️ TREND DIVERGENCE: SM SHORT but trend=increasing_longs")

    elif sm_direction == 'long' and trend == 'increasing_shorts':
        penalty = max(penalty, 10)
        warnings.append(f"⚠️ TREND DIVERGENCE: SM LONG but trend=increasing_shorts")

    if warnings:
        return True, penalty, " | ".join(warnings)

    return False, 0, None

# Granular position sizing based on confidence
# Higher confidence = larger position allowed
CONFIDENCE_TO_POSITION_MULT = {
    # (min_conf, max_conf): maxPositionMultiplier
    (90, 100): 1.0,    # 90-100% confidence → full position
    (75, 90): 0.75,    # 75-90% confidence → 75% position
    (60, 75): 0.5,     # 60-75% confidence → 50% position
    (40, 60): 0.25,    # 40-60% confidence → 25% position
    (0, 40): 0.1,      # <40% confidence → 10% position (basically skip)
}

def get_position_mult_from_confidence(confidence: int) -> float:
    """
    Get maxPositionMultiplier based on confidence level.
    Higher confidence = larger allowed position.
    """
    for (min_c, max_c), mult in CONFIDENCE_TO_POSITION_MULT.items():
        if min_c <= confidence < max_c:
            return mult
    return 0.5  # Default

def determine_trading_mode(
    weighted_longs: float,
    weighted_shorts: float,
    longs_upnl: float,
    shorts_upnl: float,
    # NEW: Optional momentum data for "Stale PnL" protection
    shorts_upnl_change_24h: float = 0,
    longs_upnl_change_24h: float = 0,
    velocity: float = 0,
    # NEW: Squeeze timeout protection for CONTRARIAN modes
    squeeze_duration_hours: float = 0,
    # NEW: Trend for divergence detection
    trend: str = 'unknown'
) -> dict:
    """
    🎯 KLUCZOWA FUNKCJA: Określ tryb tradingu na podstawie SM pozycji i uPnL.

    LOGIKA:
    1. Jeśli SM SHORT dominant I SM shorts w zysku → FOLLOW_SM_SHORT
    2. Jeśli SM SHORT dominant I SM shorts underwater → CONTRARIAN_LONG (squeeze)
    3. Jeśli SM LONG dominant I SM longs w zysku → FOLLOW_SM_LONG
    4. Jeśli SM LONG dominant I SM longs underwater → CONTRARIAN_SHORT
    5. Jeśli mixed/neutral → check PnL dominance → NEUTRAL

    Returns dict with:
    - mode: string (FOLLOW_SM_LONG, FOLLOW_SM_SHORT, CONTRARIAN_LONG, CONTRARIAN_SHORT, NEUTRAL)
    - confidence: 0-100
    - reason: explanation string
    - maxPositionMultiplier: 0.0-1.0 (based on confidence for FOLLOW, fixed 0.25 for CONTRARIAN)
    - positionRatio: shorts/longs ratio (for diagnostics)
    - pnlRatio: dominant side's PnL ratio (for diagnostics)
    - longValueUsd: total weighted long value
    - shortValueUsd: total weighted short value
    - longPnlUsd: total long uPnL
    - shortPnlUsd: total short uPnL
    - momentumWarning: string if "Stale PnL" detected (optional)
    """

    total = weighted_longs + weighted_shorts

    # Base diagnostic data (always included)
    base_data = {
        "longValueUsd": int(weighted_longs),
        "shortValueUsd": int(weighted_shorts),
        "longPnlUsd": int(longs_upnl),
        "shortPnlUsd": int(shorts_upnl),
    }

    # ============================================================
    # NEW: "STALE PNL" PROTECTION
    # If PnL is high but momentum is reversing, reduce confidence
    # ============================================================
    momentum_penalty = 0  # Confidence penalty (0-30)
    momentum_warning = None

    # Check for SHORT signal reversal warning
    if shorts_upnl > 100000 and shorts_upnl_change_24h < -50000:
        # Shorts profitable but LOSING money recently = potential reversal
        momentum_penalty = min(30, abs(shorts_upnl_change_24h) / 100000 * 10)
        momentum_warning = f"⚠️ Shorts losing momentum (-${abs(shorts_upnl_change_24h)/1000:.0f}k 24h)"

    # Check for LONG signal reversal warning
    if longs_upnl > 100000 and longs_upnl_change_24h < -50000:
        # Longs profitable but LOSING money recently = potential reversal
        momentum_penalty = min(30, abs(longs_upnl_change_24h) / 100000 * 10)
        momentum_warning = f"⚠️ Longs losing momentum (-${abs(longs_upnl_change_24h)/1000:.0f}k 24h)"

    # Velocity check: if flow is reversing, add warning
    if velocity > 500000 and shorts_upnl > longs_upnl:
        # Positive flow (buying) but shorts winning = potential squeeze
        momentum_warning = f"⚠️ SQUEEZE WARNING: +${velocity/1000:.0f}k inflow vs bearish PnL"
        momentum_penalty = max(momentum_penalty, 15)

    if momentum_warning:
        base_data["momentumWarning"] = momentum_warning

    # ============================================================
    # NEW: PERPS VS SPOT DIVERGENCE DETECTION
    # Detect when perps signal and flow momentum disagree
    # ============================================================
    # Determine current SM direction from position ratio
    sm_direction = 'neutral'
    if weighted_shorts > weighted_longs * 2:
        sm_direction = 'short'
    elif weighted_longs > weighted_shorts * 2:
        sm_direction = 'long'

    sm_pnl_direction = 'shorts_winning' if shorts_upnl > longs_upnl else 'longs_winning'

    divergence_detected, divergence_penalty, divergence_warning = detect_perps_spot_divergence(
        sm_direction=sm_direction,
        sm_pnl_direction=sm_pnl_direction,
        velocity=velocity,
        trend=trend,
        longs_upnl=longs_upnl,
        shorts_upnl=shorts_upnl
    )

    if divergence_warning:
        base_data["divergenceWarning"] = divergence_warning
        # Combine divergence penalty with momentum penalty
        momentum_penalty = max(momentum_penalty, divergence_penalty)

    # Not enough data
    if total < MODE_THRESHOLDS["MIN_TOTAL_USD"]:
        return {
            "mode": "NEUTRAL",
            "confidence": 0,
            "reason": f"Insufficient SM exposure (${total/1000:.0f}k < $50k min)",
            "maxPositionMultiplier": 0.1,
            "positionRatio": 0,
            "pnlRatio": 0,
            **base_data
        }

    # Calculate position ratio (avoid division by zero)
    if weighted_longs == 0:
        ratio = 999.0 if weighted_shorts > 0 else 1.0
    else:
        ratio = weighted_shorts / weighted_longs

    # Calculate PnL ratio (for diagnostics)
    pnl_ratio = 0.0
    if shorts_upnl > 0 and longs_upnl > 0:
        pnl_ratio = max(shorts_upnl, longs_upnl) / min(shorts_upnl, longs_upnl)
    elif shorts_upnl > 0:
        pnl_ratio = 999.0
    elif longs_upnl > 0:
        pnl_ratio = 999.0

    # ============================================================
    # CASE 1: SM SHORT DOMINANT (ratio > 2)
    # ============================================================
    if ratio > MODE_THRESHOLDS["SHORT_DOMINANT_RATIO"]:
        if shorts_upnl > MODE_THRESHOLDS["UNDERWATER_THRESHOLD"]:
            # SM shorts są w zysku → FOLLOW THEM (go SHORT)
            confidence = int(min(95, 50 + (shorts_upnl / 100000) * 10))  # +10 per $100k profit
            # Apply momentum penalty for "Stale PnL" protection
            confidence = max(30, confidence - momentum_penalty)
            # Use confidence-based position sizing for FOLLOW modes
            pos_mult = get_position_mult_from_confidence(confidence)
            reason = f"SM SHORT dominant (ratio {ratio:.1f}x) and winning (+${shorts_upnl/1000:.0f}k uPnL)"
            if momentum_warning:
                reason += f" | {momentum_warning}"
            return {
                "mode": "FOLLOW_SM_SHORT",
                "confidence": confidence,
                "reason": reason,
                "maxPositionMultiplier": pos_mult,
                "positionRatio": round(ratio, 2),
                "pnlRatio": round(pnl_ratio, 2),
                **base_data
            }
        else:
            # SM shorts są underwater → CONTRARIAN (potential squeeze, go LONG)
            confidence = int(min(70, 30 + abs(shorts_upnl) / 500000 * 20))  # +20 per $500k underwater

            # SQUEEZE TIMEOUT PROTECTION: Apply penalty if squeeze takes too long
            timeout_penalty, timeout_warning, should_exit = calculate_squeeze_timeout_penalty(squeeze_duration_hours)

            if should_exit:
                # Squeeze failed - exit CONTRARIAN mode
                return {
                    "mode": "NEUTRAL",
                    "confidence": 0,
                    "reason": f"SQUEEZE TIMEOUT: {squeeze_duration_hours:.1f}h in CONTRARIAN_LONG - no squeeze, exiting!",
                    "maxPositionMultiplier": 0.0,  # No new positions
                    "positionRatio": round(ratio, 2),
                    "pnlRatio": round(pnl_ratio, 2),
                    "squeezeFailed": True,  # Flag for bot to exit existing position
                    **base_data
                }

            # Apply timeout penalty to confidence
            confidence = max(10, confidence - timeout_penalty)
            reason = f"SM SHORT underwater (-${abs(shorts_upnl)/1000:.0f}k uPnL) - squeeze potential!"
            if timeout_warning:
                reason += f" | {timeout_warning}"

            return {
                "mode": "CONTRARIAN_LONG",
                "confidence": confidence,
                "reason": reason,
                "maxPositionMultiplier": 0.25,  # TINY size for contrarian (fixed!)
                "positionRatio": round(ratio, 2),
                "pnlRatio": round(pnl_ratio, 2),
                "squeezeDurationHours": round(squeeze_duration_hours, 1),
                **base_data
            }

    # ============================================================
    # CASE 2: SM LONG DOMINANT (ratio < 0.5)
    # ============================================================
    elif ratio < MODE_THRESHOLDS["LONG_DOMINANT_RATIO"]:
        if longs_upnl > MODE_THRESHOLDS["UNDERWATER_THRESHOLD"]:
            # SM longs są w zysku → FOLLOW THEM (go LONG)
            confidence = int(min(95, 50 + (longs_upnl / 100000) * 10))
            # Apply momentum penalty for "Stale PnL" protection
            confidence = max(30, confidence - momentum_penalty)
            pos_mult = get_position_mult_from_confidence(confidence)
            reason = f"SM LONG dominant (ratio {ratio:.2f}x) and winning (+${longs_upnl/1000:.0f}k uPnL)"
            if momentum_warning:
                reason += f" | {momentum_warning}"
            return {
                "mode": "FOLLOW_SM_LONG",
                "confidence": confidence,
                "reason": reason,
                "maxPositionMultiplier": pos_mult,
                "positionRatio": round(ratio, 2),
                "pnlRatio": round(pnl_ratio, 2),
                **base_data
            }
        else:
            # SM longs są underwater → CONTRARIAN (go SHORT)
            confidence = int(min(70, 30 + abs(longs_upnl) / 500000 * 20))

            # SQUEEZE TIMEOUT PROTECTION: Apply penalty if squeeze takes too long
            timeout_penalty, timeout_warning, should_exit = calculate_squeeze_timeout_penalty(squeeze_duration_hours)

            if should_exit:
                # Squeeze failed - exit CONTRARIAN mode
                return {
                    "mode": "NEUTRAL",
                    "confidence": 0,
                    "reason": f"SQUEEZE TIMEOUT: {squeeze_duration_hours:.1f}h in CONTRARIAN_SHORT - no squeeze, exiting!",
                    "maxPositionMultiplier": 0.0,  # No new positions
                    "positionRatio": round(ratio, 2),
                    "pnlRatio": round(pnl_ratio, 2),
                    "squeezeFailed": True,  # Flag for bot to exit existing position
                    **base_data
                }

            # Apply timeout penalty to confidence
            confidence = max(10, confidence - timeout_penalty)
            reason = f"SM LONG underwater (-${abs(longs_upnl)/1000:.0f}k uPnL) - reversal potential"
            if timeout_warning:
                reason += f" | {timeout_warning}"

            return {
                "mode": "CONTRARIAN_SHORT",
                "confidence": confidence,
                "reason": reason,
                "maxPositionMultiplier": 0.25,  # TINY size for contrarian (fixed!)
                "positionRatio": round(ratio, 2),
                "pnlRatio": round(pnl_ratio, 2),
                "squeezeDurationHours": round(squeeze_duration_hours, 1),
                **base_data
            }

    # ============================================================
    # CASE 3: NEUTRAL (ratio 0.5 - 2.0) - BUT check PnL dominance!
    # ============================================================
    else:
        # Check if one side is winning BIG (PnL ratio > 3.0x)
        # This catches cases like SOL where shorts are massively profitable
        # even though position ratio is in neutral zone

        pnl_dominant_ratio = MODE_THRESHOLDS["PNL_DOMINANT_RATIO"]

        # Check if shorts are winning big (even in neutral position ratio)
        if shorts_upnl > 0 and longs_upnl > 0:
            current_pnl_ratio = shorts_upnl / longs_upnl
            if current_pnl_ratio > pnl_dominant_ratio:
                # Shorts winning BIG despite neutral position ratio → FOLLOW_SM_SHORT
                confidence = int(min(86, 50 + (current_pnl_ratio / 10) * 10))  # +10 per 10x PnL ratio
                # Apply momentum penalty for "Stale PnL" protection
                confidence = max(30, confidence - momentum_penalty)
                pos_mult = get_position_mult_from_confidence(confidence)
                reason = f"SM SHORT winning BIG ({current_pnl_ratio:.1f}x PnL ratio) despite neutral positions"
                if momentum_warning:
                    reason += f" | {momentum_warning}"
                return {
                    "mode": "FOLLOW_SM_SHORT",
                    "confidence": confidence,
                    "reason": reason,
                    "maxPositionMultiplier": pos_mult,
                    "positionRatio": round(ratio, 2),
                    "pnlRatio": round(current_pnl_ratio, 2),
                    **base_data
                }

        # Check if shorts are winning and longs are underwater
        if shorts_upnl > 0 and longs_upnl <= 0:
            # Shorts profitable, longs underwater = clear short signal
            pnl_diff = shorts_upnl - longs_upnl  # longs_upnl is negative, so this adds
            if pnl_diff > 500000:  # Significant PnL difference ($500k+)
                confidence = int(min(86, 50 + (pnl_diff / 1000000) * 15))
                # Apply momentum penalty for "Stale PnL" protection
                confidence = max(30, confidence - momentum_penalty)
                pos_mult = get_position_mult_from_confidence(confidence)
                reason = f"SM SHORT profitable (+${shorts_upnl/1000:.0f}k) while LONG underwater (-${abs(longs_upnl)/1000:.0f}k)"
                if momentum_warning:
                    reason += f" | {momentum_warning}"
                return {
                    "mode": "FOLLOW_SM_SHORT",
                    "confidence": confidence,
                    "reason": reason,
                    "maxPositionMultiplier": pos_mult,
                    "positionRatio": round(ratio, 2),
                    "pnlRatio": 999.0,  # Infinite (shorts winning, longs negative)
                    **base_data
                }

        # Check if longs are winning big (even in neutral position ratio)
        if longs_upnl > 0 and shorts_upnl > 0:
            current_pnl_ratio = longs_upnl / shorts_upnl
            if current_pnl_ratio > pnl_dominant_ratio:
                # Longs winning BIG despite neutral position ratio → FOLLOW_SM_LONG
                confidence = int(min(86, 50 + (current_pnl_ratio / 10) * 10))
                # Apply momentum penalty for "Stale PnL" protection
                confidence = max(30, confidence - momentum_penalty)
                pos_mult = get_position_mult_from_confidence(confidence)
                reason = f"SM LONG winning BIG ({current_pnl_ratio:.1f}x PnL ratio) despite neutral positions"
                if momentum_warning:
                    reason += f" | {momentum_warning}"
                return {
                    "mode": "FOLLOW_SM_LONG",
                    "confidence": confidence,
                    "reason": reason,
                    "maxPositionMultiplier": pos_mult,
                    "positionRatio": round(ratio, 2),
                    "pnlRatio": round(current_pnl_ratio, 2),
                    **base_data
                }

        # Check if longs are winning and shorts are underwater
        if longs_upnl > 0 and shorts_upnl <= 0:
            # Longs profitable, shorts underwater = clear long signal
            pnl_diff = longs_upnl - shorts_upnl  # shorts_upnl is negative, so this adds
            if pnl_diff > 500000:  # Significant PnL difference ($500k+)
                confidence = int(min(86, 50 + (pnl_diff / 1000000) * 15))
                # Apply momentum penalty for "Stale PnL" protection
                confidence = max(30, confidence - momentum_penalty)
                pos_mult = get_position_mult_from_confidence(confidence)
                reason = f"SM LONG profitable (+${longs_upnl/1000:.0f}k) while SHORT underwater (-${abs(shorts_upnl)/1000:.0f}k)"
                if momentum_warning:
                    reason += f" | {momentum_warning}"
                return {
                    "mode": "FOLLOW_SM_LONG",
                    "confidence": confidence,
                    "reason": reason,
                    "maxPositionMultiplier": pos_mult,
                    "positionRatio": round(ratio, 2),
                    "pnlRatio": 999.0,  # Infinite (longs winning, shorts negative)
                    **base_data
                }

        # Still neutral - no clear PnL dominance
        return {
            "mode": "NEUTRAL",
            "confidence": 30,
            "reason": f"Mixed SM signals (ratio {ratio:.2f}x) - no clear direction",
            "maxPositionMultiplier": 0.25,  # Reduced for unclear signals
            "positionRatio": round(ratio, 2),
            "pnlRatio": round(pnl_ratio, 2),
            **base_data
        }

# ============================================================
# SMART MONEY TRACKING LIST - UPDATED 2026-01-19
# Full list from Nansen verification with TIERS and SIGNAL WEIGHTS
# ============================================================
#
# TIER SYSTEM:
# - TIER 1 (CONVICTION): signal_weight 0.9-1.0 - Follow closely
# - TIER 2 (FUND): signal_weight 0.7-0.85 - Institutional money
# - TIER 3 (ACTIVE): signal_weight 0.5-0.7 - Active traders
# - TIER 4 (MM): signal_weight 0.0 - IGNORE (market makers)
#
# NEW: nansen_label field determines credibility_multiplier
# min_change = minimum position change % to trigger alert
# ============================================================

WHALES = {
    # ================================================================
    # 🔴 TIER 1: CONVICTION TRADERS (signal_weight: 0.9-1.0)
    # These are the most important - they hold positions with conviction
    # ================================================================

    # === MEGA WHALE - LONG BIAS (NANSEN VERIFIED) ===
    "0xb317d2bc2d3d2df5fa441b5bae0ab9d8b07283ae": {
        "name": "Bitcoin OG",
        "emoji": "🔍",
        "tier": "CONVICTION",
        "signal_weight": 0.10,
        "nansen_label": "Smart HL Perps Trader",  # VERIFIED
        "min_change": 0.05,
        "notes": "WATCH: Liquidated -$128M on ETH LONG 31.01.2026. +$165M Oct 2025 BTC shorts. Account empty — watching for return. CLUSTER BITCOIN_OG: 3 portfele — main (b317d2), OG #2 (2ea18c, same entity 1KAt6STt), + 0x4f9a37bc (received 192.6M USDC from main). All empty. 🔴 OCT_CRASH: INSIDER_95% — ROI 4331%, zamknął konto, anonimowy, portfel stworzony specjalnie na ten trade."
    },
    "0xd7a678fcf72c1b602850ef2f3e2d668ec41fa0ed": {
        "name": "Winner d7a678",
        "emoji": "🔍",
        "tier": "CONVICTION",
        "signal_weight": 0.10,
        "nansen_label": "Smart HL Perps Trader",  # VERIFIED - Consistent Perps Winner
        "min_change": 0.08,
        "notes": "WATCH: +$4.09M profit (SOL/BTC/ETH shorts). Cashed out 31.01.2026, account empty — watching for return."
    },
    "0x2ea18c23f72a4b6172c55b411823cdc5335923f4": {
        "name": "Bitcoin OG #2",
        "emoji": "🔍",
        "tier": "CONVICTION",
        "signal_weight": 0.10,
        "nansen_label": "Smart HL Perps Trader",  # VERIFIED - same entity as OG #1
        "min_change": 0.05,
        "notes": "WATCH: +$72.5M Oct 2025 BTC short (ROI 381%), same entity as OG #1 (1KAt6STt). Account empty — watching for return. CLUSTER BITCOIN_OG: see b317d2."
    },

    # === NANSEN VERIFIED Smart HL Perps Traders (2026-01-19) ===
    "0x3c363e96d22c056d748f199fb728fc80d70e461a": {
        "name": "SM HL Trader 3c363e",
        "emoji": "🤓",
        "tier": "CONVICTION",
        "signal_weight": 0.80,
        "nansen_label": "Smart HL Perps Trader",  # VERIFIED
        "min_change": 0.08,
        "notes": "Nansen Smart HL Perps Trader - SUI trader"
    },

    # === MEGA SHORTERS - CLASSIFICATION BY NANSEN LABEL ===
    "0xa312114b5795dff9b8db50474dd57701aa78ad1e": {
        "name": "Generał",
        "emoji": "🔴",
        "tier": "CONVICTION",
        "signal_weight": 1.0,
        "nansen_label": "Smart HL Perps Trader",  # VERIFIED - profitable LIT/DOGE shorter
        "min_change": 0.05,
        "notes": "⚠️ FLIPNĄŁ LIT: SHORT→LONG 24.02 (zamknął $3.3M SHORT z zyskiem, otworzył $200K LONG @$1.3753). ASTER SHORT $1.4M (+$1M), PUMP SHORT $514K, FARTCOIN SHORT $358K (+$600K). Equity $2.86M, uPnL +$2.04M. 🔴 OCT_CRASH: INSIDER_85% — +$48.8M PnL, MEV Bot + FTX first funder."
    },
    "0x35d1151ef1aab579cbb3109e69fa82f94ff5acb1": {
        "name": "Major",
        "emoji": "🤓",
        "tier": "CONVICTION",
        "signal_weight": 0.95,
        "nansen_label": "Smart HL Perps Trader",  # VERIFIED by Nansen 2026-01-19!
        "min_change": 0.05,
        "notes": "$64.3M SOL SHORT (+$8.7M uPnL) - Nansen verified Smart HL Perps Trader. First Funder: Coinbase Hot Wallet. CLUSTER TOKEN_MILLIONAIRE: sent 32.6M USDC to Token Millionaire 0x0df8e1. Powiązany z Kraken A (06cecf) przez Token Millionaire entity."
    },
    "0x5d2f4460ac3514ada79f5d9838916e508ab39bb7": {
        "name": "Pułkownik",
        "emoji": "🔴",
        "tier": "CONVICTION",
        "signal_weight": 0.95,
        "nansen_label": "Smart HL Perps Trader",  # VERIFIED - mega BTC winner
        "min_change": 0.05,
        "notes": "$46.3M BTC SHORT (+$19.4M uPnL!) - MEGA winner on BTC. 🟡 OCT_CRASH: INSIDER_70% — ROI 7379%, wysłał 38.9M USDC na Binance, otrzymał 15.7M BTCB. CLUSTER TOKEN_MILLIONAIRE (0xc613bd). Używa Binance/Bybit/OKX."
    },
    "0x45d26f28196d226497130c4bac709d808fed4029": {
        "name": "Wice-Generał",
        "emoji": "🔴",
        "tier": "CONVICTION",
        "signal_weight": 0.9,
        "nansen_label": "Smart HL Perps Trader",  # VERIFIED
        "min_change": 0.05,
        "notes": "$40.5M BTC SHORT (+$6.4M), $28.9M ETH SHORT, $514k SUI SHORT (+$864k). CLUSTER YIELD_FARMER: sent 43M USDC to Yield Farmer 0x1419e75330c71ce463102e6a1eb62fe80b412d5f. DeFi: $48.6M net."
    },
    "0x06cecfbac34101ae41c88ebc2450f8602b3d164b": {
        "name": "Kraken A ⭐",
        "emoji": "🤓",
        "tier": "CONVICTION",
        "signal_weight": 0.90,
        "nansen_label": "Smart HL Perps Trader",  # VERIFIED by Nansen 2026-01-19!
        "min_change": 0.05,
        "notes": "$4.66M equity, ~$13.15M total profit. SOL SHORT $7M (entry $172, +$8.25M!), BTC SHORT $2.9M (+$1.9M), HYPE SHORT $2.8M (+$1.56M), FARTCOIN SHORT $373K (+$656K). Multi-asset shorter od paź 2025. First Funder on Plasma: Token Millionaire 0xc5b2359fe6b4a7118b67b116069ca2e7cf3ccc27. Sent 5M USDC to Token Millionaire 0xc5b235 (Oct 2025). Deployed Convex Finance Reward Stash. CLUSTER TOKEN_MILLIONAIRE: powiązany z Major (35d115) przez Token Millionaire entity. DeFi: $19.5M net (PT-KHYPE $6.8M, borrowed WHYPE $4M via Hyperlend)."
    },
    "0x6bea81d7a0c5939a5ce5552e125ab57216cc597f": {
        "name": "Porucznik SOL2",
        "emoji": "🤓",
        "tier": "CONVICTION",
        "signal_weight": 0.80,
        "nansen_label": "Smart HL Perps Trader",  # VERIFIED by Nansen 2026-01-19!
        "min_change": 0.05,
        "notes": "$8.1M SOL SHORT (+$2M uPnL) - Nansen verified Smart HL Perps Trader"
    },
    "0x936cf4fb95c30ce83f658b5bbb247e4bb381bb0f": {
        "name": "Porucznik SOL3",
        "emoji": "🤓",
        "tier": "CONVICTION",
        "signal_weight": 0.75,
        "nansen_label": "Smart HL Perps Trader",  # VERIFIED by Nansen 2026-01-19!
        "min_change": 0.05,
        "notes": "$6.6M SOL SHORT (+$488k uPnL) - Nansen verified Smart HL Perps Trader"
    },
    "0x71dfc07de32c2ebf1c4801f4b1c9e40b76d4a23d": {
        "name": "Kapitan BTC",
        "emoji": "🔴",
        "tier": "CONVICTION",
        "signal_weight": 0.9,
        "nansen_label": "Smart HL Perps Trader",  # VERIFIED
        "min_change": 0.05,
        "notes": "$25.4M BTC SHORT (+$4.9M), $19.8M ETH SHORT, $2.1M ZEC SHORT (+$861k). First Funder: Binance Hot Wallet. Anonymous — no other known relationships. DeFi: $31.1M net. 🟡 OCT_CRASH: INSIDER_75% — entry BTC $106,677 (2 dni przed ATH $126K!), nadal trzyma short, ROI 1334%, anonimowy."
    },
    "0x519c721de735f7c9e6146d167852e60d60496a47": {
        "name": "ZEC Conviction",
        "emoji": "🟢",
        "tier": "CONVICTION",
        "signal_weight": 0.85,
        "nansen_label": "Smart HL Perps Trader",  # VERIFIED - conviction ZEC holder
        "min_change": 0.05,
        "notes": "$6.2M ZEC LONG (-$1.1M underwater) - conviction holder"
    },

    # ================================================================
    # 🟠 TIER 2: INSTITUTIONAL / FUNDS (signal_weight: 0.7-0.85)
    # ================================================================

    "0xcac19662ec88d23fa1c81ac0e8570b0cf2ff26b3": {
        "name": "Galaxy Digital",
        "emoji": "🏦",
        "tier": "FUND",
        "signal_weight": 0.85,
        "nansen_label": "Fund",  # Institutional fund
        "min_change": 0.05,
        "notes": "$34.5M BTC SHORT (+$5.9M), $20.9M ETH SHORT (+$6.5M), $534k SOL SHORT. First Funder: Galaxy Global Markets: OTC (0x33566c9d8be6cf0b23795e0d380e112be9d75836). Confirmed institutional fund. DeFi: $40.1M net. 🟢 OCT_CRASH: LEGIT_EDGE_25% — Mike Novogratz fund, publiczna firma, legalny dostęp do flow + OTC info."
    },
    "0x8def9f50456c6c4e37fa5d3d57f108ed23992dae": {
        "name": "Laurent Zeimes",
        "emoji": "🦈",
        "tier": "FUND",
        "signal_weight": 0.8,
        "nansen_label": "All Time Smart Trader",  # Known profitable trader
        "min_change": 0.10,
        "notes": "Known trader, +$391k PnL historically"
    },
    "0xc4241dc9bfeb5126c0766df35a87ed3fbd630c78": {
        "name": "Arrington XRP Capital",
        "emoji": "💼",
        "tier": "FUND",
        "signal_weight": 0.7,
        "nansen_label": "Fund",  # Institutional fund
        "min_change": 0.10,
        "notes": "$22k SUI LONG (-$50k underwater)"
    },
    "0x418aa6bf98a2b2bc93779f810330d88cde488888": {
        "name": "58bro.eth",
        "emoji": "🔴",
        "tier": "FUND",
        "signal_weight": 0.8,
        "nansen_label": "Smart HL Perps Trader",  # Verified trader
        "min_change": 0.05,
        "notes": "$10.2M BTC SHORT, $16.4M ETH SHORT"
    },
    "0x7fdafde5cfb5465924316eced2d3715494c517d1": {
        "name": "Fasanara Capital",
        "emoji": "🏦",
        "tier": "MARKET_MAKER",
        "signal_weight": 0.0,
        "nansen_label": "Market Maker",
        "min_change": 0.05,
        "notes": "$30.6M equity, $94.5M notional. ETH SHORT $50.2M, BTC SHORT $24M, HYPE SHORT $14M, AVAX SHORT $4.9M, FARTCOIN SHORT $1.3M. London hedge fund. First Funder: Fasanara Capital Aave Arc (0x177876). DeFi: $43.2M. 🟢 OCT_CRASH: LEGIT_EDGE_20%. RECLASSIFIED 24.02: 100% maker fills, 100% CLOID = pure MM, not directional."
    },
    "0xb83de012dba672c76a7dbbbf3e459cb59d7d6e36": {
        "name": "Abraxas Capital",
        "emoji": "🏦",
        "tier": "FUND",
        "signal_weight": 0.70,
        "nansen_label": "Fund",  # Confirmed fund entity
        "min_change": 0.08,
        "notes": "$9.8M equity (main wallet). HYPE SHORT $4.3M, FARTCOIN SHORT $1.1M, XRP SHORT $598K. First Funder: Abraxas Capital (0xed0c60). DeFi: $12.8M. CLUSTER ABRAXAS: 2 trading wallets (b83de0 + 5b5d51) + funder (ed0c60). Wypłacił $144M na Binance. 🟢 OCT_CRASH: LEGIT_EDGE_30% — potwierdzony fundusz instytucjonalny."
    },
    "0x5b5d51203a0f9079f8aeb098a6523a13f298c060": {
        "name": "Abraxas #2",
        "emoji": "🏦",
        "tier": "FUND",
        "signal_weight": 0.70,
        "nansen_label": "Fund",  # Same entity as Abraxas main
        "min_change": 0.08,
        "notes": "$9.8M equity (second wallet). HYPE SHORT $4.3M, FARTCOIN SHORT $1.1M, BTC LONG $1.3M. +$81.1M PnL historycznie. CLUSTER ABRAXAS: see b83de0."
    },

    # ================================================================
    # 🟡 TIER 3: ACTIVE TRADERS (signal_weight: 0.5-0.7)
    # ================================================================

    "0xfeec88b13fc0be31695069f02bac18538a154e9c": {
        "name": "Kapitan feec ⭐",
        "emoji": "🔴",
        "tier": "ACTIVE",
        "signal_weight": 0.80,
        "nansen_label": "Smart HL Perps Trader",  # VERIFIED by Nansen 2026-01-19!
        "min_change": 0.08,
        "notes": "$1.53M equity, +$10.8M total. BTC SHORT $14M (entry $101,600, +$7.8M uPnL). HYPE SHORT $26K, FARTCOIN LONG $74K. Closed PnL +$3.04M. BTC short opened sty 2026. Nansen verified. First Funder: OKX Wallet (Oct 2, 2025). Receives funds from MEV Capital USDC, uses Coinbase/Bybit. DeFi: $9.1M net."
    },
    "0xfce053a5e461683454bf37ad66d20344c0e3f4c0": {
        "name": "Kapitan fce0 ⭐",
        "emoji": "🔴",
        "tier": "ACTIVE",
        "signal_weight": 0.85,  # UPGRADED from 0.80: MANUAL trader, high conviction
        "nansen_label": "Smart HL Perps Trader",  # VERIFIED by Nansen 2026-01-19!
        "min_change": 0.08,
        "notes": "$3.34M equity, +$6.79M total. BTC SHORT $8.5M (entry $90,472 - najnizsze wejscie z Kapitanow), ETH SHORT $3.47M (+$2.51M). MEGA LONG $3.9K. Opened BTC short 15 sty 2026. Nansen verified. DeFi: sent 1.4M USDC to Aave, 400K to Pendle Finance. Received 1.8M USDC from Hyperithm USDC. Sophisticated DeFi trader."
    },
    "0x99b1098d9d50aa076f78bd26ab22e6abd3710729": {
        "name": "Kapitan 99b1 ⭐",
        "emoji": "🔴",
        "tier": "ACTIVE",
        "signal_weight": 0.80,
        "nansen_label": "Smart HL Perps Trader",  # VERIFIED by Nansen 2026-01-19!
        "min_change": 0.08,
        "notes": "$435K equity, +$981K total. Mid-cap shorter: BCH $404K, LTC $378K, HYPE $317K, BNB $144K, ETH $12K. Zrealizowal $700K w 3 dni (5-8 lut). Nansen verified."
    },
    "0xc7290b4b308431a985fa9e3e8a335c2f7650517c": {
        "name": "OG Shorter c7290b",
        "emoji": "🔴",
        "tier": "CONVICTION",
        "signal_weight": 0.85,
        "nansen_label": "All Time Smart Trader",
        "min_change": 0.10,
        "notes": "$6.3M equity, shortuje od lis 2025. BTC SHORT $5M (entry $97K, +$2.4M), ETH SHORT $1.4M (entry $3070, +$851K), HYPE SHORT $661K. Closed PnL +$2.48M. Łącznie ~$5.76M profit. UPGRADED 24.02: MANUAL trader (2 fills/7d), +$15.5M uPnL, highest conviction."
    },
    "0xea6670ebdb4a388a8cfc16f6497bf4f267b061ee": {
        "name": "Porucznik ea66",
        "emoji": "🤓",
        "tier": "CONVICTION",
        "signal_weight": 0.85,
        "nansen_label": "Smart HL Perps Trader",  # VERIFIED by Nansen
        "min_change": 0.08,
        "notes": "$9.1M BTC SHORT - Nansen verified Smart HL Perps Trader"
    },
    "0x92e9773ad2b4ba6e2e57e7fc1f9305aef80ab6c2": {
        "name": "BTC/LIT Trader",
        "emoji": "🤓",
        "tier": "CONVICTION",
        "signal_weight": 0.80,
        "nansen_label": "Smart HL Perps Trader",  # VERIFIED by Nansen
        "min_change": 0.10,
        "notes": "Nansen Smart HL Perps Trader - BTC/LIT trader"
    },
    "0x570b09e27a87f9acbce49f85056745d29b3ee3c6": {
        "name": "Kontrarian 570b09",
        "emoji": "🔍",
        "tier": "ACTIVE",
        "signal_weight": 0.10,
        "min_change": 0.10,
        "notes": "WATCH: $1M equity, flipnął SHORT→LONG. SOL LONG $2.79M (20x) otwarty 23.02. Closed PnL +$3.13M (SOL $2.17M, ETH $493K, BTC $464K). Był shorterem sty-luty, dziś kontrarian vs SM SHORT consensus."
    },
    "0x56cd86d6ef24a3f51ce6992b7f1db751b0a0276a": {
        "name": "Kraken B ⭐",
        "emoji": "🤓",
        "tier": "CONVICTION",
        "signal_weight": 0.85,
        "nansen_label": "Smart HL Perps Trader",  # VERIFIED by Nansen 2026-01-19! Token Millionaire, Smart HL Perps Trader
        "min_change": 0.08,
        "notes": "$6.57M equity, ~$3.54M total profit. HYPE SHORT $842K (entry $40.60, +$456K), SOL SHORT $412K (entry $154.60, +$396K), XRP SHORT $195K (+$165K). Ultra-konserwatywny 0.2x lev, aktywny od cze 2025 (9 mcy). Zrealizował $1.85M w 2 dni (5-6 lut). Nansen label: Token Millionaire — possible CLUSTER TOKEN_MILLIONAIRE connection with Kraken A (06cecf) and Major (35d115)."
    },
    "0x1e771e1b95c86491299d6e2a5c3b3842d03b552e": {
        "name": "SM HL Trader 1e771e",
        "emoji": "🤓",
        "tier": "CONVICTION",
        "signal_weight": 0.75,
        "nansen_label": "Smart HL Perps Trader",  # VERIFIED by Nansen
        "min_change": 0.10,
        "notes": "Nansen Smart HL Perps Trader - DOGE/ETH shorter"
    },
    "0x179c17d04be626561b0355a248d6055a80456aa5": {
        "name": "SM Active 179c17",
        "emoji": "🔴",
        "tier": "ACTIVE",
        "signal_weight": 0.6,
        "min_change": 0.10,
        "notes": "$3.1M SOL SHORT"
    },
    "0xe4d83945c0322f3d340203a7129b7eb5cacae847": {
        "name": "SM Active e4d839",
        "emoji": "🔴",
        "tier": "ACTIVE",
        "signal_weight": 0.6,
        "min_change": 0.10,
        "notes": "$2.3M SOL SHORT"
    },
    "0xb1694de2324433778487999bd86b1acb3335ebc4": {
        "name": "SM Active b1694d",
        "emoji": "🔴",
        "tier": "ACTIVE",
        "signal_weight": 0.55,
        "min_change": 0.15,
        "notes": "$1.9M SOL SHORT"
    },
    "0xa4be91acc74feabab71b8878b66b8f5277212520": {
        "name": "SM Active a4be91",
        "emoji": "🔴",
        "tier": "ACTIVE",
        "signal_weight": 0.55,
        "min_change": 0.15,
        "notes": "$1.4M SOL SHORT"
    },
    "0x6a7a17046df7d3e746ce97d67dc1c6c55e27ce75": {
        "name": "SM Active 6a7a17",
        "emoji": "🔴",
        "tier": "ACTIVE",
        "signal_weight": 0.5,
        "min_change": 0.15,
        "notes": "$723k SOL SHORT"
    },
    "0xa6cb81271418b9f41295fff54be05f6250c7cbf6": {
        "name": "SM Active a6cb81",
        "emoji": "🔴",
        "tier": "ACTIVE",
        "signal_weight": 0.5,
        "min_change": 0.15,
        "notes": "$709k SOL SHORT"
    },
    "0x0980b34ade9476dba81bcdb0f865a333793ad1c2": {
        "name": "SM Active 0980b3",
        "emoji": "🔴",
        "tier": "ACTIVE",
        "signal_weight": 0.5,
        "min_change": 0.20,
        "notes": "$382k SOL SHORT"
    },
    "0x782e432267376f377585fc78092d998f8442ab83": {
        "name": "SM Active 782e43",
        "emoji": "🟡",
        "tier": "ACTIVE",
        "signal_weight": 0.5,
        "min_change": 0.15,
        "notes": "$3.8M BTC SHORT, $1.3M SOL LONG - mixed"
    },
    "0xdca131ba8f428bd2f90ae962e4cb2d226312505e": {
        "name": "SM Active dca131",
        "emoji": "🔴",
        "tier": "ACTIVE",
        "signal_weight": 0.55,
        "min_change": 0.15,
        "notes": "$2.8M BTC SHORT"
    },
    "0x649156ebf0a350deb18a1e4835873defd4dc5349": {
        "name": "donkstrategy.eth",
        "emoji": "🔴",
        "tier": "ACTIVE",
        "signal_weight": 0.65,
        "min_change": 0.15,
        "notes": "$600K equity, shorter od gru 2025. BTC SHORT $1M (entry $88.6K, +$354K), ETH SHORT $133K (+$107K), HYPE SHORT $53K (+$9K). Closed PnL +$736K, total ~$1.2M profit. Konserwatywny 2x lev, 49 aktywnych dni."
    },
    "0xe82bc65677e46b6626a8e779ac263221db039c2d": {
        "name": "SM Active e82bc6",
        "emoji": "🔴",
        "tier": "ACTIVE",
        "signal_weight": 0.55,
        "min_change": 0.15,
        "notes": "$2.4M BTC SHORT"
    },
    "0x84abc08c0ea62e687c370154de1f38ea462f4d37": {
        "name": "SM Active 84abc0",
        "emoji": "🔴",
        "tier": "ACTIVE",
        "signal_weight": 0.5,
        "min_change": 0.15,
        "notes": "$4.3M ETH SHORT"
    },
    "0x61f2bb695d81ac9fce0b1d01fd45cc6b2925a571": {
        "name": "SM Active 61f2bb",
        "emoji": "🔴",
        "tier": "ACTIVE",
        "signal_weight": 0.5,
        "min_change": 0.20,
        "notes": "$987k ETH SHORT"
    },
    "0xdbcc96bcada067864902aad14e029fe7c422f147": {
        "name": "SM Active dbcc96",
        "emoji": "🟢",
        "tier": "ACTIVE",
        "signal_weight": 0.5,
        "min_change": 0.20,
        "notes": "$428k SOL LONG"
    },

    # ================================================================
    # 🎯 NANSEN-VERIFIED MANUAL TRADERS (October 2025 cohort)
    # Human traders (NOT bots) — Nansen "Smart HL Perps Trader"
    # Added 24.02.2026 from Nansen BTC Short leaderboard cross-reference
    # ================================================================

    "0xf62edeee17968d4c55d1c74936d2110333342f30": {
        "name": "October Shorter f62ede",
        "emoji": "🔴",
        "tier": "CONVICTION",
        "signal_weight": 0.80,
        "nansen_label": "Smart HL Perps Trader",
        "min_change": 0.10,
        "notes": "MANUAL TRADER (nie bot). $769K equity, multi-asset shorter. BTC SHORT $3.5M (entry $105.5K, +$2.4M, +67%), ZEREBRO SHORT +2503%, PUMP SHORT +187%, HYPE SHORT +17.5%. Nansen-verified Smart HL Perps Trader. Added 24.02 from October 2025 BTC short cohort analysis."
    },
    "0xc1471df385b1b039aae2000678e0b8bd905b3aef": {
        "name": "October Shorter c1471d",
        "emoji": "🔴",
        "tier": "CONVICTION",
        "signal_weight": 0.80,
        "nansen_label": "Smart HL Perps Trader",
        "min_change": 0.10,
        "notes": "MANUAL TRADER (nie bot). $1.7M equity, aggressive multi-asset shorter. BTC SHORT $2.9M (entry $113.6K, +$2.3M, +80%), ETH SHORT $2M (+$2.1M, +106%), SOL SHORT $1M (+$784K, +75%), FARTCOIN SHORT +718%, 8+ more short positions. Nansen-verified Smart HL Perps Trader. Added 24.02 from October 2025 BTC short cohort analysis."
    },
    "0x218a65e21eddeece7a9df38c6bbdd89f692b7da2": {
        "name": "Mega Shorter 218a65",
        "emoji": "🔴",
        "tier": "CONVICTION",
        "signal_weight": 0.75,
        "min_change": 0.10,
        "notes": "MANUAL TRADER (nie bot). $3.4M equity, BTC SHORT $25.6M (358 BTC, entry $71.2K, +$3M, +186% ROI, 14x lev). Funded from Coinbase — individual trader. Liq $71.6K (tight! relies on $5.8M DeFi collateral). Added 24.02 from Nansen BTC Short leaderboard."
    },
    "0xd62d484bda5391d75b414e68f9ddcedb207b7d91": {
        "name": "Algo Shorter d62d48",
        "emoji": "🔴",
        "tier": "CONVICTION",
        "signal_weight": 0.70,
        "min_change": 0.10,
        "notes": "ALGO BOT (14,996 trades/30d). $8.6M equity, BTC SHORT $20.9M (279 BTC, entry $75.2K, +$3.4M, +778% ROI, 40x lev). Liq $92.5K (comfortable). Ranked #16 BTC PnL leaderboard (+$5.1M/30d). $10.7M DeFi collateral. Anonymous — no related addresses. Added 24.02 from Nansen BTC Short leaderboard."
    },

    # --- frankfrankbank.eth (added 25.02 from Nansen SM inflow audit) ---
    "0x6f7d75c18e8ca7f486eb4d2690abf7b329087062": {
        "name": "frankfrankbank 6f7d75",
        "emoji": "🔴",
        "tier": "CONVICTION",
        "signal_weight": 0.80,
        "nansen_label": "Smart HL Perps Trader",
        "min_change": 0.10,
        "notes": "MANUAL TRADER (nie bot). $823K equity, ETH SHORT $9.3M (entry $3,429, +$3.78M, 25x lev), BTC SHORT $102K (40x lev). ENS: frankfrankbank.eth. 14 fills/7d, zero CLOIDs, zero sub-1s. Discovered from Nansen 'bullish SM inflow' audit — deposited $556K to HL as margin for massive ETH short. Added 25.02."
    },

    # --- Selini Capital (fresh directional, re-added 24.02) ---
    # Previously removed (22.02) as MM spam (5 accounts flipping constantly).
    # These 2 accounts opened FRESH BTC shorts at $62,940 — directional, not MM behavior.
    # Low weight because of MM history — trust only if they hold.

    "0x39475d17bcd20adc540e647dae6781b153fbf3b1": {
        "name": "Selini Capital #1",
        "emoji": "🏦",
        "tier": "MARKET_MAKER",
        "signal_weight": 0.0,
        "nansen_label": "Market Maker",
        "min_change": 0.10,
        "notes": "Selini Capital — known quant fund running MM grids. RECLASSIFIED 24.02: tight spread MM grid ($60-100 spread) confirmed via openOrders API. Not directional — pure market making. Previously FUND 0.40 (24.02), originally removed as MM spam (22.02)."
    },
    "0x621c5551678189b9a6c94d929924c225ff1d63ab": {
        "name": "Selini Capital #2",
        "emoji": "🏦",
        "tier": "MARKET_MAKER",
        "signal_weight": 0.0,
        "nansen_label": "Market Maker",
        "min_change": 0.10,
        "notes": "Selini Capital second account. RECLASSIFIED 24.02: tight spread MM grid ($57 spread) confirmed via openOrders API. Same as #1 — pure market making, not directional."
    },

    # --- Token Millionaire LIT Bot (added 25.02) ---
    "0x7717a7a245d9f950e586822b8c9b46863ed7bd7e": {
        "name": "Token Millionaire 7717a7",
        "emoji": "🤖",
        "tier": "ACTIVE",
        "signal_weight": 0.60,
        "nansen_label": "Token Millionaire",
        "min_change": 0.05,
        "notes": "Trading Bot. $8.1M account, LIT LONG $187K (5x cross, entry $1.4194). Algo MM/grid bot — hundreds of small fills. Funded from Binance Hot Wallet ($11.7M USDC). Added 25.02."
    },

    # --- Contrarian tracker (24.02) ---
    "0x015354106478dda69c4aae3c0cf801290b738052": {
        "name": "Contrarian Long 015354",
        "emoji": "🟢",
        "tier": "WATCH",
        "signal_weight": 0.15,
        "nansen_label": "Smart HL Perps Trader",
        "min_change": 0.10,
        "notes": "ONLY notable SM BTC LONG ($12M, 191 BTC, entry $65,849, 2x isolated, -$597K underwater). Contrarian vs entire SM SHORT consensus. Low weight — useful as negative confirmation (when he's losing, SHORT thesis confirmed). Added 24.02."
    },

    # ================================================================
    # ❌ TIER 4: MARKET MAKERS (signal_weight: 0.0 - IGNORE!)
    # These flip constantly and should NOT influence bias calculations
    # ================================================================

    "0x091144e651b334341eabdbbbfed644ad0100023e": {
        "name": "Manifold Trading",
        "emoji": "📊",
        "tier": "ACTIVE",
        "signal_weight": 0.30,
        "min_change": 0.10,
        "notes": "$3.1M equity, hybryda MM+trader. 12 SHORT vs 3 LONG, +$1.33M uPnL. Top: LIT $1.57M, HYPE $1.35M, ZRO $1.26M, XMR $707K. MM-style fills (2000+/d, median $315) ale directional conviction."
    },

    # ================================================================
    # 📋 LEGACY ADDRESSES (keep for backwards compatibility)
    # ================================================================

    "0x091159a8106b077c13e89bc09701117e8b5f129a": {
        "name": "Kontrarian 091159",
        "emoji": "🔍",
        "tier": "CONVICTION",
        "signal_weight": 0.10,
        "nansen_label": "Smart HL Perps Trader",  # VERIFIED by Nansen
        "min_change": 0.10,
        "notes": "WATCH: $7.8M equity, kontrarian — ALL LONG (BTC $8.7M 20x, ETH $8.5M 20x, LIT $4.4M) vs SM SHORT consensus. Kupił BTC+ETH 23.02, LIT+IP 05.02. Raw USD -$20M (wyciągnął zyski wcześniej)"
    },

    # ================================================================
    # 🆕 OCTOBER 2025 BTC CRASH WINNERS (added 23.02.2026)
    # ================================================================

    "0x8e096995c3e4a3f0bc5b3ea1cba94de2aa4d70c9": {
        "name": "Oct Winner 8e0969",
        "emoji": "🔴",
        "tier": "ACTIVE",
        "signal_weight": 0.65,
        "nansen_label": "",
        "min_change": 0.10,
        "notes": "+$14.9M Oct 2025 BTC crash. Still SHORT BTC $5.5M. Unknown label but massive PnL."
    },
    "0x856c35038594767646266bc7fd68dc26480e910d": {
        "name": "Oct Winner 856c35",
        "emoji": "🔴",
        "tier": "ACTIVE",
        "signal_weight": 0.60,
        "nansen_label": "Whale",
        "min_change": 0.10,
        "notes": "+$9.1M Oct 2025 BTC crash. Still SHORT BTC $10.4M. Nansen label: Whale."
    },
    "0x4eebd8d39e82efb958e0fa9f694435c910c8518f": {
        "name": "Oct Winner 4eeb (WATCH)",
        "emoji": "🔍",
        "tier": "ACTIVE",
        "signal_weight": 0.10,
        "nansen_label": "",
        "min_change": 0.10,
        "notes": "WATCH: +$5.8M Oct 2025 BTC crash, 13.3% ROI, 1099 trades. Account EMPTY ($0) as of 23.02.2026 — took profits and left. Watching for return."
    },
    "0x5b9306593ae710a66832c4101e019e3e96f65d0a": {
        "name": "SM 5b9306",
        "emoji": "🔴",
        "tier": "ACTIVE",
        "signal_weight": 0.65,
        "nansen_label": "",
        "min_change": 0.10,
        "notes": "$9.5M equity. BTC SHORT entry $108,343 (+$1.5M). HYPE SHORT $8.9M, ETH SHORT $3.6M, FARTCOIN SHORT $325K, LIT SHORT $205K. First funder: unknown 0x3ed2ce (Feb 2025). Related: sent 4.4M USDC to High Balance 0x089d69ce9f2dbca64a1fb6ac81e0057b40d7e9a3. Sent 615.1K HYPE to Kinetiq (staking)."
    },
    "0x880ac484a1743862989a441d6d867238c7aa311c": {
        "name": "Silk Capital",
        "emoji": "🔴",
        "tier": "CONVICTION",
        "signal_weight": 0.75,
        "nansen_label": "Token Millionaire",  # Nansen category label; entity name = Silk Capital
        "min_change": 0.08,
        "notes": "$5.2M equity, 23 pozycji. XMR SHORT $7.6M (+$2.4M), HYPE SHORT $8.3M (+$974K), BTC SHORT $1.6M. UPGRADED 24.02: HYBRID algo fund — 97.9% maker fills (limit order discipline), 99.5% SHORT exposure, $16.7M cumulative funding paid. +$33.8M Oct 2025 PnL. Directional shorter, NOT MM."
    },
    "0x4f7634c03ec4e87e14725c84913ade523c6fad5a": {
        "name": "Former SM 4f7634 (WATCH)",
        "emoji": "🔍",
        "tier": "ACTIVE",
        "signal_weight": 0.10,
        "nansen_label": "Former Smart Trader",
        "min_change": 0.10,
        "notes": "WATCH: +$38.3M Oct 2025 BTC crash. Account EMPTY ($0). 🔴 OCT_CRASH: INSIDER_90% — otrzymał 11M USDC z Binance Hot Wallet 1-6 paź (przed crashem!), wysłał na HL Bridge, zshortował, zamknął konto. Timing perfekcyjny, first funder Binance Hot Wallet. Watching for return."
    },
}

# Coiny do trackowania
TRACKED_COINS = ["BTC", "ETH", "SOL", "HYPE", "FARTCOIN", "XRP", "DOGE", "WIF", "PUMP", "kPEPE", "ZEC", "LIT", "SUI", "VIRTUAL", "ENA"]

# ============================================================
# HYPERLIQUID API
# ============================================================

def get_hl_positions(address: str) -> dict:
    """Pobierz pozycje z Hyperliquid API (darmowe!)"""
    payload = {"type": "clearinghouseState", "user": address}
    try:
        response = requests.post(HL_API_URL, json=payload, timeout=10)
        response.raise_for_status()
        data = response.json()

        positions = []
        for p in data.get('assetPositions', []):
            pos = p['position']
            size = float(pos['szi'])
            if size != 0:
                entry_px = float(pos['entryPx'])
                positions.append({
                    'coin': pos['coin'],
                    'side': 'Long' if size > 0 else 'Short',
                    'size': abs(size),
                    'entry_price': entry_px,
                    'unrealized_pnl': float(pos['unrealizedPnl']),
                    'liquidation_price': float(pos.get('liquidationPx') or 0),
                    'leverage': pos.get('leverage', {}).get('value', 0),
                    'position_value': abs(size) * entry_px
                })

        return {
            'positions': positions,
            'account_value': float(data.get('marginSummary', {}).get('accountValue', 0)),
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        print(f"[ERROR] HL API error for {address[:10]}: {e}")
        return {'positions': [], 'account_value': 0}

def get_all_mids() -> dict:
    """Pobierz aktualne ceny"""
    try:
        response = requests.post(HL_API_URL, json={"type": "allMids"}, timeout=10)
        return response.json()
    except:
        return {}

# ============================================================
# CACHE
# ============================================================

def ensure_cache_dir():
    CACHE_DIR.mkdir(parents=True, exist_ok=True)

def load_cache() -> dict:
    ensure_cache_dir()
    try:
        with open(CACHE_FILE, 'r') as f:
            return json.load(f)
    except:
        return {}

def save_cache(data: dict):
    ensure_cache_dir()
    with open(CACHE_FILE, 'w') as f:
        json.dump(data, f, indent=2)

def update_freshness():
    ensure_cache_dir()
    with open(FRESHNESS_FILE, 'w') as f:
        f.write(datetime.now().isoformat())

def load_activity() -> dict:
    """Load whale activity tracker (address → last_change_epoch)"""
    try:
        with open(WHALE_ACTIVITY_FILE, 'r') as f:
            return json.load(f)
    except:
        return {}

def save_activity(activity: dict):
    """Save whale activity tracker"""
    with open(WHALE_ACTIVITY_FILE, 'w') as f:
        json.dump(activity, f, indent=2)

# ============================================================
# HISTORY & TREND ANALYSIS
# ============================================================

def load_history() -> list:
    """Load daily aggregated position history (last 7 days)"""
    ensure_cache_dir()
    try:
        with open(HISTORY_FILE, 'r') as f:
            history = json.load(f)
            # Keep only last TREND_DAYS entries
            return history[-TREND_DAYS:]
    except:
        return []

def save_daily_snapshot(aggregated: dict):
    """Save daily aggregated positions snapshot for trend analysis"""
    ensure_cache_dir()
    today = datetime.now().strftime("%Y-%m-%d")

    # Load existing history
    history = load_history()

    # Check if we already have today's snapshot (update it)
    today_entry = None
    for entry in history:
        if entry.get('date') == today:
            today_entry = entry
            break

    # Create snapshot
    snapshot = {
        'date': today,
        'timestamp': datetime.now().isoformat(),
        'data': {}
    }

    for coin, data in aggregated.items():
        net_flow = data['longs'] - data['shorts']
        snapshot['data'][coin] = {
            'longs': data['longs'],
            'shorts': data['shorts'],
            'net_flow': net_flow,
            'bias': calculate_bias(data['longs'], data['shorts'])
        }

    if today_entry:
        # Update existing entry
        idx = history.index(today_entry)
        history[idx] = snapshot
    else:
        # Add new entry
        history.append(snapshot)

    # Keep only last TREND_DAYS
    history = history[-TREND_DAYS:]

    with open(HISTORY_FILE, 'w') as f:
        json.dump(history, f, indent=2)

# ============================================================
# HOURLY HISTORY FOR BOTTOM DETECTION (24h changes)
# ============================================================

def load_hourly_history() -> list:
    """Load hourly position snapshots (last 48 hours)"""
    ensure_cache_dir()
    try:
        with open(HOURLY_HISTORY_FILE, 'r') as f:
            history = json.load(f)
            # Keep only last HOURLY_HISTORY_HOURS entries
            return history[-HOURLY_HISTORY_HOURS:]
    except:
        return []

def save_hourly_snapshot(aggregated: dict, all_data: dict):
    """Save hourly snapshot with position counts for bottom detection"""
    ensure_cache_dir()
    now = datetime.now()
    hour_key = now.strftime("%Y-%m-%d_%H")

    # Load existing history
    history = load_hourly_history()

    # Count individual positions per coin
    position_counts = {coin: {'longs_count': 0, 'shorts_count': 0, 'long_addresses': [], 'short_addresses': []}
                       for coin in TRACKED_COINS}

    for address, data in all_data.items():
        for pos in data.get('positions', []):
            coin = pos['coin']
            if coin not in position_counts:
                continue
            if pos['side'] == 'Long':
                position_counts[coin]['longs_count'] += 1
                position_counts[coin]['long_addresses'].append(address[:10])
            else:
                position_counts[coin]['shorts_count'] += 1
                position_counts[coin]['short_addresses'].append(address[:10])

    # Create snapshot
    snapshot = {
        'hour_key': hour_key,
        'timestamp': now.isoformat(),
        'data': {}
    }

    for coin, agg_data in aggregated.items():
        counts = position_counts.get(coin, {'longs_count': 0, 'shorts_count': 0})
        snapshot['data'][coin] = {
            'longs_usd': agg_data['longs'],
            'shorts_usd': agg_data['shorts'],
            'longs_upnl': agg_data['longs_upnl'],
            'shorts_upnl': agg_data['shorts_upnl'],
            'longs_count': counts['longs_count'],
            'shorts_count': counts['shorts_count'],
            'net_flow': agg_data['longs'] - agg_data['shorts']
        }

    # Check if we already have this hour's snapshot
    existing_idx = None
    for i, entry in enumerate(history):
        if entry.get('hour_key') == hour_key:
            existing_idx = i
            break

    if existing_idx is not None:
        history[existing_idx] = snapshot
    else:
        history.append(snapshot)

    # Keep only last HOURLY_HISTORY_HOURS
    history = history[-HOURLY_HISTORY_HOURS:]

    with open(HOURLY_HISTORY_FILE, 'w') as f:
        json.dump(history, f, indent=2)

    return history

def calculate_24h_changes(coin: str, hourly_history: list) -> dict:
    """
    Calculate 24h changes for bottom detection signals.
    Returns changes in position counts, PnL, and flow.
    """
    if len(hourly_history) < 2:
        return {
            'longs_count_change': 0,
            'shorts_count_change': 0,
            'longs_upnl_change': 0,
            'shorts_upnl_change': 0,
            'longs_usd_change': 0,
            'shorts_usd_change': 0,
            'new_long_positions': 0,
            'closed_short_positions': 0,
            'hours_analyzed': len(hourly_history)
        }

    # Get current and 24h ago data (or oldest available)
    current = hourly_history[-1]

    # Find snapshot from ~24h ago
    target_hours_ago = 24
    if len(hourly_history) >= target_hours_ago:
        old_snapshot = hourly_history[-target_hours_ago]
    else:
        old_snapshot = hourly_history[0]

    current_data = current.get('data', {}).get(coin, {})
    old_data = old_snapshot.get('data', {}).get(coin, {})

    # Calculate changes
    longs_count_change = current_data.get('longs_count', 0) - old_data.get('longs_count', 0)
    shorts_count_change = current_data.get('shorts_count', 0) - old_data.get('shorts_count', 0)
    longs_upnl_change = current_data.get('longs_upnl', 0) - old_data.get('longs_upnl', 0)
    shorts_upnl_change = current_data.get('shorts_upnl', 0) - old_data.get('shorts_upnl', 0)
    longs_usd_change = current_data.get('longs_usd', 0) - old_data.get('longs_usd', 0)
    shorts_usd_change = current_data.get('shorts_usd', 0) - old_data.get('shorts_usd', 0)

    # Estimate new/closed positions
    # Positive longs_count_change = new long positions opened
    # Negative shorts_count_change = short positions closed
    new_long_positions = max(0, longs_count_change)
    closed_short_positions = max(0, -shorts_count_change)

    return {
        'longs_count_change': longs_count_change,
        'shorts_count_change': shorts_count_change,
        'longs_upnl_change': int(longs_upnl_change),
        'shorts_upnl_change': int(shorts_upnl_change),
        'longs_usd_change': int(longs_usd_change),
        'shorts_usd_change': int(shorts_usd_change),
        'new_long_positions': new_long_positions,
        'closed_short_positions': closed_short_positions,
        'hours_analyzed': min(len(hourly_history), target_hours_ago)
    }

def calculate_trend(coin: str, history: list) -> dict:
    """
    Calculate trend metrics from historical data.
    Returns trend direction, momentum, and velocity.
    """
    if len(history) < 2:
        return {
            'trend': 'unknown',
            'momentum': 0,
            'velocity': 0,
            'flow_change': 0,
            'days_analyzed': len(history)
        }

    # Get coin data from history
    flows = []
    for entry in history:
        coin_data = entry.get('data', {}).get(coin)
        if coin_data:
            flows.append({
                'date': entry['date'],
                'net_flow': coin_data.get('net_flow', 0),
                'longs': coin_data.get('longs', 0),
                'shorts': coin_data.get('shorts', 0)
            })

    if len(flows) < 2:
        return {
            'trend': 'unknown',
            'momentum': 0,
            'velocity': 0,
            'flow_change': 0,
            'days_analyzed': len(flows)
        }

    # Calculate metrics
    oldest = flows[0]
    newest = flows[-1]

    # Flow change (negative = more shorts, positive = more longs)
    flow_change = newest['net_flow'] - oldest['net_flow']

    # Velocity (change per day)
    days = len(flows)
    velocity = flow_change / days if days > 0 else 0

    # Momentum (sum of daily changes)
    momentum = 0
    for i in range(1, len(flows)):
        daily_change = flows[i]['net_flow'] - flows[i-1]['net_flow']
        momentum += daily_change

    # Determine trend
    if abs(flow_change) < 50000:  # Less than $50k change = stable
        trend = 'stable'
    elif flow_change > 0:
        trend = 'increasing_longs'  # Moving toward long
    else:
        trend = 'increasing_shorts'  # Moving toward short

    # Calculate trend strength
    if abs(flow_change) > 1000000:  # >$1M change
        trend_strength = 'strong'
    elif abs(flow_change) > 200000:  # >$200k change
        trend_strength = 'moderate'
    else:
        trend_strength = 'weak'

    return {
        'trend': trend,
        'trend_strength': trend_strength,
        'momentum': int(momentum),
        'velocity': int(velocity),
        'flow_change': int(flow_change),
        'days_analyzed': days,
        'oldest_flow': int(oldest['net_flow']),
        'newest_flow': int(newest['net_flow'])
    }

# ============================================================
# TELEGRAM
# ============================================================

def send_telegram(message: str, parse_mode: str = "Markdown"):
    """Wyślij wiadomość na Telegram"""
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    data = {
        "chat_id": TELEGRAM_CHAT_ID,
        "text": message,
        "parse_mode": parse_mode,
        "disable_web_page_preview": True
    }
    try:
        response = requests.post(url, data=data, timeout=10)
        return response.json().get('ok', False)
    except Exception as e:
        print(f"[ERROR] Telegram: {e}")
        return False

# ============================================================
# CHANGE DETECTION
# ============================================================

def detect_changes(current: dict, previous: dict) -> list:
    """Wykryj zmiany w pozycjach wielorybów"""
    changes = []

    for address, whale_info in WHALES.items():
        # Skip MARKET_MAKER tier — no alerts for MMs (they flip constantly, noise)
        if whale_info.get('tier') == 'MARKET_MAKER':
            continue

        addr_lower = address.lower()
        curr_data = current.get(addr_lower, {})
        prev_data = previous.get(addr_lower, {})

        curr_pos = {p['coin']: p for p in curr_data.get('positions', [])}
        prev_pos = {p['coin']: p for p in prev_data.get('positions', [])}

        all_coins = set(curr_pos.keys()) | set(prev_pos.keys())

        for coin in all_coins:
            if coin not in TRACKED_COINS:
                continue

            curr = curr_pos.get(coin)
            prev = prev_pos.get(coin)

            # Nowa pozycja
            if curr and not prev:
                changes.append({
                    'type': 'NEW',
                    'address': addr_lower,
                    'whale': whale_info['name'],
                    'emoji': whale_info['emoji'],
                    'coin': coin,
                    'side': curr['side'],
                    'value': curr['position_value'],
                    'prev_value': 0,
                    'upnl': curr['unrealized_pnl']
                })

            # Zamknięta pozycja
            elif prev and not curr:
                changes.append({
                    'type': 'CLOSED',
                    'address': addr_lower,
                    'whale': whale_info['name'],
                    'emoji': whale_info['emoji'],
                    'coin': coin,
                    'side': prev['side'],
                    'value': prev['position_value'],
                    'prev_value': prev['position_value']
                })

            # Zmiana pozycji
            elif curr and prev:
                if prev['position_value'] > 0:
                    value_change = (curr['position_value'] - prev['position_value']) / prev['position_value']
                else:
                    value_change = 0

                # Flip
                if curr['side'] != prev['side']:
                    changes.append({
                        'type': 'FLIPPED',
                        'address': addr_lower,
                        'whale': whale_info['name'],
                        'emoji': whale_info['emoji'],
                        'coin': coin,
                        'from': prev['side'],
                        'to': curr['side'],
                        'value': curr['position_value'],
                        'prev_value': prev['position_value']
                    })
                # Znacząca zmiana
                elif abs(value_change) > whale_info['min_change']:
                    changes.append({
                        'type': 'INCREASED' if value_change > 0 else 'REDUCED',
                        'address': addr_lower,
                        'whale': whale_info['name'],
                        'emoji': whale_info['emoji'],
                        'coin': coin,
                        'side': curr['side'],
                        'change_pct': value_change,
                        'value': curr['position_value'],
                        'prev_value': prev['position_value'],
                        'upnl': curr['unrealized_pnl']
                    })

    return changes

def format_change(change: dict) -> str:
    """Format change for Telegram"""
    emoji = change['emoji']
    whale = change['whale']
    coin = change['coin']

    if change['type'] == 'NEW':
        return f"{emoji} *{whale}* OPENED {change['side'].upper()} {coin}\n   Value: ${change['value']:,.0f} | uPnL: ${change['upnl']:,.0f}"
    elif change['type'] == 'CLOSED':
        return f"{emoji} *{whale}* CLOSED {change['side'].upper()} {coin}\n   Final Value: ${change['value']:,.0f}"
    elif change['type'] == 'FLIPPED':
        return f"{emoji} *{whale}* FLIPPED {coin}\n   {change['from']} → {change['to']} | Value: ${change['value']:,.0f}"
    elif change['type'] in ['INCREASED', 'REDUCED']:
        direction = "📈" if change['type'] == 'INCREASED' else "📉"
        return f"{emoji} *{whale}* {direction} {change['side'].upper()} {coin} by {abs(change['change_pct'])*100:.0f}%\n   Value: ${change['value']:,.0f} | uPnL: ${change['upnl']:,.0f}"
    return ""


def send_short_exit_alerts(changes: list, current: dict):
    """
    Dedykowany alarm na zamykanie/redukcję shortów przez SM.
    Wysyła osobną wiadomość priorytetową gdy SM zamyka shorty.
    Typy: CLOSED (short gone), REDUCED (short smaller), FLIPPED (short→long)
    """
    short_exits = []

    for c in changes:
        coin = c.get('coin', '')
        whale = c.get('whale', '')
        emoji = c.get('emoji', '')
        ctype = c.get('type', '')

        # CLOSED short
        if ctype == 'CLOSED' and c.get('side', '').lower() == 'short':
            closed_usd = c.get('prev_value', c.get('value', 0))
            short_exits.append({
                'whale': whale, 'emoji': emoji, 'coin': coin,
                'action': 'ZAMKNĄŁ SHORT',
                'closed_usd': closed_usd,
                'remaining_usd': 0,
                'pct_closed': 100.0
            })

        # REDUCED short (value went down = short getting smaller)
        elif ctype == 'REDUCED' and c.get('side', '').lower() == 'short':
            prev_val = c.get('prev_value', 0)
            curr_val = c.get('value', 0)
            closed_usd = prev_val - curr_val
            pct = abs(c.get('change_pct', 0)) * 100
            short_exits.append({
                'whale': whale, 'emoji': emoji, 'coin': coin,
                'action': f'REDUKUJE SHORT (-{pct:.0f}%)',
                'closed_usd': closed_usd,
                'remaining_usd': curr_val,
                'pct_closed': pct
            })

        # FLIPPED from short to long
        elif ctype == 'FLIPPED' and c.get('from', '').lower() == 'short':
            closed_usd = c.get('prev_value', 0)
            new_val = c.get('value', 0)
            short_exits.append({
                'whale': whale, 'emoji': emoji, 'coin': coin,
                'action': f'FLIP SHORT → LONG (${new_val:,.0f})',
                'closed_usd': closed_usd,
                'remaining_usd': 0,
                'pct_closed': 100.0
            })

    if not short_exits:
        return

    # Count remaining SM shorts per coin from current data
    sm_shorts_remaining = {}
    for address, whale_info in WHALES.items():
        if whale_info.get('tier') == 'MARKET_MAKER':
            continue
        if whale_info.get('signal_weight', 0) == 0:
            continue
        addr_lower = address.lower()
        positions = current.get(addr_lower, {}).get('positions', [])
        for p in positions:
            if p.get('coin') in TRACKED_COINS and p.get('side', '').lower() == 'short':
                coin = p['coin']
                if coin not in sm_shorts_remaining:
                    sm_shorts_remaining[coin] = {'count': 0, 'value': 0}
                sm_shorts_remaining[coin]['count'] += 1
                sm_shorts_remaining[coin]['value'] += p.get('position_value', 0)

    # Build alert message
    msg = "🚨 *SHORT EXIT ALERT* 🚨\n\n"

    for se in short_exits:
        coin = se['coin']
        remaining = sm_shorts_remaining.get(coin, {'count': 0, 'value': 0})

        msg += f"{se['emoji']} *{se['whale']}* {se['action']} {coin}\n"
        msg += f"   Zamknięte: ${se['closed_usd']:,.0f}"
        if se['remaining_usd'] > 0:
            msg += f" | Zostaje: ${se['remaining_usd']:,.0f}"
        msg += "\n"
        msg += f"   SM SHORT jeszcze: {remaining['count']} traderów, ${remaining['value']:,.0f}\n\n"

    total_closed = sum(se['closed_usd'] for se in short_exits)
    msg += f"💰 *Łącznie zamknięte shorty: ${total_closed:,.0f}*"

    # Check if this is a mass exit (3+ traders or >$1M closed)
    unique_whales = len(set(se['whale'] for se in short_exits))
    if unique_whales >= 3 or total_closed >= 1_000_000:
        msg += f"\n\n⚠️ *MASS SHORT EXIT* — {unique_whales} traderów zamyka ${total_closed:,.0f}!"

    send_telegram(msg)
    print(f"[SHORT EXIT ALERT] {len(short_exits)} exits, ${total_closed:,.0f} closed")

    # Append to cumulative log for analysis & daily reports
    _append_short_exit_log(short_exits, sm_shorts_remaining, total_closed)


def _append_short_exit_log(short_exits: list, sm_shorts_remaining: dict, total_closed: float):
    """Append SHORT EXIT events to cumulative log file for daily reports and on-demand analysis."""
    from datetime import datetime
    now = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

    # Load existing log
    try:
        with open(SHORT_EXIT_LOG_FILE, 'r') as f:
            log = json.load(f)
    except:
        log = []

    entry = {
        'timestamp': now,
        'total_closed_usd': total_closed,
        'exits': [],
        'sm_shorts_snapshot': {}
    }

    for se in short_exits:
        coin = se['coin']
        remaining = sm_shorts_remaining.get(coin, {'count': 0, 'value': 0})
        entry['exits'].append({
            'whale': se['whale'],
            'coin': coin,
            'action': se['action'],
            'closed_usd': se['closed_usd'],
            'remaining_usd': se['remaining_usd'],
            'pct_closed': se['pct_closed'],
            'sm_remaining_count': remaining['count'],
            'sm_remaining_value': remaining['value']
        })

    # Snapshot of total SM shorts per coin at this moment
    for coin, data in sm_shorts_remaining.items():
        entry['sm_shorts_snapshot'][coin] = {
            'count': data['count'],
            'value_usd': data['value']
        }

    log.append(entry)

    # Keep last 30 days (max ~3000 entries at 4/hour)
    if len(log) > 3000:
        log = log[-3000:]

    with open(SHORT_EXIT_LOG_FILE, 'w') as f:
        json.dump(log, f, indent=2)

    print(f"[SHORT EXIT LOG] Appended to {SHORT_EXIT_LOG_FILE} ({len(log)} entries total)")


# ============================================================
# AGGREGATION FOR BOT
# ============================================================

def aggregate_sm_positions(all_data: dict) -> dict:
    """
    Agreguj pozycje SM dla każdego coina Z WAŻENIEM przez:
    - signal_weight (size factor) - jak duża jest pozycja
    - credibility_multiplier (skill factor) - czy jest Nansen verified

    Final weight = signal_weight × credibility_multiplier

    KLUCZOWY INSIGHT:
    - Whale z $64M pozycją ale BEZ Nansen labela = weight 0.95 × 0.30 = 0.285
    - Smart Money z $68M pozycją i Nansen labelem = weight 1.0 × 1.0 = 1.0

    To sprawia że VERIFIED Smart Money ma ~3.5x większy wpływ niż nieweryfikowane Whales!
    """
    aggregated = {coin: {'longs': 0, 'shorts': 0, 'longs_upnl': 0, 'shorts_upnl': 0,
                         'longs_count': 0, 'shorts_count': 0} for coin in TRACKED_COINS}

    # Load activity for dormant decay
    activity = load_activity()
    now_epoch = int(time.time())

    for address, data in all_data.items():
        # Pobierz info dla tego adresu
        whale_info = WHALES.get(address.lower(), {})

        # Size factor (0-1): jak duża/ważna jest pozycja
        signal_weight = whale_info.get('signal_weight', 0.5)

        # Skill factor (0-1): czy jest Nansen verified
        nansen_label = whale_info.get('nansen_label', 'Unknown')
        credibility = CREDIBILITY_MULTIPLIERS.get(nansen_label, 0.2)  # Default to Unknown

        # PnL-aware dormant decay: diamond hands (profitable hold) vs stale losers
        days_since_change = (now_epoch - activity.get(address.lower(), now_epoch)) / 86400
        addr_total_upnl = sum(p.get('unrealized_pnl', 0) for p in data.get('positions', []))

        if days_since_change > 7 and addr_total_upnl > 0:
            # 💎 Diamond Hands: holding profitable positions = conviction, not dormancy
            dormant_factor = 1.0
            if days_since_change > 14:
                name = whale_info.get('name', address[:10])
                print(f"  💎 [DIAMOND_HANDS] {name}: {days_since_change:.0f}d holding, +${addr_total_upnl:,.0f} uPnL → full weight")
        elif days_since_change > 21:
            dormant_factor = 0.10   # Stale loser — almost ignored
        elif days_since_change > 14:
            dormant_factor = 0.25
        elif days_since_change > 7:
            dormant_factor = 0.50
        else:
            dormant_factor = 1.0    # Active — full weight

        # Final weight = size × credibility × dormant_factor
        final_weight = signal_weight * credibility * dormant_factor

        if dormant_factor < 1.0:
            name = whale_info.get('name', address[:10])
            print(f"  💤 [DORMANT] {name}: {days_since_change:.0f}d inactive, ${addr_total_upnl:,.0f} uPnL → weight ×{dormant_factor}")

        # Market makers (credibility=0) są ignorowane
        if final_weight == 0:
            continue

        for pos in data.get('positions', []):
            coin = pos['coin']
            if coin not in aggregated:
                continue

            # WAŻENIE pozycji przez final_weight (size × credibility)
            value = pos['position_value'] * final_weight
            upnl = pos['unrealized_pnl'] * final_weight

            if pos['side'] == 'Long':
                aggregated[coin]['longs'] += value
                aggregated[coin]['longs_upnl'] += upnl
                aggregated[coin]['longs_count'] += 1
            else:
                aggregated[coin]['shorts'] += value
                aggregated[coin]['shorts_upnl'] += upnl
                aggregated[coin]['shorts_count'] += 1

    return aggregated

def calculate_bias(longs: float, shorts: float) -> float:
    """Oblicz bias (0-1, gdzie 0.5 = neutral)"""
    total = longs + shorts
    if total == 0:
        return 0.5
    return longs / total

def generate_bot_data(aggregated: dict, history: list = None, hourly_history: list = None) -> tuple:
    """Generuj pliki dla bota MM z uwzględnieniem trendów i 24h zmian dla bottom detection"""
    timestamp = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

    # smart_money_data.json
    sm_data = {
        "timestamp": timestamp,
        "source": "whale_tracker_live",
        "data": {}
    }

    # nansen_bias.json
    bias_data = {}

    # CONTRARIAN SQUEEZE TRACKING: Load state at start
    contrarian_state = load_contrarian_state()

    for coin, data in aggregated.items():
        longs = data['longs']
        shorts = data['shorts']
        bias = calculate_bias(longs, shorts)
        flow = longs - shorts

        # Calculate trend if history available
        trend_info = calculate_trend(coin, history) if history else {
            'trend': 'unknown', 'momentum': 0, 'velocity': 0, 'flow_change': 0
        }

        # Determine base signal
        # Thresholds: bullish >= 0.60 (1.5:1 long), bearish <= 0.40 (1.5:1 short)
        if bias >= 0.60:
            signal = "bullish"
            direction = "long"
            bias_strength = "strong" if bias >= 0.75 else "moderate"
            base_boost = 1.5 + (bias - 0.6) * 2.5
        elif bias <= 0.40:
            signal = "bearish"
            direction = "short"
            bias_strength = "strong" if bias <= 0.25 else "moderate"
            base_boost = 0.5 - (0.4 - bias) * 1.25
        else:
            signal = "neutral"
            direction = "neutral"
            bias_strength = "soft"
            base_boost = 1.0

        # TREND ADJUSTMENT: Boost confidence when trend aligns with position
        trend_adjustment = 1.0
        trend = trend_info.get('trend', 'unknown')
        trend_strength = trend_info.get('trend_strength', 'weak')

        if trend != 'unknown' and trend != 'stable':
            # Position is SHORT and trend is increasing_shorts = HIGH confidence
            if direction == "short" and trend == "increasing_shorts":
                if trend_strength == "strong":
                    trend_adjustment = 1.3  # 30% boost for strong aligned trend
                elif trend_strength == "moderate":
                    trend_adjustment = 1.15  # 15% boost

            # Position is LONG and trend is increasing_longs = HIGH confidence
            elif direction == "long" and trend == "increasing_longs":
                if trend_strength == "strong":
                    trend_adjustment = 1.3
                elif trend_strength == "moderate":
                    trend_adjustment = 1.15

            # Position opposes trend = LOWER confidence (be careful!)
            elif direction == "short" and trend == "increasing_longs":
                if trend_strength == "strong":
                    trend_adjustment = 0.7  # 30% reduction
                elif trend_strength == "moderate":
                    trend_adjustment = 0.85

            elif direction == "long" and trend == "increasing_shorts":
                if trend_strength == "strong":
                    trend_adjustment = 0.7
                elif trend_strength == "moderate":
                    trend_adjustment = 0.85

        # Apply trend adjustment to boost
        adjusted_boost = base_boost * trend_adjustment

        # Calculate 24h changes for bottom detection
        changes_24h = calculate_24h_changes(coin, hourly_history) if hourly_history else {
            'longs_count_change': 0, 'shorts_count_change': 0,
            'longs_upnl_change': 0, 'shorts_upnl_change': 0,
            'new_long_positions': 0, 'closed_short_positions': 0,
            'longs_usd_change': 0, 'shorts_usd_change': 0
        }

        # Get current position counts from hourly history
        current_counts = {'longs_count': 0, 'shorts_count': 0}
        if hourly_history and len(hourly_history) > 0:
            current_hour = hourly_history[-1]
            coin_data = current_hour.get('data', {}).get(coin, {})
            current_counts['longs_count'] = coin_data.get('longs_count', 0)
            current_counts['shorts_count'] = coin_data.get('shorts_count', 0)

        # First, do a preliminary mode check (without timeout) to get expected mode
        # We need this to calculate squeeze duration BEFORE calling full determine_trading_mode()
        preliminary_mode = None
        if shorts != 0 and longs != 0:
            ratio = shorts / longs
            if ratio > MODE_THRESHOLDS["SHORT_DOMINANT_RATIO"] and data['shorts_upnl'] <= 0:
                preliminary_mode = "CONTRARIAN_LONG"
            elif ratio < MODE_THRESHOLDS["LONG_DOMINANT_RATIO"] and data['longs_upnl'] <= 0:
                preliminary_mode = "CONTRARIAN_SHORT"
        elif shorts > 0 and longs == 0:
            if data['shorts_upnl'] <= 0:
                preliminary_mode = "CONTRARIAN_LONG"

        # Get squeeze duration for this token (if in CONTRARIAN mode)
        squeeze_duration = 0.0
        if preliminary_mode and preliminary_mode.startswith('CONTRARIAN'):
            squeeze_duration = get_squeeze_duration_hours(coin, preliminary_mode, contrarian_state)

        # First, determine trading mode (need it for both sm_data and bias_data)
        # Pass momentum data for "Stale PnL" protection + squeeze timeout + divergence detection
        trading_mode_result = determine_trading_mode(
            weighted_longs=longs,
            weighted_shorts=shorts,
            longs_upnl=data['longs_upnl'],
            shorts_upnl=data['shorts_upnl'],
            # Momentum params for Stale PnL protection
            shorts_upnl_change_24h=changes_24h['shorts_upnl_change'],
            longs_upnl_change_24h=changes_24h['longs_upnl_change'],
            velocity=trend_info.get('velocity', 0),
            # Squeeze timeout protection
            squeeze_duration_hours=squeeze_duration,
            # Divergence detection
            trend=trend
        )

        # Update contrarian state tracking (start/clear timestamps)
        contrarian_state = update_contrarian_state(coin, trading_mode_result["mode"], contrarian_state)

        sm_data["data"][coin] = {
            "bias": round(bias, 2),
            "signal": signal,
            "flow": int(flow),
            "current_longs_usd": int(longs),
            "current_shorts_usd": int(shorts),
            "longs_upnl": int(data['longs_upnl']),
            "shorts_upnl": int(data['shorts_upnl']),
            "top_traders_pnl": "longs_winning" if data['longs_upnl'] > data['shorts_upnl'] else "shorts_winning",
            # Trend data (7d)
            "trend": trend,
            "trend_strength": trend_strength,
            "momentum": trend_info.get('momentum', 0),
            "velocity": trend_info.get('velocity', 0),
            "flow_change_7d": trend_info.get('flow_change', 0),
            # Position counts
            "longs_count": current_counts['longs_count'],
            "shorts_count": current_counts['shorts_count'],
            # 24h changes for bottom detection
            "longs_count_change_24h": changes_24h['longs_count_change'],
            "shorts_count_change_24h": changes_24h['shorts_count_change'],
            "longs_upnl_change_24h": changes_24h['longs_upnl_change'],
            "shorts_upnl_change_24h": changes_24h['shorts_upnl_change'],
            "longs_usd_change_24h": changes_24h['longs_usd_change'],
            "shorts_usd_change_24h": changes_24h['shorts_usd_change'],
            "new_long_positions_24h": changes_24h['new_long_positions'],
            "closed_short_positions_24h": changes_24h['closed_short_positions'],
            # Trading mode from determine_trading_mode()
            "trading_mode": trading_mode_result["mode"],
            "trading_mode_confidence": trading_mode_result["confidence"],
            "max_position_multiplier": trading_mode_result["maxPositionMultiplier"],
        }

        # Build bias_data entry (trading_mode_result already computed above)
        bias_entry = {
            "boost": round(max(0.05, min(2.0, adjusted_boost)), 2),
            "direction": direction,
            "biasStrength": bias_strength,
            "buySellPressure": int(flow),
            "updatedAt": timestamp,
            # Trend info
            "trend": trend,
            "trendStrength": trend_strength,
            "trendAdjustment": round(trend_adjustment, 2),
            # Trading Mode (from determine_trading_mode)
            "tradingMode": trading_mode_result["mode"],
            "tradingModeConfidence": trading_mode_result["confidence"],
            "tradingModeReason": trading_mode_result["reason"],
            "maxPositionMultiplier": trading_mode_result["maxPositionMultiplier"],
            # Diagnostic fields for transparency
            "positionRatio": trading_mode_result.get("positionRatio", 0),
            "pnlRatio": trading_mode_result.get("pnlRatio", 0),
            "longValueUsd": trading_mode_result.get("longValueUsd", 0),
            "shortValueUsd": trading_mode_result.get("shortValueUsd", 0),
            "longPnlUsd": trading_mode_result.get("longPnlUsd", 0),
            "shortPnlUsd": trading_mode_result.get("shortPnlUsd", 0),
        }

        # Add momentum warning if present (Stale PnL protection)
        if trading_mode_result.get("momentumWarning"):
            bias_entry["momentumWarning"] = trading_mode_result["momentumWarning"]

        # Add squeeze duration if present (CONTRARIAN timeout tracking)
        if trading_mode_result.get("squeezeDurationHours"):
            bias_entry["squeezeDurationHours"] = trading_mode_result["squeezeDurationHours"]

        # Add squeeze failed flag if present (timeout exceeded)
        if trading_mode_result.get("squeezeFailed"):
            bias_entry["squeezeFailed"] = True

        # Add divergence warning if present (perps vs spot divergence)
        if trading_mode_result.get("divergenceWarning"):
            bias_entry["divergenceWarning"] = trading_mode_result["divergenceWarning"]

        bias_data[coin] = bias_entry

    # Save contrarian state after processing all coins
    save_contrarian_state(contrarian_state)

    return sm_data, bias_data

# ============================================================
# MAIN FUNCTIONS
# ============================================================

def fetch_all_whales() -> dict:
    """Pobierz pozycje wszystkich wielorybów"""
    all_data = {}
    for address in WHALES.keys():
        data = get_hl_positions(address)
        all_data[address.lower()] = data
    return all_data

def run_tracker():
    """Główna funkcja - sprawdź zmiany i wyślij alerty"""
    print(f"[{datetime.now()}] Running whale tracker...")

    # Pobierz aktualne dane
    current = fetch_all_whales()

    # Załaduj poprzednie
    previous = load_cache()

    # Wykryj zmiany
    if previous:
        changes = detect_changes(current, previous)

        if changes:
            msg = "🐋 *WHALE ALERT*\n\n"
            for change in changes[:10]:  # Max 10 zmian
                msg += format_change(change) + "\n\n"

            send_telegram(msg)
            print(f"[ALERT] Sent {len(changes)} changes to Telegram")

            # Dedykowany alarm na zamykanie shortów
            send_short_exit_alerts(changes, current)
        else:
            print("[INFO] No significant changes detected")
    else:
        print("[INFO] First run - no previous data to compare")

    # Update activity tracker for dormant decay
    activity = load_activity()
    now_epoch = int(time.time())

    if previous:
        # Mark addresses with position changes as active
        for address in WHALES.keys():
            addr_lower = address.lower()
            curr_positions = current.get(addr_lower, {}).get('positions', [])
            prev_positions = previous.get(addr_lower, {}).get('positions', [])
            curr_map = {p['coin']: (p['side'], p['position_value']) for p in curr_positions}
            prev_map = {p['coin']: (p['side'], p['position_value']) for p in prev_positions}
            if curr_map != prev_map:
                activity[addr_lower] = now_epoch

    # Initialize unknown addresses with current time (first run)
    for address in WHALES.keys():
        addr_lower = address.lower()
        if addr_lower not in activity:
            activity[addr_lower] = now_epoch

    save_activity(activity)

    # Zapisz cache
    save_cache(current)
    update_freshness()

    # Generuj dane dla bota
    aggregated = aggregate_sm_positions(current)

    # Load history for trend analysis
    history = load_history()
    print(f"[INFO] Loaded {len(history)} days of history for trend analysis")

    # Save today's snapshot to history
    save_daily_snapshot(aggregated)

    # Save hourly snapshot for bottom detection (24h changes)
    hourly_history = save_hourly_snapshot(aggregated, current)
    print(f"[INFO] Saved hourly snapshot, {len(hourly_history)} hours in history")

    # Generate bot data with trend info and 24h changes
    sm_data, bias_data = generate_bot_data(aggregated, history, hourly_history)

    # Zapisz lokalnie
    with open(BOT_DATA_FILE, 'w') as f:
        json.dump(sm_data, f, indent=2)
    with open(BOT_BIAS_FILE, 'w') as f:
        json.dump(bias_data, f, indent=2)

    print(f"[INFO] Updated {BOT_DATA_FILE} and {BOT_BIAS_FILE}")

    # Log trend info for key coins
    for coin in ['LIT', 'SUI', 'DOGE']:
        coin_data = sm_data['data'].get(coin, {})
        trend = coin_data.get('trend', 'unknown')
        flow_change = coin_data.get('flow_change_7d', 0)
        if trend != 'unknown':
            print(f"[TREND] {coin}: {trend} (7d flow change: ${flow_change:+,.0f})")

    return current, aggregated

def get_whale_details(all_data: dict, coin: str) -> list:
    """Pobierz szczegóły pozycji whale'ów dla danego coina"""
    details = []
    for address, whale_info in WHALES.items():
        addr_lower = address.lower()
        data = all_data.get(addr_lower, {})
        for pos in data.get('positions', []):
            if pos['coin'] == coin:
                details.append({
                    'name': whale_info['name'],
                    'emoji': whale_info['emoji'],
                    'side': pos['side'],
                    'size': pos['size'],
                    'entry': pos['entry_price'],
                    'value': pos['position_value'],
                    'upnl': pos['unrealized_pnl'],
                    'liq': pos['liquidation_price']
                })
    return sorted(details, key=lambda x: x['value'], reverse=True)

def calculate_levels(whale_details: list, current_price: float, bias: float) -> dict:
    """
    Oblicz poziomy entry/TP/SL na podstawie pozycji whale'ów
    WYMAGANE: minimum R:R 1:3

    Logika:
    1. SL opieramy na liquidation prices whale'ów (tam jest support/resistance)
    2. Entry przy obecnej cenie lub lekkim pullback'u
    3. TP obliczany dynamicznie by dać min 1:3 R:R
    4. Jeśli 1:3 nie jest możliwe - odrzucamy setup
    """
    MIN_RR = 3.0  # Minimum Risk:Reward ratio

    if not whale_details or current_price == 0:
        return {}

    # Filtruj tylko pozycje zgodne z kierunkiem bias
    if bias >= 0.6:
        relevant = [w for w in whale_details if w['side'] == 'Long']
        direction = "LONG"
    elif bias <= 0.4:
        relevant = [w for w in whale_details if w['side'] == 'Short']
        direction = "SHORT"
    else:
        return {'direction': 'NEUTRAL', 'note': 'Wait for clearer signal'}

    if not relevant:
        return {'direction': 'NEUTRAL', 'note': 'No whale positions in this direction'}

    # Średnia ważona entry whale'ów (ważona wartością pozycji)
    total_value = sum(w['value'] for w in relevant)
    if total_value == 0:
        return {}

    weighted_entry = sum(w['entry'] * w['value'] for w in relevant) / total_value

    # Zbierz liquidation prices (wsparcie/opór)
    liq_prices = [w['liq'] for w in relevant if w['liq'] > 0]

    # Znajdź entry profitable whale'ów
    profitable = [w for w in relevant if w['upnl'] > 0]
    underwater = [w for w in relevant if w['upnl'] < 0]
    profitable_value = sum(w['value'] for w in profitable)
    confidence = profitable_value / total_value if total_value > 0 else 0

    if direction == "LONG":
        # === LONG SETUP ===

        # Entry: obecna cena lub lekki pullback (1-2%)
        entry = current_price * 0.99  # Wejście przy -1% dip

        # SL: Poniżej najniższego liq price whale'ów (to jest support!)
        # Lub jeśli brak liq prices, użyj ciasnego SL 2%
        if liq_prices:
            # Najniższy liq price longujących whale'ów = support
            lowest_liq = min(liq_prices)
            # SL tuż poniżej (1% marginesu)
            sl = lowest_liq * 0.99
            # Ale nie dalej niż 5% od entry
            sl = max(sl, entry * 0.95)
        else:
            # Brak danych liq, użyj ciasnego SL
            sl = entry * 0.98  # 2% SL

        # Risk = odległość od entry do SL
        risk = entry - sl
        risk_pct = risk / entry * 100

        # Wymagany reward dla min 1:3 R:R
        required_reward = risk * MIN_RR
        tp1 = entry + required_reward
        tp2 = entry + required_reward * 1.5  # TP2 = 1:4.5 R:R

        # Sprawdź czy TP jest realistyczny (max 15% od ceny)
        max_tp = entry * 1.151  # Small margin for floating point
        if tp1 > max_tp:
            # TP zbyt daleko - setup nierealistyczny
            req_move = (tp1 / entry - 1) * 100
            return {
                'direction': direction,
                'note': f'R:R 1:3 requires +{req_move:.0f}% move (max 15%)',
                'required_move_pct': req_move,
                'risk_pct': risk_pct,
                'rejected': True
            }

    else:  # SHORT
        # === SHORT SETUP ===

        # Entry: obecna cena lub lekki pump (1-2%)
        entry = current_price * 1.01  # Wejście przy +1% pump

        # SL: Powyżej najwyższego liq price whale'ów (to jest resistance!)
        if liq_prices:
            highest_liq = max(liq_prices)
            sl = highest_liq * 1.01
            sl = min(sl, entry * 1.05)  # Max 5% od entry
        else:
            sl = entry * 1.02  # 2% SL

        # Risk = odległość od entry do SL
        risk = sl - entry
        risk_pct = risk / entry * 100

        # Wymagany reward dla min 1:3 R:R
        required_reward = risk * MIN_RR
        tp1 = entry - required_reward
        tp2 = entry - required_reward * 1.5

        # Sprawdź czy TP jest realistyczny (max 15% od ceny)
        min_tp = entry * 0.849  # Small margin for floating point
        if tp1 < min_tp:
            req_move = (1 - tp1 / entry) * 100
            return {
                'direction': direction,
                'note': f'R:R 1:3 requires -{req_move:.0f}% move (max 15%)',
                'required_move_pct': req_move,
                'risk_pct': risk_pct,
                'rejected': True
            }

    # Oblicz finalny R:R
    actual_risk = abs(entry - sl)
    actual_reward = abs(tp1 - entry)
    rr = actual_reward / actual_risk if actual_risk > 0 else 0

    return {
        'direction': direction,
        'current': current_price,
        'entry': entry,
        'tp1': tp1,
        'tp2': tp2,
        'sl': sl,
        'rr': rr,
        'risk_pct': (actual_risk / entry) * 100,
        'reward_pct': (actual_reward / entry) * 100,
        'confidence': confidence,
        'whale_avg_entry': weighted_entry,
        'rejected': False
    }

def generate_report(aggregated: dict, all_data: dict = None) -> str:
    """Generuj kompletny Trading Manual"""
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M")

    # Pobierz aktualne ceny
    prices = get_all_mids()

    lines = [
        "🐋 *SMART MONEY TRADING MANUAL*",
        f"📅 {timestamp} CET",
        "",
        "=" * 35,
    ]

    # Sort by total value
    sorted_coins = sorted(
        aggregated.items(),
        key=lambda x: x[1]['longs'] + x[1]['shorts'],
        reverse=True
    )

    for coin, data in sorted_coins:
        longs = data['longs']
        shorts = data['shorts']
        total = longs + shorts

        if total < 100000:  # Skip small positions
            continue

        bias = calculate_bias(longs, shorts)
        current_price = float(prices.get(coin, 0))

        # Emoji i signal
        if bias >= 0.7:
            emoji = "🟢"
            signal = "BULLISH"
        elif bias <= 0.3:
            emoji = "🔴"
            signal = "BEARISH"
        else:
            emoji = "🟡"
            signal = "NEUTRAL"

        upnl_longs = data['longs_upnl']
        upnl_shorts = data['shorts_upnl']

        # Header
        lines.append("")
        lines.append(f"{emoji} *{coin}* - {signal} ({bias*100:.0f}% long)")
        lines.append(f"💰 Price: ${current_price:,.4f}" if current_price < 1 else f"💰 Price: ${current_price:,.2f}")

        # Pozycje SM
        lines.append(f"📊 L: ${longs/1e6:.1f}M ({'+' if upnl_longs >= 0 else ''}{upnl_longs/1e3:.0f}k)")
        lines.append(f"📊 S: ${shorts/1e6:.1f}M ({'+' if upnl_shorts >= 0 else ''}{upnl_shorts/1e3:.0f}k)")

        # Whale details
        if all_data:
            whale_details = get_whale_details(all_data, coin)
            levels = calculate_levels(whale_details, current_price, bias)

            if levels and levels.get('direction') not in ['NEUTRAL', None]:
                lines.append("")

                # Check if setup was rejected (R:R < 3)
                if levels.get('rejected'):
                    lines.append(f"⚠️ *{levels['direction']}* - No favorable R:R")
                    lines.append(f"   {levels.get('note', 'Setup rejected')}")
                else:
                    # Valid setup with min 1:3 R:R
                    rr = levels['rr']
                    rr_emoji = "🔥" if rr >= 4 else "✅" if rr >= 3 else "⚠️"

                    lines.append(f"🎯 *TRADE SETUP: {levels['direction']}* {rr_emoji}")

                    if current_price < 1:
                        lines.append(f"   Entry: ${levels['entry']:.4f}")
                        lines.append(f"   TP1: ${levels['tp1']:.4f} (+{levels['reward_pct']:.1f}%)")
                        lines.append(f"   TP2: ${levels['tp2']:.4f}")
                        lines.append(f"   SL: ${levels['sl']:.4f} (-{levels['risk_pct']:.1f}%)")
                    else:
                        lines.append(f"   Entry: ${levels['entry']:,.2f}")
                        lines.append(f"   TP1: ${levels['tp1']:,.2f} (+{levels['reward_pct']:.1f}%)")
                        lines.append(f"   TP2: ${levels['tp2']:,.2f}")
                        lines.append(f"   SL: ${levels['sl']:,.2f} (-{levels['risk_pct']:.1f}%)")

                    lines.append(f"   *R:R = 1:{rr:.1f}* ✓")

                    conf_emoji = "🟢" if levels['confidence'] > 0.5 else "🟡" if levels['confidence'] > 0.3 else "🔴"
                    lines.append(f"   {conf_emoji} Confidence: {levels['confidence']*100:.0f}%")

                    # Top whales
                    if whale_details[:2]:
                        lines.append("   👥 Top whales:")
                        for w in whale_details[:2]:
                            upnl_sign = "+" if w['upnl'] >= 0 else ""
                            lines.append(f"      {w['emoji']} {w['name'][:15]}: {w['side']} ${w['value']/1e6:.1f}M ({upnl_sign}{w['upnl']/1e3:.0f}k)")

            elif levels.get('direction') == 'NEUTRAL':
                lines.append("⏳ *Wait for clearer signal*")

        lines.append("-" * 35)

    # Summary
    total_longs = sum(d['longs'] for d in aggregated.values())
    total_shorts = sum(d['shorts'] for d in aggregated.values())
    overall_bias = calculate_bias(total_longs, total_shorts)

    lines.extend([
        "",
        "📈 *MARKET SUMMARY:*",
        f"Total SM Longs: ${total_longs/1e6:.0f}M",
        f"Total SM Shorts: ${total_shorts/1e6:.0f}M",
        f"Overall Bias: {overall_bias*100:.0f}% long",
        "",
        "⚠️ *RISK NOTES:*",
    ])

    # Risk warnings
    for coin, data in sorted_coins:
        if data['longs_upnl'] < -1000000:
            lines.append(f"🚨 {coin} longs underwater ${abs(data['longs_upnl'])/1e6:.1f}M")
        if data['shorts_upnl'] < -1000000:
            lines.append(f"🚨 {coin} shorts underwater ${abs(data['shorts_upnl'])/1e6:.1f}M")

    lines.append("")
    lines.append("_Whale Tracker by Claude Code_")

    return "\n".join(lines)

def run_report():
    """Generuj i wyślij raport"""
    print(f"[{datetime.now()}] Generating report...")

    current = fetch_all_whales()
    aggregated = aggregate_sm_positions(current)

    report = generate_report(aggregated, current)
    success = send_telegram(report)

    if success:
        print("[INFO] Report sent to Telegram")
    else:
        print("[ERROR] Failed to send report")

    # Aktualizuj dane
    save_cache(current)
    update_freshness()

    sm_data, bias_data = generate_bot_data(aggregated)
    with open(BOT_DATA_FILE, 'w') as f:
        json.dump(sm_data, f, indent=2)
    with open(BOT_BIAS_FILE, 'w') as f:
        json.dump(bias_data, f, indent=2)

def run_test():
    """Test połączenia"""
    print("Testing Hyperliquid API...")

    for address, info in list(WHALES.items())[:3]:
        data = get_hl_positions(address)
        print(f"\n{info['emoji']} {info['name']}:")
        print(f"   Account Value: ${data['account_value']:,.0f}")
        for pos in data['positions'][:3]:
            print(f"   {pos['coin']:8} {pos['side']:5} ${pos['position_value']:,.0f} | uPnL: ${pos['unrealized_pnl']:,.0f}")

    print("\nTest complete!")

# ============================================================
# CLI
# ============================================================

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Whale Tracker for Hyperliquid")
    parser.add_argument("--report", action="store_true", help="Generate and send full report")
    parser.add_argument("--test", action="store_true", help="Test API connection")
    parser.add_argument("--upload", action="store_true", help="Upload data to bot server")
    args = parser.parse_args()

    if args.test:
        run_test()
    elif args.report:
        run_report()
    elif args.upload:
        run_tracker()
        # Upload to server
        import subprocess
        subprocess.run(["scp", str(BOT_DATA_FILE), "bot-server:/tmp/smart_money_data.json"])
        subprocess.run(["scp", str(BOT_BIAS_FILE), "bot-server:/home/jerry/hyperliquid-mm-bot-complete/runtime/nansen_bias.json"])
        print("[INFO] Uploaded to bot-server")
    else:
        run_tracker()
