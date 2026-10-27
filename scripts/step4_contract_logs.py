"""Step 4. Event logs for WRBNT and the two Reddex staking pools.

WRBNT: Transfer, Deposit (wrap) and Withdrawal (unwrap) events give every
address that ever held WRBNT, plus WRBNT moves by named wallets.
Staking pools: Stake and Unstake events give every staker and the amounts
staked and unstaked inside the quarter.
"""

import json
import os
import time

import bisect

from common import (POOL_365, POOL_NO_LOCK, RAW, ROUTESCAN_ETHERSCAN, TOPIC_DEPOSIT, TOPIC_TRANSFER, TOPIC_WITHDRAWAL,
                    WRBNT, routescan_get, rpc, save_json, snapshots)

PAGE = 1000
MAX_PAGES = 10


def hexint(x):
    """Routescan writes zero as "0x"."""
    return int(x, 16) if x and x != "0x" else 0


def get_logs(address, start, end):
    """All logs for one contract from Routescan's getLogs endpoint.

    The public RPC caps eth_getLogs at under 100 blocks per call and rate
    limits it, so logs are read from Routescan in pages of 1,000. Routescan
    serves at most 10 pages per query, so the scan walks forward through
    block windows and halves a window whenever it would need more pages.
    Finished windows are cached in data/raw/logs_cache so a rerun resumes.
    Completeness is checked in step 6 against totals read from the RPC.
    """
    cache = os.path.join(RAW, "logs_cache", f"{address}.jsonl")
    os.makedirs(os.path.dirname(cache), exist_ok=True)
    out, s = [], start
    if os.path.exists(cache):
        with open(cache) as f:
            for line in f:
                w = json.loads(line)
                if w["s"] == s:
                    out += w["rows"]
                    s = w["e"] + 1
    window = 200_000
    with open(cache, "a") as cf:
        while s <= end:
            e = min(end, s + window - 1)
            rows = []
            for page in range(1, MAX_PAGES + 1):
                r = routescan_get(ROUTESCAN_ETHERSCAN, {"module": "logs", "action": "getLogs", "address": address,
                                                        "fromBlock": s, "toBlock": e, "page": page, "offset": PAGE})
                time.sleep(0.2)
                if r["status"] != "1":
                    if not r["message"].startswith("No records"):
                        raise RuntimeError(r)
                    break
                rows += r["result"]
                if len(r["result"]) < PAGE:
                    break
            else:
                if e > s:
                    window = max(1, window // 2)
                    continue
            cf.write(json.dumps({"s": s, "e": e, "rows": rows}) + "\n")
            cf.flush()
            out += rows
            s = e + 1
            if len(rows) < 3 * PAGE:
                window = min(2_000_000, window * 2)
            print(f"  {address[:10]} up to block {e:,}: {len(out):,} logs", flush=True)
    seen, uniq = set(), []
    for lg in out:
        k = (lg["transactionHash"], hexint(lg["logIndex"]))
        if k not in seen:
            seen.add(k)
            uniq.append(lg)
    uniq.sort(key=lambda lg: (hexint(lg["blockNumber"]), hexint(lg["logIndex"])))
    return uniq


def repair_wrbnt(logs, close_block):
    """Routescan's log index can miss a block. WRBNT supply only changes on
    Deposit and Withdrawal, so the running sum of those events must equal
    totalSupply() at every block. Binary search for the first block where it
    does not, read that block's logs from the RPC (single block queries are
    allowed), merge, and repeat until the sums match at the closing block."""
    added = 0
    while True:
        moves = sorted((hexint(lg["blockNumber"]), (1 if lg["topics"][0] == TOPIC_DEPOSIT else -1) * hexint(lg["data"]))
                       for lg in logs if lg["topics"][0] in (TOPIC_DEPOSIT, TOPIC_WITHDRAWAL))
        blocks = [b for b, _ in moves]
        cum, c = [], 0
        for _, v in moves:
            c += v
            cum.append(c)

        def gap(b):
            i = bisect.bisect_right(blocks, b)
            supply = int(rpc("eth_call", [{"to": WRBNT, "data": "0x18160ddd"}, hex(b)]) or "0x0", 16)
            return (cum[i - 1] if i else 0) - supply

        if gap(close_block) == 0:
            print(f"  WRBNT events reconcile with totalSupply; {added} logs added from the RPC")
            return logs
        lo, hi = 0, close_block
        while lo < hi:
            mid = (lo + hi) // 2
            if gap(mid) != 0:
                hi = mid
            else:
                lo = mid + 1
        have = {(lg["transactionHash"], hexint(lg["logIndex"])) for lg in logs if hexint(lg["blockNumber"]) == lo}
        fresh = [lg for lg in rpc("eth_getLogs", [{"address": WRBNT, "fromBlock": hex(lo), "toBlock": hex(lo)}])
                 if (lg["transactionHash"], hexint(lg["logIndex"])) not in have]
        if not fresh:
            raise RuntimeError(f"WRBNT supply gap at block {lo} that the RPC logs do not explain")
        print(f"  block {lo:,}: {len(fresh)} logs missing from Routescan, added from the RPC")
        logs = sorted(logs + fresh, key=lambda lg: (hexint(lg["blockNumber"]), hexint(lg["logIndex"])))
        added += len(fresh)


def topic_addr(t):
    return "0x" + t[-40:].lower()


def main():
    close_block = snapshots()["close"]["block"]

    wrbnt = []
    for lg in repair_wrbnt(get_logs(WRBNT, 0, close_block), close_block):
        t = lg["topics"]
        n = hexint(lg["blockNumber"])
        v = str(hexint(lg["data"]))
        if t[0] == TOPIC_TRANSFER:
            wrbnt.append([n, lg["transactionHash"], "transfer", topic_addr(t[1]), topic_addr(t[2]), v])
        elif t[0] == TOPIC_DEPOSIT:
            wrbnt.append([n, lg["transactionHash"], "wrap", "", topic_addr(t[1]), v])
        elif t[0] == TOPIC_WITHDRAWAL:
            wrbnt.append([n, lg["transactionHash"], "unwrap", topic_addr(t[1]), "", v])
    save_json(os.path.join(RAW, "wrbnt_events.json.gz"), wrbnt, gz=True)
    print("WRBNT events", len(wrbnt))

    # Stake(address account, uint256 amount, uint256 tvl, uint256 timestamp), same for Unstake.
    # None of the arguments are indexed, so the account is the first data word.
    stake_topic = "0x" + keccak("Stake(address,uint256,uint256,uint256)")
    unstake_topic = "0x" + keccak("Unstake(address,uint256,uint256,uint256)")
    claim_topic = "0x" + keccak("ClaimLiquidXReward(address,uint256)")
    pools = {}
    for pool in (POOL_NO_LOCK, POOL_365):
        ev = []
        for lg in get_logs(pool, 0, close_block):
            t0 = lg["topics"][0]
            d = lg["data"][2:]
            words = [d[i:i + 64] for i in range(0, len(d), 64)]
            n = hexint(lg["blockNumber"])
            if t0 in (stake_topic, unstake_topic):
                kind = "stake" if t0 == stake_topic else "unstake"
                ev.append([n, lg["transactionHash"], kind, "0x" + words[0][-40:], str(int(words[1], 16))])
            elif t0 == claim_topic:
                ev.append([n, lg["transactionHash"], "claim", "0x" + words[0][-40:], str(int(words[1], 16))])
        pools[pool] = ev
        print(pool, "events", len(ev))
    save_json(os.path.join(RAW, "staking_events.json.gz"), pools, gz=True)


def keccak(sig):
    """Keccak-256 of a string, pure Python, so no extra dependency is needed."""
    return _keccak256(sig.encode()).hex()


# Minimal Keccak-256 (the pre-NIST padding used by Ethereum).
_RC = [0x0000000000000001, 0x0000000000008082, 0x800000000000808A, 0x8000000080008000, 0x000000000000808B,
       0x0000000080000001, 0x8000000080008081, 0x8000000000008009, 0x000000000000008A, 0x0000000000000088,
       0x0000000080008009, 0x000000008000000A, 0x000000008000808B, 0x800000000000008B, 0x8000000000008089,
       0x8000000000008003, 0x8000000000008002, 0x8000000000000080, 0x000000000000800A, 0x800000008000000A,
       0x8000000080008081, 0x8000000000008080, 0x0000000080000001, 0x8000000080008008]
_ROT = [[0, 36, 3, 41, 18], [1, 44, 10, 45, 2], [62, 6, 43, 15, 61], [28, 55, 25, 21, 56], [27, 20, 39, 8, 14]]
_M = (1 << 64) - 1


def _rol(x, n):
    return ((x << n) | (x >> (64 - n))) & _M if n else x


def _f(a):
    for rc in _RC:
        c = [a[x][0] ^ a[x][1] ^ a[x][2] ^ a[x][3] ^ a[x][4] for x in range(5)]
        d = [c[(x - 1) % 5] ^ _rol(c[(x + 1) % 5], 1) for x in range(5)]
        a = [[a[x][y] ^ d[x] for y in range(5)] for x in range(5)]
        b = [[0] * 5 for _ in range(5)]
        for x in range(5):
            for y in range(5):
                b[y][(2 * x + 3 * y) % 5] = _rol(a[x][y], _ROT[x][y])
        a = [[b[x][y] ^ ((~b[(x + 1) % 5][y]) & b[(x + 2) % 5][y]) for y in range(5)] for x in range(5)]
        a[0][0] ^= rc
    return a


def _keccak256(data):
    rate = 136
    msg = bytearray(data) + b"\x01"
    while len(msg) % rate:
        msg += b"\x00"
    msg[-1] |= 0x80
    a = [[0] * 5 for _ in range(5)]
    for off in range(0, len(msg), rate):
        block = msg[off:off + rate]
        for i in range(rate // 8):
            x, y = i % 5, i // 5
            a[x][y] ^= int.from_bytes(block[i * 8:i * 8 + 8], "little")
        a = _f(a)
    out = b"".join(a[i % 5][i // 5].to_bytes(8, "little") for i in range(4))
    return out


if __name__ == "__main__":
    main()
