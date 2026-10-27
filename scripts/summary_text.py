"""Words for the community summary. Every figure comes from report.json via
the formatters passed in by step7_write_docs.py, which also records each
quoted figure so verify_outputs.py can trace it.

Voice rules (brand kit): plain words, say the number, no em or en dashes,
no emoji, no price talk, no advice.
"""

SITE = "https://rbnt-quarterly-on-chain-holder-report.vercel.app"


def build(rep, f):
    full, amt, pct, rel = f["full"], f["amt"], f["pct"], f["rel"]
    L = len(rep["meta"]["snapshots"]) - 1
    h, c, st, g = rep["holders"], rep["concentration"], rep["staking"], rep["cohorts"]
    reserved = [n for n in rep["named"] if n["kind"] == "reserved"]
    res_open = sum(n["rbnt"][0] for n in reserved)
    res_close = sum(n["rbnt"][L] for n in reserved)
    movers = [n for n in reserved if abs(n["change"]) >= 1]
    top100 = {k: sum(x[k] for x in g[:2]) for k in ("added", "reduced", "steady", "open", "close")}
    claims = sum(p["q"]["claim_rbnt"] for p in st["pools"])
    w = rep["wrbnt"]
    names = {n["name"] for n in reserved}
    internal = sum(fl["amount"] for n in reserved for fl in n["flows"]
                   if fl["direction"] == "out" and fl["asset"] == "RBNT" and fl["counterparty"] in names)
    external = sum(fl["amount"] for n in reserved for fl in n["flows"]
                   if fl["direction"] == "out" and fl["asset"] == "RBNT" and fl["counterparty"] not in names)
    external_from = sorted({n["name"] for n in reserved for fl in n["flows"]
                            if fl["direction"] == "out" and fl["asset"] == "RBNT" and fl["counterparty"] not in names})

    def move(a, b, up="up", down="down"):
        return up if b > a else down if b < a else "unchanged"

    def change(a, b, up="up", down="down"):
        if a == b:
            return "unchanged"
        return f"{move(a, b, up, down)} {rel(a, b)}"

    def pts(a, b):
        d = (b - a) * 100
        return f["q"](f"{abs(d):.1f}") + " points " + ("higher" if d > 0 else "lower")

    tweets = [
        f"RBNT Holder Report, {rep['meta']['quarter']['label']} (1 July to 30 September). A sourced look at how RBNT holders behaved on Redbelly mainnet. "
        f"Every figure is read from the chain at fixed blocks. Report, data and method: {SITE}",

        f"Holders: {full(h['ge1'][L])} addresses held at least 1 RBNT on 30 September, {move(h['ge1'][0], h['ge1'][L])} from {full(h['ge1'][0])} on 1 July. "
        "Wrapped and staked RBNT count toward the address that owns it.",

        f"Concentration: of the RBNT outside the named Redbelly wallets, the largest 10 holders held {pct(c['top10'][L])} on 30 September, "
        f"{pts(c['top10'][0], c['top10'][L])} than on 1 July. Half of it sits with {full(c['half_count'][L])} holders. "
        f"Among regular wallets only, the largest 10 held {pct(c['wallets_top10'][L])}.",

        f"Largest holders: of the 10 largest on 1 July, {full(g[0]['reduced'])} reduced their holdings by more than 1% and {full(g[0]['added'])} added. "
        f"Of the next 90, {full(g[1]['added'])} added and {full(g[1]['reduced'])} reduced. "
        "A reduction can be a sale, a move to another wallet or a deposit. The chain cannot tell these apart.",

        f"Staking: {amt(st['total_staked'][L])} RBNT was staked in the two Reddex pools on 30 September, "
        f"{change(st['total_staked'][0], st['total_staked'][L])} on the quarter, held by {full(st['stakers_any'][L])} wallets "
        f"against {full(st['stakers_any'][0])} on 1 July. The pools paid out {amt(claims)} RBNT in rewards.",

        (f"Reserved wallets: {amt(internal)} RBNT moved between the nine treasury wallets. {amt(external)} RBNT left the group, "
         f"from {' and '.join(external_from)}. They held {amt(res_close)} RBNT on 30 September. Every transfer is in the report.")
        if movers else
        f"Reserved wallets: the nine wallets on the DAO treasury page held {amt(res_close)} RBNT. None of them changed balance during the quarter.",

        f"WRBNT: {amt(w['supply'][L])} RBNT sat wrapped as WRBNT on 30 September, {change(w['supply'][0], w['supply'][L])} on the quarter. "
        "At every snapshot each WRBNT was backed one to one by RBNT in the contract.",

        "Method: every balance read at 4 snapshot blocks, each RBNT counted once, and only wallets that are already public are named. "
        f"The balances found add up to {f['q'](f'{(1 - rep["supply"]["unlocated"][L] / rep["supply"]["genesis"]) * 100:.4f}')}% of the 10 billion RBNT created at launch. "
        "Data and scripts are open. Not financial advice.",
    ]
    for i, t in enumerate(tweets):
        # X counts any link as 23 characters
        n = len(t.replace(SITE, "x" * 23))
        assert n <= 270, f"post {i + 1} is {n} characters"

    paras = [
        f"Redbelly DAO's first quarterly on-chain holder report covers {rep['meta']['quarter']['label']}, from 1 July to 30 September 2026. "
        "It reads every RBNT balance on Redbelly mainnet at fixed blocks at the start and end of the quarter and at each month end, "
        "and counts wrapped and staked RBNT toward the address that owns it, so nothing is counted twice.",

        f"{full(h['ge1'][L])} addresses held at least 1 RBNT at the end of the quarter, {move(h['ge1'][0], h['ge1'][L])} from {full(h['ge1'][0])} at the start. "
        f"Of the RBNT outside the named Redbelly wallets, the largest 10 holders held {pct(c['top10'][L])}, {pts(c['top10'][0], c['top10'][L])} than on 1 July, "
        f"and half of it sits with {full(c['half_count'][L])} holders. Counting regular wallets only, the largest 10 held {pct(c['wallets_top10'][L])}, "
        f"{pts(c['wallets_top10'][0], c['wallets_top10'][L])}. Among the 100 largest holders, {full(top100['added'])} added more than 1% over the quarter, "
        f"{full(top100['reduced'])} reduced more than 1% and {full(top100['steady'])} stayed within 1%. A reduction is not always a sale: "
        "it can also be a move between wallets or a deposit.",

        f"Staking in the two Reddex pools went from {amt(st['total_staked'][0])} to {amt(st['total_staked'][L])} RBNT, held by {full(st['stakers_any'][L])} wallets at the end of the quarter, "
        f"and the pools paid out {amt(claims)} RBNT in rewards. The nine reserved wallets on the DAO treasury page held {amt(res_close)} RBNT on 30 September, "
        f"against {amt(res_open)} on 1 July. Most of their activity was between themselves ({amt(internal)} RBNT), and {amt(external)} RBNT left the group. "
        f"{amt(w['supply'][L])} RBNT sat wrapped as WRBNT, fully backed at every snapshot.",

        "The report names only wallets that are already public: the treasury wallets, the WRBNT contract and the two staking pools. "
        "Every other address is reported in groups. All figures, the method and the scripts are open, so anyone can check them or produce the next edition. "
        f"This is a description of past on-chain activity, not financial advice. Full report: {SITE}",
    ]

    out = [
        f"# RBNT Holder Report, {rep['meta']['quarter']['label']}: community summary",
        "",
        f"Period: 1 July to 30 September 2026 (UTC). Data verified {rep['meta']['generated_utc']}. "
        f"Snapshot blocks {full(rep['meta']['snapshots'][0]['block'])} and {full(rep['meta']['snapshots'][L]['block'])}.",
        "",
        "## X thread",
        "",
    ]
    for i, t in enumerate(tweets):
        out += [f"**{i + 1}/{len(tweets)}**", "", t, ""]
    out += ["## Short version", ""]
    for p in paras:
        out += [p, ""]
    return "\n".join(out)
