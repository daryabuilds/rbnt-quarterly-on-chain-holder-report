"""Step 3. Internal RBNT transfers (value moved by contracts) up to the
closing snapshot, from the Routescan Etherscan-compatible API.

The public RPC has no tracing, so contract-to-wallet payments (for example
WRBNT unwraps or staking payouts) are read from Routescan's
txlistinternal endpoint by block range. A range that returns the page
limit is split in two until every range fits.
"""

import os
import time

from common import RAW, ROUTESCAN_ETHERSCAN, routescan_get, save_json, snapshots

LIMIT = 10_000


def fetch(start, end):
    r = routescan_get(ROUTESCAN_ETHERSCAN, {
        "module": "account", "action": "txlistinternal", "startblock": start, "endblock": end,
        "page": 1, "offset": LIMIT, "sort": "asc",
    })
    time.sleep(0.25)
    if r["status"] != "1":
        if r["message"].startswith("No transactions"):
            return []
        raise RuntimeError(r)
    return r["result"]


def main():
    close_block = snapshots()["close"]["block"]
    rows = []
    stack = [(0, close_block)]
    calls = 0
    while stack:
        s, e = stack.pop()
        res = fetch(s, e)
        calls += 1
        if len(res) >= LIMIT and e > s:
            mid = (s + e) // 2
            stack.append((mid + 1, e))
            stack.append((s, mid))
            continue
        for x in res:
            rows.append([int(x["blockNumber"]), x["hash"], x["from"].lower(), (x["to"] or "").lower(),
                         x["value"], x["type"], (x.get("contractAddress") or "").lower(), x["isError"]])
        if calls % 20 == 0:
            print(f"{calls} calls, {len(rows)} rows, at block {e}", flush=True)
    rows.sort()
    save_json(os.path.join(RAW, "internal_transfers.json.gz"), rows, gz=True)
    print(f"done: {calls} calls, {len(rows)} internal transfers")


if __name__ == "__main__":
    main()
