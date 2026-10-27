"""Step 1. Find the snapshot blocks for the quarter.

Opening snapshot: the last block mined before the quarter starts. Its state
is the state at 00:00:00 UTC on the first day.
Month-end snapshots: the last block mined at or before 23:59:59 UTC on the
last day of each month inside the quarter. The last one is the closing
snapshot.

Blocks are found by binary search over block timestamps on the Redbelly
RPC, then cross-checked against the Routescan getblocknobytime endpoint.
"""

import os
from datetime import datetime, timedelta, timezone

from common import QUARTER, RAW, ROUTESCAN_ETHERSCAN, quarter_ts, routescan_get, rpc, save_json, utc


def block_ts(n):
    return int(rpc("eth_getBlockByNumber", [hex(n), False])["timestamp"], 16)


def last_block_at_or_before(ts, hi):
    lo = 0
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if block_ts(mid) <= ts:
            lo = mid
        else:
            hi = mid - 1
    return lo


def month_ends(start_ts, end_ts):
    """Last second of each month that ends inside the quarter."""
    out = []
    d = datetime.fromtimestamp(start_ts, timezone.utc)
    while True:
        nxt = (d.replace(day=1) + timedelta(days=32)).replace(day=1)
        last = int(nxt.timestamp()) - 1
        if last > end_ts:
            break
        out.append(last)
        d = nxt
    return out


def main():
    start_ts, end_ts = quarter_ts()
    head = int(rpc("eth_blockNumber", []), 16)
    cut_offs = [("open", start_ts - 1)]
    for ts in month_ends(start_ts, end_ts):
        cut_offs.append(("close" if ts == end_ts else datetime.fromtimestamp(ts, timezone.utc).strftime("%b").lower(), ts))

    points = []
    for key, ts in cut_offs:
        blk = last_block_at_or_before(ts, head)
        rs = int(routescan_get(ROUTESCAN_ETHERSCAN, {"module": "block", "action": "getblocknobytime",
                                                     "timestamp": ts, "closest": "before"})["result"])
        state_at = datetime.fromtimestamp(ts + 1, timezone.utc)
        points.append({
            "key": key,
            "state_at_utc": state_at.strftime("%Y-%m-%d %H:%M:%S UTC"),
            "label": f"{state_at.day} {state_at.strftime('%b')}",
            "cutoff_ts": ts,
            "block": blk,
            "block_time_utc": utc(block_ts(blk)),
            "next_block_time_utc": utc(block_ts(blk + 1)),
            "routescan_block": rs,
            "routescan_matches_rpc": rs == blk,
        })
        print(points[-1])

    by_key = {p["key"]: p for p in points}
    save_json(os.path.join(RAW, "snapshots.json"), {
        "quarter": QUARTER,
        "head_block_when_run": head,
        "points": points,
        "open": by_key["open"],
        "close": by_key["close"],
    })


if __name__ == "__main__":
    main()
