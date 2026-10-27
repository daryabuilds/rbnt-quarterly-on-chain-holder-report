/* Hero background: a slow consensus network. Slate nodes drift, links form
   between near neighbours, and red pulses travel along links the way blocks
   pass between validators. One accent colour only. Static for reduced motion,
   paused when off screen or when the tab is hidden. */
(function () {
  "use strict";
  var canvas = document.getElementById("net");
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext("2d");
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var RED = "239,83,80", SLATE = "143,161,173";
  var nodes = [], pulses = [], W = 0, H = 0, dpr = 1, running = false, raf = 0, last = 0, seed = 7;

  function rnd() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }

  function setup() {
    var r = canvas.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    seed = 7;
    var count = Math.round(Math.min(90, Math.max(28, (W * H) / 14000)));
    nodes = [];
    for (var i = 0; i < count; i++) {
      // weight nodes toward the right, away from the headline
      var x = W * (0.25 + 0.75 * Math.pow(rnd(), 0.7));
      nodes.push({ x: x, y: rnd() * H, vx: (rnd() - 0.5) * 0.12, vy: (rnd() - 0.5) * 0.12, r: 1.2 + rnd() * 1.8, glow: 0 });
    }
    pulses = [];
  }

  function links() {
    var out = [], max = Math.min(170, Math.max(110, W / 9));
    for (var i = 0; i < nodes.length; i++) {
      for (var j = i + 1; j < nodes.length; j++) {
        var dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y, d = Math.sqrt(dx * dx + dy * dy);
        if (d < max) out.push([i, j, 1 - d / max]);
      }
    }
    return out;
  }

  function frame(t) {
    var dt = last ? Math.min(50, t - last) : 16;
    last = t;
    ctx.clearRect(0, 0, W, H);
    var L = links();
    for (var k = 0; k < L.length; k++) {
      var a = nodes[L[k][0]], b = nodes[L[k][1]];
      ctx.strokeStyle = "rgba(" + SLATE + "," + (0.22 * L[k][2]).toFixed(3) + ")";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    if (!reduce && L.length && Math.random() < 0.05 && pulses.length < 14) {
      var pick = L[Math.floor(Math.random() * L.length)];
      pulses.push({ a: pick[0], b: pick[1], p: 0, speed: 0.0009 + Math.random() * 0.0012 });
    }
    for (var q = pulses.length - 1; q >= 0; q--) {
      var P = pulses[q], A = nodes[P.a], B = nodes[P.b];
      P.p += P.speed * dt;
      if (P.p >= 1) { B.glow = 1; pulses.splice(q, 1); continue; }
      var x = A.x + (B.x - A.x) * P.p, y = A.y + (B.y - A.y) * P.p;
      var tx = A.x + (B.x - A.x) * Math.max(0, P.p - 0.18), ty = A.y + (B.y - A.y) * Math.max(0, P.p - 0.18);
      var g = ctx.createLinearGradient(tx, ty, x, y);
      g.addColorStop(0, "rgba(" + RED + ",0)");
      g.addColorStop(1, "rgba(" + RED + ",0.85)");
      ctx.strokeStyle = g; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(x, y); ctx.stroke();
      ctx.fillStyle = "rgba(" + RED + ",0.95)";
      ctx.beginPath(); ctx.arc(x, y, 1.8, 0, Math.PI * 2); ctx.fill();
    }
    for (var n = 0; n < nodes.length; n++) {
      var N = nodes[n];
      if (!reduce) {
        N.x += N.vx * dt * 0.06; N.y += N.vy * dt * 0.06;
        if (N.x < W * 0.2 || N.x > W + 10) N.vx *= -1;
        if (N.y < -10 || N.y > H + 10) N.vy *= -1;
      }
      if (N.glow > 0) {
        ctx.fillStyle = "rgba(" + RED + "," + (0.18 * N.glow).toFixed(3) + ")";
        ctx.beginPath(); ctx.arc(N.x, N.y, 4 + 10 * (1 - N.glow), 0, Math.PI * 2); ctx.fill();
        N.glow = Math.max(0, N.glow - dt * 0.0012);
      }
      ctx.fillStyle = N.glow > 0.05 ? "rgba(" + RED + ",0.9)" : "rgba(" + SLATE + ",0.55)";
      ctx.beginPath(); ctx.arc(N.x, N.y, N.r, 0, Math.PI * 2); ctx.fill();
    }
    if (running) raf = requestAnimationFrame(frame);
  }

  function start() { if (running || reduce) return; running = true; last = 0; raf = requestAnimationFrame(frame); }
  function stop() { running = false; cancelAnimationFrame(raf); }

  setup();
  frame(16);
  if (reduce) return;
  var visible = true;
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (es) { visible = es[0].isIntersecting; visible && !document.hidden ? start() : stop(); }).observe(canvas);
  } else start();
  document.addEventListener("visibilitychange", function () { document.hidden ? stop() : visible && start(); });
  var rt;
  window.addEventListener("resize", function () { clearTimeout(rt); rt = setTimeout(function () { setup(); if (!running) frame(16); }, 150); });
})();
