"""Step 6. Turn the raw reads into the report figures.

Outputs (all aggregated, no unlabelled wallet is listed on its own):
  public/data/report.json      every figure used by the site and the PDF
  public/data/report.js        the same, as window.REPORT for the static site
  public/data/*.csv            the data behind each chart
  data/raw/checks.json         verification results (also inside report.json)

Definitions are in METHOD.md. In short:
  * Location view: where each RBNT physically sits at a snapshot. Sums to
    total supply.
  * Holdings view (used for holder counts, bands, concentration and the
    largest holder groups): RBNT a wallet holds directly, plus WRBNT it
    holds, plus RBNT it has staked in a Reddex pool. The WRBNT contract and
    the pools then only keep what is not owed to anyone (surplus and reward
    funds), so every RBNT is counted once.
"""

import csv
import json
import os
from collections import defaultdict
from datetime import datetime, timezone

from common import (EXPLORER, GENESIS_SUPPLY_WEI, LABEL_CHECK, NAMED, POOL_365, POOL_NO_LOCK, PUBLIC_DATA, QUARTER, RAW,
                    ROUTESCAN_ETHERSCAN, ROUTESCAN_LABELS, TREASURY_ALLOCATION, WRBNT, load_json, routescan_get,
                    rpc_batch, save_json, snapshots)

E18 = 10**18
ONE = E18
BANDS = [
    ("1 to 999", 1, 1_000),
    ("1,000 to 9,999", 1_000, 10_000),
    ("10,000 to 99,999", 10_000, 100_000),
    ("100,000 to 999,999", 100_000, 1_000_000),
    ("1 million to 9.99 million", 1_000_000, 10_000_000),
    ("10 million to 99.9 million", 10_000_000, 100_000_000),
    ("100 million or more", 100_000_000, None),
]
COHORTS = [("Largest 10", 0, 10), ("Ranks 11 to 100", 10, 100), ("Ranks 101 to 1,000", 100, 1000),
           ("Ranks 1,001 to 10,000", 1000, 10000)]
MOVE = 0.01  # a change of more than 1% counts as adding or reducing


def pct_txt(x, d=1):
    return f"{x * 100:.{d}f}%"


def r(x, d=0):
    """Wei to RBNT, rounded for publishing."""
    v = x / E18
    return round(v, d) if d else round(v)


def fees_paid(addr, ob, cb):
    """Network fees a regular wallet paid for the transactions it sent between
    the two blocks: gasUsed x effectiveGasPrice from each receipt. The list of
    transactions comes from Routescan; the amounts come from the RPC."""
    cache = os.path.join(RAW, "named_fees.json")
    seen = load_json(cache) if os.path.exists(cache) else {}
    key = f"{addr}:{ob}:{cb}"
    if key in seen:
        return int(seen[key][0]), seen[key][1]
    txs, page = [], 1
    while True:
        res = routescan_get(ROUTESCAN_ETHERSCAN, {"module": "account", "action": "txlist", "address": addr,
                                                  "startblock": ob + 1, "endblock": cb, "page": page,
                                                  "offset": 1000, "sort": "asc"})
        rows = res["result"] if res["status"] == "1" else []
        txs += [t["hash"] for t in rows if t["from"].lower() == addr]
        if len(rows) < 1000:
            break
        page += 1
    fee = 0
    for i in range(0, len(txs), 50):
        for rc in rpc_batch([("eth_getTransactionReceipt", [h]) for h in txs[i:i + 50]]):
            fee += int(rc["gasUsed"], 16) * int(rc["effectiveGasPrice"], 16)
    seen[key] = [str(fee), len(txs)]
    save_json(cache, seen)
    return fee, len(txs)


def main():
    snap = snapshots()
    pts = snap["points"]
    K = len(pts)
    ob, cb = snap["open"]["block"], snap["close"]["block"]
    bal = load_json(os.path.join(RAW, "balances.json.gz"))
    assert bal["blocks"] == [p["block"] for p in pts]

    native = {a: [int(x) for x in v] for a, v in bal["native"].items()}
    wrbnt = {a: [int(x) for x in v] for a, v in bal["wrbnt"].items()}
    staked = {p: {a: [int(x) for x in v] for a, v in d.items()} for p, d in bal["staked"].items()}
    total_stake = {p: [int(x) for x in v] for p, v in bal["total_stake"].items()}
    wrbnt_supply = [int(x) for x in bal["wrbnt_total_supply"]]
    code = bal["code"]
    labels = {a.lower(): v for a, v in ROUTESCAN_LABELS.items()}
    named = dict(NAMED)
    for a, (name, kind) in labels.items():
        named.setdefault(a, (name, kind))

    zero = [0] * K
    addrs = set(native) | set(wrbnt) | {a for d in staked.values() for a in d} | set(named)

    def nat(a):
        return native.get(a, zero)

    # ---------- supply and checks ----------
    checks = []

    def check(name, ok, detail):
        checks.append({"check": name, "pass": bool(ok), "detail": detail})

    supply = [sum(v[i] for v in native.values()) for i in range(K)]
    scan_dir = os.path.join(RAW, "scan")
    fees_open = fees_close = 0
    tx_q = 0
    senders_q = set()
    named_tx = []
    for f in sorted(os.listdir(scan_dir)):
        d = load_json(os.path.join(scan_dir, f))
        fees_open += int(d["fees_le_open"])
        fees_close += int(d["fees_le_close"])
        tx_q += d["tx_in_quarter"]
        senders_q.update(d["senders_in_quarter"])
        named_tx += d["named_tx"]
    fees_q = fees_close - fees_open
    unlocated = [GENESIS_SUPPLY_WEI - x for x in supply]
    check("All balances found add up to the 10 billion genesis supply",
          all(0 <= u < GENESIS_SUPPLY_WEI // 100_000 for u in unlocated),
          f"Block 0 held exactly 10,000,000,000 RBNT. The balances found add up to {r(supply[0]):,} RBNT at the start and "
          f"{r(supply[-1]):,} at the end. The other {pct_txt(unlocated[-1] / GENESIS_SUPPLY_WEI, 4)} ({r(unlocated[-1]):,} RBNT) could not be placed, "
          "most likely at addresses the protocol paid directly that never appear in a transaction (METHOD.md, section 10). Pass level: under 0.001%.")
    check("Total supply held steady through the quarter",
          abs(supply[-1] - supply[0]) < fees_q // 100,
          f"Sum of all balances changed by {r(supply[-1] - supply[0], 2):,} RBNT while {r(fees_q):,} RBNT was paid in network fees, "
          "so the fees were paid back out to network participants, not burned. Pass level: change under 1% of fees paid.")
    for p in pts:
        check(f"Snapshot block for {p['state_at_utc']} matches Routescan", p["routescan_matches_rpc"],
              f"RPC binary search block {p['block']:,}; Routescan getblocknobytime {p['routescan_block']:,}.")

    wsum = [sum(v[i] for v in wrbnt.values()) for i in range(K)]
    check("WRBNT balances add up to WRBNT total supply", all(wsum[i] == wrbnt_supply[i] for i in range(K)),
          "At every snapshot, the WRBNT held by all addresses equals totalSupply() of the contract. "
          + ", ".join(f"{p['label']}: {r(wrbnt_supply[i]):,}" for i, p in enumerate(pts)))
    check("WRBNT is fully backed by RBNT", all(nat(WRBNT)[i] >= wsum[i] for i in range(K)),
          f"RBNT held by the WRBNT contract at close {r(nat(WRBNT)[-1]):,}; WRBNT held by all addresses {r(wsum[-1]):,}.")
    for p_addr, d in staked.items():
        ssum = [sum(v[i] for v in d.values()) for i in range(K)]
        check(f"Staker positions add up to totalStake ({named[p_addr][0]})",
              all(ssum[i] == total_stake[p_addr][i] for i in range(K)),
              f"Sum of userInfo(amount) at close {r(ssum[-1]):,}; totalStake() {r(total_stake[p_addr][-1]):,}.")

    # ---------- holdings view (look-through) ----------
    hold = {}
    for a in addrs:
        h = list(nat(a))
        w = wrbnt.get(a)
        if w:
            h = [h[i] + w[i] for i in range(K)]
        for p_addr, d in staked.items():
            s = d.get(a)
            if s:
                h = [h[i] + s[i] for i in range(K)]
        hold[a] = h
    # WRBNT totalSupply() is the contract's own RBNT balance (WETH9 design), so the
    # surplus is measured against the WRBNT that addresses actually hold.
    hold[WRBNT] = [hold[WRBNT][i] - wsum[i] for i in range(K)]
    for p_addr in staked:
        hold[p_addr] = [hold[p_addr][i] - total_stake[p_addr][i] for i in range(K)]
    hsum = [sum(v[i] for v in hold.values()) for i in range(K)]
    check("Holdings view counts every RBNT once", all(hsum[i] == supply[i] for i in range(K)),
          "After moving WRBNT and staked RBNT to their holders, the total still equals total supply at every snapshot.")

    # ---------- location view ----------
    def kind(a):
        if a in named:
            return named[a][1]
        c = code.get(a)
        return "contract" if c == "contract" else "wallet"

    loc_keys = [("reserved", "Redbelly reserved wallets", "The nine wallets listed on the DAO treasury page."),
                ("staking", "Reddex staking pools", "Stakes plus reward funds in the two RBNT pools."),
                ("wrapper", "Wrapped RBNT contract", "RBNT locked to back WRBNT one to one."),
                ("exchange", "Labelled exchange wallets", "Exchange wallets labelled on Routescan."),
                ("contract", "Other smart contracts", "Programs such as trading pools, vesting and multisig contracts. Not labelled."),
                ("wallet", "Regular wallets", "Wallets controlled by a private key. Not labelled.")]
    loc = {k: [0] * K for k, _, _ in loc_keys}
    for a, v in native.items():
        k = kind(a)
        if k not in loc:
            k = "contract"
        for i in range(K):
            loc[k][i] += v[i]
    location = [{"key": k, "label": lab, "desc": desc, "rbnt": [r(x) for x in loc[k]],
                 "share": [loc[k][i] / supply[i] for i in range(K)]}
                for k, lab, desc in loc_keys if any(loc[k]) or k == "exchange"]

    # ---------- holders, bands, concentration (excluding named wallets) ----------
    base = {a: h for a, h in hold.items() if a not in named}
    base_total = [sum(h[i] for h in base.values()) for i in range(K)]
    holders_ge1 = [sum(1 for h in base.values() if h[i] >= ONE) for i in range(K)]
    holders_gt0 = [sum(1 for h in base.values() if h[i] > 0) for i in range(K)]
    bands = []
    for lab, lo, hi in BANDS:
        cnt, amt = [0] * K, [0] * K
        for h in base.values():
            for i in range(K):
                x = h[i]
                if x >= lo * E18 and (hi is None or x < hi * E18):
                    cnt[i] += 1
                    amt[i] += x
        bands.append({"label": lab, "holders": cnt, "rbnt": [r(x) for x in amt],
                      "share": [amt[i] / base_total[i] for i in range(K)]})
    dust = [sum(1 for h in base.values() if 0 < h[i] < ONE) for i in range(K)]

    ranked = [sorted((h[i] for h in base.values()), reverse=True) for i in range(K)]

    def top_share(n):
        return [sum(ranked[i][:n]) / base_total[i] for i in range(K)]

    def half_count(i):
        acc, n = 0, 0
        for x in ranked[i]:
            acc += x
            n += 1
            if acc * 2 >= base_total[i]:
                return n
        return n

    wallets = [h for a, h in base.items() if kind(a) == "wallet"]
    w_ranked = [sorted((h[i] for h in wallets), reverse=True) for i in range(K)]
    w_total = [sum(x) for x in w_ranked]
    concentration = {
        "wallets_top10": [sum(w_ranked[i][:10]) / w_total[i] for i in range(K)],
        "wallets_top100": [sum(w_ranked[i][:100]) / w_total[i] for i in range(K)],
        "wallets_total": [r(x) for x in w_total],
        "top10_contracts_close": sum(1 for a in sorted(base, key=lambda a: base[a][-1], reverse=True)[:10] if kind(a) == "contract"),
        "top10": top_share(10), "top100": top_share(100), "top1000": top_share(1000),
        "half_count": [half_count(i) for i in range(K)],
        "base_total": [r(x) for x in base_total],
        "base_share_of_supply": [base_total[i] / supply[i] for i in range(K)],
    }

    # ---------- largest holder groups, ranked at the opening snapshot ----------
    order = sorted(base, key=lambda a: base[a][0], reverse=True)
    cohorts = []
    for lab, lo, hi in COHORTS:
        members = order[lo:hi]
        o = sum(base[a][0] for a in members)
        c = sum(base[a][-1] for a in members)
        up = sum(1 for a in members if base[a][-1] > base[a][0] * (1 + MOVE))
        down = sum(1 for a in members if base[a][-1] < base[a][0] * (1 - MOVE))
        emptied = sum(1 for a in members if base[a][-1] < ONE)
        contracts = sum(1 for a in members if kind(a) == "contract")
        path = [sum(base[a][i] for a in members) for i in range(K)]
        moves = sorted((base[a][-1] - base[a][0] for a in members), reverse=(c >= o))
        top3 = sum(moves[:3]) / (c - o) if c != o else 0
        cohorts.append({"label": lab, "size": len(members), "open": r(o), "close": r(c), "change": r(c - o),
                        "change_pct": (c - o) / o if o else 0, "added": up, "reduced": down,
                        "steady": len(members) - up - down, "emptied": emptied, "contracts": contracts,
                        "path": [r(x) for x in path], "top3_share_of_change": top3,
                        "min_open": r(base[members[-1]][0]) if members else 0})
    top1000_open = set(order[:1000])
    order_close = sorted(base, key=lambda a: base[a][-1], reverse=True)
    top1000_close = order_close[:1000]
    entrants = [a for a in top1000_close if a not in top1000_open]
    entr = {
        "count": len(entrants),
        "new_holders": sum(1 for a in entrants if base[a][0] < ONE),
        "holdings_close": r(sum(base[a][-1] for a in entrants)),
        "holdings_open": r(sum(base[a][0] for a in entrants)),
        "contracts": sum(1 for a in entrants if kind(a) == "contract"),
        "threshold_close": r(base[top1000_close[-1]][-1]),
        "threshold_open": r(base[order[999]][0]),
    }

    # ---------- named wallet flows inside the quarter ----------
    internal = load_json(os.path.join(RAW, "internal_transfers.json.gz"))
    wev = load_json(os.path.join(RAW, "wrbnt_events.json.gz"))
    sev = load_json(os.path.join(RAW, "staking_events.json.gz"))

    # status of quarter transactions that move value to or from a named wallet
    q_named_tx = [t for t in named_tx if ob < t[0] <= cb]
    status_cache = os.path.join(RAW, "named_tx_status.json")
    status = load_json(status_cache) if os.path.exists(status_cache) else {}
    missing = [t[1] for t in q_named_tx if t[1] not in status]
    for i in range(0, len(missing), 100):
        chunk = missing[i:i + 100]
        for h, rc in zip(chunk, rpc_batch([("eth_getTransactionReceipt", [h]) for h in chunk])):
            status[h] = int(rc["status"], 16)
    save_json(status_cache, status)

    flows = defaultdict(lambda: defaultdict(lambda: {"rbnt": 0, "n": 0}))

    def add_flow(wallet, direction, other, amount, asset):
        key = named[other][0] if other in named else ("Other addresses, not named" if other else "Network")
        f = flows[wallet][(direction, key, asset)]
        f["rbnt"] += amount
        f["n"] += 1

    for blk, h, fr, to, v in q_named_tx:
        if status.get(h) != 1:
            continue
        v = int(v)
        if fr in named:
            add_flow(fr, "out", to, v, "RBNT")
        if to in named:
            add_flow(to, "in", fr, v, "RBNT")
    for blk, h, fr, to, v, typ, created, err in internal:
        if not (ob < blk <= cb) or err != "0" or typ == "delegatecall" or v == "0":
            continue
        to = to or created
        v = int(v)
        if fr in named:
            add_flow(fr, "out", to, v, "RBNT")
        if to in named:
            add_flow(to, "in", fr, v, "RBNT")
    wrap_q = unwrap_q = 0
    wrap_all = unwrap_all = 0
    for blk, h, typ, fr, to, v in wev:
        v = int(v)
        if typ == "wrap":
            wrap_all += v
        elif typ == "unwrap":
            unwrap_all += v
        if not (ob < blk <= cb):
            continue
        if typ == "wrap":
            wrap_q += v
            if to in named:
                f = flows[to][("in", "Wrapping its own RBNT", "WRBNT")]
                f["rbnt"] += v
                f["n"] += 1
        elif typ == "unwrap":
            unwrap_q += v
            if fr in named:
                f = flows[fr][("out", "Unwrapping to RBNT", "WRBNT")]
                f["rbnt"] += v
                f["n"] += 1
        elif typ == "transfer":
            if fr in named:
                add_flow(fr, "out", to, v, "WRBNT")
            if to in named:
                add_flow(to, "in", fr, v, "WRBNT")
    check("WRBNT events explain WRBNT supply", wrap_all - unwrap_all == wrbnt_supply[-1],
          f"All wraps minus all unwraps up to the closing block {r(wrap_all - unwrap_all):,}; totalSupply() {r(wrbnt_supply[-1]):,}.")

    named_rows = []
    for a, (name, k) in named.items():
        n = nat(a)
        w = wrbnt.get(a, zero)
        f = flows.get(a, {})
        rb_in = sum(x["rbnt"] for (d, _, asset), x in f.items() if d == "in" and asset == "RBNT")
        rb_out = sum(x["rbnt"] for (d, _, asset), x in f.items() if d == "out" and asset == "RBNT")
        fee, fee_n = (0, 0) if a in code else fees_paid(a, ob, cb)
        residual = n[-1] - n[0] - rb_in + rb_out + fee
        w_in = sum(x["rbnt"] for (d, _, asset), x in f.items() if d == "in" and asset == "WRBNT")
        w_out = sum(x["rbnt"] for (d, _, asset), x in f.items() if d == "out" and asset == "WRBNT")
        w_residual = w[-1] - w[0] - w_in + w_out
        flist = []
        for (d, key, asset), x in sorted(f.items(), key=lambda kv: -kv[1]["rbnt"]):
            flist.append({"direction": d, "counterparty": key, "asset": asset, "amount": r(x["rbnt"]), "transfers": x["n"]})
        row = {"name": name, "address": a, "kind": k, "explorer": f"{EXPLORER}/address/{a}",
               "allocation": TREASURY_ALLOCATION.get(a), "rbnt": [r(x) for x in n], "wrbnt": [r(x) for x in w],
               "change": r(n[-1] - n[0]), "in": r(rb_in), "out": r(rb_out), "fees_paid": r(fee, 2), "unexplained": r(residual, 4),
               "flows": flist, "is_contract": a in code}
        named_rows.append(row)
        if k == "reserved":
            check(f"Transfers explain the balance change ({name})", abs(residual) < E18 // 1000 and w_residual == 0,
                  f"RBNT: start {r(n[0]):,} + in {r(rb_in):,} - out {r(rb_out):,}"
                  + (f" - network fees {r(fee, 2):,} ({fee_n} transactions)" if fee else "")
                  + f" = end {r(n[-1]):,}; unexplained {r(residual, 4):,}. WRBNT: start {r(w[0]):,}, end {r(w[-1]):,}, unexplained {r(w_residual, 4):,}.")

    # ---------- staking ----------
    stake_topic_rows = {}
    pools = []
    for p_addr in (POOL_NO_LOCK, POOL_365):
        ev = sev.get(p_addr, [])
        q = [e for e in ev if ob < e[0] <= cb]
        st = [int(e[4]) for e in q if e[2] == "stake"]
        un = [int(e[4]) for e in q if e[2] == "unstake"]
        cl = [int(e[4]) for e in q if e[2] == "claim"]
        all_st = sum(int(e[4]) for e in ev if e[2] == "stake")
        all_un = sum(int(e[4]) for e in ev if e[2] == "unstake")
        check(f"Stake and unstake events explain totalStake ({named[p_addr][0]})",
              all_st - all_un == total_stake[p_addr][-1],
              f"All stakes minus all unstakes up to close {r(all_st - all_un):,}; totalStake() {r(total_stake[p_addr][-1]):,}.")
        stake_hashes = {e[1] for e in ev if e[2] == "stake"}
        # money into the pool that was not a stake() call is reward funding
        funding = defaultdict(int)
        for blk, h, fr, to, v in q_named_tx:
            if to == p_addr and h not in stake_hashes and status.get(h) == 1:
                funding[named[fr][0] if fr in named else "Other addresses, not named"] += int(v)
        for blk, h, fr, to, v, typ, created, err in internal:
            if ob < blk <= cb and to == p_addr and err == "0" and typ != "delegatecall" and v != "0" and h not in stake_hashes:
                funding[named[fr][0] if fr in named else "Other addresses, not named"] += int(v)
        users = staked.get(p_addr, {})
        stakers = [sum(1 for v in users.values() if v[i] > 0) for i in range(K)]
        added = sum(1 for v in users.values() if v[-1] > v[0])
        reduced = sum(1 for v in users.values() if v[-1] < v[0])
        new = sum(1 for v in users.values() if v[0] == 0 and v[-1] > 0)
        left = sum(1 for v in users.values() if v[0] > 0 and v[-1] == 0)
        top10 = [sum(sorted((v[i] for v in users.values()), reverse=True)[:10]) / total_stake[p_addr][i]
                 if total_stake[p_addr][i] else 0 for i in range(K)]
        bal_p = nat(p_addr)
        pools.append({
            "name": named[p_addr][0], "address": p_addr, "explorer": f"{EXPLORER}/address/{p_addr}",
            "balance": [r(x) for x in bal_p], "staked": [r(x) for x in total_stake[p_addr]],
            "reward_funds": [r(bal_p[i] - total_stake[p_addr][i]) for i in range(K)],
            "stakers": stakers, "stakers_added": added, "stakers_reduced": reduced, "new_stakers": new,
            "left": left, "top10_share": top10,
            "q": {"stake_n": len(st), "stake_rbnt": r(sum(st)), "unstake_n": len(un), "unstake_rbnt": r(sum(un)),
                  "claim_n": len(cl), "claim_rbnt": r(sum(cl)),
                  "funding": [{"from": k2, "rbnt": r(v2)} for k2, v2 in sorted(funding.items(), key=lambda kv: -kv[1])]},
        })
    stakers_any = [len({a for d in staked.values() for a, v in d.items() if v[i] > 0}) for i in range(K)]

    # ---------- fee payouts without transactions ----------
    # Addresses whose RBNT balance changed during the quarter with no transaction,
    # internal transfer or event touching them: credits made by the protocol itself.
    touched = set(senders_q) | {e[3].lower() for ev in sev.values() for e in ev if ob < e[0] <= cb}
    for f in sorted(os.listdir(scan_dir)):
        d = load_json(os.path.join(scan_dir, f))
        if d["end"] > ob and d["start"] <= cb:
            touched.update(d["addrs"])
    for row in internal:
        if ob - 10_000 < row[0] <= cb:
            touched.update(x for x in (row[2], row[3], row[6]) if x)
    for row in wev:
        if ob < row[0] <= cb:
            touched.update(x for x in (row[3], row[4]) if x)
    credited = [(v[-1] - v[0], a) for a, v in native.items() if v[-1] != v[0] and a not in touched]
    protocol_credits = {
        "addresses": sum(1 for x, _ in credited if x > 0),
        "contracts": sum(1 for x, a in credited if x > 0 and kind(a) == "contract"),
        "rbnt": r(sum(x for x, _ in credited if x > 0)),
        "decreases": sum(1 for x, _ in credited if x < 0),
    }

    # ---------- WRBNT ----------
    wrbnt_holders = [sum(1 for a, v in wrbnt.items() if v[i] >= ONE) for i in range(K)]
    wrbnt_contract_share = [sum(v[i] for a, v in wrbnt.items() if kind(a) == "contract") / wrbnt_supply[i]
                            if wrbnt_supply[i] else 0 for i in range(K)]
    wr = {"supply": [r(x) for x in wrbnt_supply], "backing": [r(x) for x in nat(WRBNT)],
          "holders": wrbnt_holders, "wrapped_q": r(wrap_q), "unwrapped_q": r(unwrap_q),
          "held_by_contracts_share": wrbnt_contract_share}

    # ---------- wallets vs contracts among holders ----------
    kinds_close = defaultdict(lambda: [0, 0])
    for a, h in base.items():
        if h[-1] >= ONE:
            kk = kind(a)
            kinds_close[kk][0] += 1
            kinds_close[kk][1] += h[-1]

    report = {
        "meta": {
            "quarter": QUARTER, "generated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
            "snapshots": [{"key": p["key"], "label": p["label"], "state_at_utc": p["state_at_utc"], "block": p["block"],
                           "block_time_utc": p["block_time_utc"]} for p in pts],
            "universe_size": bal["universe_size"], "routescan_list_size": bal["routescan_list_size"],
            "explorer": EXPLORER,
        },
        "supply": {"genesis": r(GENESIS_SUPPLY_WEI), "total": [r(x) for x in supply], "unlocated": [r(x) for x in unlocated],
                   "fees_in_quarter": r(fees_q), "fees_to_close": r(fees_close),
                   "change_in_quarter": r(supply[-1] - supply[0], 2)},
        "location": location,
        "holders": {"ge1": holders_ge1, "gt0": holders_gt0, "dust": dust, "bands": bands,
                    "kinds_close": {k: {"holders": v[0], "rbnt": r(v[1])} for k, v in kinds_close.items()}},
        "concentration": concentration,
        "cohorts": cohorts, "entrants": entr,
        "staking": {"pools": pools, "stakers_any": stakers_any,
                    "total_staked": [r(sum(total_stake[p][i] for p in total_stake)) for i in range(K)],
                    "total_balance": [r(sum(nat(p)[i] for p in total_stake)) for i in range(K)]},
        "named": named_rows,
        "exchanges": {"labelled": [{"name": v[0], "address": a} for a, v in labels.items() if v[1] == "exchange"],
                      "check": LABEL_CHECK},
        "wrbnt": wr,
        "activity": {"transactions": tx_q, "sending_addresses": len(senders_q), "protocol_fee_payouts": protocol_credits},
        "checks": checks,
    }
    os.makedirs(PUBLIC_DATA, exist_ok=True)
    save_json(os.path.join(PUBLIC_DATA, "report.json"), report)
    with open(os.path.join(PUBLIC_DATA, "report.js"), "w") as f:
        f.write("window.REPORT = " + json.dumps(report, separators=(",", ":")) + ";\n")
    save_json(os.path.join(RAW, "checks.json"), checks)
    write_csvs(report)
    for c in checks:
        print(("PASS " if c["pass"] else "FAIL ") + c["check"] + " | " + c["detail"])


def write_csvs(rep):
    pts = rep["meta"]["snapshots"]
    head = [p["state_at_utc"] + " (block " + str(p["block"]) + ")" for p in pts]

    def w(name, header, rows):
        with open(os.path.join(PUBLIC_DATA, name), "w", newline="") as f:
            cw = csv.writer(f)
            cw.writerow(header)
            cw.writerows(rows)

    w("01_where_rbnt_sits.csv", ["category", "description"] + [f"RBNT at {h}" for h in head],
      [[x["label"], x["desc"]] + x["rbnt"] for x in rep["location"]] +
      [["Total supply", "Sum of all balances"] + rep["supply"]["total"]])
    w("02_holders_by_balance_band.csv", ["band (RBNT, counting wrapped and staked)"] +
      [f"holders at {h}" for h in head] + [f"RBNT at {h}" for h in head],
      [[b["label"]] + b["holders"] + b["rbnt"] for b in rep["holders"]["bands"]] +
      [["All holders with 1 RBNT or more"] + rep["holders"]["ge1"] + [""] * len(pts),
       ["Addresses with less than 1 RBNT (not counted as holders)"] + rep["holders"]["dust"] + [""] * len(pts)])
    c = rep["concentration"]
    w("03_concentration.csv", ["measure (shares in %, of RBNT outside named wallets unless stated)"] + head,
      [["Share held by the largest 10 holders"] + [round(x * 100, 2) for x in c["top10"]],
       ["Share held by the largest 100 holders"] + [round(x * 100, 2) for x in c["top100"]],
       ["Share held by the largest 1,000 holders"] + [round(x * 100, 2) for x in c["top1000"]],
       ["Number of holders that together hold half"] + c["half_count"],
       ["Regular wallets only: share held by the largest 10 (of RBNT in regular wallets)"] + [round(x * 100, 2) for x in c["wallets_top10"]],
       ["Regular wallets only: share held by the largest 100 (of RBNT in regular wallets)"] + [round(x * 100, 2) for x in c["wallets_top100"]],
       ["RBNT held by regular wallets outside named wallets"] + c["wallets_total"],
       ["RBNT held outside named wallets"] + c["base_total"]])
    w("04_largest_holder_groups.csv",
      ["group (ranked at opening snapshot)", "addresses", "RBNT at open", "RBNT at close", "change RBNT", "change %",
       "added more than 1%", "reduced more than 1%", "steady", "emptied (under 1 RBNT at close)", "smart contracts in group"],
      [[x["label"], x["size"], x["open"], x["close"], x["change"], round(x["change_pct"] * 100, 2), x["added"],
        x["reduced"], x["steady"], x["emptied"], x["contracts"]] for x in rep["cohorts"]])
    rows = []
    for p in rep["staking"]["pools"]:
        for i, h in enumerate(head):
            rows.append([p["name"], p["address"], h, p["balance"][i], p["staked"][i], p["reward_funds"][i], p["stakers"][i]])
    w("05_staking_pools.csv", ["pool", "address", "snapshot", "pool RBNT balance", "staked (totalStake)",
                               "reward funds (balance minus staked)", "wallets with a stake"], rows)
    rows = []
    for p in rep["staking"]["pools"]:
        q = p["q"]
        rows += [[p["name"], "staked", q["stake_n"], q["stake_rbnt"]], [p["name"], "unstaked", q["unstake_n"], q["unstake_rbnt"]],
                 [p["name"], "rewards claimed", q["claim_n"], q["claim_rbnt"]]]
        rows += [[p["name"], "reward funding from " + f["from"], "", f["rbnt"]] for f in q["funding"]]
    w("06_staking_flows_in_quarter.csv", ["pool", "flow", "events", "RBNT"], rows)
    w("07_named_wallets.csv", ["wallet", "address", "type", "original allocation (treasury page)"] +
      [f"RBNT at {h}" for h in head] + [f"WRBNT at {h}" for h in head] + ["RBNT in during quarter", "RBNT out during quarter"],
      [[x["name"], x["address"], x["kind"], x["allocation"] if x["allocation"] is not None else ""] + x["rbnt"] + x["wrbnt"] + [x["in"], x["out"]]
       for x in rep["named"]])
    rows = []
    for x in rep["named"]:
        for f in x["flows"]:
            rows.append([x["name"], f["direction"], f["counterparty"], f["asset"], f["amount"], f["transfers"]])
    w("08_named_wallet_flows_in_quarter.csv", ["named wallet", "direction", "counterparty (named, or grouped)", "asset",
                                               "amount", "transfers"], rows)
    wr = rep["wrbnt"]
    w("09_wrbnt.csv", ["measure"] + head,
      [["WRBNT total supply"] + wr["supply"], ["RBNT held by WRBNT contract"] + wr["backing"],
       ["Addresses holding 1 WRBNT or more"] + wr["holders"]])
    w("10_verification_checks.csv", ["check", "result", "detail"],
      [[c["check"], "pass" if c["pass"] else "FAIL", c["detail"]] for c in rep["checks"]])


if __name__ == "__main__":
    main()
