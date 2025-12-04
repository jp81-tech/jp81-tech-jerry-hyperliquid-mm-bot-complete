import asyncio
import httpx
import urllib.parse
import os
import json
from dataclasses import dataclass
from typing import Dict, List, Optional
from datetime import datetime, timedelta
from enum import Enum

# ==========================================
# 📊 DATA STRUCTURES & CONFIG
# ==========================================

class LiquidityRisk(Enum):
    SAFE = "safe"           # >10% liq/mcap
    MODERATE = "moderate"   # 5-10%
    RISKY = "risky"         # 2-5%
    CRITICAL = "critical"   # <2%
    RUG_DETECTED = "rug"    # Liquidity removed > 50%

@dataclass
class LPPool:
    token_symbol: str
    token_address: str
    lp_address: str
    dex: str
    chain: str
    deployer_address: Optional[str] = None
    lock_expiry: Optional[datetime] = None

@dataclass
class LiquiditySnapshot:
    timestamp: datetime
    liquidity_usd: float
    market_cap_usd: float
    liq_mcap_ratio: float
    lp_token_supply: float
    holders_count: int

DEXSCREENER_CHAINS = {
    "bnb": "bsc",
    "bsc": "bsc",
    "eth": "ethereum",
    "ethereum": "ethereum",
    "base": "base",
    "solana": "solana",
    "arbitrum": "arbitrum"
}

# ==========================================
# 🧠 CORE LOGIC
# ==========================================

class LiquidityMonitor:

    THRESHOLDS = {
        "liq_mcap_safe": 0.10,
        "liq_mcap_moderate": 0.05,
        "liq_mcap_risky": 0.02,
        "liq_drop_warning": 0.10,   # -10%
        "liq_drop_critical": 0.25,  # -25%
        "liq_drop_rug": 0.50,       # -50%
        "min_liquidity_usd": 50000,
    }

    def __init__(self, telegram_chat_id: str):
        self.telegram_chat_id = telegram_chat_id
        self.pools: Dict[str, LPPool] = {}
        self.snapshots: Dict[str, List[LiquiditySnapshot]] = {}

    def add_pool(self, pool: LPPool):
        key = f"{pool.chain}:{pool.token_symbol}"
        self.pools[key] = pool
        if key not in self.snapshots:
            self.snapshots[key] = []
        print(f"✅ [Monitor] Added pool: {pool.token_symbol} on {pool.dex} ({pool.chain})")

    def record_snapshot(self, pool_key: str, liquidity_usd: float,
                        market_cap_usd: float, lp_supply: float, holders: int):
        ratio = liquidity_usd / market_cap_usd if market_cap_usd > 0 else 0

        snapshot = LiquiditySnapshot(
            timestamp=datetime.now(),
            liquidity_usd=liquidity_usd,
            market_cap_usd=market_cap_usd,
            liq_mcap_ratio=ratio,
            lp_token_supply=lp_supply,
            holders_count=holders
        )

        self.snapshots[pool_key].append(snapshot)
        if len(self.snapshots[pool_key]) > 1000:
            self.snapshots[pool_key] = self.snapshots[pool_key][-1000:]

        return snapshot

    def analyze_liquidity_change(self, pool_key: str) -> dict:
        snapshots = self.snapshots.get(pool_key, [])
        if len(snapshots) < 2:
            return {"risk": LiquidityRisk.SAFE, "change_pct": 0, "changes": {}}

        current = snapshots[-1]
        comparisons = {}

        for label, minutes in [("5m", 5), ("1h", 60), ("24h", 1440)]:
            target_time = current.timestamp - timedelta(minutes=minutes)
            past = self._find_closest_snapshot(snapshots, target_time)

            if past:
                change = (current.liquidity_usd - past.liquidity_usd) / past.liquidity_usd if past.liquidity_usd > 0 else 0
                comparisons[label] = {
                    "change_pct": change * 100,
                    "change_usd": current.liquidity_usd - past.liquidity_usd
                }

        risk = self._calculate_risk(current, comparisons)

        return {
            "risk": risk,
            "current_liquidity": current.liquidity_usd,
            "liq_mcap_ratio": current.liq_mcap_ratio,
            "changes": comparisons,
            "timestamp": current.timestamp
        }

    def _find_closest_snapshot(self, snapshots: List[LiquiditySnapshot], target_time: datetime) -> Optional[LiquiditySnapshot]:
        closest = None
        min_diff = timedelta(hours=24)

        for s in snapshots:
            diff = abs(s.timestamp - target_time)
            if diff < min_diff:
                min_diff = diff
                closest = s

        return closest

    def _calculate_risk(self, current: LiquiditySnapshot, comparisons: dict) -> LiquidityRisk:
        ratio = current.liq_mcap_ratio
        if ratio < self.THRESHOLDS["liq_mcap_risky"]:
            base_risk = LiquidityRisk.CRITICAL
        elif ratio < self.THRESHOLDS["liq_mcap_moderate"]:
            base_risk = LiquidityRisk.RISKY
        elif ratio < self.THRESHOLDS["liq_mcap_safe"]:
            base_risk = LiquidityRisk.MODERATE
        else:
            base_risk = LiquidityRisk.SAFE

        for _, data in comparisons.items():
            change = data.get("change_pct", 0) / 100
            if change < -self.THRESHOLDS["liq_drop_rug"]:
                return LiquidityRisk.RUG_DETECTED
            elif change < -self.THRESHOLDS["liq_drop_critical"]:
                return LiquidityRisk.CRITICAL
            elif change < -self.THRESHOLDS["liq_drop_warning"]:
                if base_risk == LiquidityRisk.SAFE:
                    base_risk = LiquidityRisk.MODERATE

        if current.liquidity_usd < self.THRESHOLDS["min_liquidity_usd"]:
            if base_risk in [LiquidityRisk.SAFE, LiquidityRisk.MODERATE]:
                base_risk = LiquidityRisk.RISKY

        return base_risk

    def check_lp_unlock(self, pool_key: str) -> Optional[dict]:
        pool = self.pools.get(pool_key)
        if not pool or not pool.lock_expiry:
            return None

        now = datetime.now()
        time_to_unlock = pool.lock_expiry - now

        if time_to_unlock < timedelta(0):
            return {"status": "UNLOCKED", "message": f"⚠️ LP UNLOCKED!", "risk": LiquidityRisk.CRITICAL}
        elif time_to_unlock < timedelta(days=7):
            return {"status": "WARNING", "message": f"🔓 Unlock in {time_to_unlock.days} days", "risk": LiquidityRisk.RISKY}

        return None

# ==========================================
# 🔌 INTEGRATION & NETWORKING
# ==========================================

class LiquidityAlertIntegration:
    ALERT_LOG_FILE = "alerts_liquidity.csv"
    FLAGS_FILE = "liquidity_flags.json"

    def __init__(self, liquidity_monitor: LiquidityMonitor, telegram_bot_token: str):
        self.monitor = liquidity_monitor
        self.telegram_bot_token = telegram_bot_token

    def _log_alert_to_file(self, pool: LPPool, analysis: dict, kind: str):
        """Log alert to CSV file."""
        line = (
            f"{datetime.utcnow().isoformat()},"
            f"{kind},"
            f"{pool.token_symbol},"
            f"{pool.dex},"
            f"{pool.chain},"
            f"{analysis.get('risk', '')},"
            f"{analysis.get('current_liquidity', '')},"
            f"{analysis.get('liq_mcap_ratio', '')},"
            f"{analysis.get('changes', {}).get('5m', {}).get('change_pct', '')},"
            f"{analysis.get('changes', {}).get('1h', {}).get('change_pct', '')},"
            f"{analysis.get('changes', {}).get('24h', {}).get('change_pct', '')}\n"
        )
        try:
            with open(self.ALERT_LOG_FILE, "a") as f:
                f.write(line)
        except Exception as e:
            print(f"[LiquidityMonitor] Failed to log alert: {e}")

    def _update_liquidity_flag(self, pool: LPPool, analysis: dict):
        """Update liquidity flag JSON for MM bot."""
        symbol = pool.token_symbol
        risk_val = analysis["risk"].value if hasattr(analysis["risk"], "value") else str(analysis["risk"])

        flags = {}
        if os.path.exists(self.FLAGS_FILE):
            try:
                with open(self.FLAGS_FILE, "r") as f:
                    flags = json.load(f)
            except:
                flags = {}

        flags[symbol] = {
            "risk": risk_val,
            "updated_at": datetime.utcnow().isoformat() + "Z"
        }

        tmp = self.FLAGS_FILE + ".tmp"
        try:
            with open(tmp, "w") as f:
                json.dump(flags, f, indent=2)
            os.replace(tmp, self.FLAGS_FILE)
        except Exception as e:
            print(f"[LiquidityMonitor] Failed to write flags file: {e}")

    async def periodic_check(self, interval_seconds: int = 300):
        print(f"🔄 Starting periodic check (every {interval_seconds}s)...")
        while True:
            for pool_key, pool in self.monitor.pools.items():
                try:
                    data = await self._fetch_liquidity_data(pool)

                    self.monitor.record_snapshot(
                        pool_key,
                        data["liquidity_usd"],
                        data["market_cap_usd"],
                        data["lp_supply"],
                        data["holders"]
                    )

                    analysis = self.monitor.analyze_liquidity_change(pool_key)

                    print(f"   📊 {pool.token_symbol}: ${data['liquidity_usd']:,.0f} Liq | Risk: {analysis['risk'].value}")

                    # Always update flag with current risk state
                    self._update_liquidity_flag(pool, analysis)

                    if analysis["risk"] in [LiquidityRisk.CRITICAL, LiquidityRisk.RUG_DETECTED]:
                        await self._send_alert(pool, analysis)

                    unlock = self.monitor.check_lp_unlock(pool_key)
                    if unlock and unlock["status"] in ["UNLOCKED", "WARNING"]:
                        await self._send_unlock_alert(pool, unlock)

                except Exception as e:
                    print(f"❌ [Error] {pool.token_symbol}: {e}")

            await asyncio.sleep(interval_seconds)

    async def _fetch_liquidity_data(self, pool: LPPool) -> dict:
        chain_id = DEXSCREENER_CHAINS.get(pool.chain.lower(), pool.chain.lower())

        if not pool.lp_address or "0x..." in pool.lp_address:
            raise ValueError(f"Invalid LP Address for {pool.token_symbol}")

        url = f"https://api.dexscreener.com/latest/dex/pairs/{chain_id}/{pool.lp_address}"

        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(url)
            r.raise_for_status()
            data = r.json()

        if not data.get("pairs"):
             raise ValueError(f"No pair data found on DexScreener for {pool.lp_address}")

        pair = data["pairs"][0]

        return {
            "liquidity_usd": float(pair.get("liquidity", {}).get("usd", 0) or 0),
            "market_cap_usd": float(pair.get("fdv", pair.get("marketCap", 0)) or 0),
            "lp_supply": 0,
            "holders": 0
        }

    async def _send_alert(self, pool: LPPool, analysis: dict):
        risk = analysis["risk"]
        emoji = "🚨" if risk == LiquidityRisk.RUG_DETECTED else "⚠️"

        msg = (
            f"{emoji} **LIQUIDITY ALERT: {pool.token_symbol}**\n\n"
            f"Risk: *{risk.value.upper()}*\n"
            f"Liquidity: ${analysis['current_liquidity']:,.0f}\n"
            f"Liq/MCap: {analysis['liq_mcap_ratio']:.1%}\n\n"
            f"1h Change: {analysis['changes'].get('1h', {}).get('change_pct', 0):+.1f}%\n"
            f"DEX: {pool.dex} | Chain: {pool.chain}"
        )

        self._log_alert_to_file(pool, analysis, kind="risk")
        await self._send_telegram(self.monitor.telegram_chat_id, msg)

    async def _send_unlock_alert(self, pool: LPPool, unlock: dict):
        msg = f"{unlock['message']} ({pool.token_symbol} on {pool.chain})"

        analysis = {
            "risk": unlock["risk"],
            "current_liquidity": "",
            "liq_mcap_ratio": "",
            "changes": {},
        }
        self._log_alert_to_file(pool, analysis, kind="unlock")

        await self._send_telegram(self.monitor.telegram_chat_id, msg)

    async def _send_telegram(self, chat_id: str, text: str):
        base_url = f"https://api.telegram.org/bot{self.telegram_bot_token}/sendMessage"
        params = {"chat_id": chat_id, "text": text, "parse_mode": "Markdown"}

        async with httpx.AsyncClient(timeout=10) as client:
            await client.get(base_url, params=params)

# ==========================================
# 🚀 SETUP
# ==========================================

def setup_liquidity_monitoring(telegram_chat_id: str):
    monitor = LiquidityMonitor(telegram_chat_id)

    pools = [
        # MON (Solana / Meteora)
        LPPool(
            token_symbol="MON",
            lp_address="GbVFZZ9g71fNioHDfS3aTEYvMGxLcs6yWNdiG9uBLQnn",
            dex="meteora",
            chain="solana",
        ),
        # VIRTUAL – Base / Uniswap
        LPPool(
            token_symbol="VIRTUAL",
            token_address="0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b",
            lp_address="0xa9991eeaca10af662633913106fe4c18ec06e1f8",
            dex="uniswap",
            chain="base",
        ),
        # ZEC – BSC / Uniswap (DexScreener compatible)
        LPPool(
            token_symbol="ZEC",
            token_address="ZEC_TOKEN_ADDRESS_IF_NEEDED",
            lp_address="0x4d1b90273d5b0ea98101154d73a6c7d7a19884db",
            dex="uniswap",
            chain="bsc",
        ),
        # HYPE – Base / PancakeSwap
        LPPool(
            token_symbol="HYPE",
            token_address="HYPE_TOKEN_ADDRESS_IF_NEEDED",
            lp_address="0xb4585f61fdbeb7182839fd30dff9eb0e36a649cf",
            dex="pancakeswap",
            chain="base",
        ),
    ]

    for pool in pools:
        if "0x..." not in pool.lp_address and "TODO" not in pool.lp_address:
            monitor.add_pool(pool)
        else:
            print(f"⚠️ [Config] Skipping {pool.token_symbol} - Missing LP Address in scripts/liquidity_monitor/liquidity_monitor.py")

    return monitor
