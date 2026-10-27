"""Shared settings and helpers for the RBNT quarterly holder report.

Everything that changes between editions lives in QUARTER below. Each
script reads it, so a new edition only needs a new QUARTER entry and a
re-run of the steps listed in METHOD.md.
"""

import gzip
import json
import os
import random
import threading
import time
from datetime import datetime, timezone

import requests

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw")
PUBLIC_DATA = os.path.join(ROOT, "public", "data")

CHAIN_ID = 151
RPC_URL = os.environ.get("RBNT_RPC", "https://governors.mainnet.redbelly.network")
ROUTESCAN = "https://api.routescan.io/v2/network/mainnet/evm/151"
ROUTESCAN_ETHERSCAN = ROUTESCAN + "/etherscan/api"
EXPLORER = "https://redbelly.routescan.io"

GENESIS_SUPPLY_WEI = 10_000_000_000 * 10**18

# Edition settings. Times are UTC.
QUARTER = {
    "id": "2026-Q3",
    "label": "Q3 2026",
    "start_utc": "2026-07-01T00:00:00+00:00",  # first second inside the quarter
    "end_utc": "2026-09-30T23:59:59+00:00",  # last second inside the quarter
}

WRBNT = "0x6ed1f491e2d31536d6561f6bdb2adc8f092a6076"
POOL_NO_LOCK = "0x43a1dc107bbb06df266278056055ae7fc5bd2817"
POOL_365 = "0x5e8040e85d0e6363d798a43bea939c026449946d"

# Publicly named wallets. Sources:
#   reserved wallets: https://redbellydao.network/treasury/
#   WRBNT and pools: task brief, Routescan verified contract pages
NAMED = {
    "0xbcee2defb7cf136480e3619cf93e8129059977af": ("Team (Locked)", "reserved"),
    "0x9a83957d3399cbbcbef2112797b4a5b8e58c63d4": ("Governance (Locked)", "reserved"),
    "0x9e678318539d7c98057e9f89c58fb8f99752faea": ("Governance (Unlocked)", "reserved"),
    "0xac27381ef74457c1258d54a808c2461eedc56270": ("USYD/CSIRO (Locked)", "reserved"),
    "0xef816d556e01bc194ae302999930eacd6dc4e566": ("Investors", "reserved"),
    "0x7473feaf836b5319d9190d8367991dc6ef33c16d": ("Reserve", "reserved"),
    "0xc5c131572d232512973e79204b93c2c1d57c879d": ("Ecosystem (Locked)", "reserved"),
    "0xe0c701c40166bbd8d5f5ec33c123f0a03e902df7": ("Ecosystem 2 (Unlocked)", "reserved"),
    "0x415cad8fc89f75a63c5b830e06460eecde083c9f": ("Ecosystem (Unlocked)", "reserved"),
    WRBNT: ("Wrapped RBNT (WRBNT) contract", "wrapper"),
    POOL_NO_LOCK: ("Reddex RBNT staking pool, no lock", "staking"),
    POOL_365: ("Reddex RBNT staking pool, 365 day lock", "staking"),
}

# Original allocations as listed on the DAO treasury page (not balances).
TREASURY_ALLOCATION = {
    "0xbcee2defb7cf136480e3619cf93e8129059977af": 1_000_000_000,
    "0x9a83957d3399cbbcbef2112797b4a5b8e58c63d4": 200_000_000,
    "0x9e678318539d7c98057e9f89c58fb8f99752faea": 100_000_000,
    "0xac27381ef74457c1258d54a808c2461eedc56270": 200_000_000,
    "0xef816d556e01bc194ae302999930eacd6dc4e566": 2_785_987_083,
    "0x7473feaf836b5319d9190d8367991dc6ef33c16d": 2_000_000_000,
    "0xc5c131572d232512973e79204b93c2c1d57c879d": 2_794_132_788,
    "0xe0c701c40166bbd8d5f5ec33c123f0a03e902df7": None,
    "0x415cad8fc89f75a63c5b830e06460eecde083c9f": 919_880_129,
}

# Exchange or contract labels read from Routescan address pages. Filled in
# by hand after checking the explorer; see METHOD.md, section 8, step 7.
# Format: {"0x...": ("Label as shown on Routescan", "exchange" or "contract")}
ROUTESCAN_LABELS = {}

# Record of the last label check, shown in the report.
LABEL_CHECK = {
    "date": "2026-10-27",
    "checked": 30,  # largest holders outside the named wallets, by holdings at the closing block
    "found": 0,
    "seen_on_named": ["Redbelly Network: Wrapped RBNT", "Redbelly Network Access: Ecosystem (Unlocked)"],
}

# Event topics
TOPIC_TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
TOPIC_DEPOSIT = "0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c"
TOPIC_WITHDRAWAL = "0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65"


def quarter_ts():
    s = int(datetime.fromisoformat(QUARTER["start_utc"]).timestamp())
    e = int(datetime.fromisoformat(QUARTER["end_utc"]).timestamp())
    return s, e


def utc(ts):
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")


_local = threading.local()


def _session():
    s = getattr(_local, "s", None)
    if s is None:
        s = requests.Session()
        s.headers["content-type"] = "application/json"
        _local.s = s
    return s


class RpcTooLarge(RuntimeError):
    """The node refused the request as too large. Retrying will not help."""


def rpc_batch(calls, retries=12):
    """calls: list of (method, params). Returns results in order.

    The Redbelly governors RPC accepts batches of up to 100 calls.
    """
    out = [None] * len(calls)
    for i in range(0, len(calls), 100):
        chunk = calls[i:i + 100]
        body = [{"jsonrpc": "2.0", "id": j, "method": m, "params": p} for j, (m, p) in enumerate(chunk)]
        for attempt in range(retries):
            try:
                r = _session().post(RPC_URL, data=json.dumps(body), timeout=180)
                r.raise_for_status()
                res = r.json()
                if isinstance(res, dict):
                    raise RuntimeError(res)
                errs = [x for x in res if "error" in x]
                if errs:
                    if "too large" in str(errs[0]["error"].get("message", "")):
                        raise RpcTooLarge(errs[0]["error"])
                    raise RuntimeError(errs[0]["error"])
                for x in res:
                    out[i + x["id"]] = x["result"]
                break
            except RpcTooLarge:
                raise
            except Exception as e:  # network hiccups, rate limits
                if attempt == retries - 1:
                    raise
                wait = min(60, 2 ** attempt)
                if "rate limit" in str(e):
                    wait = max(wait, 20)  # the node asks for a pause, give it one
                time.sleep(wait + random.random())
    return out


def rpc(method, params):
    return rpc_batch([(method, params)])[0]


def routescan_get(url, params=None, retries=8):
    for attempt in range(retries):
        try:
            r = _session().get(url, params=params, timeout=180)
            if r.status_code == 429:
                raise RuntimeError("rate limited")
            r.raise_for_status()
            return r.json()
        except Exception:
            if attempt == retries - 1:
                raise
            time.sleep(min(60, 2 ** attempt))


def wei_to_rbnt(x):
    return x / 10**18


def save_json(path, obj, gz=False):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    if gz:
        with gzip.open(tmp, "wt") as f:
            json.dump(obj, f)
    else:
        with open(tmp, "w") as f:
            json.dump(obj, f, indent=1)
    os.replace(tmp, path)


def load_json(path):
    if path.endswith(".gz"):
        with gzip.open(path, "rt") as f:
            return json.load(f)
    with open(path) as f:
        return json.load(f)


def snapshots():
    return load_json(os.path.join(RAW, "snapshots.json"))
