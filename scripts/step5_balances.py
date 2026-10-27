"""Step 5. Read every balance at every snapshot block from the RPC.

The address list is the union of:
  * every transaction sender and receiver from step 2,
  * contracts created by transactions (step 2) or by other contracts (step 3),
  * every sender and receiver of internal transfers (step 3),
  * every address in a WRBNT or staking event (step 4),
  * the publicly named wallets,
  * Routescan's native holder list (catches genesis balances that never moved),
  * validator addresses listed in block headers (extraData), sampled every
    250 blocks. The protocol pays network fees to some addresses directly,
    without a transaction, so a transaction scan alone cannot find them.

For each address the script reads, at each snapshot block (opening, month
ends, closing):
  * native RBNT balance (eth_getBalance),
  * WRBNT balance (balanceOf) for WRBNT users,
  * staked principal in each Reddex pool (userInfo(address).amount) for stakers.
It also reads WRBNT totalSupply, each pool's totalStake, and the contract
code at the closing block for every address that holds any RBNT, wrapped or
staked RBNT at any snapshot (to tell regular wallets from smart contracts).
"""

import os
import re
from concurrent.futures import ThreadPoolExecutor

from common import (NAMED, POOL_365, POOL_NO_LOCK, RAW, ROUTESCAN, WRBNT, load_json, routescan_get, rpc_batch,
                    save_json, snapshots)

WORKERS = int(os.environ.get("WORKERS", "12"))
SEL_BALANCE_OF = "0x70a08231"
SEL_TOTAL_SUPPLY = "0x18160ddd"
SEL_USER_INFO = "0x1959a002"  # userInfo(address)
SEL_TOTAL_STAKE = "0x8b0e9f3f"  # totalStake()


def header_addresses(close_block, step=250):
    """20-byte values RLP-encoded in block extraData (prefix 0x94). Stray
    matches inside signatures only add empty addresses, which do no harm."""
    found = set()
    blocks = list(range(1, close_block + 1, step)) + [close_block]

    def read(chunk):
        res = rpc_batch([("eth_getBlockByNumber", [hex(n), False]) for n in chunk])
        return [m.group(1) for blk in res for m in re.finditer(r"94([0-9a-f]{40})", blk["extraData"][2:])]

    with ThreadPoolExecutor(WORKERS) as ex:
        for r in ex.map(read, [blocks[i:i + 50] for i in range(0, len(blocks), 50)]):
            found.update("0x" + x for x in r)
    return found


def routescan_holder_list():
    url = ROUTESCAN + "/addresses"
    params = {"limit": 200}
    out = []
    while True:
        r = routescan_get(url, params)
        out += [x["address"].lower() for x in r["items"]]
        nxt = r.get("link", {}).get("nextToken")
        if not nxt or not r["items"]:
            break
        params = {"limit": 200, "next": nxt}
    return out


BUCKETS = 64


def parallel(fn, items, size=1000, cache=None):
    """Run fn over items in chunks on a thread pool and return (item, value)
    pairs. With cache set, values are kept per address in 64 bucket files
    (split by address prefix), so a rerun only reads addresses it has not
    read before."""
    def run(part):
        res = []
        with ThreadPoolExecutor(WORKERS) as ex:
            for r in ex.map(fn, [part[i:i + size] for i in range(0, len(part), size)]):
                res += r
        return res

    if not cache:
        return run(items)
    buckets = {}
    for a in items:
        buckets.setdefault(int(a[2:4], 16) % BUCKETS, []).append(a)
    out, done = [], 0
    for bk in sorted(buckets):
        part = buckets[bk]
        path = os.path.join(RAW, "bal_cache", f"{cache}_b{bk:02d}.json.gz")
        have = dict(load_json(path)) if os.path.exists(path) else {}
        todo = [a for a in part if a not in have]
        if todo:
            have.update(run(todo))
            save_json(path, sorted(have.items()), gz=True)
        out += [(a, have[a]) for a in part]
        done += len(part)
        print(f"  {cache}: {done:,}/{len(items):,} ({len(todo):,} read from the RPC)", flush=True)
    return out


def main():
    snap = snapshots()
    blocks = [hex(p["block"]) for p in snap["points"]]
    k = len(blocks)
    cb = hex(snap["close"]["block"])

    universe = set(NAMED)
    scan_dir = os.path.join(RAW, "scan")
    for f in sorted(os.listdir(scan_dir)):
        universe.update(load_json(os.path.join(scan_dir, f))["addrs"])
    universe.update(load_json(os.path.join(RAW, "created_contracts.json")))
    for r in load_json(os.path.join(RAW, "internal_transfers.json.gz")):
        universe.update(x for x in (r[2], r[3], r[6]) if x)
    wrbnt_users = set()
    for r in load_json(os.path.join(RAW, "wrbnt_events.json.gz")):
        wrbnt_users.update(x for x in (r[3], r[4]) if x)
    universe |= wrbnt_users
    stakers = {}
    for pool, ev in load_json(os.path.join(RAW, "staking_events.json.gz")).items():
        stakers[pool] = sorted({e[3].lower() for e in ev})
        universe.update(stakers[pool])
    rs_list = routescan_holder_list()
    print("routescan list", len(rs_list))
    universe.update(rs_list)
    headers = header_addresses(snap["close"]["block"])
    print("block header addresses", len(headers), "new", len(headers - universe))
    universe.update(headers)
    universe.discard("")
    universe = sorted(universe)
    print("universe", len(universe), flush=True)

    def balances(chunk):
        res = rpc_batch([("eth_getBalance", [a, b]) for a in chunk for b in blocks])
        return [(a, [int(x, 16) for x in res[k * i:k * i + k]]) for i, a in enumerate(chunk)]

    tag = "-".join(str(p["block"]) for p in snap["points"])
    native = {a: v for a, v in parallel(balances, universe, 250, cache="native-" + tag) if any(v)}
    print("non-zero native", len(native), flush=True)

    def erc20(chunk):
        calls = []
        for a in chunk:
            data = SEL_BALANCE_OF + a[2:].rjust(64, "0")
            calls += [("eth_call", [{"to": WRBNT, "data": data}, b]) for b in blocks]
        res = rpc_batch(calls)
        return [(a, [int(x, 16) for x in res[k * i:k * i + k]]) for i, a in enumerate(chunk)]

    wrbnt = {a: v for a, v in parallel(erc20, sorted(wrbnt_users), 100) if any(v)}
    wrbnt_supply = [int(x, 16) for x in rpc_batch([("eth_call", [{"to": WRBNT, "data": SEL_TOTAL_SUPPLY}, b]) for b in blocks])]

    staked = {}
    total_stake = {}
    for pool, users in stakers.items():
        def info(chunk, pool=pool):
            calls = []
            for a in chunk:
                data = SEL_USER_INFO + a[2:].rjust(64, "0")
                calls += [("eth_call", [{"to": pool, "data": data}, b]) for b in blocks]
            res = rpc_batch(calls)
            # userInfo returns (amount, logStartIndex, debtReward, timestamp); amount is word 0.
            # Before the pool existed the call returns "0x".
            return [(a, [int(x[2:66] or "0", 16) for x in res[k * i:k * i + k]]) for i, a in enumerate(chunk)]
        staked[pool] = {a: v for a, v in parallel(info, users, 100) if any(v)}
        total_stake[pool] = [int(x[2:66] or "0", 16) for x in rpc_batch(
            [("eth_call", [{"to": pool, "data": SEL_TOTAL_STAKE}, b]) for b in blocks])]

    # Contract code for every address holding anything at any snapshot.
    big = set()
    for d in [native, wrbnt] + list(staked.values()):
        big.update(d)
    big = sorted(big)

    def code(chunk):
        res = rpc_batch([("eth_getCode", [a, cb]) for a in chunk])
        # keep only what the report needs: no code, a 7702 delegation, or a contract
        return [(a, "" if c in (None, "0x") else "delegated" if c.startswith("0xef0100") else "contract")
                for a, c in zip(chunk, res)]

    codes = {a: c for a, c in parallel(code, big, 500, cache="code-" + str(snap["close"]["block"])) if c}

    def s(v):
        return [str(x) for x in v]

    save_json(os.path.join(RAW, "balances.json.gz"), {
        "points": [p["key"] for p in snap["points"]], "blocks": [p["block"] for p in snap["points"]],
        "universe_size": len(universe), "routescan_list_size": len(rs_list), "header_addresses": len(headers),
        "native": {a: s(v) for a, v in native.items()},
        "wrbnt": {a: s(v) for a, v in wrbnt.items()},
        "wrbnt_total_supply": s(wrbnt_supply),
        "staked": {p: {a: s(v) for a, v in d.items()} for p, d in staked.items()},
        "total_stake": {p: s(v) for p, v in total_stake.items()},
        "code": codes,
    }, gz=True)
    print("done")


if __name__ == "__main__":
    main()
