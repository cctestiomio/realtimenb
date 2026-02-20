import os
import time
from datetime import datetime, timezone

import requests

# =====================================================
# CONFIG
# =====================================================

WEBHOOK_URL = os.getenv("DISCORD_WEBHOOK_URL", "")

# -------- LARGE TRADES ONLY ----------
MONITORED_ADDRESSES_LARGE_ONLY = [
    "0xcc500cbcc8b7cf5bd21975ebbea34f21b5644c82",
    "0x55be7aa03ecfbe37aa5460db791205f7ac9ddca3",
    "0xebf79787ab928c803cbef6fa8e0abe42b9e1da78",
    "0x4a38e6e0330c2463fb5ac2188a620634039abfe8",
    "0x589222a5124a96765443b97a3498d89ffd824ad2",
    "0x6031b6eed1c97e853c6e0f03ad3ce3529351f96d",
    "0x28065f1b88027422274fb33e1e22bf3dad5736e7",
    "0xe9c6312464b52aa3eff13d822b003282075995c9",
    "0x6a72f61820b26b1fe4d956e17b6dc2a1ea3033ee",
    "0xd25c72ac0928385610611c8148803dc717334d20",
    "0x03e8a544e97eeff5753bc1e90d46e5ef22af1697",
    "0xc2e7800b5af46e6093872b177b7a5e7f0563be51",
    "0x1d8a377c5020f612ce63a0a151970df64baae842",
    "0xd0b4c4c020abdc88ad9a884f999f3d8cff8ffed6",
    "0x43372356634781eea88d61bbdd7824cdce958882",
    "0x13414a77a4be48988851c73dfd824d0168e70853",
    "0x9d84ce0306f8551e02efef1680475fc0f1dc1344",
]

# -------- ALL TRADES (small minimum) ----------
MONITORED_ADDRESSES_ALL_TRADES = [
    "0xf705fa045201391d9632b7f3cde06a5e24453ca7",
    "0xcc500cbcc8b7cf5bd21975ebbea34f21b5644c82",
    "0x7744bfd749a70020d16a1fcbac1d064761c9999e",
    "0x90ed5bffbffbfc344aa1195572d89719a398b5bc",
    "0xf2f6af4f27ec2dcf4072095ab804016e14cd5817",
    "0x57cd939930fd119067ca9dc42b22b3e15708a0fb",
    "0xccb290b1c145d1c95695d3756346bba9f1398586",
    "0xe24838258b572f1771dffba3bcdde57a78def293",
    "0x6ade597c0e2b43c0bf3542cada8a5e330d73f5b0",
    "0x8b3234f9027f4e994e949df4b48b90ab79015950",
    "0x13414a77a4be48988851c73dfd824d0168e70853",
    "0x93abbc022ce98d6f45d4444b594791cc4b7a9723",
    "0x9cb990f1862568a63d8601efeebe0304225c32f2",
    "0xe6a3778e5c3f93958534684ed7308b4625622f0d",
    "0x14964aefa2cd7caff7878b3820a690a03c5aa429",
]

CHECK_DELAY = 30
MIN_LARGE_TRADE_VALUE = 10000
MIN_ALL_TRADE_VALUE = 100
SEED_LOOKBACK_SECONDS = 120

API_URL = "https://data-api.polymarket.com/trades"

# =====================================================
# STATE
# =====================================================

user_seen_trades = {}
api_error_counts = {}
loop_count = 0

# =====================================================
# HELPERS
# =====================================================


def trade_key(trade):
    return f"{trade.get('timestamp')}-{trade.get('price')}-{trade.get('size')}-{trade.get('side')}"


def ts():
    return datetime.now(timezone.utc).strftime("%H:%M:%S")


def short(address):
    return address[:6] + "…" + address[-4:]


def trade_age_seconds(trade):
    raw = trade.get("timestamp") or trade.get("createdAt") or trade.get("created_at")
    if not raw:
        return 0
    try:
        if isinstance(raw, (int, float)):
            trade_ts = float(raw)
        else:
            dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
            trade_ts = dt.timestamp()
        return time.time() - trade_ts
    except Exception:
        return 0


def is_buy(trade) -> bool:
    return str(trade.get("side", "")).upper() == "BUY"


def min_value_for_address(address):
    # Conflict resolution rule:
    # If an address appears in both lists, use the lower threshold so trades aren't swallowed.
    if address in MONITORED_ADDRESSES_ALL_TRADES:
        return MIN_ALL_TRADE_VALUE
    return MIN_LARGE_TRADE_VALUE


# =====================================================
# API
# =====================================================

def get_latest_trades(address):
    try:
        r = requests.get(
            API_URL,
            params={
                "user": address,
                "limit": 110,
                "sortBy": "timestamp",
                "sortDirection": "DESC",
            },
            timeout=10,
        )
        r.raise_for_status()
        data = r.json()

        if api_error_counts.get(address, 0) > 0:
            print(f"  [{ts()}] ✅ {short(address)} recovered after {api_error_counts[address]} error(s)")
        api_error_counts[address] = 0
        return data

    except requests.exceptions.HTTPError as e:
        api_error_counts[address] = api_error_counts.get(address, 0) + 1
        print(
            f"  [{ts()}] ❌ HTTP {e.response.status_code} for {short(address)} "
            f"(consecutive errors: {api_error_counts[address]})"
        )
        return []
    except requests.exceptions.ConnectionError:
        api_error_counts[address] = api_error_counts.get(address, 0) + 1
        print(
            f"  [{ts()}] ❌ CONNECTION ERROR for {short(address)} "
            f"(consecutive errors: {api_error_counts[address]})"
        )
        return []
    except requests.exceptions.Timeout:
        api_error_counts[address] = api_error_counts.get(address, 0) + 1
        print(
            f"  [{ts()}] ❌ TIMEOUT for {short(address)} "
            f"(consecutive errors: {api_error_counts[address]})"
        )
        return []
    except Exception as e:
        api_error_counts[address] = api_error_counts.get(address, 0) + 1
        print(
            f"  [{ts()}] ❌ UNKNOWN ERROR for {short(address)}: {e} "
            f"(consecutive errors: {api_error_counts[address]})"
        )
        return []


# =====================================================
# DISCORD ALERT
# =====================================================

def send_discord_alert(trade, address, min_value):
    size = float(trade.get("size", 0) or 0)
    price = float(trade.get("price", 0) or 0)
    value = size * price

    username = trade.get("name") or trade.get("pseudonym") or short(address)
    title = trade.get("title") or trade.get("market") or "?"

    if value < min_value:
        print(
            f"  [{ts()}] ⏭  SKIPPED (${value:,.2f} < ${min_value:,} min) — "
            f"📈 BUY {size:,.0f}@{price:.3f} by {username} | {title[:60]}"
        )
        return

    if not WEBHOOK_URL:
        print(f"  [{ts()}] ⚠️  DISCORD_WEBHOOK_URL not set; alert suppressed")
        return

    slug = trade.get("eventSlug", trade.get("slug", ""))
    market_link = f"https://polymarket.com/event/{slug}"
    user_link = f"https://polymarket.com/profile/{address}"

    embed = {
        "title": f"📈 BUY by {username}",
        "url": market_link,
        "color": 5763719,
        "fields": [
            {"name": "Trader", "value": f"{username} - {user_link}", "inline": False},
            {"name": "Shares", "value": f"{size:,.2f}", "inline": True},
            {"name": "Price", "value": f"${price:.3f}", "inline": True},
            {"name": "Value", "value": f"${value:,.2f}", "inline": True},
            {"name": "Market", "value": f"[{title}]({market_link})", "inline": False},
        ],
        "footer": {"text": f"{ts()} UTC"},
    }

    try:
        resp = requests.post(WEBHOOK_URL, json={"embeds": [embed]}, timeout=8)
        resp.raise_for_status()
        print(
            f"  [{ts()}] 📈 ALERT SENT — BUY {size:,.0f} shares @ ${price:.3f} "
            f"(${value:,.0f}) by {username} | {title[:50]}"
        )
    except requests.exceptions.HTTPError as e:
        print(f"  [{ts()}] ⚠️  Discord HTTP {e.response.status_code}: {e.response.text[:200]}")
    except Exception as e:
        print(f"  [{ts()}] ⚠️  Discord webhook failed: {e}")


# =====================================================
# INIT
# =====================================================

def initialize(addresses):
    print(
        f"[{ts()}] Seeding {len(addresses)} addresses — BUY orders only "
        f"(trades older than {SEED_LOOKBACK_SECONDS}s skipped)..."
    )

    for addr in addresses:
        trades = get_latest_trades(addr)
        seeded = 0
        recent_buys = 0
        for t in trades:
            key = trade_key(t)
            age = trade_age_seconds(t)
            user_seen_trades.setdefault(addr, set()).add(key)
            if not is_buy(t):
                continue
            if age <= SEED_LOOKBACK_SECONDS:
                user_seen_trades[addr].discard(key)
                recent_buys += 1
            else:
                seeded += 1

        print(f"  {short(addr)} → {seeded} old buys (skip), {recent_buys} recent buys (will alert)")

    print(f"[{ts()}] Seed complete.\n")


# =====================================================
# LOOP
# =====================================================

def process_addresses(addresses):
    new_found = 0
    for addr in addresses:
        min_value = min_value_for_address(addr)
        trades = get_latest_trades(addr)
        for trade in reversed(trades):
            key = trade_key(trade)
            seen = user_seen_trades.setdefault(addr, set())

            if key in seen:
                continue

            seen.add(key)

            if not is_buy(trade):
                continue

            new_found += 1
            send_discord_alert(trade, addr, min_value)

    return new_found


def print_heartbeat(loop, new_trades, all_addresses):
    problem_addrs = [short(a) for a, c in api_error_counts.items() if c > 0]
    print(
        f"[{ts()}] ♻️  Loop #{loop} — "
        f"new buys: {new_trades} | "
        f"errors: {len(problem_addrs)}/{len(all_addresses)} | "
        f"next in {CHECK_DELAY}s"
    )
    if problem_addrs:
        print(f"           ⚠️  Failing: {', '.join(problem_addrs)}")


def main():
    all_addresses = list(set(MONITORED_ADDRESSES_LARGE_ONLY + MONITORED_ADDRESSES_ALL_TRADES))

    print("=" * 60)
    print("  Polymarket Trade Monitor  [BUY orders only]")
    print(f"  Tracking   : {len(all_addresses)} unique addresses")
    print(f"  Large min  : ${MIN_LARGE_TRADE_VALUE:,}")
    print(f"  All min    : ${MIN_ALL_TRADE_VALUE:,}")
    print(f"  Poll every : {CHECK_DELAY}s")
    print(f"  Seed window: ignore trades older than {SEED_LOOKBACK_SECONDS}s")
    print("=" * 60 + "\n")

    initialize(all_addresses)
    print(f"[{ts()}] 🟢 Monitoring live BUY orders...\n")

    global loop_count
    while True:
        loop_count += 1
        new_buys = process_addresses(all_addresses)
        print_heartbeat(loop_count, new_buys, all_addresses)
        time.sleep(CHECK_DELAY)


if __name__ == "__main__":
    main()
