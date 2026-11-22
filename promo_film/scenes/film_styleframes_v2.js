/* film.js - TarmacOS promo film (1080x1350, 56 s).
   Deterministic: window.render(t) sets every element from t alone, so any frame can be rendered in any order.
   Real dashboard footage comes from ../assets/captures (DPR 2 screenshots of the running app, never edited);
   crop rectangles are CSS pixels of the 1920x1080 dashboard. Every quoted value is in _capture_log.json. */
"use strict";

const DURATION = 56;
const CAP = "../assets/captures/";
const W = 1080, H = 1350, M = 72;                     // frame and safe margin

// ------------------------------------------------------------------ maths
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const prog = (t, a, b) => clamp((t - a) / (b - a));
const mix = (a, b, k) => a + (b - a) * k;
const eo = (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x));                 // expo out
const ei = (x) => (x <= 0 ? 0 : Math.pow(2, 10 * x - 10));                 // expo in
const ec = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);   // cubic in-out
const bump = (t, a, b) => Math.sin(Math.PI * prog(t, a, b));               // 0 -> 1 -> 0
const amberMix = (k) => `color-mix(in srgb, var(--amber) ${Math.round(clamp(k) * 100)}%, var(--text))`;
const lerpRect = (r1, r2, k) => r1.map((v, i) => mix(v, r2[i], k));

// ------------------------------------------------------------------ DOM helpers
const SVGNS = "http://www.w3.org/2000/svg";
function el(tag, cls, parent, style, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (style) Object.assign(e.style, style);
  if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}
function sv(tag, attrs, parent) {
  const e = document.createElementNS(SVGNS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}
function show(e, on) { e.style.visibility = on ? "visible" : "hidden"; }
function svgLayer(parent) { return sv("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}` }, parent); }

// ------------------------------------------------------------------ kinetic type
/* Words: a caption revealed word by word. The newest word lands amber and cools to white;
   *word* stays amber. "\n" forces a line break. Exit = rise + blur with two ghost echoes. */
class Words {
  constructor(parent, text, o) {
    this.o = Object.assign({ x: M, y: 0, w: W - 2 * M, size: 52, weight: 700, family: "var(--tight)", align: "left", lh: 1.08,
                             color: "var(--text)", track: "-0.02em" }, o);
    const st = { left: this.o.x + "px", top: this.o.y + "px", width: this.o.w + "px", fontSize: this.o.size + "px",
                 fontWeight: this.o.weight, fontFamily: this.o.family, textAlign: this.o.align, lineHeight: this.o.lh,
                 letterSpacing: this.o.track };
    this.roots = [0, 1, 2].map(() => el("div", "words", parent, { ...st }));
    this.words = this.roots.map(() => []);
    const tokens = text.split(/( |\n)/).filter((s) => s !== "" && s !== " ");
    this.roots.forEach((root, r) => {
      tokens.forEach((tok) => {
        if (tok === "\n") { el("br", null, root); return; }
        const accent = /^\*.*\*[.,:?!]*$/.test(tok);
        const span = el("span", "w", root, {}, tok.replace(/\*/g, "") + " ");
        span.accent = accent;
        this.words[r].push(span);
      });
    });
    this.roots[1].style.opacity = 0; this.roots[2].style.opacity = 0;
  }
  draw(t, start, per = 0.11, end = Infinity, dur = 0.45) {
    const n = this.words[0].length;
    const ex = ec(prog(t, end, end + dur));
    this.roots.forEach((root, r) => {
      const lag = r * 0.06;
      const e = r === 0 ? ex : ec(prog(t, end + lag, end + dur + lag));
      if (r > 0) {
        root.style.opacity = t > end ? (1 - e) * (r === 1 ? 0.35 : 0.16) * clamp(ex * 5) : 0;
        root.style.transform = `translateY(${-e * 70 + r * 16}px)`;
        root.style.filter = `blur(${2 + r * 2}px)`;
      } else {
        root.style.opacity = 1 - e;
        root.style.transform = `translateY(${-e * 70}px)`;
        root.style.filter = e > 0 ? `blur(${e * 8}px)` : "none";
      }
      for (let i = 0; i < n; i++) {
        const w = this.words[r][i], a = start + i * per;
        const k = eo(prog(t, a, a + 0.55));
        w.style.opacity = k;
        w.style.transform = `translateY(${(1 - k) * 0.4}em)`;
        w.style.filter = k < 1 ? `blur(${(1 - k) * 9}px)` : "none";
        w.style.color = w.accent ? "var(--amber)" : amberMix(1 - prog(t, a + 0.35, a + 1.0));
      }
    });
  }
}

/* Slam: big display lines built letter by letter (blur-in), landing amber then cooling to white,
   unless the line is marked amber. glowBoost adds an extra bloom (used on the end card). */
class Slam {
  constructor(parent, lines, o) {
    this.o = Object.assign({ x: 0, y: 0, w: W, align: "center", size: 140, stretch: 112, gap: 0.92, color: "var(--text)" }, o);
    this.root = el("div", "slam", parent, { left: this.o.x + "px", top: this.o.y + "px", width: this.o.w + "px",
                                             textAlign: this.o.align, fontSize: this.o.size + "px", fontStretch: this.o.stretch + "%",
                                             lineHeight: this.o.gap });
    this.chars = [];
    lines.forEach((ln) => {
      const line = el("span", "ln", this.root, ln.size ? { fontSize: ln.size + "px" } : {});
      [...ln.text].forEach((c, ci) => {
        const amber = ln.amber === true || (Array.isArray(ln.amber) && ln.amber.includes(ci));
        const ch = el("span", "ch", line, {}, c === " " ? " " : c);
        ch.amber = amber; ch.final = ln.color || null;
        this.chars.push(ch);
      });
    });
  }
  draw(t, start, stagger = 0.03, end = Infinity, glowBoost = 0) {
    const ex = ec(prog(t, end, end + 0.5));
    this.root.style.opacity = 1 - ex;
    this.root.style.transform = `translateY(${-ex * 60}px) scale(${1 - ex * 0.06})`;
    this.root.style.filter = ex > 0 ? `blur(${ex * 10}px)` : "none";
    this.chars.forEach((ch, i) => {
      const a = start + i * stagger;
      const k = eo(prog(t, a, a + 0.5));
      ch.style.opacity = k;
      ch.style.transform = `translateY(${(1 - k) * 0.35}em) scale(${1 + (1 - k) * 0.25})`;
      ch.style.filter = k < 1 ? `blur(${(1 - k) * 14}px)` : "none";
      const cool = prog(t, a + 0.2, a + 0.9);
      ch.style.color = ch.final ? ch.final : ch.amber ? "var(--amber)" : amberMix(1 - cool);
      const g = (1 - cool) * 0.9 + glowBoost;
      ch.style.textShadow = g > 0.01 ? `0 0 ${18 + 50 * g}px rgba(240,180,60,${0.55 * clamp(g)})` : "none";
    });
  }
}

/* Typewriter text (mono). */
class Typer {
  constructor(parent, text, o) {
    this.text = text;
    this.e = el("div", "abs mono", parent, Object.assign({ fontSize: "30px", color: "var(--text)", whiteSpace: "pre" }, o));
  }
  draw(t, start, cps = 30) {
    const n = Math.floor(clamp((t - start) * cps, 0, this.text.length));
    this.e.textContent = this.text.slice(0, n);
    this.e.style.opacity = t >= start ? 1 : 0;
  }
}

// ------------------------------------------------------------------ real footage
/* Shot: a borderless card showing a crop of one or more real captures (crossfaded). */
class Shot {
  constructor(parent, names, o = {}) {
    this.root = el("div", "shot", parent, o.style || {});
    this.imgs = names.map((n) => {
      const img = el("img", null, this.root);
      img.src = CAP + n + ".png";
      img.style.width = "3840px"; img.style.height = "2160px";
      return img;
    });
    if (o.fadeRight) this.root.style.maskImage = "linear-gradient(90deg, #000 88%, transparent 100%)";
    // redactions: boxes over personal data in the capture (the capture file itself is not edited)
    this.masks = (o.redact || []).map((m) => {
      const e = el("div", "abs mono", this.root, { background: "#0b1322", border: "1px dashed rgba(240,180,60,.55)", borderRadius: "4px",
                                                    color: "var(--amber)", display: "flex", alignItems: "center", paddingLeft: "10px",
                                                    boxSizing: "border-box", whiteSpace: "nowrap", overflow: "hidden" }, m.label);
      return { e, rect: m.rect };
    });
  }
  /* box = [x, y, w, h] in frame px; rect = [x0, y0, x1, y1] in dashboard CSS px; idx = float image index */
  set(box, rect, idx = 0, extra = "") {
    const [bx, by, bw, bh] = box, [x0, y0, x1, y1] = rect;
    const s = Math.max(bw / (x1 - x0), bh / (y1 - y0));
    Object.assign(this.root.style, { left: bx + "px", top: by + "px", width: bw + "px", height: bh + "px", transform: extra });
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    this.imgs.forEach((img, i) => {
      img.style.transform = `translate(${bw / 2 - cx * s}px, ${bh / 2 - cy * s}px) scale(${s / 2})`;
      img.style.opacity = clamp(1 - Math.abs(i - idx));
    });
    this.masks.forEach(({ e, rect: [mx0, my0, mx1, my1] }) => {
      Object.assign(e.style, { left: bw / 2 + (mx0 - cx) * s + "px", top: bh / 2 + (my0 - cy) * s + "px",
                               width: (mx1 - mx0) * s + "px", height: (my1 - my0) * s + "px", fontSize: (my1 - my0) * s * 0.62 + "px" });
    });
  }
}

// ------------------------------------------------------------------ scene registry
const SCENES = [];
function scene(a, b, build) {
  const root = el("div", "scene", document.getElementById("scenes"));
  const s = { a, b, root, draw: build(root) };
  SCENES.push(s);
  return s;
}
const HUD = {};

// ================================================================== S1 HOOK 0.0-4.6
function S1(root) {
  const svg = svgLayer(root);
  const clip = sv("clipPath", { id: "cl1" }, sv("defs", {}, svg));
  const clipRect = sv("rect", { x: 0, y: 0, width: 0, height: H }, clip);
  const line = sv("line", { x1: -20, y1: 1040, x2: W + 20, y2: 1040, stroke: "#f0b43c", "stroke-width": 6, "stroke-dasharray": "46 26",
                            "clip-path": "url(#cl1)", style: "filter: drop-shadow(0 0 10px rgba(240,180,60,.7))" }, svg);
  const hook = el("div", "abs", root, { left: 0, top: "360px", width: W + "px", textAlign: "center", fontFamily: "var(--inter)",
                                         fontWeight: 200, fontSize: "84px", letterSpacing: "-0.01em", color: "var(--text)", whiteSpace: "nowrap" });
  const hookIn = el("span", null, hook, { display: "inline-block", textShadow: "0 0 24px rgba(228,232,240,.45)" }, "What if an airport");
  const pen = el("div", "abs", root, { width: "16px", height: "16px", borderRadius: "50%", background: "#fff",
                                        boxShadow: "0 0 18px 8px rgba(240,180,60,.9), 0 0 60px 20px rgba(240,180,60,.35)" });
  const ran = new Words(root, "ran like an", { y: 500, align: "center", size: 60, x: 0, w: W });
  const slam = new Slam(root, [{ text: "OPERATING" }, { text: "SYSTEM?", amber: [6] }], { y: 610, size: 136 });
  let hookBox = null;
  return (t) => {
    if (!hookBox) { const r = hookIn.getBoundingClientRect(); hookBox = [r.left, r.top, r.width, r.height]; }
    const wk = ec(prog(t, 0.25, 1.65));
    hookIn.style.clipPath = `inset(-20% ${100 - wk * 100}% -20% 0)`;
    pen.style.left = hookBox[0] + hookBox[2] * wk - 8 + "px";
    pen.style.top = hookBox[1] + hookBox[3] * 0.62 + "px";
    pen.style.opacity = bump(t, 0.2, 1.85);
    const ex = ec(prog(t, 4.0, 4.5));
    hook.style.opacity = 1 - ex;
    hook.style.transform = `translateY(${-ex * 70}px)`;
    hook.style.filter = ex > 0 ? `blur(${ex * 8}px)` : "none";
    ran.draw(t, 1.75, 0.13, 4.02);
    slam.draw(t, 2.3, 0.032, 4.05);
    clipRect.setAttribute("width", W * ec(prog(t, 0.4, 3.2)));
    // hand-off: the taxiway line rises to become the spine of S2
    const up = ec(prog(t, 4.0, 4.8));
    line.setAttribute("transform", `translate(0 ${-up * 820})`);
    line.style.opacity = 1;
  };
}

// ================================================================== S2 THE IDEA 4.0-10.0
function S2(root) {
  const rows = [
    ["Flights", "PROCESSES"],
    ["Ground crews", "THREADS"],
    ["Gates · fuel trucks · tugs", "SHARED RESOURCES"],
    ["Baggage cart", "DISK HEAD"],
  ];
  const svg = svgLayer(root);
  const spine = sv("line", { x1: -20, y1: 220, x2: W + 20, y2: 220, stroke: "#f0b43c", "stroke-width": 6, "stroke-dasharray": "46 26",
                             style: "filter: drop-shadow(0 0 10px rgba(240,180,60,.7))" }, svg);
  const items = rows.map(([small, big], i) => {
    const y = 300 + i * 232;
    const s = new Words(root, small + "  →", { y, size: 40, weight: 600, color: "var(--text-2)" });
    s.roots.forEach((r) => (r.style.color = "var(--text-2)"));
    const b = new Slam(root, [{ text: big }], { x: M, w: W - 2 * M, y: y + 54, align: "left", size: 82, stretch: 100 });
    return { s, b, y };
  });
  const micro = el("div", "micro", root, { left: M + "px", top: 300 + 54 + 88 + "px", fontSize: "22px", color: "var(--text-2)" },
                   "simulated processes · each on a real POSIX thread");
  return (t) => {
    const k = ec(prog(t, 4.0, 4.6));
    spine.style.opacity = 1 - prog(t, 9.0, 9.6);
    spine.setAttribute("transform", `translate(${-k * 0} 0)`);
    items.forEach((it, i) => {
      const a = 4.45 + i * 1.15;
      it.s.draw(t, a, 0.07, 9.25, 0.4);
      it.s.roots.forEach((r) => r.querySelectorAll(".w").forEach((w) => (w.style.color = "var(--text-2)")));
      it.b.draw(t, a + 0.25, 0.022);
      // collapse: the big words fly to the centre and merge into a point of light
      const c = ei(prog(t, 9.2, 9.75));
      const dx = W / 2 - (M + 300), dy = 675 - (it.y + 90);
      it.b.root.style.transform = `translate(${dx * c}px, ${dy * c}px) scale(${1 - c * 0.92})`;
      it.b.root.style.opacity = 1 - prog(t, 9.55, 9.8);
      if (c > 0) it.b.chars.forEach((ch) => { ch.style.color = "var(--amber)"; ch.style.textShadow = `0 0 ${30 + 60 * c}px rgba(240,180,60,.8)`; });
    });
    micro.style.opacity = prog(t, 4.9, 5.4) * (1 - prog(t, 9.2, 9.5));
  };
}

// ================================================================== S3 TITLE 9.5-13.3
function S3(root) {
  const flash = el("div", "abs", root, { left: 0, top: 0, width: W + "px", height: H + "px",
                                          background: "radial-gradient(circle at 50% 50%, rgba(255,236,190,1) 0%, rgba(240,180,60,.55) 12%, rgba(240,180,60,0) 45%)" });
  const title = new Slam(root, [{ text: "TARMACOS", amber: [6, 7] }], { y: 480, size: 138 });
  const sub = new Words(root, "Airport ground control, run by\na real C++ engine on Linux.", { x: 0, w: W, y: 680, align: "center", size: 46, weight: 600 });
  const micro = el("div", "micro", root, { left: 0, width: W + "px", textAlign: "center", top: "860px", fontSize: "22px", color: "var(--text-2)" },
                   "C++17  ·  POSIX threads  ·  fork & pipes  ·  no frameworks");
  return (t) => {
    const f = bump(t, 9.55, 10.35);
    flash.style.opacity = f;
    flash.style.transform = `scale(${0.4 + prog(t, 9.55, 10.35) * 1.4})`;
    title.draw(t, 9.85, 0.045, Infinity);
    sub.draw(t, 10.7, 0.09, Infinity);
    micro.style.opacity = prog(t, 11.4, 11.9);
    const ex = ec(prog(t, 12.65, 13.3));
    root.style.opacity = 1 - ex;
    root.style.transform = `scale(${1 - ex * 0.15})`;
  };
}

// ================================================================== S4 PRODUCT REVEAL 12.6-20.0
function S4(root) {
  const ticks = [];
  for (let i = 8; i <= 14; i++) ticks.push("busy_t" + String(i).padStart(2, "0"));
  const wrap = el("div", "abs", root, { left: 0, top: 0, width: W + "px", height: H + "px", perspective: "1800px" });
  const shot = new Shot(wrap, ticks);
  const cap = new Words(root, "Five flights. Three gates.\nOne fuel truck. One tug.", { y: 150, size: 56 });
  const now = new Shot(root, ticks, { fadeRight: true });
  const NOW = [236, 862, 996, 900];
  const cap2 = new Words(root, "Every value comes from the engine.", { y: 1150, size: 46, weight: 600 });
  const label = el("div", "micro", root, { left: M + "px", top: "1262px" }, "Real dashboard capture · busy apron scenario");
  const amber = el("div", "abs", root, { background: "var(--amber)", borderRadius: "8px" });
  const FULL = [0, 0, 1920, 1080];
  const MAP = [236, 159, 1000, 600];          // queue + gates G1-G3 + vehicles + belt (left part of the apron map)
  const CHIP = [382, 200, 545, 238];          // the SG404 chip in the queue (BLOCKED from t13)
  return (t) => {
    // rise in as a tilted plane, settle flat
    const r = ec(prog(t, 12.6, 13.9));
    const push = ec(prog(t, 14.4, 15.8));
    const fullBox = [M, 380, W - 2 * M, (W - 2 * M) * 1080 / 1920];
    const mapH = (W - 2 * M) * (MAP[3] - MAP[1]) / (MAP[2] - MAP[0]);
    const mapBox = [M, 360, W - 2 * M, mapH];
    let box = lerpRect(fullBox, mapBox, push), rect = lerpRect(FULL, MAP, push);
    // final push into the blocked chip, then amber takes the frame
    const z = ei(prog(t, 19.0, 19.75));
    const chipBox = [W / 2 - 240, 675 - 60, 480, 112];
    box = lerpRect(box, chipBox, z * 0);       // the card stays; the crop rect zooms
    rect = lerpRect(rect, CHIP, z);
    const idx = clamp((t - 15.9) / 0.5, 0, ticks.length - 1);
    shot.set(box, rect, idx, `translateY(${(1 - r) * 420}px) rotateX(${(1 - r) * 16}deg)`);
    shot.root.style.opacity = r;
    const nk = eo(prog(t, 16.0, 16.6));
    now.set([M, 360 + mapH + 34 + (1 - nk) * 30, W - 2 * M, (W - 2 * M) * (NOW[3] - NOW[1]) / (NOW[2] - NOW[0])], NOW, idx);
    now.root.style.opacity = nk * (1 - prog(t, 19.0, 19.3));
    cap.draw(t, 15.0, 0.12, 19.0);
    cap2.draw(t, 18.0, 0.1, 19.0);
    label.style.opacity = prog(t, 13.6, 14.2) * (1 - prog(t, 18.9, 19.2));
    const a = ei(prog(t, 19.35, 19.85));
    Object.assign(amber.style, { left: mix(W / 2 - 160, 0, a) + "px", top: mix(675 - 30, 0, a) + "px", width: mix(320, W, a) + "px",
                                 height: mix(60, H, a) + "px", opacity: prog(t, 19.3, 19.45), borderRadius: (1 - a) * 8 + "px" });
  };
}

// ================================================================== S5 SPIKE 19.6-21.7
function S5(root) {
  const field = el("div", "abs", root, { left: 0, top: 0, width: W + "px", height: H + "px", background: "var(--amber)" });
  const words = [["UNTIL", 230, 19.85], ["IT", 300, 20.3], ["DEADLOCKS.", 108, 20.8]].map(([w, size, a]) => {
    const e = el("div", "slam", root, { left: 0, width: W + "px", textAlign: "center", top: 675 - size * 0.45 + "px", fontSize: size + "px",
                                         color: "#0a111e", fontStretch: "112%" }, w);
    return { e, a };
  });
  const dot = el("div", "abs", root, { width: "30px", height: "30px", borderRadius: "50%", background: "var(--red)",
                                        boxShadow: "0 0 30px 10px rgba(239,100,97,.6)" });
  return (t) => {
    const drain = ec(prog(t, 21.25, 21.7));
    field.style.clipPath = `circle(${(1 - drain) * 1300}px at 990px 700px)`;
    words.forEach((w, i) => {
      const next = i < words.length - 1 ? words[i + 1].a : 99;
      const k = eo(prog(t, w.a, w.a + 0.28)), o = ei(prog(t, next - 0.06, next + 0.12));
      w.e.style.opacity = t < w.a ? 0 : (1 - o) * (i === 2 ? 1 - prog(t, 21.2, 21.4) : 1);
      w.e.style.transform = `scale(${mix(1.35, 1, k) * (1 - o * 0.2)}) translateY(${(1 - k) * 40 - o * 30}px)`;
      w.e.style.filter = `blur(${(1 - k) * 16 + o * 16}px)`;
    });
    // the full stop drops out and travels to node A of the graph
    const d = ec(prog(t, 21.2, 21.7));
    dot.style.opacity = prog(t, 21.15, 21.25) * (1 - prog(t, 21.65, 21.8));
    dot.style.left = mix(990, 540 - 15, d) + "px";
    dot.style.top = mix(700, 420 - 15, d) + "px";
  };
}

// ================================================================== S6 DEADLOCK 21.5-31.2
const NODES = {
  A: { x: 540, y: 420, kind: "f", label: "A" }, FT1: { x: 815, y: 580, kind: "r", label: "FT1", sub: "Truck" },
  B: { x: 815, y: 900, kind: "f", label: "B" }, TG1: { x: 540, y: 1060, kind: "r", label: "TG1", sub: "Tug" },
  C: { x: 265, y: 900, kind: "f", label: "C" }, G3: { x: 265, y: 580, kind: "r", label: "G3", sub: "Gate" },
};
// holds: resource -> flight (solid); wants: flight -> resource (dashed). Order = the cycle A -> FT1 -> B -> TG1 -> C -> G3 -> A.
const EDGES = [
  { from: "G3", to: "A", hold: true, at: 22.9 }, { from: "A", to: "FT1", hold: false, at: 23.45, tick: "t6" },
  { from: "FT1", to: "B", hold: true, at: 24.7 }, { from: "B", to: "TG1", hold: false, at: 25.25, tick: "t7" },
  { from: "TG1", to: "C", hold: true, at: 26.5 }, { from: "C", to: "G3", hold: false, at: 27.05, tick: "t8" },
];
const PEAK = 27.85;
function S6(root) {
  const wrap = el("div", "abs", root, { left: 0, top: 0, width: W + "px", height: H + "px", transformOrigin: "540px 740px" });
  const svg = svgLayer(wrap);
  const ring = sv("circle", { cx: 540, cy: 740, r: 10, fill: "none", stroke: "#ef6461", "stroke-width": 4 }, svg);
  const edgeG = sv("g", {}, svg);
  const edges = EDGES.map((e) => {
    const a = NODES[e.from], b = NODES[e.to];
    const ra = a.kind === "f" ? 66 : 56, rb = b.kind === "f" ? 72 : 62;
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len;
    const p1 = [a.x + ux * ra, a.y + uy * ra], p2 = [b.x - ux * rb, b.y - uy * rb];
    const line = sv("line", { x1: p1[0], y1: p1[1], x2: p1[0], y2: p1[1], "stroke-width": 6, "stroke-linecap": "round",
                              "stroke-dasharray": e.hold ? "none" : "16 14" }, edgeG);
    const head = sv("polygon", { points: "0,0 -24,-12 -24,12" }, edgeG);
    head.setAttribute("transform", `translate(${p2[0]} ${p2[1]}) rotate(${Math.atan2(uy, ux) * 180 / Math.PI})`);
    let lbl = null;
    if (e.tick) {
      const mx = (p1[0] + p2[0]) / 2 - uy * 40, my = (p1[1] + p2[1]) / 2 + ux * 40;
      lbl = sv("text", { x: mx, y: my + 10, "text-anchor": "middle", "font-family": "JetBrains Mono", "font-size": 28, "font-weight": 600 }, svg);
      lbl.textContent = e.tick;
    }
    return { e, line, head, lbl, p1, p2 };
  });
  const nodeEls = {};
  for (const [id, n] of Object.entries(NODES)) {
    const g = sv("g", {}, svg);
    const shape = n.kind === "f"
      ? sv("circle", { cx: n.x, cy: n.y, r: 64, "stroke-width": 5 }, g)
      : sv("rect", { x: n.x - 70, y: n.y - 46, width: 140, height: 92, rx: 10, "stroke-width": 5 }, g);
    const tx = sv("text", { x: n.x, y: n.y + (n.kind === "f" ? 6 : -2), "text-anchor": "middle", "font-family": "Archivo",
                            "font-weight": 900, "font-size": n.kind === "f" ? 54 : 34, fill: "#e4e8f0" }, g);
    tx.textContent = n.label;
    const st = sv("text", { x: n.x, y: n.y + (n.kind === "f" ? 36 : 30), "text-anchor": "middle", "font-family": "JetBrains Mono",
                            "font-size": n.kind === "f" ? 17 : 20, fill: "#b4bdcf", "letter-spacing": "1" }, g);
    st.textContent = n.kind === "f" ? "" : n.sub;
    nodeEls[id] = { g, shape, tx, st, n };
  }
  const cap = [
    new Words(root, "A holds Gate 3. Wants the fuel truck.", { y: 150, size: 50 }),
    new Words(root, "B holds the truck. Wants the tug.", { y: 150, size: 50 }),
    new Words(root, "C holds the tug. Wants Gate 3.", { y: 150, size: 50 }),
  ];
  const peak = new Slam(root, [{ text: "CIRCULAR WAIT.", color: "#ef6461" }], { x: M, w: W - 2 * M, y: 140, align: "left", size: 104 });
  const micro = el("div", "micro", root, { left: M + "px", top: "1262px" }, "Engine scenario · deadlock A/B/C · policy DETECTION");
  // real evidence: the engine's own report (banner + graph), DETECTION at t8
  const real = new Shot(root, ["det_t09"]);
  const realCap = new Words(root, "Detected at *t8.*", { y: 150, size: 64 });
  const realLbl = el("div", "micro", root, { left: M + "px", top: "1262px" }, "Real dashboard capture · Deadlocks tab");
  const RREAL = [236, 354, 901, 844];
  HUD.s6 = { real, RREAL };
  return (t) => {
    // camera: slow push, then a jolt at the peak
    const push = mix(1, 1.05, ec(prog(t, 22.0, PEAK))) + bump(t, PEAK, PEAK + 0.35) * 0.025;
    const shake = Math.sin(t * 90) * 4 * bump(t, PEAK, PEAK + 0.3);
    wrap.style.transform = `translate(${shake}px, 0) scale(${push})`;
    const toReal = ec(prog(t, 29.3, 29.9));
    wrap.style.opacity = prog(t, 21.55, 21.9) * (1 - toReal);
    const red = (i) => prog(t, PEAK + i * 0.07, PEAK + i * 0.07 + 0.25);         // red sweeps around the cycle
    edges.forEach((ed, i) => {
      const k = ec(prog(t, ed.e.at, ed.e.at + (i === 5 ? 0.7 : 0.45)));
      ed.line.setAttribute("x2", mix(ed.p1[0], ed.p2[0], k));
      ed.line.setAttribute("y2", mix(ed.p1[1], ed.p2[1], k));
      const r = red(i);
      const base = ed.e.hold ? "#f0b43c" : "#7d8aa3";
      const col = r > 0.5 ? "#ef6461" : base;
      ed.line.setAttribute("stroke", col);
      ed.head.setAttribute("fill", col);
      ed.head.style.opacity = prog(t, ed.e.at + 0.3, ed.e.at + 0.45);
      if (ed.lbl) { ed.lbl.setAttribute("fill", r > 0.5 ? "#ef6461" : "#f0b43c"); ed.lbl.style.opacity = prog(t, ed.e.at + 0.35, ed.e.at + 0.6); }
    });
    const order = ["A", "FT1", "B", "TG1", "C", "G3"];
    order.forEach((id, i) => {
      const ne = nodeEls[id], n = ne.n;
      const appear = eo(prog(t, 21.7 + i * 0.08, 22.3 + i * 0.08));
      ne.g.style.opacity = appear;
      ne.g.style.transformOrigin = `${n.x}px ${n.y}px`;
      ne.g.style.transform = `scale(${0.7 + appear * 0.3 + bump(t, PEAK + i * 0.07, PEAK + i * 0.07 + 0.4) * 0.12})`;
      const r = red(i) > 0.5;
      // flights block when their request is refused: A at t6, B at t7, C at t8 (engine event log)
      const blockAt = { A: 23.85, B: 25.65, C: PEAK }[id];
      const blocked = n.kind === "f" && t >= blockAt;
      if (n.kind === "f") {
        ne.shape.setAttribute("fill", r ? "rgba(239,100,97,.22)" : blocked ? "rgba(240,180,60,.12)" : "rgba(75,163,227,.14)");
        ne.shape.setAttribute("stroke", r ? "#ef6461" : blocked ? "#f0b43c" : "#4ba3e3");
        ne.st.textContent = blocked ? "BLOCKED" : "";
        ne.st.setAttribute("fill", r ? "#ef6461" : "#f0b43c");
      } else {
        ne.shape.setAttribute("fill", r ? "rgba(239,100,97,.18)" : "rgba(240,180,60,.10)");
        ne.shape.setAttribute("stroke", r ? "#ef6461" : "#f0b43c");
      }
    });
    edgeG.style.filter = t > PEAK ? `drop-shadow(0 0 ${8 + 14 * bump(t, PEAK, PEAK + 1.6)}px rgba(239,100,97,.9))` : "none";
    const rk = prog(t, PEAK, PEAK + 1.1);
    ring.setAttribute("r", 40 + eo(rk) * 620);
    ring.style.opacity = rk > 0 ? (1 - rk) * 0.8 : 0;
    cap[0].draw(t, 22.4, 0.1, 24.05);
    cap[1].draw(t, 24.25, 0.1, 25.85);
    cap[2].draw(t, 26.05, 0.1, PEAK - 0.2);
    peak.draw(t, PEAK, 0.03, 29.25);
    micro.style.opacity = prog(t, 22.0, 22.5) * (1 - toReal);
    // match-dissolve to the real Deadlocks tab
    const box = [M, 330, W - 2 * M, (W - 2 * M) * (RREAL[3] - RREAL[1]) / (RREAL[2] - RREAL[0])];
    const out = ec(prog(t, 30.65, 31.25));
    real.set(box, RREAL, 0, `scale(${mix(1.08, 1, toReal)})`);
    real.root.style.opacity = toReal * (1 - out);
    realCap.draw(t, 29.6, 0.1, 30.6);
    realLbl.style.opacity = toReal * (1 - out);
  };
}

// ================================================================== S7 TWO WAYS OUT 30.6-38.4
function S7(root) {
  const BANNER = [236, 354, 900, 415];
  const bh = (W - 2 * M) * (BANNER[3] - BANNER[1]) / (BANNER[2] - BANNER[0]);
  const k1 = el("div", "kicker", root, { left: M + "px", top: "128px" }, "Recovery");
  const c1 = new Words(root, "Roll back C. *Everyone* *finishes.*", { y: 166, size: 50 });
  const rec = new Shot(root, ["det_t09", "rec_t09"], { fadeRight: true });
  // turnaround bars: values read from the engine's event log (TAT 13 / 18 / 21 ticks)
  const svg = svgLayer(root);
  const bars = [["B", 13], ["A", 18], ["C", 21]].map(([f, v], i) => {
    const y = 420 + i * 62;
    const lab = sv("text", { x: M, y: y + 30, "font-family": "Archivo", "font-weight": 900, "font-size": 36, fill: "#e4e8f0" }, svg);
    lab.textContent = f;
    const bar = sv("rect", { x: M + 50, y, width: 0, height: 40, rx: 6, fill: "#f0b43c" }, svg);
    const val = sv("text", { x: M + 60, y: y + 31, "font-family": "JetBrains Mono", "font-weight": 700, "font-size": 30, fill: "#0a111e" }, svg);
    val.textContent = v;
    return { bar, val, lab, v, i };
  });
  const tatLbl = el("div", "micro", root, { left: M + "px", top: "612px" }, "Turnaround, ticks · from the engine's event log");
  const divider = el("div", "abs", root, { left: M + "px", top: "668px", height: "2px", width: W - 2 * M + "px", background: "var(--line-2)" });
  const k2 = el("div", "kicker", root, { left: M + "px", top: "706px" }, "Avoidance");
  const c2 = new Words(root, "Banker's algorithm says *not* *yet.*", { y: 744, size: 50 });
  const av = new Shot(root, ["avoid_t03"], { fadeRight: true });
  const BANK = [925, 700, 1440, 766];
  const bkh = (W - 2 * M) * (BANK[3] - BANK[1]) / (BANK[2] - BANK[0]);
  const bank = new Shot(root, ["avoid_t03"]);
  const c3 = new Words(root, "No cycle ever forms.", { y: 1130, size: 50 });
  const lbl = el("div", "micro", root, { left: M + "px", top: "1262px" }, "Real dashboard captures · Deadlocks tab");
  return (t) => {
    // the S6 capture slides up so its banner lands here, then turns from red to green
    const slide = ec(prog(t, 30.65, 31.3));
    const s6 = HUD.s6;
    const fromBox = [M, 330, W - 2 * M, bh];
    const toBox = [M, 250, W - 2 * M, bh];
    rec.set(lerpRect(fromBox, toBox, slide), BANNER, ec(prog(t, 31.35, 31.8)));
    rec.root.style.opacity = prog(t, 30.65, 30.9);
    const g = bump(t, 31.35, 31.9);
    rec.root.style.boxShadow = `0 40px 90px rgba(0,0,0,.6), 0 0 0 ${1 + g * 3}px rgba(63,201,140,${0.2 + g * 0.6}), 0 0 ${g * 60}px rgba(63,201,140,${g * 0.5})`;
    k1.style.opacity = prog(t, 31.0, 31.4);
    c1.draw(t, 31.5, 0.12, 38.0);
    bars.forEach((b) => {
      const k = eo(prog(t, 32.5 + b.i * 0.25, 33.4 + b.i * 0.25));
      const full = (W - 2 * M - 60) * b.v / 21;
      b.bar.setAttribute("width", full * k);
      b.val.setAttribute("x", M + 50 + full * k - 52);
      b.val.style.opacity = prog(t, 33.0 + b.i * 0.25, 33.3 + b.i * 0.25);
      b.lab.style.opacity = prog(t, 32.4 + b.i * 0.25, 32.7 + b.i * 0.25);
    });
    tatLbl.style.opacity = prog(t, 33.2, 33.6);
    divider.style.transform = `scaleX(${ec(prog(t, 33.6, 34.2))})`;
    divider.style.transformOrigin = "0 0";
    k2.style.opacity = prog(t, 34.0, 34.4);
    c2.draw(t, 34.3, 0.12, 38.0);
    const ak = eo(prog(t, 34.8, 35.5));
    av.set([M, 832 + (1 - ak) * 40, W - 2 * M, bh], BANNER);
    av.root.style.opacity = ak;
    const bk = eo(prog(t, 35.4, 36.1));
    bank.set([M, 950 + (1 - bk) * 40, W - 2 * M, bkh], BANK);
    bank.root.style.opacity = bk;
    c3.draw(t, 36.4, 0.12, 38.0);
    lbl.style.opacity = prog(t, 31.0, 31.5);
    const ex = ec(prog(t, 37.9, 38.45));
    root.style.opacity = 1 - ex;
    root.style.filter = ex > 0 ? `blur(${ex * 6}px)` : "none";
  };
}

// ================================================================== S8 SCHEDULING 37.9-43.4
function S8(root) {
  const cap = new Words(root, "Round Robin, quantum 4.", { y: 140, size: 56 });
  const GANTT = [236, 139, 1246, 454];
  const gh = (W - 2 * M) * (GANTT[3] - GANTT[1]) / (GANTT[2] - GANTT[0]);
  const gantt = new Shot(root, ["rr_end"]);
  const METRICS = [1100, 505, 1345, 712];
  const MW = 400, mh = MW * (METRICS[3] - METRICS[1]) / (METRICS[2] - METRICS[0]);
  const metrics = new Shot(root, ["rr_end"]);
  const nums = [["13.50", "avg turnaround", 588], ["8.75", "avg waiting", 768]].map(([v, l, y]) => {
    const x = M + MW + 56;
    const n = el("div", "slam", root, { left: x + "px", top: y + "px", fontSize: "128px", color: "var(--amber)", fontStretch: "100%" }, v);
    const lab = el("div", "micro", root, { left: x + 4 + "px", top: y + 124 + "px", fontSize: "24px", color: "var(--text-2)" }, l + " · ticks");
    return { n, lab, v: parseFloat(v), digits: v.split(".")[1].length };
  });
  const cmp = el("div", "micro", root, { left: M + "px", top: "1000px", fontSize: "24px", color: "var(--text-2)", lineHeight: "1.6" },
                 "Same workload:  FCFS 8.00 / 12.75  ·  Priority 4.75 / 9.50");
  const lbl = el("div", "micro", root, { left: M + "px", top: "1262px" }, "Real dashboard capture · Scheduler tab");
  return (t) => {
    const a = prog(t, 38.0, 38.3);
    cap.draw(t, 38.2, 0.12, 42.9);
    const wipe = ec(prog(t, 38.7, 40.2));
    gantt.set([M, 240, W - 2 * M, gh], GANTT);
    gantt.root.style.clipPath = `inset(0 ${100 - wipe * 100}% 0 0 round 14px)`;
    gantt.root.style.opacity = a;
    const mk = eo(prog(t, 40.0, 40.6));
    metrics.set([M, 580 + (1 - mk) * 40, MW, mh], METRICS);
    metrics.root.style.opacity = mk;
    nums.forEach((n, i) => {
      const k = ec(prog(t, 40.6 + i * 0.2, 41.6 + i * 0.2));
      n.n.textContent = (n.v * k).toFixed(n.digits);
      n.n.style.opacity = prog(t, 40.6 + i * 0.2, 40.8 + i * 0.2);
      n.n.style.textShadow = `0 0 ${40 * (1 - prog(t, 41.6, 42.4))}px rgba(240,180,60,.6)`;
      n.lab.style.opacity = prog(t, 41.0 + i * 0.2, 41.3 + i * 0.2);
    });
    cmp.style.opacity = prog(t, 41.7, 42.1);
    lbl.style.opacity = a;
    const ex = ec(prog(t, 42.85, 43.4));
    root.style.opacity = 1 - ex;
    root.style.transform = `translateY(${-ex * 50}px)`;
  };
}

// ================================================================== S9 REAL OS MECHANISMS 42.9-51.2
function S9(root) {
  const cap = new Words(root, "The baggage handler is a\n*real* *child* *process.*", { y: 130, size: 56 });
  // IPC diagram: engine and child, fork() and two pipes - nothing else
  const svg = svgLayer(root);
  const g = sv("g", {}, svg);
  const BX = [M, 640], BY = 430, BW = 368, BH = 150;
  const boxes = [["ENGINE", "PID 9981"], ["BAGGAGE HANDLER", "PID 9983"]].map(([name, pid], i) => {
    const r = sv("rect", { x: BX[i], y: BY, width: BW, height: BH, rx: 14, fill: "#111b2e", stroke: i ? "#f0b43c" : "#4ba3e3", "stroke-width": 4 }, g);
    const n = sv("text", { x: BX[i] + BW / 2, y: BY + 62, "text-anchor": "middle", "font-family": "Inter Tight", "font-weight": 800,
                           "font-size": i ? 31 : 44, fill: "#e4e8f0" }, g);
    n.textContent = name;
    const p = sv("text", { x: BX[i] + BW / 2, y: BY + 112, "text-anchor": "middle", "font-family": "JetBrains Mono", "font-weight": 600,
                           "font-size": 32, fill: i ? "#f0b43c" : "#4ba3e3" }, g);
    p.textContent = pid;
    return { r, n, p };
  });
  const forkPath = sv("path", { d: `M ${BX[0] + BW / 2} ${BY - 8} C ${BX[0] + BW / 2} 330, ${BX[1] + BW / 2} 330, ${BX[1] + BW / 2} ${BY - 14}`,
                                fill: "none", stroke: "#f0b43c", "stroke-width": 5, "stroke-dasharray": "1000", "stroke-dashoffset": "1000" }, g);
  const forkHead = sv("polygon", { points: "0,0 -12,-22 12,-22", fill: "#f0b43c" }, g);
  forkHead.setAttribute("transform", `translate(${BX[1] + BW / 2} ${BY - 6})`);
  const forkLbl = sv("text", { x: W / 2, y: 326, "text-anchor": "middle", "font-family": "JetBrains Mono", "font-weight": 700, "font-size": 40, fill: "#f0b43c" }, g);
  forkLbl.textContent = "fork()";
  const x1 = BX[0] + BW + 6, x2 = BX[1] - 6;
  const pipes = [BY + 48, BY + 102].map((y, i) => {
    const l = sv("line", { x1, y1: y, x2: x1, y2: y, stroke: "#e4e8f0", "stroke-width": 5 }, g);
    return { l, y };
  });
  const pipeLbl = sv("text", { x: (x1 + x2) / 2, y: BY + 82, "text-anchor": "middle", "font-family": "JetBrains Mono", "font-size": 26, fill: "#b4bdcf" }, g);
  pipeLbl.textContent = "2 pipes";
  const msgs = [["SCHED →", 0], ["← ORDER", 1]].map(([txt, i]) => {
    const m = el("div", "abs mono", root, { fontSize: "24px", fontWeight: 700, color: "#0a111e", background: "var(--amber)", padding: "4px 10px",
                                             borderRadius: "6px", whiteSpace: "nowrap" }, txt);
    return m;
  });
  // the real head-movement chart: the route the child process planned (SCAN up from 20)
  const CHART = [236, 139, 1246, 515];
  const ch = (W - 2 * M) * (CHART[3] - CHART[1]) / (CHART[2] - CHART[0]);
  const chart = new Shot(root, ["scan_end"]);
  const ROUTE = [20, 21, 37, 44, 49, 12, 5, 3];
  const route = el("div", "abs mono", root, { left: M + "px", top: "1060px", fontSize: "36px", fontWeight: 700, color: "var(--text)", whiteSpace: "nowrap" });
  const routeSpans = ROUTE.map((p, i) => el("span", null, route, {}, (i ? " → " : "") + p));
  const moved = new Words(root, "*75* positions, one sweep.", { y: 1124, size: 44, weight: 600 });
  // brief glimpse of the real terminal: ps output for the child and the engine's threads
  const TERM = [244, 148, 804, 402];
  const th = (W - 2 * M) * (TERM[3] - TERM[1]) / (TERM[2] - TERM[0]);
  // the child's CMD column shows a personal Windows path: redacted, everything else is the genuine ps output
  const term = new Shot(root, ["term_busy"], { redact: [{ rect: [488, 203, 1100, 222], label: "[path redacted]" }] });
  const tcap = new Words(root, "Real PIDs. Real threads.", { y: 130, size: 56 });
  const lbl = el("div", "micro", root, { left: M + "px", top: "1262px" }, "Diagram + real dashboard captures · Baggage & disk, Ops terminal");
  return (t) => {
    root.style.opacity = prog(t, 42.95, 43.3) * (1 - ec(prog(t, 50.7, 51.2)));
    cap.draw(t, 43.2, 0.12, 48.9);
    const dk = eo(prog(t, 43.6, 44.2));
    const dOut = ec(prog(t, 48.9, 49.4));
    g.style.opacity = dk * (1 - dOut);
    g.style.transform = `translateY(${(1 - dk) * 30 - dOut * 40}px)`;
    boxes.forEach((b, i) => { b.r.style.opacity = prog(t, 43.6 + i * 0.6, 43.9 + i * 0.6); b.n.style.opacity = b.p.style.opacity = b.r.style.opacity; });
    forkPath.setAttribute("stroke-dashoffset", 1000 * (1 - ec(prog(t, 43.9, 44.5))));
    forkHead.style.opacity = forkLbl.style.opacity = prog(t, 44.35, 44.55);
    pipes.forEach((p, i) => p.l.setAttribute("x2", mix(x1, x2, ec(prog(t, 44.7 + i * 0.15, 45.2 + i * 0.15)))));
    pipeLbl.style.opacity = prog(t, 45.1, 45.4);
    msgs.forEach((m, i) => {
      const a = 45.45 + i * 0.9;
      const k = ec(prog(t, a, a + 0.8));
      const y = pipes[i].y - 21;
      const xa = i ? x2 - 140 : x1, xb = i ? x1 : x2 - 140;
      m.style.left = mix(xa, xb, k) + "px";
      m.style.top = y + "px";
      m.style.opacity = bump(t, a - 0.05, a + 0.85) > 0 ? clamp(bump(t, a - 0.05, a + 0.85) * 3) * (1 - dOut) : 0;
    });
    const ck = eo(prog(t, 46.6, 47.2));
    chart.set([M, 690 + (1 - ck) * 40, W - 2 * M, ch], CHART);
    const cOut = ec(prog(t, 49.0, 49.4));
    chart.root.style.opacity = ck * (1 - cOut);
    route.style.opacity = 1 - cOut;
    moved.roots[0].style.visibility = cOut >= 1 ? "hidden" : "inherit";
    routeSpans.forEach((s, i) => { s.style.opacity = prog(t, 47.1 + i * 0.12, 47.3 + i * 0.12); s.style.color = i === 4 ? "var(--muted)" : "var(--text)"; });
    moved.draw(t, 48.2, 0.1);
    const tk = eo(prog(t, 49.2, 49.8));
    term.set([M, 300 + (1 - tk) * 40, W - 2 * M, th], TERM);
    term.root.style.opacity = tk;
    tcap.draw(t, 49.3, 0.12);
    lbl.style.opacity = prog(t, 43.5, 44);
  };
}

// ================================================================== S10 END CARD 50.8-56.0
function S10(root) {
  const svg = svgLayer(root);
  const arc = sv("path", { d: "M 120 640 Q 540 260 960 640", fill: "none", stroke: "#f0b43c", "stroke-width": 3, "stroke-dasharray": "1200",
                           "stroke-dashoffset": "1200", style: "filter: drop-shadow(0 0 8px rgba(240,180,60,.8))" }, svg);
  const title = new Slam(root, [{ text: "TARMACOS", amber: [6, 7] }], { y: 530, size: 138 });
  const tag = new Words(root, "An airport, run like an operating system.", { x: 0, w: W, y: 720, align: "center", size: 42, weight: 600 });
  const url = el("div", "abs mono", root, { left: 0, width: W + "px", textAlign: "center", top: "850px", fontSize: "50px", fontWeight: 700,
                                             color: "var(--amber)" }, "tarmacos-kohl.vercel.app");
  const ul = el("div", "abs", root, { left: "250px", width: "580px", top: "925px", height: "4px", background: "var(--amber)",
                                       transformOrigin: "0 0", boxShadow: "0 0 14px rgba(240,180,60,.8)" });
  const names = el("div", "abs", root, { left: 0, width: W + "px", textAlign: "center", top: "1180px", fontFamily: "var(--inter)",
                                          fontSize: "34px", fontWeight: 500, color: "var(--text-2)" }, "Zimran Ullah  ·  Aadit Bhutani  ·  Tanush Adarsh");
  return (t) => {
    root.style.opacity = prog(t, 50.8, 51.1);
    arc.setAttribute("stroke-dashoffset", 1200 * (1 - ec(prog(t, 50.9, 52.0))));
    arc.style.opacity = 0.55;
    const bloom = 1.6 * (1 - ec(prog(t, 51.5, 52.8)));
    title.draw(t, 51.05, 0.04, Infinity, bloom);
    tag.draw(t, 52.0, 0.08);
    const u = eo(prog(t, 52.5, 53.1));
    url.style.opacity = u;
    url.style.transform = `translateY(${(1 - u) * 20}px)`;
    ul.style.transform = `scaleX(${ec(prog(t, 52.9, 53.7))})`;
    names.style.opacity = prog(t, 53.4, 54.0) * 0.9;
  };
}

// ------------------------------------------------------------------ timeline
scene(0.0, 4.9, S1);
scene(4.0, 10.0, S2);
scene(9.5, 13.35, S3);
scene(12.6, 20.0, S4);
scene(19.3, 21.85, S5);
scene(21.5, 31.3, S6);
scene(30.6, 38.5, S7);
scene(37.9, 43.45, S8);
scene(42.9, 51.25, S9);
scene(50.8, DURATION + 1, S10);

const grid = document.getElementById("grid");
const fade = document.getElementById("fade");
window.render = function (t) {
  for (const s of SCENES) {
    const on = t >= s.a && t < s.b;
    show(s.root, on);
    if (on) s.draw(t);
  }
  grid.style.transform = `translate(${-t * 3}px, ${-t * 1.5}px)`;
  grid.style.opacity = 1 - bump(t, 19.4, 21.7) * 0.9;
  fade.style.opacity = 1 - prog(t, 0, 0.6) + prog(t, DURATION - 0.4, DURATION);
  return t;
};

window.READY = (async () => {
  await document.fonts.load('900 100px "Archivo"');
  await document.fonts.load('700 50px "Inter Tight"');
  await document.fonts.load('600 50px "Inter Tight"');
  await document.fonts.load('200 50px "Inter"');
  await document.fonts.load('700 30px "JetBrains Mono"');
  await document.fonts.ready;
  await Promise.all([...document.images].map((i) => i.decode().catch(() => null)));
  window.render(0);
  return true;
})();
