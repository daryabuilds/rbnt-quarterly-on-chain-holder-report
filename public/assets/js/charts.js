/* Small SVG chart kit for the RBNT holder report.
   No dependencies. Every chart:
   - draws thin marks with 4px rounded data ends,
   - animates in once when it scrolls into view (skipped for reduced motion and print),
   - has a hover and keyboard tooltip on each mark,
   - redraws on resize without replaying the animation. */
(function () {
  "use strict";

  var NS = "http://www.w3.org/2000/svg";
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var printing = /[?&]print=1/.test(location.search);

  function el(tag, attrs, parent) {
    var n = document.createElementNS(NS, tag);
    if (attrs) for (var k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function txt(parent, x, y, s, cls, anchor, extra) {
    var t = el("text", Object.assign({ x: x, y: y, "class": cls || "", "text-anchor": anchor || "start" }, extra || {}), parent);
    t.textContent = s;
    return t;
  }

  /* Number formats. Plain hyphen for negatives, per the brand voice rules. */
  var F = {
    full: function (v, d) {
      return Number(v).toLocaleString("en-US", { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });
    },
    compact: function (v) {
      var a = Math.abs(v), s = v < 0 ? "-" : "";
      if (a >= 1e9) return s + trim(a / 1e9, a >= 1e10 ? 1 : 2) + "B";
      if (a >= 1e6) return s + trim(a / 1e6, a >= 1e8 ? 0 : 1) + "M";
      if (a >= 1e3) return s + trim(a / 1e3, a >= 1e5 ? 0 : 1) + "K";
      return s + trim(a, a >= 100 ? 0 : 1);
    },
    pct: function (v, d) { return (v * 100).toFixed(d === undefined ? 1 : d) + "%"; },
    signed: function (v, f) { return (v > 0 ? "+" : v < 0 ? "-" : "") + f(Math.abs(v)); }
  };
  function trim(x, d) { return Number(x.toFixed(d)).toString(); }

  /* One shared tooltip */
  var tip;
  function tooltip() {
    if (!tip) {
      tip = document.createElement("div");
      tip.className = "tooltip";
      tip.setAttribute("role", "status");
      document.body.appendChild(tip);
    }
    return tip;
  }
  function showTip(title, rows, x, y) {
    var t = tooltip();
    t.textContent = "";
    var h = document.createElement("div");
    h.className = "tt-title";
    h.textContent = title;
    t.appendChild(h);
    rows.forEach(function (r) {
      var row = document.createElement("div");
      row.className = "tt-row";
      if (r.color) {
        var k = document.createElement("span");
        k.className = "k";
        k.style.background = r.color;
        row.appendChild(k);
      }
      var v = document.createElement("span");
      v.className = "v";
      v.textContent = r.value;
      var n = document.createElement("span");
      n.className = "n";
      n.textContent = r.name || "";
      row.appendChild(v);
      row.appendChild(n);
      t.appendChild(row);
    });
    var w = t.offsetWidth || 180, hgt = t.offsetHeight || 60;
    var left = Math.min(window.innerWidth - w - 12, Math.max(12, x + 14));
    var top = y - hgt - 12;
    if (top < 72) top = y + 18;
    t.style.left = left + "px";
    t.style.top = top + "px";
    t.classList.add("on");
  }
  function hideTip() { if (tip) tip.classList.remove("on"); }

  function bindHover(hit, mark, getTip) {
    hit.setAttribute("tabindex", "0");
    hit.setAttribute("role", "img");
    var info = getTip();
    hit.setAttribute("aria-label", info.title + ": " + info.rows.map(function (r) { return r.value + " " + (r.name || ""); }).join(", "));
    function on(e) {
      var i = getTip();
      var x, y;
      if (e && e.clientX !== undefined && e.type !== "focus") { x = e.clientX; y = e.clientY; }
      else { var b = hit.getBoundingClientRect(); x = b.left + b.width / 2; y = b.top; }
      showTip(i.title, i.rows, x, y);
      if (mark) mark.classList.add("on");
    }
    function off() { hideTip(); if (mark) mark.classList.remove("on"); }
    hit.addEventListener("pointermove", on);
    hit.addEventListener("pointerleave", off);
    hit.addEventListener("focus", on);
    hit.addEventListener("blur", off);
  }

  /* Bar path: square at the baseline, 4px rounded data end. */
  function hbar(x0, y, w, h, toLeft) {
    var r = Math.min(4, Math.abs(w), h / 2);
    if (w <= 0.5) return "M" + x0 + "," + y + "h0.5v" + h + "h-0.5z";
    if (!toLeft) {
      return "M" + x0 + "," + y + "h" + (w - r) + "a" + r + "," + r + " 0 0 1 " + r + "," + r +
        "v" + (h - 2 * r) + "a" + r + "," + r + " 0 0 1 -" + r + "," + r + "h-" + (w - r) + "z";
    }
    return "M" + x0 + "," + y + "h-" + (w - r) + "a" + r + "," + r + " 0 0 0 -" + r + "," + r +
      "v" + (h - 2 * r) + "a" + r + "," + r + " 0 0 0 " + r + "," + r + "h" + (w - r) + "z";
  }
  function vbar(x, y0, w, h) {
    var r = Math.min(4, w / 2, h);
    if (h <= 0.5) return "M" + x + "," + y0 + "v-0.5h" + w + "v0.5z";
    return "M" + x + "," + y0 + "v-" + (h - r) + "a" + r + "," + r + " 0 0 1 " + r + ",-" + r +
      "h" + (w - 2 * r) + "a" + r + "," + r + " 0 0 1 " + r + "," + r + "v" + (h - r) + "z";
  }
  function niceMax(v) {
    if (v <= 0) return 1;
    var p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p;
    var m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
    return m * p;
  }

  /* Animate once on first view */
  var io = "IntersectionObserver" in window ? new IntersectionObserver(function (es) {
    es.forEach(function (e) {
      if (e.isIntersecting) { e.target.classList.add("drawn"); e.target.__drawn = true; io.unobserve(e.target); }
    });
  }, { threshold: 0.25 }) : null;

  function mount(container, render) {
    container.classList.add("chart");
    var last = 0;
    function draw() {
      var w = Math.round(container.clientWidth);
      if (!w || w === last) return;
      last = w;
      container.textContent = "";
      render(w);
      if (container.__drawn || reduce || printing || !io) {
        container.classList.add("drawn");
        container.__drawn = true;
      } else {
        // force a style flush so the from-state paints before the transition
        void container.offsetWidth;
      }
    }
    draw();
    if (io && !container.__drawn && !reduce && !printing) io.observe(container);
    if ("ResizeObserver" in window) new ResizeObserver(function () { draw(); }).observe(container);
    else window.addEventListener("resize", draw);
  }

  /* Horizontal paired bars: one row per category, one bar per series.
     opts: { rows:[{label, values:[...], note}], series:[{name,color}], fmt, tipFmt } */
  function pairedBars(container, opts) {
    mount(container, function (W) {
      var series = opts.series, rows = opts.rows;
      var fmt = opts.fmt || F.compact, tipFmt = opts.tipFmt || fmt;
      var barH = opts.barH || 12, gap = 4, labelH = 22, rowPad = 18;
      var valueW = opts.valueW || 64;
      var rowH = labelH + series.length * barH + (series.length - 1) * gap + rowPad;
      var H = rows.length * rowH + 8;
      var plotW = Math.max(80, W - valueW - 4);
      var max = opts.max || Math.max.apply(null, rows.map(function (r) { return Math.max.apply(null, r.values); }));
      if (max <= 0) max = 1;
      var svg = el("svg", { viewBox: "0 0 " + W + " " + H, width: W, height: H, role: "group", "aria-label": opts.title || "" }, container);
      rows.forEach(function (r, i) {
        var y0 = i * rowH;
        txt(svg, 0, y0 + 15, r.label, "t-strong", "start", { "font-size": 14 });
        if (r.note) {
          var nt = txt(svg, W, y0 + 15, r.note, "t-muted", "end", { "font-size": 12 });
        }
        el("line", { x1: 0.5, x2: 0.5, y1: y0 + labelH - 2, y2: y0 + labelH + series.length * (barH + gap) - gap + 2, "class": "baseline" }, svg);
        series.forEach(function (s, j) {
          var v = r.values[j], w = Math.max(0, (v / max) * plotW);
          var y = y0 + labelH + j * (barH + gap);
          var g = el("g", { "class": "mark" }, svg);
          var p = el("path", { d: hbar(1, y, Math.max(w, v > 0 ? 1.5 : 0.5), barH), fill: s.color, "class": "grow x" }, g);
          p.style.transitionDelay = (i * 60 + j * 90) + "ms";
          var lbl = txt(svg, Math.min(w + 8, plotW + 8), y + barH - 2, fmt(v), j === series.length - 1 ? "t-strong fade" : "t-muted fade", "start", { "font-size": 12 });
          lbl.style.transitionDelay = (400 + i * 60) + "ms";
          var hit = el("rect", { x: 0, y: y - gap / 2, width: Math.max(plotW, 40), height: barH + gap, "class": "hit" }, svg);
          bindHover(hit, g, function () {
            return { title: r.label, rows: series.map(function (s2, k) { return { color: s2.color, value: tipFmt(r.values[k]), name: s2.name }; }) };
          });
        });
      });
    });
  }

  /* Diverging bars around a centre line: left value and right value per row.
     opts: { rows:[{label, left, right}], left:{name,color}, right:{name,color}, fmt } */
  function divergingBars(container, opts) {
    mount(container, function (W) {
      var rows = opts.rows, fmt = opts.fmt || F.full;
      var labelW = W < 560 ? 0 : 150;
      var barH = 16, rowH = W < 560 ? 62 : 40;
      var H = rows.length * rowH + 34;
      var cx = labelW + (W - labelW) / 2;
      var half = (W - labelW) / 2 - 46;
      var max = Math.max.apply(null, rows.map(function (r) { return Math.max(r.left, r.right); })) || 1;
      var svg = el("svg", { viewBox: "0 0 " + W + " " + H, width: W, height: H }, container);
      txt(svg, cx - 8, 14, opts.left.name, "t-muted", "end", { "font-size": 12 });
      txt(svg, cx + 8, 14, opts.right.name, "t-muted", "start", { "font-size": 12 });
      var top = 26;
      el("line", { x1: cx, x2: cx, y1: top - 4, y2: H - 4, "class": "baseline" }, svg);
      rows.forEach(function (r, i) {
        var y0 = top + i * rowH;
        var by = labelW ? y0 + (rowH - barH) / 2 : y0 + 26;
        if (labelW) txt(svg, 0, by + barH - 3, r.label, "t-strong", "start", { "font-size": 14 });
        else txt(svg, cx, y0 + 16, r.label, "t-strong", "middle", { "font-size": 13 });
        var wl = (r.left / max) * half, wr = (r.right / max) * half;
        var g = el("g", { "class": "mark" }, svg);
        var pl = el("path", { d: hbar(cx - 1, by, Math.max(wl, 0.5), barH, true), fill: opts.left.color, "class": "grow x-r" }, g);
        var pr = el("path", { d: hbar(cx + 1, by, Math.max(wr, 0.5), barH), fill: opts.right.color, "class": "grow x" }, g);
        pl.style.transitionDelay = pr.style.transitionDelay = (i * 80) + "ms";
        txt(svg, cx - wl - 8, by + barH - 3, fmt(r.left), "t-muted fade", "end", { "font-size": 12 });
        txt(svg, cx + wr + 8, by + barH - 3, fmt(r.right), "t-strong fade", "start", { "font-size": 12 });
        var hit = el("rect", { x: labelW, y: y0, width: W - labelW, height: rowH, "class": "hit" }, svg);
        bindHover(hit, g, function () {
          var rowsT = [{ color: opts.right.color, value: fmt(r.right), name: opts.right.name }, { color: opts.left.color, value: fmt(r.left), name: opts.left.name }];
          if (r.extra) rowsT = rowsT.concat(r.extra);
          return { title: r.label, rows: rowsT };
        });
      });
    });
  }

  /* Signed horizontal bars from a zero line (net change). */
  function signedBars(container, opts) {
    mount(container, function (W) {
      var rows = opts.rows, fmt = opts.fmt || F.compact;
      var labelW = W < 560 ? 0 : 150;
      var barH = 16, rowH = W < 560 ? 60 : 40;
      var H = rows.length * rowH + 8;
      var min = Math.min(0, Math.min.apply(null, rows.map(function (r) { return r.value; })));
      var max = Math.max(0, Math.max.apply(null, rows.map(function (r) { return r.value; })));
      var span = (max - min) || 1, padL = 56, padR = 56;
      var plot = W - labelW - padL - padR;
      var x0 = labelW + padL + (-min / span) * plot;
      var svg = el("svg", { viewBox: "0 0 " + W + " " + H, width: W, height: H }, container);
      el("line", { x1: x0, x2: x0, y1: 0, y2: H, "class": "baseline" }, svg);
      rows.forEach(function (r, i) {
        var y0 = i * rowH;
        var by = labelW ? y0 + (rowH - barH) / 2 : y0 + 24;
        if (labelW) txt(svg, 0, by + barH - 3, r.label, "t-strong", "start", { "font-size": 14 });
        else txt(svg, 0, y0 + 15, r.label, "t-strong", "start", { "font-size": 13 });
        var w = Math.abs(r.value) / span * plot, neg = r.value < 0;
        var g = el("g", { "class": "mark" }, svg);
        var p = el("path", { d: hbar(neg ? x0 - 1 : x0 + 1, by, Math.max(w, 0.5), barH, neg), fill: r.color || opts.color, "class": "grow " + (neg ? "x-r" : "x") }, g);
        p.style.transitionDelay = (i * 80) + "ms";
        txt(svg, neg ? x0 - w - 8 : x0 + w + 8, by + barH - 3, F.signed(r.value, fmt), "t-strong fade", neg ? "end" : "start", { "font-size": 12 });
        var hit = el("rect", { x: labelW, y: y0, width: W - labelW, height: rowH, "class": "hit" }, svg);
        bindHover(hit, g, function () { return { title: r.label, rows: [{ color: r.color || opts.color, value: F.signed(r.value, opts.tipFmt || fmt), name: opts.name || "" }].concat(r.extra || []) }; });
      });
    });
  }

  /* Columns over time, optionally stacked.
     opts: { points:[label...], series:[{name,color,values}], fmt, height } */
  function columns(container, opts) {
    mount(container, function (W) {
      var pts = opts.points, series = opts.series, fmt = opts.fmt || F.compact;
      var H = opts.height || 240, padT = 22, padB = 30, padL = 44;
      var plotH = H - padT - padB, plotW = W - padL - 4;
      var totals = pts.map(function (_, i) { return series.reduce(function (a, s) { return a + s.values[i]; }, 0); });
      var max = niceMax(opts.max || Math.max.apply(null, totals));
      var svg = el("svg", { viewBox: "0 0 " + W + " " + H, width: W, height: H }, container);
      var grid = el("g", { "class": "grid" }, svg);
      for (var t = 0; t <= 4; t++) {
        var v = max * t / 4, y = padT + plotH - (v / max) * plotH;
        el("line", { x1: padL, x2: W, y1: Math.round(y) + 0.5, y2: Math.round(y) + 0.5 }, grid);
        txt(svg, padL - 8, y + 4, F.compact(v), "t-muted", "end", { "font-size": 11 });
      }
      var slot = plotW / pts.length, bw = Math.min(40, slot * 0.5);
      pts.forEach(function (lab, i) {
        var x = padL + slot * i + (slot - bw) / 2, base = padT + plotH;
        txt(svg, x + bw / 2, H - 8, lab, "t-muted", "middle", { "font-size": 12 });
        var g = el("g", { "class": "mark" }, svg), acc = 0;
        series.forEach(function (s, j) {
          var h = (s.values[i] / max) * plotH;
          if (h <= 0) return;
          var top = j === series.length - 1 || series.slice(j + 1).every(function (s2) { return !s2.values[i]; });
          var y = base - acc - h;
          var d = top ? vbar(x, base - acc, bw, h) : "M" + x + "," + (base - acc) + "v-" + h + "h" + bw + "v" + h + "z";
          var p = el("path", { d: d, fill: s.color, "class": "grow y" }, g);
          p.style.transitionDelay = (i * 90 + j * 120) + "ms";
          acc += h + (top ? 0 : 2); // 2px surface gap between stacked segments
        });
        txt(svg, x + bw / 2, base - acc - 8, fmt(totals[i]), "t-strong fade", "middle", { "font-size": 12 }).style.transitionDelay = (500 + i * 90) + "ms";
        var hit = el("rect", { x: padL + slot * i, y: padT, width: slot, height: plotH, "class": "hit" }, svg);
        bindHover(hit, g, function () {
          return { title: lab, rows: series.map(function (s) { return { color: s.color, value: (opts.tipFmt || fmt)(s.values[i]), name: s.name }; }).concat(series.length > 1 ? [{ value: (opts.tipFmt || fmt)(totals[i]), name: "Total" }] : []) };
        });
      });
      el("line", { x1: padL, x2: W, y1: padT + plotH + 0.5, y2: padT + plotH + 0.5, "class": "baseline" }, svg);
    });
  }

  /* Line over snapshot points with end-value label. */
  function line(container, opts) {
    mount(container, function (W) {
      var pts = opts.points, vals = opts.values, fmt = opts.fmt || F.compact;
      var H = opts.height || 200, padT = 16, padB = 28, padL = 48, padR = 64;
      var plotH = H - padT - padB, plotW = W - padL - padR;
      var lo = opts.min !== undefined ? opts.min : Math.min.apply(null, vals);
      var hi = Math.max.apply(null, vals);
      if (opts.min === undefined) { var pad = (hi - lo) * 0.25 || hi * 0.05 || 1; lo = Math.max(0, lo - pad); hi = hi + pad; }
      var svg = el("svg", { viewBox: "0 0 " + W + " " + H, width: W, height: H }, container);
      var grid = el("g", { "class": "grid" }, svg);
      for (var t = 0; t <= 3; t++) {
        var v = lo + (hi - lo) * t / 3, y = padT + plotH - ((v - lo) / (hi - lo)) * plotH;
        el("line", { x1: padL, x2: W - padR + 20, y1: Math.round(y) + 0.5, y2: Math.round(y) + 0.5 }, grid);
        txt(svg, padL - 8, y + 4, (opts.axisFmt || F.compact)(v), "t-muted", "end", { "font-size": 11 });
      }
      function X(i) { return padL + (pts.length === 1 ? plotW / 2 : (plotW * i) / (pts.length - 1)); }
      function Y(v) { return padT + plotH - ((v - lo) / (hi - lo)) * plotH; }
      pts.forEach(function (p, i) { txt(svg, X(i), H - 8, p, "t-muted", "middle", { "font-size": 12 }); });
      var d = vals.map(function (v, i) { return (i ? "L" : "M") + X(i).toFixed(1) + "," + Y(v).toFixed(1); }).join("");
      var area = el("path", { d: d + "L" + X(vals.length - 1) + "," + (padT + plotH) + "L" + X(0) + "," + (padT + plotH) + "Z", fill: opts.color, "fill-opacity": 0.1, "class": "fade" }, svg);
      var path = el("path", { d: d, fill: "none", stroke: opts.color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round", "class": "draw" }, svg);
      var len = 0;
      try { len = path.getTotalLength(); } catch (e) { len = 2000; }
      if (!container.__drawn && !reduce && !printing) {
        path.style.strokeDasharray = len;
        path.style.strokeDashoffset = len;
        var obs = new MutationObserver(function () {
          if (container.classList.contains("drawn")) { path.style.strokeDashoffset = 0; obs.disconnect(); }
        });
        obs.observe(container, { attributes: true, attributeFilter: ["class"] });
      }
      vals.forEach(function (v, i) {
        var g = el("g", { "class": "mark" }, svg);
        el("circle", { cx: X(i), cy: Y(v), r: 4, fill: opts.color, stroke: "var(--surface-slate)", "stroke-width": 2, "class": "fade" }, g).style.transitionDelay = (300 + i * 150) + "ms";
        var hit = el("rect", { x: X(i) - Math.max(12, plotW / (pts.length * 2)), y: padT, width: Math.max(24, plotW / pts.length), height: plotH, "class": "hit" }, svg);
        bindHover(hit, g, function () { return { title: pts[i], rows: [{ color: opts.color, value: (opts.tipFmt || fmt)(v), name: opts.name || "" }] }; });
      });
      txt(svg, X(vals.length - 1) + 10, Y(vals[vals.length - 1]) + 4, fmt(vals[vals.length - 1]), "t-strong fade", "start", { "font-size": 12 });
    });
  }

  /* Count-up numbers for KPI tiles. data-count holds the final value. */
  function countUp(node) {
    var end = parseFloat(node.getAttribute("data-count"));
    var fmt = node.getAttribute("data-fmt") || "full";
    var dec = parseInt(node.getAttribute("data-dec") || "0", 10);
    var suffix = node.getAttribute("data-suffix") || "";
    function show(v) {
      var s = fmt === "compact" ? F.compact(v) : fmt === "pct" ? (v).toFixed(dec) + "%" : F.full(v, dec);
      node.textContent = s + suffix;
    }
    if (reduce || printing || !("IntersectionObserver" in window)) { show(end); return; }
    show(0);
    var o = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        o.disconnect();
        var t0 = performance.now(), dur = 1400;
        (function step(t) {
          var k = Math.min(1, (t - t0) / dur);
          var eased = 1 - Math.pow(1 - k, 4);
          show(k < 1 ? end * eased : end);
          if (k < 1) requestAnimationFrame(step);
        })(t0);
      });
    }, { threshold: 0.4 });
    o.observe(node);
  }

  /* Sparkline in a stat tile */
  function spark(container, values, color) {
    mount(container, function (W) {
      var H = 36, lo = Math.min.apply(null, values), hi = Math.max.apply(null, values);
      if (hi === lo) { hi += 1; lo -= 1; }
      var svg = el("svg", { viewBox: "0 0 " + W + " " + H, width: W, height: H, "aria-hidden": "true" }, container);
      function X(i) { return 4 + (W - 8) * i / (values.length - 1); }
      function Y(v) { return 4 + (H - 8) * (1 - (v - lo) / (hi - lo)); }
      el("path", { d: values.map(function (v, i) { return (i ? "L" : "M") + X(i) + "," + Y(v); }).join(""), fill: "none", stroke: "var(--chart-context)", "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round" }, svg);
      el("circle", { cx: X(values.length - 1), cy: Y(values[values.length - 1]), r: 4, fill: color || "var(--chart-focus)", stroke: "var(--surface-slate)", "stroke-width": 2 }, svg);
    });
  }

  window.RBCharts = { F: F, pairedBars: pairedBars, divergingBars: divergingBars, signedBars: signedBars, columns: columns, line: line, countUp: countUp, spark: spark };
})();
