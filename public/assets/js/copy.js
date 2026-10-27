/* Words for the report page. Figures are always pulled from window.REPORT so
   the text and the data cannot disagree. Brand voice: plain, direct, numbers
   stated, no em or en dashes, no emoji, no price talk. */
(function () {
  "use strict";
  function full(v, d) { return Number(v).toLocaleString("en-US", { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); }
  function m(v) { return (v / 1e6).toLocaleString("en-US", { maximumFractionDigits: 1 }) + " million"; }
  function b(v) { return (v / 1e9).toLocaleString("en-US", { maximumFractionDigits: 2 }) + " billion"; }
  function amt(v) { return Math.abs(v) >= 1e9 ? b(v) : Math.abs(v) >= 1e6 ? m(v) : full(v); }
  function pct(v, d) { return (v * 100).toFixed(d === undefined ? 1 : d) + "%"; }
  function rel(a, c) { return a ? Math.abs((c - a) / a * 100).toFixed(1) + "%" : ""; }
  function dir(a, c, up, down, same) { return c > a ? up : c < a ? down : same; }
  function signedFull(v) { return (v > 0 ? "+" : v < 0 ? "-" : "") + full(Math.abs(v)); }
  function signedPct(v) { return (v > 0 ? "+" : v < 0 ? "-" : "") + Math.abs(v * 100).toFixed(1) + "%"; }

  /* Reserved wallet transfers split into moves inside the group and moves out of it. */
  function reservedFlows(R) {
    var L = R.meta.snapshots.length - 1;
    var reserved = R.named.filter(function (n) { return n.kind === "reserved"; });
    var names = reserved.map(function (n) { return n.name; });
    var internal = 0, external = 0, from = [];
    reserved.forEach(function (n) {
      n.flows.forEach(function (f) {
        if (f.direction !== "out" || f.asset !== "RBNT") return;
        if (names.indexOf(f.counterparty) >= 0) internal += f.amount;
        else { external += f.amount; if (from.indexOf(n.name) < 0) from.push(n.name); }
      });
    });
    return {
      internal: internal, external: external, externalFrom: from,
      open: reserved.reduce(function (a, n) { return a + n.rbnt[0]; }, 0),
      close: reserved.reduce(function (a, n) { return a + n.rbnt[L]; }, 0)
    };
  }

  window.REPORT_COPY = {
    findings: function (R) {
      var L = R.meta.snapshots.length - 1;
      var h = R.holders, c = R.concentration, st = R.staking, g = R.cohorts;
      var claims = st.pools.reduce(function (a, p) { return a + p.q.claim_rbnt; }, 0);
      var funding = st.pools.reduce(function (a, p) { return a + p.q.funding.reduce(function (x, f) { return x + f.rbnt; }, 0); }, 0);
      var res = reservedFlows(R);
      var top = g[0], next = g[1];
      var out = [];

      out.push({
        title: "Holder count " + dir(h.ge1[0], h.ge1[L], "edged up", "edged down", "held steady") + (h.ge1[0] !== h.ge1[L] ? " " + rel(h.ge1[0], h.ge1[L]) : ""),
        body: "<strong>" + full(h.ge1[L]) + "</strong> addresses held at least 1 RBNT on 30 September, against " + full(h.ge1[0]) +
          " on 1 July, a change of " + signedFull(h.ge1[L] - h.ge1[0]) + ". Wrapped and staked RBNT count toward the address that owns it.",
        link: "#spread"
      });

      out.push({
        title: "Holdings stay highly concentrated",
        body: "Half of the RBNT outside the named wallets sits with " + full(c.half_count[L]) + " holders. The largest 10 held <strong>" + pct(c.top10[L]) +
          "</strong> of it on 30 September, against " + pct(c.top10[0]) + " on 1 July. " + full(c.top10_contracts_close) +
          " of those 10 are smart contracts. Among regular wallets only, the largest 10 held " + pct(c.wallets_top10[L]) + ", against " + pct(c.wallets_top10[0]) + ".",
        link: "#spread"
      });

      out.push({
        title: "The largest 10 " + dir(top.open, top.close, "added", "reduced", "held steady") + ", ranks 11 to 100 " + dir(next.open, next.close, "added", "reduced", "held steady"),
        body: "Of the 10 largest holders on 1 July, " + full(top.reduced) + " reduced their holdings by more than 1% and " + full(top.added) + " added. Together they ended with " +
          amt(Math.abs(top.change)) + " RBNT " + (top.change < 0 ? "less" : "more") + " (" + signedPct(top.change_pct) + "). Ranks 11 to 100: " + full(next.added) + " added, " +
          full(next.reduced) + " reduced, " + signedPct(next.change_pct) + " combined.",
        link: "#largest"
      });

      out.push({
        title: "More RBNT staked, by " + dir(st.stakers_any[0], st.stakers_any[L], "more", "slightly fewer", "the same number of") + " wallets",
        body: "Staked RBNT in the two Reddex pools " + dir(st.total_staked[0], st.total_staked[L], "rose", "fell", "held at") + " " + rel(st.total_staked[0], st.total_staked[L]) + " to <strong>" +
          amt(st.total_staked[L]) + "</strong>, while wallets with a stake went from " + full(st.stakers_any[0]) + " to " + full(st.stakers_any[L]) +
          ". The pools paid " + amt(claims) + " RBNT in rewards and received " + amt(funding) + " RBNT of reward funding.",
        link: "#staking"
      });
      if (st.total_staked[L] < st.total_staked[0]) out[3].title = "Less RBNT staked";

      out.push({
        title: "Reserved wallets: " + (res.internal > res.external ? "mostly moves between themselves" : "transfers out to other addresses"),
        body: amt(res.internal) + " RBNT moved between the nine reserved wallets during the quarter. " + amt(res.external) +
          " RBNT left the group, all of it from " + res.externalFrom.join(" and ") + ". The group held <strong>" + amt(res.close) + "</strong> RBNT on 30 September, against " + amt(res.open) + " on 1 July.",
        link: "#named"
      });
      if (!res.external) out[4].body = amt(res.internal) + " RBNT moved between the nine reserved wallets during the quarter and none left the group. The group held <strong>" + amt(res.close) + "</strong> RBNT on 30 September.";

      out.push({
        title: "WRBNT supply " + dir(R.wrbnt.supply[0], R.wrbnt.supply[L], "rose", "fell", "held steady") + (R.wrbnt.supply[0] !== R.wrbnt.supply[L] ? " " + rel(R.wrbnt.supply[0], R.wrbnt.supply[L]) : ""),
        body: amt(R.wrbnt.unwrapped_q) + " RBNT was unwrapped and " + amt(R.wrbnt.wrapped_q) + " wrapped during the quarter, leaving <strong>" + amt(R.wrbnt.supply[L]) +
          "</strong> RBNT as WRBNT. The WRBNT contract held enough RBNT to back every WRBNT at every snapshot.",
        link: "#named"
      });
      return out;
    },

    sections: function (R) {
      var L = R.meta.snapshots.length - 1;
      var h = R.holders, c = R.concentration, st = R.staking, g = R.cohorts, e = R.entrants;
      var locBy = {};
      R.location.forEach(function (l) { locBy[l.key] = l; });
      function share(k) { return pct(locBy[k] ? locBy[k].share[L] : 0); }
      var bigBand = h.bands[h.bands.length - 1], smallBand = h.bands[0];
      var claims = st.pools.reduce(function (a, p) { return a + p.q.claim_rbnt; }, 0);
      var funding = st.pools.reduce(function (a, p) { return a + p.q.funding.reduce(function (x, f) { return x + f.rbnt; }, 0); }, 0);
      var funders = [];
      st.pools.forEach(function (p) { p.q.funding.forEach(function (f) { if (funders.indexOf(f.from) < 0) funders.push(f.from); }); });
      var stakeIn = st.pools.reduce(function (a, p) { return a + p.q.stake_rbnt; }, 0), stakeN = st.pools.reduce(function (a, p) { return a + p.q.stake_n; }, 0);
      var unIn = st.pools.reduce(function (a, p) { return a + p.q.unstake_rbnt; }, 0), unN = st.pools.reduce(function (a, p) { return a + p.q.unstake_n; }, 0);
      var rewardEnd = st.pools.reduce(function (a, p) { return a + p.reward_funds[L]; }, 0);
      var res = reservedFlows(R);
      var reserved = R.named.filter(function (n) { return n.kind === "reserved"; });
      var names = reserved.map(function (n) { return n.name; });
      var moves = [], outs = {};
      reserved.forEach(function (n) {
        n.flows.forEach(function (f) {
          if (f.direction !== "out" || f.asset !== "RBNT") return;
          if (names.indexOf(f.counterparty) >= 0) moves.push(amt(f.amount) + " from " + n.name + " to " + f.counterparty);
          else outs[f.counterparty] = (outs[f.counterparty] || 0) + f.amount;
        });
      });
      var outList = Object.keys(outs).sort(function (x, y) { return outs[y] - outs[x]; }).map(function (k) {
        var label = k === "Other addresses, not named" ? "other addresses" :
          k.indexOf("staking pool") >= 0 ? "the " + k.replace("Reddex RBNT staking pool, ", "") + " staking pool" :
          k === "Wrapped RBNT (WRBNT) contract" ? "the WRBNT contract (wrapping it)" : k;
        return amt(outs[k]) + " to " + label;
      });
      var wOut = 0, wIn = 0;
      reserved.forEach(function (n) {
        n.flows.forEach(function (f) {
          if (f.asset !== "WRBNT" || f.counterparty !== "Other addresses, not named") return;
          if (f.direction === "out") wOut += f.amount; else wIn += f.amount;
        });
      });
      var bigMovers = g.filter(function (x) { return Math.abs(x.change_pct) >= 0.25 && x.top3_share_of_change > 0 && x.top3_share_of_change <= 1; });
      function list(a) { return a.length <= 1 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1]; }

      return {
        ledes: {
          spread: "Holder counts and shares in this section leave out the " + R.named.length + " named wallets and count wrapped and staked RBNT toward the address that owns it. That leaves " +
            amt(c.base_total[L]) + " RBNT, or " + pct(c.base_share_of_supply[L]) + " of all RBNT, spread across " + full(h.ge1[L]) + " holders at the end of the quarter.",
          largest: "Holders are ranked by what they held on 1 July and kept in that group for the whole quarter. Each group shows how many added to their holdings, how many reduced them, and the net result. Only groups are shown, never single wallets.",
          staking: "Reddex runs two RBNT staking pools: one with no lock and one with a 365 day lock. Each pool holds the RBNT people staked plus RBNT set aside to pay rewards, so the charts split the two using the pool's own totalStake() figure.",
          named: "These are the only wallets this report names, because they are already public. Balances are read from the chain. The DAO treasury page lists the original allocations, which are shown for comparison."
        },
        explain: {
          where: [
            "Think of this chart as a list of places where RBNT is parked. On 30 September, <strong>" + share("reserved") + "</strong> sat in Redbelly's nine reserved wallets, " + share("wrapper") +
              " inside the WRBNT contract and " + share("staking") + " in the two staking pools. Regular wallets held " + share("wallet") + " and other smart contracts " + share("contract") + ".",
            "The WRBNT contract is one row here because it physically holds that RBNT. Everywhere else in the report the same RBNT is counted with whoever holds the WRBNT, so it is never counted twice. The rows add up to " +
              full(R.supply.total[L]) + " RBNT, which is all but " + full(R.supply.unlocated[L]) + " RBNT (" + (R.supply.unlocated[L] / R.supply.genesis * 100).toFixed(4) + "%) of the 10 billion created at launch. The method note explains the small remainder."
          ],
          spread: [
            "Most holders hold small amounts and a few hold large ones. At the end of the quarter " + full(smallBand.holders[L]) + " holders had between 1 and 999 RBNT, together " + pct(smallBand.share[L], 2) +
              " of it, while the " + full(bigBand.holders[L]) + " holders with 100 million or more held <strong>" + pct(bigBand.share[L]) + "</strong>.",
            "The largest 10 holders' share went from " + pct(c.top10[0]) + " to " + pct(c.top10[L]) + ". " + full(c.top10_contracts_close) + " of them are smart contracts, not regular wallets. Counting regular wallets only, the largest 10 held " +
              pct(c.wallets_top10[L]) + " at the end against " + pct(c.wallets_top10[0]) + " at the start. One address is not always one person: a contract or an exchange can hold RBNT for many people, and one person can use many addresses."
          ],
          largest: [
            "<strong>Added</strong> means the address held more than 1% more at the end of the quarter than at the start. <strong>Reduced</strong> means more than 1% less. A reduction can be a sale, but it can also be a move to another wallet, a payment, or a deposit to an exchange. The chain shows the movement, not the reason. Staking or wrapping RBNT does not count as reducing, because the report follows staked and wrapped RBNT back to its owner."
          ].concat(bigMovers.map(function (x) {
            return "Big group totals can come from a few addresses. In the " + x.label.charAt(0).toLowerCase() + x.label.slice(1) + " group, three addresses account for " + pct(x.top3_share_of_change, 0) +
              " of its " + amt(Math.abs(x.change)) + " RBNT " + (x.change > 0 ? "increase" : "decrease") + ".";
          })).concat([
            full(e.count) + " addresses entered the largest 1,000 during the quarter, and " + full(e.new_holders) + " of them held less than 1 RBNT on 1 July."
          ]),
          staking: [
            "Staked RBNT across both pools went from " + amt(st.total_staked[0]) + " to <strong>" + amt(st.total_staked[L]) + "</strong>. During the quarter " + full(stakeN) + " stakes added " + amt(stakeIn) +
              " RBNT and " + full(unN) + " unstakes took out " + amt(unIn) + ". Wallets with a stake went from " + full(st.stakers_any[0]) + " to " + full(st.stakers_any[L]) + ", so the average stake " +
              (st.total_staked[L] / st.stakers_any[L] > st.total_staked[0] / st.stakers_any[0] ? "grew." : "shrank."),
            "Pool balances also include reward funds: RBNT kept to pay stakers, which stakers do not own. Stakers claimed " + amt(claims) + " RBNT of rewards in the quarter" +
              (funding ? ", and " + list(funders) + " added " + amt(funding) + " RBNT of reward funding" : "") + ". Reward funds stood at " + amt(rewardEnd) + " RBNT on 30 September."
          ],
          named: [
            (moves.length ? "Most reserved wallet activity was between the reserved wallets themselves: " + list(moves) + ". " : "") +
              (res.external ? "The " + amt(res.external) + " RBNT that left the group came from " + list(res.externalFrom) + ": " + list(outList) + "." : "No RBNT left the group.") +
              (wOut || wIn ? " In WRBNT, reserved wallets sent " + amt(wOut) + " to addresses that are not named and received " + amt(wIn) + " from them." : ""),
            "WRBNT was fully backed at every snapshot: the contract held as much RBNT as there was WRBNT. " + pct(R.wrbnt.held_by_contracts_share[L]) + " of all WRBNT sat in smart contracts rather than regular wallets on 30 September."
          ]
        }
      };
    },

    exchanges: function (R) {
      var k = R.exchanges.check;
      return "Routescan showed no public name tag on any of the " + k.checked + " largest holders outside the named wallets when they were checked on " + k.date +
        ". Routescan does tag Redbelly's own wallets, for example " + k.seen_on_named[0] + ", so the check works, but no exchange wallet is labelled on Redbelly mainnet yet. " +
        "Exchange flows are therefore not reported for this quarter. When an exchange is labelled, the next edition adds it with one setting in the scripts.";
    },

    method: [
      "<strong>Pick the snapshot blocks.</strong> The last block before 1 July 00:00 UTC, the last block of each month, and the last block before 1 October 00:00 UTC. Found by binary search on block times and matched against Routescan.",
      "<strong>List every address that could hold RBNT.</strong> A full scan of all 3.2 million blocks for senders and receivers, plus contracts created, internal transfers, WRBNT and staking events, the named wallets and Routescan's holder list.",
      "<strong>Read every balance from the chain.</strong> RBNT balance, WRBNT balance and staked RBNT for each address at each snapshot block, straight from the Redbelly RPC.",
      "<strong>Count each RBNT once.</strong> WRBNT and staked RBNT are moved to the holder who owns them. The WRBNT contract and the pools keep only what is not owed to anyone.",
      "<strong>Group, never single out.</strong> Only publicly named wallets appear by name. Everything else is reported as totals for groups.",
      "<strong>Check before publishing.</strong> All balances must add up to the 10 billion RBNT created at launch, WRBNT and staking totals must match their contracts, and reserved wallet transfers must explain their balance changes to the last RBNT."
    ],

    sources: [
      "Balances and contract reads: Redbelly mainnet RPC, chain ID 151, <span class=\"mono\">governors.mainnet.redbelly.network</span>",
      "Internal transfers, event logs, block by time and contract source: <a href=\"https://redbelly.routescan.io\" target=\"_blank\" rel=\"noopener\">Routescan</a> Etherscan-compatible API",
      "Reserved wallet names, addresses and allocations: <a href=\"https://redbellydao.network/treasury/\" target=\"_blank\" rel=\"noopener\">DAO treasury page</a>",
      "Staking pool logic: verified ReddexRBNTLockStaker source on Routescan (<span class=\"mono\">totalStake()</span>, <span class=\"mono\">userInfo()</span>, Stake and Unstake events)",
      "Wrapped RBNT: verified WRBNT source on Routescan (<span class=\"mono\">totalSupply()</span>, <span class=\"mono\">balanceOf()</span>, Deposit and Withdrawal events)"
    ],

    glossary: [
      ["RBNT", "The native coin of the Redbelly Network. It pays network fees and can be staked."],
      ["Wallet or address", "An account on the chain, written as a long code starting with 0x. Anyone can see its balance. The chain does not say who owns it."],
      ["Holder", "In this report, an address with at least 1 RBNT, counting wrapped and staked RBNT."],
      ["Block and snapshot", "The chain adds transactions in blocks. A snapshot is the state of every balance right after one chosen block."],
      ["Smart contract", "A program that lives on the chain and can hold RBNT, for example a trading pool or a staking pool."],
      ["Wrapped RBNT (WRBNT)", "RBNT turned into a token so apps can use it. Each WRBNT is backed by one RBNT held in the WRBNT contract, and can be turned back at any time."],
      ["Staking", "Locking RBNT in a pool to earn rewards. Reddex runs two RBNT pools: one with no lock and one with a 365 day lock."],
      ["Reward funds", "RBNT a staking pool holds to pay rewards. It is the pool balance minus what holders staked."],
      ["Reserved wallets", "The nine wallets Redbelly lists on the DAO treasury page, for example Team, Investors, Reserve and Ecosystem."],
      ["Labelled wallet", "An address the explorer has publicly tagged, such as an exchange. Only labelled and treasury wallets are named in this report."],
      ["Network fees", "Every transaction pays a small fee in RBNT. At today's activity levels Redbelly pays these fees back out to network participants instead of burning them, so the total amount of RBNT stays the same."],
      ["Concentration", "How much of the RBNT sits with the largest holders. Higher concentration means fewer addresses hold more of it."]
    ],

    downloads: [
      { type: "PDF", title: "Full report", desc: "The complete report with charts and tables, A4.", href: "downloads/RBNT-Holder-Report-Q3-2026.pdf" },
      { type: "MD", title: "Community summary", desc: "An X thread and a short version in paragraphs, ready to share.", href: "downloads/COMMUNITY_SUMMARY.md" },
      { type: "XLSX", title: "Data workbook", desc: "Every table behind the charts, plus a sources sheet.", href: "data/RBNT-Holder-Report-Q3-2026-data.xlsx" },
      { type: "ZIP", title: "Data as CSV", desc: "Ten CSV files, one per chart or table.", href: "data/RBNT-Holder-Report-Q3-2026-csv.zip" },
      { type: "MD", title: "Method and sources", desc: "How every figure was made, and how to make the next edition.", href: "downloads/METHOD.md" },
      { type: "JSON", title: "Report data", desc: "All figures in one machine readable file, with snapshot blocks.", href: "data/report.json" }
    ]
  };
})();
