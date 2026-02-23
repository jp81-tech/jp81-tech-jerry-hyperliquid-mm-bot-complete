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
    "0xb317d2": "Smart HL Perps Trader",  # Bitcoin OG - $717M ETH, $92M BTC LONG
    "0xbaae15": "Smart HL Perps Trader",  # $4.7M FARTCOIN SHORT
    "0xa31211": "Smart HL Perps Trader",  # $7.4M LIT SHORT, $2M DOGE SHORT
    "0x35d115": "Smart HL Perps Trader",  # $64.4M SOL SHORT - MEGA SHORTER!
    "0x45d26f": "Smart HL Perps Trader",  # $40.5M BTC SHORT, $28.9M ETH SHORT
    "0x5d2f44": "Smart HL Perps Trader",  # $46.3M BTC SHORT
    "0x71dfc0": "Smart HL Perps Trader",  # $25.4M BTC SHORT
    "0x06cecf": "Smart HL Perps Trader",  # $11.8M SOL SHORT
    "0x6bea81": "Smart HL Perps Trader",  # $8.1M SOL SHORT
    "0x936cf4": "Smart HL Perps Trader",  # $6.6M SOL SHORT
    "0x56cd86": "Smart HL Perps Trader",  # $3.9M SOL SHORT - Token Millionaire
    "0xd7a678": "Smart HL Perps Trader",  # $3.7M SOL SHORT - Consistent Perps Winner
    "0x519c72": "Smart HL Perps Trader",  # $6.2M ZEC LONG

    # === ACTIVE SM TRADERS ===
    "0x9eec98": "Smart HL Perps Trader",  # $182.8M ETH LONG
    "0xfeec88": "Smart HL Perps Trader",  # $22.6M BTC SHORT
    "0xfce053": "Smart HL Perps Trader",  # $21.7M BTC SHORT
    "0x99b109": "Smart HL Perps Trader",  # $34.3M BTC SHORT
    "0xea6670": "Smart HL Perps Trader",  # $9.1M BTC SHORT
    "0x3c363e": "Smart HL Perps Trader",  # $1.9M ETH SHORT
    "0x2ed5c4": "Smart HL Perps Trader",  # ASTER trader
    "0x689f15": "Smart HL Perps Trader",  # BTC trader
    "0x92e977": "Smart HL Perps Trader",  # BTC/LIT trader
    "0x1e771e": "Smart HL Perps Trader",  # DOGE/ETH shorter
    "0xa2acb1": "Smart HL Perps Trader",  # Hikari - $5.6M BTC LONG
    "0x8a0cd1": "Smart HL Perps Trader",  # $1.6M BTC SHORT
    "0x091159": "Smart HL Perps Trader",  # LIT trader
    "0x0b2396": "Smart HL Perps Trader",  # DOGE trader

    # === FUNDS ===
    "0xcac196": "Fund",  # Galaxy Digital
    "0x7fdafd": "Fund",  # Fasanara Capital
    "0x023a3d": "Fund",  # Auros Global
    "0xecb63c": "Fund",  # Wintermute
    "0x5b5d51": "Fund",  # Abraxas Capital
    "0x8def9f": "All Time Smart Trader",  # Laurent Zeimes
    "0x418aa6": "Smart HL Perps Trader",  # 58bro.eth
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
        "emoji": "🐋",
        "tier": "CONVICTION",
        "signal_weight": 1.0,
        "nansen_label": "Smart HL Perps Trader",  # VERIFIED - full credibility
        "min_change": 0.05,
        "notes": "$717M ETH LONG, $92M BTC LONG, $68M SOL LONG. +$4.5M uPnL on ETH"
    },

    # === NANSEN VERIFIED Smart HL Perps Traders (2026-01-19) ===
    "0xbaae15f6ffe2aa6e0e9ffde6f1888c8092f4b22a": {
        "name": "SM HL Trader baae15",
        "emoji": "🤓",
        "tier": "CONVICTION",
        "signal_weight": 0.95,
        "nansen_label": "Smart HL Perps Trader",  # VERIFIED
        "min_change": 0.05,
        "notes": "Nansen Smart HL Perps Trader - BTC/PUMP LONG, FARTCOIN SHORT, $9M+ trades"
    },
    "0x2ed5c47a79c27c75188af495a8093c22ada4f6e7": {
        "name": "SM HL Trader 2ed5c4",
        "emoji": "🤓",
        "tier": "CONVICTION",
        "signal_weight": 0.85,
        "nansen_label": "Smart HL Perps Trader",  # VERIFIED
        "min_change": 0.08,
        "notes": "Nansen Smart HL Perps Trader - ASTER LONG $3.8M"
    },
    "0x689f15c9047f73c974e08c70f12a5d6a19f45c15": {
        "name": "SM HL Trader 689f15",
        "emoji": "🤓",
        "tier": "CONVICTION",
        "signal_weight": 0.85,
        "nansen_label": "Smart HL Perps Trader",  # VERIFIED
        "min_change": 0.08,
        "notes": "Nansen Smart HL Perps Trader - BTC LONG $3.2M"
    },
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
        "notes": "Main LIT/DOGE shorter. $7.4M LIT SHORT (+$3.4M), $2M DOGE SHORT (+$291k)"
    },
    "0x35d1151ef1aab579cbb3109e69fa82f94ff5acb1": {
        "name": "Major",
        "emoji": "🤓",
        "tier": "CONVICTION",
        "signal_weight": 0.95,
        "nansen_label": "Smart HL Perps Trader",  # VERIFIED by Nansen 2026-01-19!
        "min_change": 0.05,
        "notes": "$64.3M SOL SHORT (+$8.7M uPnL) - Nansen verified Smart HL Perps Trader"
    },
    "0x5d2f4460ac3514ada79f5d9838916e508ab39bb7": {
        "name": "Pułkownik",
        "emoji": "🔴",
        "tier": "CONVICTION",
        "signal_weight": 0.95,
        "nansen_label": "Smart HL Perps Trader",  # VERIFIED - mega BTC winner
        "min_change": 0.05,
        "notes": "$46.3M BTC SHORT (+$19.4M uPnL!) - MEGA winner on BTC"
    },
    "0x45d26f28196d226497130c4bac709d808fed4029": {
        "name": "Wice-Generał",
        "emoji": "🔴",
        "tier": "CONVICTION",
        "signal_weight": 0.9,
        "nansen_label": "Smart HL Perps Trader",  # VERIFIED
        "min_change": 0.05,
        "notes": "$40.5M BTC SHORT (+$6.4M), $28.9M ETH SHORT, $514k SUI SHORT (+$864k)"
    },
    "0x06cecfbac34101ae41c88ebc2450f8602b3d164b": {
        "name": "Kraken A",
        "emoji": "🤓",
        "tier": "CONVICTION",
        "signal_weight": 0.85,
        "nansen_label": "Smart HL Perps Trader",  # VERIFIED by Nansen 2026-01-19!
        "min_change": 0.05,
        "notes": "$11.8M SOL SHORT (+$3.5M uPnL) - Nansen verified Smart HL Perps Trader"
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
        "notes": "$25.4M BTC SHORT (+$4.9M), $19.8M ETH SHORT, $2.1M ZEC SHORT (+$861k)"
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
        "notes": "$34.5M BTC SHORT (+$5.9M), $20.9M ETH SHORT (+$6.5M), $534k SOL SHORT"
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

    # ================================================================
    # 🟡 TIER 3: ACTIVE TRADERS (signal_weight: 0.5-0.7)
    # ================================================================

    "0x9eec98d048d06d9cd75318fffa3f3960e081daab": {
        "name": "ETH Whale",
        "emoji": "🟢",
        "tier": "ACTIVE",
        "signal_weight": 0.85,  # UPGRADED - $182.8M ETH LONG is massive
        "nansen_label": "Smart HL Perps Trader",  # VERIFIED by Nansen 2026-01-19!
        "min_change": 0.08,
        "notes": "$182.8M ETH LONG - Nansen verified Smart HL Perps Trader"
    },
    "0xfeec88b13fc0be31695069f02bac18538a154e9c": {
        "name": "Kapitan feec",
        "emoji": "🔴",
        "tier": "ACTIVE",
        "signal_weight": 0.80,
        "nansen_label": "Smart HL Perps Trader",  # VERIFIED by Nansen 2026-01-19!
        "min_change": 0.08,
        "notes": "$22.6M BTC SHORT (+$4M) - Nansen verified Smart HL Perps Trader"
    },
    "0xfce053a5e461683454bf37ad66d20344c0e3f4c0": {
        "name": "Kapitan fce0",
        "emoji": "🔴",
        "tier": "ACTIVE",
        "signal_weight": 0.80,
        "nansen_label": "Smart HL Perps Trader",  # VERIFIED by Nansen 2026-01-19!
        "min_change": 0.08,
        "notes": "$21.7M BTC SHORT - Nansen verified Smart HL Perps Trader"
    },
    "0x99b1098d9d50aa076f78bd26ab22e6abd3710729": {
        "name": "Kapitan 99b1",
        "emoji": "🔴",
        "tier": "ACTIVE",
        "signal_weight": 0.80,
        "nansen_label": "Smart HL Perps Trader",  # VERIFIED by Nansen 2026-01-19!
        "min_change": 0.08,
        "notes": "$34.3M BTC SHORT - Nansen verified Smart HL Perps Trader"
    },
    "0xc7290b4b308431a985fa9e3e8a335c2f7650517c": {
        "name": "SM Active c7290b",
        "emoji": "🔴",
        "tier": "ACTIVE",
        "signal_weight": 0.65,
        "min_change": 0.10,
        "notes": "$11.2M BTC SHORT, $7.3M ETH SHORT, $183k ZEC SHORT"
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
        "name": "SM Active 570b09",
        "emoji": "🔴",
        "tier": "ACTIVE",
        "signal_weight": 0.6,
        "min_change": 0.10,
        "notes": "$2.6M SOL SHORT, $2.6M BTC SHORT, $1.2M ETH SHORT"
    },
    "0x56cd86d6ef24a3f51ce6992b7f1db751b0a0276a": {
        "name": "Kraken B",
        "emoji": "🤓",
        "tier": "CONVICTION",
        "signal_weight": 0.85,
        "nansen_label": "Smart HL Perps Trader",  # VERIFIED by Nansen 2026-01-19! Token Millionaire, Smart HL Perps Trader
        "min_change": 0.08,
        "notes": "$3.9M SOL SHORT (+$618k uPnL) - Nansen verified!"
    },
    "0xd7a678fcf72c1b602850ef2f3e2d668ec41fa0ed": {
        "name": "Winner d7a678",
        "emoji": "🤓",
        "tier": "CONVICTION",
        "signal_weight": 0.85,
        "nansen_label": "Smart HL Perps Trader",  # VERIFIED by Nansen 2026-01-19! Smart HL Perps Trader, Consistent Perps Winner
        "min_change": 0.08,
        "notes": "$3.7M SOL SHORT (+$1.1M uPnL), closest to liq $176.70 - Nansen verified!"
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
    "0xe2823659be02e0f48a4660e4da008b5e1abfdf29": {
        "name": "SM Active e28236",
        "emoji": "🟢",
        "tier": "ACTIVE",
        "signal_weight": 0.6,
        "min_change": 0.15,
        "notes": "$1.1M ZEC LONG (+$79k), $1.6M ETH LONG"
    },
    "0x039405fa4636364e6023df1e06b085a462b9cdc9": {
        "name": "SM Active 039405",
        "emoji": "🔴",
        "tier": "ACTIVE",
        "signal_weight": 0.65,
        "min_change": 0.15,
        "notes": "$293k LIT SHORT (+$118k)"
    },
    "0xa2acb1c1d689fd3785696277537a504fcea8d1d0": {
        "name": "Hikari",
        "emoji": "🟢",
        "tier": "CONVICTION",
        "signal_weight": 0.75,
        "nansen_label": "Smart HL Perps Trader",  # VERIFIED by Nansen
        "min_change": 0.10,
        "notes": "$5.6M BTC LONG - Nansen Smart HL Perps Trader"
    },
    "0x179c17d04be626561b0355a248d6055a80456aa5": {
        "name": "SM Active 179c17",
        "emoji": "🔴",
        "tier": "ACTIVE",
        "signal_weight": 0.6,
        "min_change": 0.10,
        "notes": "$3.1M SOL SHORT"
    },
    "0xbe494a5e3a719a78a45a47ab453b7b0199d9d101": {
        "name": "SM Active be494a",
        "emoji": "🔴",
        "tier": "ACTIVE",
        "signal_weight": 0.6,
        "min_change": 0.10,
        "notes": "$2.8M SOL SHORT"
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
    "0x95e2687b07f0dec34462fdab6bbebcc0b3ab49c6": {
        "name": "SM Active 95e268",
        "emoji": "🔴",
        "tier": "ACTIVE",
        "signal_weight": 0.5,
        "min_change": 0.15,
        "notes": "$924k SOL SHORT"
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
    "0x106943709714fb0e5e62b82f5013ebc762591ae1": {
        "name": "SM Active 106943",
        "emoji": "🔴",
        "tier": "ACTIVE",
        "signal_weight": 0.5,
        "min_change": 0.15,
        "notes": "$622k SOL SHORT"
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
        "signal_weight": 0.55,
        "min_change": 0.15,
        "notes": "$2.4M BTC SHORT"
    },
    "0xe82bc65677e46b6626a8e779ac263221db039c2d": {
        "name": "SM Active e82bc6",
        "emoji": "🔴",
        "tier": "ACTIVE",
        "signal_weight": 0.55,
        "min_change": 0.15,
        "notes": "$2.4M BTC SHORT"
    },
    "0xb12f7415705d9d1cee194e73ca0f8aaffb8b77cd": {
        "name": "fuckingbot.eth",
        "emoji": "🔴",
        "tier": "ACTIVE",
        "signal_weight": 0.5,
        "min_change": 0.15,
        "notes": "$2M BTC SHORT"
    },
    "0x84abc08c0ea62e687c370154de1f38ea462f4d37": {
        "name": "SM Active 84abc0",
        "emoji": "🔴",
        "tier": "ACTIVE",
        "signal_weight": 0.5,
        "min_change": 0.15,
        "notes": "$4.3M ETH SHORT"
    },
    "0xc12f6e6f7a11604871786db86abf33fdf36fb0ad": {
        "name": "SM Active c12f6e",
        "emoji": "🔴",
        "tier": "ACTIVE",
        "signal_weight": 0.5,
        "min_change": 0.15,
        "notes": "$2.5M ETH SHORT"
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
    "0x8a0cd16a004e21e04936a0a01c6f5a49ff937914": {
        "name": "SM HL Trader 8a0cd1",
        "emoji": "🤓",
        "tier": "CONVICTION",
        "signal_weight": 0.75,
        "nansen_label": "Smart HL Perps Trader",  # VERIFIED by Nansen
        "min_change": 0.10,
        "notes": "$1.6M BTC SHORT - Nansen Smart HL Perps Trader"
    },

    # ================================================================
    # ❌ TIER 4: MARKET MAKERS (signal_weight: 0.0 - IGNORE!)
    # These flip constantly and should NOT influence bias calculations
    # ================================================================

    "0x091144e651b334341eabdbbbfed644ad0100023e": {
        "name": "Manifold Trading",
        "emoji": "📊",
        "tier": "MARKET_MAKER",
        "signal_weight": 0.0,
        "min_change": 0.50,
        "notes": "IGNORE - Market maker, frequent flips"
    },

    # ================================================================
    # 📋 LEGACY ADDRESSES (keep for backwards compatibility)
    # ================================================================

    "0x091159a8106b077c13e89bc09701117e8b5f129a": {
        "name": "SM HL Trader 091159",
        "emoji": "🤓",
        "tier": "CONVICTION",
        "signal_weight": 0.75,
        "nansen_label": "Smart HL Perps Trader",  # VERIFIED by Nansen
        "min_change": 0.10,
        "notes": "Nansen Smart HL Perps Trader - LIT trader"
    },
    "0x6f9bb7e454f5b3eb2310343f0e99269dc2bb8a1d": {
        "name": "Arrington XRP Legacy",
        "emoji": "💼",
        "tier": "FUND",
        "signal_weight": 0.6,
        "min_change": 0.15,
        "notes": "Legacy - Fund"
    },
    "0x0b23968e02c549f99ff77b6471be3a78cbfff37b": {
        "name": "SM HL Trader 0b2396",
        "emoji": "🤓",
        "tier": "CONVICTION",
        "signal_weight": 0.70,
        "nansen_label": "Smart HL Perps Trader",  # VERIFIED by Nansen
        "min_change": 0.10,
        "notes": "Nansen Smart HL Perps Trader - DOGE trader"
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
                    'whale': whale_info['name'],
                    'emoji': whale_info['emoji'],
                    'coin': coin,
                    'side': curr['side'],
                    'value': curr['position_value'],
                    'upnl': curr['unrealized_pnl']
                })

            # Zamknięta pozycja
            elif prev and not curr:
                changes.append({
                    'type': 'CLOSED',
                    'whale': whale_info['name'],
                    'emoji': whale_info['emoji'],
                    'coin': coin,
                    'side': prev['side'],
                    'value': prev['position_value']
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
                        'whale': whale_info['name'],
                        'emoji': whale_info['emoji'],
                        'coin': coin,
                        'from': prev['side'],
                        'to': curr['side'],
                        'value': curr['position_value']
                    })
                # Znacząca zmiana
                elif abs(value_change) > whale_info['min_change']:
                    changes.append({
                        'type': 'INCREASED' if value_change > 0 else 'REDUCED',
                        'whale': whale_info['name'],
                        'emoji': whale_info['emoji'],
                        'coin': coin,
                        'side': curr['side'],
                        'change_pct': value_change,
                        'value': curr['position_value'],
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

    for address, data in all_data.items():
        # Pobierz info dla tego adresu
        whale_info = WHALES.get(address.lower(), {})

        # Size factor (0-1): jak duża/ważna jest pozycja
        signal_weight = whale_info.get('signal_weight', 0.5)

        # Skill factor (0-1): czy jest Nansen verified
        nansen_label = whale_info.get('nansen_label', 'Unknown')
        credibility = CREDIBILITY_MULTIPLIERS.get(nansen_label, 0.2)  # Default to Unknown

        # Final weight = size × credibility
        final_weight = signal_weight * credibility

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
        else:
            print("[INFO] No significant changes detected")
    else:
        print("[INFO] First run - no previous data to compare")

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
