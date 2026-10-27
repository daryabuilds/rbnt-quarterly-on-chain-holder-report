"""Step 2. Scan every block from 1 to the closing snapshot.

For each 10,000 block chunk this records:
  * every address seen as a transaction sender or receiver,
  * hashes of contract creation transactions (receipts are fetched to get
    the new contract address),
  * network fees paid (block gasUsed x baseFeePerGas; Redbelly charges
    exactly the base fee, so there is no tip). The protocol pays these fees
    back out to network participants, so they are not burned at current
    volumes,
  * native RBNT transactions that touch a publicly named wallet,
  * transaction and sender counts inside the quarter.

The address list is the starting point for the full holder list in step 5.
Chunks are cached in data/raw/scan so the scan can resume.
"""

import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed

from common import NAMED, RAW, RpcTooLarge, load_json, rpc_batch, save_json, snapshots

CHUNK = 10_000
BATCH = 50
WORKERS = int(os.environ.get("WORKERS", "8"))
OUT = os.path.join(RAW, "scan")


def get_blocks(lo, hi):
    """Blocks lo..hi with full transactions. Splits the batch when the node
    answers "response too large"; a single oversized block is read as a list
    of hashes and then one transaction at a time."""
    try:
        return rpc_batch([("eth_getBlockByNumber", [hex(n), True]) for n in range(lo, hi + 1)])
    except RpcTooLarge:
        if hi > lo:
            mid = (lo + hi) // 2
            return get_blocks(lo, mid) + get_blocks(mid + 1, hi)
        blk = rpc_batch([("eth_getBlockByNumber", [hex(lo), False])])[0]
        txs = []
        for i in range(0, len(blk["transactions"]), 20):
            txs += rpc_batch([("eth_getTransactionByHash", [h]) for h in blk["transactions"][i:i + 20]])
        blk["transactions"] = txs
        return [blk]


def scan_chunk(start, end, open_block, close_block):
    path = os.path.join(OUT, f"{start:08d}.json.gz")
    if os.path.exists(path):
        return path
    addrs, senders_q, creates, named_tx = set(), set(), [], []
    fees_le_open = fees_le_close = 0
    tx_q = 0
    for b in range(start, end + 1, BATCH):
        hi = min(end, b + BATCH - 1)
        blocks = get_blocks(b, hi)
        for blk in blocks:
            n = int(blk["number"], 16)
            fee = int(blk["gasUsed"], 16) * int(blk.get("baseFeePerGas") or "0x0", 16)
            if n <= open_block:
                fees_le_open += fee
            if n <= close_block:
                fees_le_close += fee
            in_q = open_block < n <= close_block
            for tx in blk["transactions"]:
                f = tx["from"].lower()
                t = (tx["to"] or "").lower()
                addrs.add(f)
                if t:
                    addrs.add(t)
                else:
                    creates.append(tx["hash"])
                if in_q:
                    tx_q += 1
                    senders_q.add(f)
                v = int(tx["value"], 16)
                if v and (f in NAMED or t in NAMED):
                    named_tx.append([n, tx["hash"], f, t, str(v)])
    data = {
        "start": start, "end": end,
        "addrs": sorted(addrs), "creates": creates, "named_tx": named_tx,
        "fees_le_open": str(fees_le_open), "fees_le_close": str(fees_le_close),
        "tx_in_quarter": tx_q, "senders_in_quarter": sorted(senders_q),
    }
    save_json(path, data, gz=True)
    return path


def main():
    snap = snapshots()
    open_block, close_block = snap["open"]["block"], snap["close"]["block"]
    os.makedirs(OUT, exist_ok=True)
    ranges = [(s, min(close_block, s + CHUNK - 1)) for s in range(1, close_block + 1, CHUNK)]
    todo = [r for r in ranges if not os.path.exists(os.path.join(OUT, f"{r[0]:08d}.json.gz"))]
    print(f"{len(ranges)} chunks, {len(todo)} to do", flush=True)
    done = 0
    with ThreadPoolExecutor(WORKERS) as ex:
        futs = {ex.submit(scan_chunk, s, e, open_block, close_block): s for s, e in todo}
        for f in as_completed(futs):
            f.result()
            done += 1
            if done % 10 == 0 or done == len(todo):
                print(f"{done}/{len(todo)} chunks", flush=True)

    # Contract creation receipts -> new contract addresses
    created = []
    hashes = []
    for s, _ in ranges:
        hashes += load_json(os.path.join(OUT, f"{s:08d}.json.gz"))["creates"]
    for i in range(0, len(hashes), 100):
        for rc in rpc_batch([("eth_getTransactionReceipt", [h]) for h in hashes[i:i + 100]]):
            if rc and rc.get("contractAddress"):
                created.append(rc["contractAddress"].lower())
    save_json(os.path.join(RAW, "created_contracts.json"), sorted(set(created)))
    print(f"creation txs {len(hashes)}, contracts {len(set(created))}")


if __name__ == "__main__":
    sys.exit(main())
