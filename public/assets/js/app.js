/* Renders the report from window.REPORT (public/data/report.js, built by
   scripts/step6_analyse.py). Every number on the page comes from that file.
   Copy rules from the brand kit: plain hyphens only, no emoji, say the number. */
(function () {
  "use strict";
  var R = window.REPORT;
  var C = window.RBCharts, F = C.F;
  if (!R) return;

  var S = R.meta.snapshots, K = S.length, LAST = K - 1;
  var PRINT = /[?&]print=1/.test(location.search);
  var SITE = "https://redbelly-holder.vercel.app/";
  function link(href) { return PRINT && !/^(https?:|#)/.test(href) ? SITE + href : href; }
  var OPEN = S[0], CLOSE = S[LAST];
  var css = getComputedStyle(document.documentElement);
  var COLOR_CONTEXT = "var(--chart-context)", COLOR_FOCUS = "var(--chart-focus)";

  /* ---------- helpers ---------- */
  function $(id) { return document.getElementById(id); }
  function h(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === "text") n.textContent = attrs[k];
      else if (k === "html") n.innerHTML = attrs[k];
      else if (k === "class") n.className = attrs[k];
      else n.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }
  function rb(v) { return F.full(v) + " RBNT"; }
  function cmp(v) { return F.compact(v); }
  function pct(v, d) { return F.pct(v, d); }
  function pp(a, b) { var d = (b - a) * 100; return (d >= 0 ? "+" : "-") + Math.abs(d).toFixed(1) + " points"; }
  function chg(a, b) { if (!a) return "new"; var d = (b - a) / a; return (d >= 0 ? "+" : "-") + Math.abs(d * 100).toFixed(1) + "%"; }
  function signed(v) { return (v > 0 ? "+" : v < 0 ? "-" : "") + F.full(Math.abs(v)); }
  function moved(a, b, up, down, flat) { return b > a ? up : b < a ? down : flat; }
  function shortDate(s) { return s.label; }
  var dates = S.map(function (s, i) { return i === 0 ? "1 Jul" : i === LAST ? "30 Sep" : ["", "31 Jul", "31 Aug"][i] || s.label; });
  var dateLong = S.map(function (s, i) { return i === 0 ? "start of 1 July" : i === LAST ? "end of 30 September" : ["", "end of 31 July", "end of 31 August"][i]; });
  function blockLink(n) {
    return h("a", { href: R.meta.explorer + "/block/" + n, class: "mono", target: "_blank", rel: "noopener", text: F.full(n) });
  }
  function addrLink(a) {
    return h("a", { href: R.meta.explorer + "/address/" + a, class: "addr", target: "_blank", rel: "noopener", text: PRINT ? a : a.slice(0, 6) + "..." + a.slice(-4), title: a });
  }

  function card(container, title, sub, opts) {
    opts = opts || {};
    var root = typeof container === "string" ? $(container) : container;
    root.classList.add("card");
    var headText = h("div", null, [h("h3", { text: title }), sub ? h("p", { text: sub }) : null]);
    var head = h("div", { class: "card-head" }, [headText]);
    var body = h("div", { class: "card-body" });
    root.appendChild(head);
    root.appendChild(body);
    var tableView;
    if (opts.table) {
      var btn = h("button", { class: "toggle-table", type: "button", "aria-expanded": "false", text: "Show table" });
      head.appendChild(btn);
      tableView = h("div", { class: "table-view", hidden: "" });
      btn.addEventListener("click", function () {
        var open = tableView.hasAttribute("hidden");
        if (open) tableView.removeAttribute("hidden"); else tableView.setAttribute("hidden", "");
        btn.setAttribute("aria-expanded", String(open));
        btn.textContent = open ? "Hide table" : "Show table";
      });
    }
    if (opts.source) {
      root.appendChild(h("div", { class: "card-foot" }, [h("span", { text: "Source: " + opts.source })]));
    }
    return { root: root, body: body, table: tableView };
  }

  function table(target, caption, cols, rows, totalRow, left) {
    var t = h("table", { class: "data" + (left ? " left" : "") });
    if (caption) t.appendChild(h("caption", { text: caption }));
    var thead = h("thead"), tr = h("tr");
    cols.forEach(function (c) { tr.appendChild(h("th", { scope: "col", text: c })); });
    thead.appendChild(tr); t.appendChild(thead);
    var tb = h("tbody");
    rows.concat(totalRow ? [totalRow] : []).forEach(function (r, i) {
      var row = h("tr", totalRow && i === rows.length ? { class: "total" } : null);
      r.forEach(function (c, j) {
        var td = h(j === 0 ? "th" : "td", j === 0 ? { scope: "row" } : null);
        if (c instanceof Node) td.appendChild(c); else td.textContent = c;
        row.appendChild(td);
      });
      tb.appendChild(row);
    });
    t.appendChild(tb);
    var wrap = h("div", { class: "table-wrap" }, [t]);
    target.appendChild(wrap);
    return t;
  }

  function legend(target, items) {
    var ul = h("ul", { class: "legend" });
    items.forEach(function (it) {
      var sw = h("span", { class: "sw" + (it.line ? " line" : "") });
      sw.style.background = it.color;
      ul.appendChild(h("li", null, [sw, it.name]));
    });
    target.appendChild(ul);
  }

  function stat(target, label, valueNode, sub, sparkVals) {
    var v = h("div", { class: "s-value" });
    if (valueNode instanceof Node) v.appendChild(valueNode); else v.textContent = valueNode;
    var tile = h("div", { class: "stat" }, [h("div", { class: "s-label", text: label }), v, sub ? h("div", { class: "s-sub", text: sub }) : null]);
    if (sparkVals) {
      var sp = h("div", { class: "spark" });
      tile.appendChild(sp);
      target.appendChild(tile);
      C.spark(sp, sparkVals);
    } else target.appendChild(tile);
    return tile;
  }
  function counter(value, fmt, dec, suffix) {
    var s = h("span", { "data-count": String(value), "data-fmt": fmt || "full", "data-dec": String(dec || 0), "data-suffix": suffix || "" });
    s.textContent = fmt === "pct" ? value.toFixed(dec || 0) + "%" : F.full(value, dec || 0);
    return s;
  }
  function explain(id, title, paras) {
    var box = $(id);
    box.appendChild(h("div", { class: "t", text: title || "What this means" }));
    paras.forEach(function (p) { box.appendChild(h("p", { html: p })); });
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  /* ---------- derived figures ---------- */
  var hold = R.holders, conc = R.concentration, st = R.staking, sup = R.supply;
  var reserved = R.named.filter(function (n) { return n.kind === "reserved"; });
  var reservedTotal = S.map(function (_, i) { return reserved.reduce(function (a, n) { return a + n.rbnt[i]; }, 0); });
  var locBy = {}; R.location.forEach(function (l) { locBy[l.key] = l; });
  var cohort = R.cohorts;
  var top100 = cohort.slice(0, 2).reduce(function (a, c) { return { added: a.added + c.added, reduced: a.reduced + c.reduced, steady: a.steady + c.steady, open: a.open + c.open, close: a.close + c.close, size: a.size + c.size }; }, { added: 0, reduced: 0, steady: 0, open: 0, close: 0, size: 0 });

  /* ---------- hero ---------- */
  var meta = $("hero-meta");
  [["Period", "1 July to 30 September 2026, UTC"],
   ["Opening block", null, OPEN.block],
   ["Closing block", null, CLOSE.block],
   ["Data read", R.meta.generated_utc.slice(0, 10)]].forEach(function (m) {
    var li = h("li", null, [h("span", { text: m[0] })]);
    li.appendChild(m[2] ? blockLink(m[2]) : h("span", { class: "mono", text: m[1] }));
    meta.appendChild(li);
  });

  var kpis = $("kpis");
  function kpi(label, value, fmt, dec, suffix, delta) {
    var v = h("div", { class: "k-value" }, [counter(value, fmt, dec, suffix)]);
    kpis.appendChild(h("div", { class: "kpi" }, [h("div", { class: "k-label", text: label }), v, h("div", { class: "k-delta", text: delta })]));
  }
  kpi("Holders", hold.ge1[LAST], "full", 0, "", chg(hold.ge1[0], hold.ge1[LAST]) + " since 1 July");
  kpi("RBNT staked", st.total_staked[LAST] / 1e6, "full", 1, "M", chg(st.total_staked[0], st.total_staked[LAST]) + " since 1 July");
  kpi("Largest 10 hold", conc.top10[LAST] * 100, "pct", 1, "", pp(conc.top10[0], conc.top10[LAST]) + ", outside named wallets");
  kpi("Reserved wallets", reservedTotal[LAST] / 1e9, "full", 2, "B", chg(reservedTotal[0], reservedTotal[LAST]) + " since 1 July");

  /* ---------- findings ---------- */
  var findings = window.REPORT_COPY ? window.REPORT_COPY.findings(R) : [];
  var fwrap = $("findings");
  findings.forEach(function (f, i) {
    var el = h("article", { class: "finding reveal", "data-delay": String(i % 3) }, [
      h("h3", { text: f.title }), h("p", { html: f.body }), f.link ? h("a", { class: "jump", href: f.link, text: "See the numbers" }) : null
    ]);
    fwrap.appendChild(el);
  });

  /* ---------- where RBNT sits ---------- */
  $("where-lede").textContent = "Every RBNT sits at exactly one address. This view sorts all " + F.full(sup.total[LAST]) +
    " RBNT found on chain by the type of address holding it at the end of the quarter, next to the start.";
  (function () {
    var c = card("card-where", "RBNT by type of address", "Start and end of the quarter. Bars use the same scale.", { table: true, source: "eth_getBalance at blocks " + F.full(OPEN.block) + " and " + F.full(CLOSE.block) });
    legend(c.body, [{ name: "1 July (start)", color: COLOR_CONTEXT }, { name: "30 September (end)", color: COLOR_FOCUS }]);
    var rows = R.location.filter(function (l) { return l.rbnt[0] || l.rbnt[LAST]; }).map(function (l) {
      return { label: l.label, values: [l.rbnt[0], l.rbnt[LAST]], note: pct(l.share[LAST]) + " of supply" };
    });
    var ch = h("div"); c.body.appendChild(ch);
    C.pairedBars(ch, { rows: rows, series: [{ name: "1 July", color: COLOR_CONTEXT }, { name: "30 September", color: COLOR_FOCUS }], fmt: cmp, tipFmt: rb, valueW: 60 });
    c.root.insertBefore(c.table, c.root.lastChild);
    table(c.table, "RBNT by type of address", ["Type", "What it is", "1 July", "30 September", "Change", "Share at end"],
      R.location.map(function (l) { return [l.label, l.desc, F.full(l.rbnt[0]), F.full(l.rbnt[LAST]), signed(l.rbnt[LAST] - l.rbnt[0]), pct(l.share[LAST])]; }),
      ["All balances found", "Of 10,000,000,000 RBNT created at launch", F.full(sup.total[0]), F.full(sup.total[LAST]), signed(Math.round(sup.change_in_quarter)), "100.0%"]);
  })();

  /* ---------- spread ---------- */
  (function () {
    var cs = $("conc-stats");
    var half = conc.half_count;
    stat(cs, "Held by the largest 10 holders", h("span", { text: pct(conc.top10[LAST]) }), "Was " + pct(conc.top10[0]) + " on 1 July (" + pp(conc.top10[0], conc.top10[LAST]) + ")", conc.top10);
    stat(cs, "Largest 10 regular wallets only", h("span", { text: pct(conc.wallets_top10[LAST]) }), "Was " + pct(conc.wallets_top10[0]) + " on 1 July (" + pp(conc.wallets_top10[0], conc.wallets_top10[LAST]) + ")", conc.wallets_top10);
    stat(cs, "Held by the largest 100 holders", h("span", { text: pct(conc.top100[LAST]) }), "Was " + pct(conc.top100[0]) + " on 1 July (" + pp(conc.top100[0], conc.top100[LAST]) + ")", conc.top100);
    stat(cs, "Holders that together hold half", h("span", { text: F.full(half[LAST]) }), "Was " + F.full(half[0]) + " on 1 July", half);

    var c1 = card("card-holders", "Holders with at least 1 RBNT", "Wallets and contracts, counting wrapped and staked RBNT. Named wallets left out.", { table: true, source: "balances at the 4 snapshot blocks" });
    var ch1 = h("div"); c1.body.appendChild(ch1);
    C.columns(ch1, { points: dates, series: [{ name: "Holders", color: COLOR_FOCUS, values: hold.ge1 }], fmt: function (v) { return F.full(v); }, height: 240 });
    c1.root.insertBefore(c1.table, c1.root.lastChild);
    table(c1.table, "Holder counts at each snapshot", ["Snapshot", "Block", "Holders with 1 RBNT or more", "Addresses with less than 1 RBNT"],
      S.map(function (s, i) { return [dateLong[i], F.full(s.block), F.full(hold.ge1[i]), F.full(hold.dust[i])]; }));

    var c2 = card("card-bands", "Share of RBNT by balance size", "Holders grouped by how much they hold. Bars show each group's share of the RBNT outside named wallets.", { table: true, source: "balances at blocks " + F.full(OPEN.block) + " and " + F.full(CLOSE.block) });
    legend(c2.body, [{ name: "1 July", color: COLOR_CONTEXT }, { name: "30 September", color: COLOR_FOCUS }]);
    var ch2 = h("div"); c2.body.appendChild(ch2);
    C.pairedBars(ch2, {
      rows: hold.bands.map(function (b) { return { label: b.label + " RBNT", values: [b.share[0], b.share[LAST]], note: F.full(b.holders[LAST]) + (b.holders[LAST] === 1 ? " holder" : " holders") }; }),
      series: [{ name: "1 July", color: COLOR_CONTEXT }, { name: "30 September", color: COLOR_FOCUS }],
      fmt: function (v) { return pct(v, v > 0 && v < 0.01 ? 2 : 1); }, valueW: 60, barH: 10
    });
    c2.root.insertBefore(c2.table, c2.root.lastChild);
    table(c2.table, "Holders and RBNT by balance band. RBNT per band on 1 July is in 02_holders_by_balance_band.csv.", ["Band (RBNT)", "Holders 1 Jul", "Holders 30 Sep", "Share 1 Jul", "Share 30 Sep", "RBNT 30 Sep"],
      hold.bands.map(function (b) { return [b.label, F.full(b.holders[0]), F.full(b.holders[LAST]), pct(b.share[0], b.share[0] < 0.01 ? 2 : 1), pct(b.share[LAST], b.share[LAST] < 0.01 ? 2 : 1), F.full(b.rbnt[LAST])]; }));
  })();

  /* ---------- largest holders ---------- */
  (function () {
    var c1 = card("card-cohort-count", "How many added and how many reduced", "Holders grouped by rank on 1 July. A move of more than 1% counts.", { table: true, source: "holdings at blocks " + F.full(OPEN.block) + " and " + F.full(CLOSE.block) });
    legend(c1.body, [{ name: "Reduced holdings", color: COLOR_CONTEXT }, { name: "Added to holdings", color: COLOR_FOCUS }]);
    var ch1 = h("div"); c1.body.appendChild(ch1);
    C.divergingBars(ch1, {
      rows: cohort.map(function (g) { return { label: g.label, left: g.reduced, right: g.added, extra: [{ value: F.full(g.steady), name: "steady" }] }; }),
      left: { name: "Reduced", color: COLOR_CONTEXT }, right: { name: "Added", color: COLOR_FOCUS }, fmt: function (v) { return F.full(v); }
    });
    c1.root.insertBefore(c1.table, c1.root.lastChild);
    table(c1.table, "Largest holders, grouped by rank on 1 July", ["Group", "Holders", "Added more than 1%", "Reduced more than 1%", "Steady", "Emptied", "Smart contracts in group"],
      cohort.map(function (g) { return [g.label, F.full(g.size), F.full(g.added), F.full(g.reduced), F.full(g.steady), F.full(g.emptied), F.full(g.contracts)]; }));

    var c2 = card("card-cohort-net", "Net change in what each group holds", "Combined holdings on 30 September minus 1 July, in RBNT.", { table: true, source: "same snapshot blocks" });
    var ch2 = h("div"); c2.body.appendChild(ch2);
    C.signedBars(ch2, {
      rows: cohort.map(function (g) { return { label: g.label, value: g.change, extra: [{ value: (g.change_pct >= 0 ? "+" : "-") + Math.abs(g.change_pct * 100).toFixed(1) + "%", name: "of the group's holdings" }] }; }),
      color: COLOR_FOCUS, fmt: cmp, tipFmt: function (v) { return F.full(v) + " RBNT"; }, name: "net change"
    });
    c2.root.insertBefore(c2.table, c2.root.lastChild);
    table(c2.table, "Combined holdings by group", ["Group", "1 July", "30 September", "Change", "Change %"],
      cohort.map(function (g) { return [g.label, F.full(g.open), F.full(g.close), signed(g.change), (g.change_pct >= 0 ? "+" : "-") + Math.abs(g.change_pct * 100).toFixed(2) + "%"]; }));

    var e = R.entrants, es = $("entrant-stats");
    stat(es, "Holders that joined the largest 1,000 during the quarter", h("span", { text: F.full(e.count) }), F.full(e.new_holders) + " of them held less than 1 RBNT on 1 July");
    stat(es, "What it took to be in the largest 1,000", h("span", { text: cmp(e.threshold_close) + " RBNT" }), "On 30 September. It was " + cmp(e.threshold_open) + " RBNT on 1 July.");
    stat(es, "Holdings of the newcomers on 30 September", h("span", { text: cmp(e.holdings_close) + " RBNT" }), "They held " + cmp(e.holdings_open) + " RBNT on 1 July");
  })();

  /* ---------- staking ---------- */
  (function () {
    var ss = $("staking-stats");
    stat(ss, "RBNT staked in both pools", h("span", { text: cmp(st.total_staked[LAST]) }), chg(st.total_staked[0], st.total_staked[LAST]) + " since 1 July", st.total_staked);
    stat(ss, "Wallets with a stake", h("span", { text: F.full(st.stakers_any[LAST]) }), "Was " + F.full(st.stakers_any[0]) + " on 1 July", st.stakers_any);
    stat(ss, "Share of supply staked", h("span", { text: pct(st.total_staked[LAST] / sup.total[LAST]) }), "Was " + pct(st.total_staked[0] / sup.total[0]) + " on 1 July");
    var claims = st.pools.reduce(function (a, p) { return a + p.q.claim_rbnt; }, 0);
    stat(ss, "Rewards claimed in the quarter", h("span", { text: cmp(claims) }), "RBNT paid out by the two pools");

    var pc = $("pool-cards");
    st.pools.forEach(function (p, i) {
      var box = h("div", { class: "reveal", "data-delay": String(i) });
      pc.appendChild(box);
      var c = card(box, p.name, "Pool balance split into stakes and reward funds, at each month end.", { table: true, source: "eth_getBalance and totalStake() on the pool contract" });
      legend(c.body, [{ name: "Staked by holders", color: COLOR_FOCUS }, { name: "Reward funds", color: COLOR_CONTEXT }]);
      var ch = h("div"); c.body.appendChild(ch);
      C.columns(ch, { points: dates, series: [{ name: "Staked", color: COLOR_FOCUS, values: p.staked }, { name: "Reward funds", color: COLOR_CONTEXT, values: p.reward_funds.map(function (v) { return Math.max(0, v); }) }], fmt: cmp, tipFmt: rb, height: 240 });
      c.root.insertBefore(c.table, c.root.lastChild);
      table(c.table, p.name, ["Snapshot", "Pool balance", "Staked (totalStake)", "Reward funds", "Wallets with a stake"],
        S.map(function (s, j) { return [dateLong[j], F.full(p.balance[j]), F.full(p.staked[j]), F.full(p.reward_funds[j]), F.full(p.stakers[j])]; }));
      var foot = c.root.querySelector(".card-foot");
      if (foot) foot.appendChild(addrLink(p.address));
    });

    var c = card("card-stake-flows", "Money in and out of the pools during the quarter", "Read from Stake, Unstake and reward claim events, plus transfers into each pool.", { source: "pool event logs between blocks " + F.full(OPEN.block) + " and " + F.full(CLOSE.block) });
    function fund(p) { return p.q.funding.reduce(function (a, f) { return a + f.rbnt; }, 0); }
    var measures = [
      ["Stakes made", function (p) { return F.full(p.q.stake_n); }],
      ["RBNT staked", function (p) { return F.full(p.q.stake_rbnt); }],
      ["Unstakes made", function (p) { return F.full(p.q.unstake_n); }],
      ["RBNT unstaked", function (p) { return F.full(p.q.unstake_rbnt); }],
      ["Rewards claimed (RBNT)", function (p) { return F.full(p.q.claim_rbnt); }],
      ["Reward funding received (RBNT)", function (p) { return F.full(fund(p)); }],
      ["Wallets that started staking", function (p) { return F.full(p.new_stakers); }],
      ["Wallets that fully unstaked", function (p) { return F.full(p.left); }]
    ];
    table(c.body, null, ["During the quarter"].concat(st.pools.map(function (p) { return p.name.replace("Reddex RBNT staking pool, ", "Pool: "); })),
      measures.map(function (m) { return [m[0]].concat(st.pools.map(m[1])); }));
    var funders = [];
    st.pools.forEach(function (p) { p.q.funding.forEach(function (f) { funders.push([p.name, f.from, F.full(f.rbnt)]); }); });
    if (funders.length) {
      c.body.appendChild(h("p", { style: "margin:20px 0 8px;font-size:14px;color:var(--outline)", text: "Where reward funding came from" }));
      table(c.body, null, ["Pool", "Sent by", "RBNT"], funders, null, true);
    }
  })();

  /* ---------- named wallets ---------- */
  (function () {
    var c = card("card-named", "Redbelly reserved wallets", "Balances read from the chain. The treasury page lists original allocations, not balances.", { source: "redbellydao.network/treasury and eth_getBalance" });
    var rows = reserved.map(function (n) {
      var name = h("span", null, [h("span", { text: n.name }), h("br"), addrLink(n.address)]);
      return [name, n.allocation === null || n.allocation === undefined ? "Not listed" : F.full(n.allocation), F.full(n.rbnt[0]), F.full(n.rbnt[LAST]), signed(n.change), F.full(n["in"]), F.full(n.out)];
    });
    var tot = reserved.reduce(function (a, n) { return [a[0] + (n.allocation || 0), a[1] + n.rbnt[0], a[2] + n.rbnt[LAST], a[3] + n.change, a[4] + n["in"], a[5] + n.out]; }, [0, 0, 0, 0, 0, 0]);
    table(c.body, null, ["Wallet", "Original allocation", "1 July", "30 September", "Change", "In during quarter", "Out during quarter"], rows,
      ["All nine reserved wallets", F.full(tot[0]), F.full(tot[1]), F.full(tot[2]), signed(tot[3]), F.full(tot[4]), F.full(tot[5])]);

    var c2 = card("card-named-flows", "Where reserved wallet transfers went", "Every RBNT and WRBNT transfer into or out of a reserved wallet during the quarter. Counterparties that are not publicly named are grouped.", { source: "transactions, internal transfers and WRBNT events in the quarter" });
    var frows = [];
    reserved.forEach(function (n) {
      n.flows.forEach(function (f) {
        var who = f.counterparty;
        frows.push([n.name, f.direction === "in" ? "In from" : "Out to", who, F.full(f.amount) + " " + f.asset, F.full(f.transfers)]);
      });
    });
    if (frows.length) table(c2.body, null, ["Reserved wallet", "Direction", "Counterparty", "Amount", "Transfers"], frows, null, true);
    else c2.body.appendChild(h("p", { text: "No reserved wallet sent or received RBNT or WRBNT during the quarter." }));

    var w = R.wrbnt;
    var c3 = card("card-wrbnt", "Wrapped RBNT (WRBNT)", "WRBNT is RBNT in token form, backed one to one by RBNT held in the WRBNT contract.", { table: true, source: "totalSupply() and Deposit and Withdrawal events" });
    var ch3 = h("div"); c3.body.appendChild(ch3);
    C.columns(ch3, { points: dates, series: [{ name: "WRBNT supply", color: COLOR_FOCUS, values: w.supply }], fmt: cmp, tipFmt: rb, height: 200 });
    c3.body.appendChild(h("p", { class: "s-sub", style: "font-size:14px;color:var(--on-surface-variant);margin:12px 0 0", text: "Wrapped in the quarter: " + F.full(w.wrapped_q) + " RBNT. Unwrapped: " + F.full(w.unwrapped_q) + " RBNT. Holders with 1 WRBNT or more on 30 September: " + F.full(w.holders[LAST]) + "." }));
    c3.root.insertBefore(c3.table, c3.root.lastChild);
    table(c3.table, "WRBNT", ["Snapshot", "WRBNT supply", "RBNT backing it", "Holders with 1 WRBNT or more"],
      S.map(function (s, j) { return [dateLong[j], F.full(w.supply[j]), F.full(w.backing[j]), F.full(w.holders[j])]; }));

    var c4 = card("card-exchanges", "Exchange wallets", null, { source: "Routescan address labels, checked on " + R.meta.generated_utc.slice(0, 10) });
    var ex = R.exchanges.labelled;
    if (ex.length) {
      table(c4.body, null, ["Exchange", "Address"], ex.map(function (e) { return [e.name, addrLink(e.address)]; }));
    } else {
      c4.body.appendChild(h("p", { style: "margin:0;color:var(--on-surface-variant);line-height:1.6", text: window.REPORT_COPY && window.REPORT_COPY.exchanges ? window.REPORT_COPY.exchanges(R) : "" }));
    }
  })();

  /* ---------- activity ---------- */
  (function () {
    var a = $("activity-stats");
    stat(a, "Transactions in the quarter", h("span", { text: F.full(R.activity.transactions) }), "Between blocks " + F.full(OPEN.block + 1) + " and " + F.full(CLOSE.block));
    stat(a, "Addresses that sent a transaction", h("span", { text: F.full(R.activity.sending_addresses) }), "Counted once each");
    stat(a, "RBNT paid in network fees", h("span", { text: F.full(sup.fees_in_quarter) }), "The protocol pays fees back out to network participants instead of burning them, so total RBNT changed by only " + Math.abs(sup.change_in_quarter).toFixed(2) + " RBNT");
  })();

  /* ---------- method ---------- */
  (function () {
    var steps = $("method-steps");
    ((window.REPORT_COPY && window.REPORT_COPY.method) || []).forEach(function (s) { steps.appendChild(h("li", { html: s })); });
    var c = card("card-checks", "Verification checks", "Run by the scripts every time the data is rebuilt. All must pass before publishing.", { source: "public/data/10_verification_checks.csv" });
    table(c.body, null, ["Check", "Result", "Detail"], R.checks.map(function (k) {
      var res = h("span", { class: "pill" }, [h("span", { class: "dot " + (k.pass ? "ok" : "warn") }), k.pass ? "PASSED" : "FAILED"]);
      var d = h("span", { style: "white-space:normal;display:block;min-width:280px;text-align:left", text: k.detail });
      return [k.check, res, d];
    }), null, true);
    var c2 = card("card-sources", "Sources and snapshot blocks", "Where each figure comes from and the exact chain state it describes.");
    table(c2.body, null, ["Snapshot", "State at", "Block", "Block time"], S.map(function (s, i) {
      return [dateLong[i].charAt(0).toUpperCase() + dateLong[i].slice(1), s.state_at_utc, blockLink(s.block), s.block_time_utc];
    }), null, true);
    var ul = h("ul", { style: "margin:20px 0 0;padding-left:20px;line-height:1.8;color:var(--on-surface-variant);font-size:15px" });
    ((window.REPORT_COPY && window.REPORT_COPY.sources) || []).forEach(function (s) { ul.appendChild(h("li", { html: s })); });
    c2.body.appendChild(ul);
  })();

  /* ---------- glossary ---------- */
  ((window.REPORT_COPY && window.REPORT_COPY.glossary) || []).forEach(function (g) {
    $("glossary-list").appendChild(h("div", null, [h("dt", { text: g[0] }), h("dd", { text: g[1] })]));
  });

  /* ---------- downloads ---------- */
  ((window.REPORT_COPY && window.REPORT_COPY.downloads) || []).forEach(function (d) {
    $("download-list").appendChild(h("a", { class: "dl", href: link(d.href), download: "" }, [h("span", { class: "ft", text: d.type }), h("span", null, [h("strong", { text: d.title }), h("span", { text: d.desc }), h("span", { class: "url", text: SITE + d.href })])]));
  });

  /* ---------- footer ---------- */
  $("footer-text").appendChild(h("p", { text: "RBNT Quarterly On-Chain Holder Report, " + R.meta.quarter.label + ". Prepared for the Redbelly DAO Community Task Board." }));
  $("footer-text").appendChild(h("p", { text: "Data last verified " + R.meta.generated_utc + " against Redbelly mainnet (chain ID 151). Snapshot blocks " + F.full(OPEN.block) + " to " + F.full(CLOSE.block) + "." }));
  $("footer-text").appendChild(h("p", { text: "This report describes past on-chain activity only. It is not financial advice and makes no prediction about prices." }));

  /* ---------- section intros and plain-language notes ---------- */
  var sec = window.REPORT_COPY && window.REPORT_COPY.sections ? window.REPORT_COPY.sections(R) : null;
  if (sec) {
    ["spread", "largest", "staking", "named"].forEach(function (k) { if (sec.ledes[k]) $(k + "-lede").textContent = sec.ledes[k]; });
    Object.keys(sec.explain).forEach(function (k) { explain("explain-" + k, "What this means", sec.explain[k]); });
  }

  /* In the PDF, relative links point at the live site */
  if (PRINT) document.querySelectorAll("a[href]").forEach(function (a) { a.setAttribute("href", link(a.getAttribute("href"))); });

  /* ---------- page motion ---------- */
  document.querySelectorAll("[data-count]").forEach(C.countUp);
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches || /[?&]print=1/.test(location.search);
  var reveals = document.querySelectorAll(".reveal");
  if (reduce || !("IntersectionObserver" in window)) reveals.forEach(function (n) { n.classList.add("in"); });
  else {
    var ro = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("in"); ro.unobserve(e.target); } }); }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
    reveals.forEach(function (n) { ro.observe(n); });
  }
  /* Section tabs: one highlight slides to the current tab. When a tab is
     clicked it moves straight there, and the scroll tracker waits until the
     page stops scrolling so it does not step through every tab on the way. */
  var links = Array.prototype.slice.call(document.querySelectorAll(".nav a"));
  var secs = links.map(function (a) { return document.querySelector(a.getAttribute("href")); });
  var ind = document.querySelector(".nav-indicator");
  var current = -2, jumping = false, settleTimer = 0;
  function place(i) {
    if (!ind) return;
    var a = links[i];
    if (!a || !a.offsetWidth) { ind.style.opacity = "0"; return; }
    var hidden = ind.style.opacity !== "1";
    if (hidden) ind.classList.add("no-anim");
    ind.style.width = a.offsetWidth + "px";
    ind.style.transform = "translateX(" + a.offsetLeft + "px)";
    if (hidden) { void ind.offsetWidth; ind.classList.remove("no-anim"); }
    ind.style.opacity = "1";
  }
  function setCurrent(i) {
    if (i === current) return;
    current = i;
    links.forEach(function (a, k) { if (k === i) a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current"); });
    place(i);
  }
  function spy() {
    var y = window.scrollY + 120, cur = -1;
    secs.forEach(function (s, i) { if (s && s.offsetTop <= y) cur = i; });
    return cur;
  }
  function onScroll() {
    if (jumping) {
      clearTimeout(settleTimer);
      settleTimer = setTimeout(function () { jumping = false; setCurrent(spy()); }, 140);
      return;
    }
    setCurrent(spy());
  }
  links.forEach(function (a, i) {
    a.addEventListener("click", function (e) {
      if (!secs[i]) return;
      e.preventDefault();
      jumping = true;
      setCurrent(i);
      secs[i].scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
      history.replaceState(null, "", a.getAttribute("href"));
      clearTimeout(settleTimer);
      settleTimer = setTimeout(function () { jumping = false; setCurrent(spy()); }, 1600);
    });
  });
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", function () { place(current); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { place(current); });
  setCurrent(spy());

  /* Logo goes back to the top without adding a hash to the address */
  $("brand-link").addEventListener("click", function (e) {
    e.preventDefault();
    jumping = true;
    setCurrent(-1);
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
  });

  /* ---------- theme ---------- */
  var tbtn = $("theme-toggle");
  function setTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    tbtn.setAttribute("aria-label", t === "dark" ? "Switch to light theme" : "Switch to dark theme");
    try { localStorage.setItem("rbnt-theme", t); } catch (e) {}
  }
  tbtn.addEventListener("click", function () { setTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark"); });
  tbtn.setAttribute("aria-label", document.documentElement.getAttribute("data-theme") === "dark" ? "Switch to light theme" : "Switch to dark theme");
})();
