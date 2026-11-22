/* film.js - TarmacOS promo film (1080x1350, 59.4 s).
   Deterministic: window.render(t) sets every element from t alone, so any frame can be rendered in any order.
   Every scene works in local time u = t - base; the bases are in BASE below (the soundtrack cues in
   scripts/soundtrack.py are derived from the same numbers).
   Real dashboard footage comes from ../assets/captures (DPR 2 screenshots of the running app, never edited);
   crop rectangles are CSS pixels of the 1920x1080 dashboard. Every quoted value is in _capture_log.json. */
"use strict";

const BASE = { S1: 0, S2: 4.0, S3: 10.0, S4: 12.9, S5: 20.35, S6: 22.25, S7: 33.3, S7b: 36.5, S8: 40.7, S9: 45.8, S9b: 52.2, S10: 54.4 };
const DURATION = 59.4;
const PEAK_LOCAL = 6.35;                               // the cycle turns red at BASE.S6 + 6.35 = 28.6 s
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
const micro = (parent, text, top = 1262) => el("div", "micro", parent, { left: M + "px", top: top + "px" }, text);

// ------------------------------------------------------------------ kinetic type
/* Words: a caption revealed word by word. The newest word lands amber and cools to white;
   *word* stays amber. "\n" forces a line break. Exit = rise + blur with two ghost echoes. */
class Words {
  constructor(parent, text, o) {
    this.o = Object.assign({ x: M, y: 0, w: W - 2 * M, size: 52, weight: 700, family: "var(--tight)", align: "left", lh: 1.08,
                             track: "-0.02em", base: null }, o);
    const st = { left: this.o.x + "px", top: this.o.y + "px", width: this.o.w + "px", fontSize: this.o.size + "px",
                 fontWeight: this.o.weight, fontFamily: this.o.family, textAlign: this.o.align, lineHeight: this.o.lh,
                 letterSpacing: this.o.track };
    this.roots = [0, 1, 2].map(() => el("div", "words", parent, { ...st }));
    this.words = this.roots.map(() => []);
    const tokens = text.split(/( |\n)/).filter((s) => s !== "" && s !== " ");
    this.roots.forEach((root, r) => {
      tokens.forEach((tok) => {
        if (tok === "\n") { el("br", null, root); return; }
        const span = el("span", "w", root, {}, tok.replace(/\*/g, "") + " ");
        span.accent = /^\*.*\*[.,:?!]*$/.test(tok);
        this.words[r].push(span);
      });
    });
  }
  draw(t, start, per = 0.11, end = Infinity, dur = 0.45) {
    const n = this.words[0].length;
    const ex = ec(prog(t, end, end + dur));
    this.roots.forEach((root, r) => {
      const e = r === 0 ? ex : ec(prog(t, end + r * 0.06, end + dur + r * 0.06));
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
        w.style.color = this.o.base ? this.o.base : w.accent ? "var(--amber)" : amberMix(1 - prog(t, a + 0.35, a + 1.0));
      }
    });
  }
}

/* Slam: big display lines built letter by letter (blur-in), landing amber then cooling to white,
   unless the line is marked amber. glowBoost adds an extra bloom (used on the end card). */
class Slam {
  constructor(parent, lines, o) {
    this.o = Object.assign({ x: 0, y: 0, w: W, align: "center", size: 140, stretch: 112, gap: 0.92 }, o);
    this.root = el("div", "slam", parent, { left: this.o.x + "px", top: this.o.y + "px", width: this.o.w + "px",
                                             textAlign: this.o.align, fontSize: this.o.size + "px", fontStretch: this.o.stretch + "%",
                                             lineHeight: this.o.gap });
    this.chars = [];
    lines.forEach((ln) => {
      const line = el("span", "ln", this.root, ln.size ? { fontSize: ln.size + "px" } : {});
      [...ln.text].forEach((c, ci) => {
        const ch = el("span", "ch", line, {}, c === " " ? " " : c);
        ch.amber = ln.amber === true || (Array.isArray(ln.amber) && ln.amber.includes(ci));
        ch.final = ln.color || null;
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
      const glow = ch.final === "#ef6461" ? "239,100,97" : "240,180,60";
      ch.style.textShadow = g > 0.01 ? `0 0 ${18 + 50 * g}px rgba(${glow},${0.55 * clamp(g)})` : "none";
    });
  }
}

// ------------------------------------------------------------------ real footage
/* Shot: a borderless card showing a crop of one or more real captures (crossfaded by index).
   marks: drawn on top of the capture, positioned in dashboard CSS px (the capture files are never edited):
     {kind: "redact", rect, label}  covers personal data
     {kind: "ring", rect}           amber highlight; its opacity is set by the scene via shot.marks[i].e */
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
    this.marks = (o.marks || []).map((m) => {
      const e = m.kind === "redact"
        ? el("div", "abs mono", this.root, { background: "#0b1322", border: "1px dashed rgba(240,180,60,.55)", borderRadius: "4px",
                                             color: "var(--amber)", display: "flex", alignItems: "center", paddingLeft: "10px",
                                             boxSizing: "border-box", whiteSpace: "nowrap", overflow: "hidden" }, m.label)
        : el("div", "abs", this.root, { border: "4px solid var(--amber)", borderRadius: "10px", boxSizing: "border-box",
                                        boxShadow: "0 0 24px rgba(240,180,60,.75), inset 0 0 14px rgba(240,180,60,.35)", opacity: 0 });
      return { e, rect: m.rect, kind: m.kind, pad: m.pad || 0 };
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
    this.marks.forEach(({ e, rect: [mx0, my0, mx1, my1], kind, pad }) => {
      Object.assign(e.style, { left: bw / 2 + (mx0 - cx) * s - pad + "px", top: bh / 2 + (my0 - cy) * s - pad + "px",
                               width: (mx1 - mx0) * s + 2 * pad + "px", height: (my1 - my0) * s + 2 * pad + "px" });
      if (kind === "redact") e.style.fontSize = (my1 - my0) * s * 0.62 + "px";
    });
  }
}
const boxFor = (rect, y, w = W - 2 * M, x = M) => [x, y, w, w * (rect[3] - rect[1]) / (rect[2] - rect[0])];

// ------------------------------------------------------------------ scene registry
const SCENES = [];
/* a scene is active for local time [a, b) relative to its base */
function scene(name, a, b, build) {
  const root = el("div", "scene", document.getElementById("scenes"));
  root.dataset.scene = name;
  const base = BASE[name];
  const draw = build(root);
  SCENES.push({ a: base + a, b: base + b, root, draw: (t) => draw(t - base, t) });
}
const SHARED = {};

// ================================================================== S1 HOOK
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
  return (u) => {
    if (!hookBox) { const r = hookIn.getBoundingClientRect(); hookBox = [r.left, r.top, r.width, r.height]; }
    const wk = ec(prog(u, 0.25, 1.65));
    hookIn.style.clipPath = `inset(-20% ${100 - wk * 100}% -20% 0)`;
    pen.style.left = hookBox[0] + hookBox[2] * wk - 8 + "px";
    pen.style.top = hookBox[1] + hookBox[3] * 0.62 + "px";
    pen.style.opacity = bump(u, 0.2, 1.85);
    const ex = ec(prog(u, 4.0, 4.5));
    hook.style.opacity = 1 - ex;
    hook.style.transform = `translateY(${-ex * 70}px)`;
    hook.style.filter = ex > 0 ? `blur(${ex * 8}px)` : "none";
    ran.draw(u, 1.75, 0.13, 4.02);
    slam.draw(u, 2.3, 0.032, 4.05);
    clipRect.setAttribute("width", W * ec(prog(u, 0.4, 3.2)));
    // hand-off: the taxiway line rises to become the spine of S2
    line.setAttribute("transform", `translate(0 ${-ec(prog(u, 4.0, 4.8)) * 820})`);
  };
}

// ================================================================== S2 THE IDEA (one mapping at a time)
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
  const AT = (i) => 0.45 + i * 1.35;                   // each mapping gets its own 1.35 s moment
  const items = rows.map(([small, big], i) => {
    const y = 300 + i * 232;
    const g = el("div", "abs", root, { left: 0, top: 0, width: W + "px", height: H + "px" });
    const s = new Words(g, small, { y, size: 40, weight: 600, base: "var(--text-2)" });
    const arrow = el("div", "abs", g, { left: M + "px", top: y + 22 + "px", height: "4px", background: "var(--amber)", transformOrigin: "0 50%",
                                        boxShadow: "0 0 10px rgba(240,180,60,.7)" });
    const head = el("div", "abs", g, { top: y + 14 + "px", width: 0, height: 0, borderTop: "10px solid transparent",
                                       borderBottom: "10px solid transparent", borderLeft: "16px solid var(--amber)" });
    const b = new Slam(g, [{ text: big }], { x: M, w: W - 2 * M, y: y + 54, align: "left", size: 82, stretch: 100 });
    return { g, s, arrow, head, b, y, small };
  });
  const sub = el("div", "micro", items[0].g, { left: M + "px", top: 300 + 54 + 88 + "px", fontSize: "22px" },
                 "simulated processes · each on a real POSIX thread");
  let widths = null;
  return (u) => {
    if (!widths) widths = items.map((it) => measure(it.s.roots[0]));
    spine.style.opacity = prog(u, 0.75, 0.8) * (1 - prog(u, 5.6, 6.2));
    items.forEach((it, i) => {
      const a = AT(i);
      it.s.draw(u, a, 0.07, 5.85, 0.4);
      // arrow grows from the end of the label, then the mapped word lands
      const ak = ec(prog(u, a + 0.25, a + 0.6));
      const x0 = M + widths[i] + 14, len = 70;
      it.arrow.style.left = x0 + "px";
      it.arrow.style.width = len * ak + "px";
      it.arrow.style.opacity = ak > 0 ? 1 - prog(u, 5.85, 6.1) : 0;
      it.head.style.left = x0 + len * ak - 2 + "px";
      it.head.style.opacity = prog(u, a + 0.5, a + 0.6) * (1 - prog(u, 5.85, 6.1));
      it.b.draw(u, a + 0.45, 0.022);
      // the current mapping is bright; earlier ones step back; all return for a short recap
      const next = i < 3 ? AT(i + 1) : 99;
      const dim = prog(u, next - 0.1, next + 0.3) * (1 - prog(u, 5.35, 5.6));
      it.g.style.opacity = 1 - dim * 0.68;
      // collapse: the big words fly to the centre and merge into a point of light
      const c = ei(prog(u, 5.85, 6.35));
      const dx = W / 2 - (M + 300), dy = 675 - (it.y + 90);
      it.b.root.style.transform = `translate(${dx * c}px, ${dy * c}px) scale(${1 - c * 0.92})`;
      it.b.root.style.opacity = 1 - prog(u, 6.2, 6.4);
      if (c > 0) it.b.chars.forEach((ch) => { ch.style.color = "var(--amber)"; ch.style.textShadow = `0 0 ${30 + 60 * c}px rgba(240,180,60,.8)`; });
    });
    sub.style.opacity = prog(u, 1.2, 1.6) * (1 - prog(u, 5.85, 6.1));
  };
  function measure(root) {
    let w = 0;
    root.querySelectorAll(".w").forEach((s) => { w += s.getBoundingClientRect().width; });
    return w - 10;
  }
}

// ================================================================== S3 TITLE
function S3(root) {
  const flash = el("div", "abs", root, { left: 0, top: 0, width: W + "px", height: H + "px",
                                          background: "radial-gradient(circle at 50% 50%, rgba(255,236,190,1) 0%, rgba(240,180,60,.55) 12%, rgba(240,180,60,0) 45%)" });
  const title = new Slam(root, [{ text: "TARMACOS", amber: [6, 7] }], { y: 480, size: 138 });
  const sub = new Words(root, "Airport ground control, run by\na real C++ engine on Linux.", { x: 0, w: W, y: 680, align: "center", size: 46, weight: 600 });
  const m = el("div", "micro", root, { left: 0, width: W + "px", textAlign: "center", top: "860px", fontSize: "22px" },
               "C++17  ·  POSIX threads  ·  fork & pipes  ·  no frameworks");
  return (u) => {
    flash.style.opacity = bump(u, 0.05, 0.85);
    flash.style.transform = `scale(${0.4 + prog(u, 0.05, 0.85) * 1.4})`;
    title.draw(u, 0.35, 0.045);
    sub.draw(u, 1.1, 0.09);
    m.style.opacity = prog(u, 1.8, 2.3);
    const ex = ec(prog(u, 2.95, 3.6));
    root.style.opacity = 1 - ex;
    root.style.transform = `scale(${1 - ex * 0.15})`;
  };
}

// ================================================================== S4 PRODUCT REVEAL (real apron map)
function S4(root) {
  const ticks = [];
  for (let i = 8; i <= 14; i++) ticks.push("busy_t" + String(i).padStart(2, "0"));
  const wrap = el("div", "abs", root, { left: 0, top: 0, width: W + "px", height: H + "px", perspective: "1800px" });
  // amber rings on the real chips of the flights the engine reports BLOCKED (SG404 from t13, IX505 from t14)
  const RING_SG = [380, 200, 542, 238], RING_IX = [556, 200, 712, 238];
  const shot = new Shot(wrap, ticks, { marks: [{ kind: "ring", rect: RING_SG, pad: 6 }, { kind: "ring", rect: RING_IX, pad: 6 }] });
  const cap = new Words(root, "Five flights. Three gates.\nOne fuel truck. One tug.", { y: 140, size: 56 });
  const NOW = [236, 862, 996, 900];
  const now = new Shot(root, ticks, { fadeRight: true });
  const cap2 = new Words(root, "Every gate taken. *Two* *flights* *blocked.*", { y: 1100, size: 50 });
  const label = micro(root, "Real dashboard capture · every value from the C++ engine");
  const amber = el("div", "abs", root, { background: "var(--amber)", borderRadius: "8px" });
  const FULL = [0, 0, 1920, 1080];
  const MAP = [236, 159, 905, 495];             // queue, gates G1-G3 and the fuel truck / tug: about 1.4x
  const CHIP = [382, 200, 545, 238];            // the SG404 chip: the final push
  return (u) => {
    const r = ec(prog(u, 0, 1.1));
    const push = ec(prog(u, 1.7, 3.0));
    const fullBox = boxFor(FULL, 400);
    const mapBox = boxFor(MAP, 330);
    const z = ei(prog(u, 6.9, 7.6));
    const box = lerpRect(fullBox, mapBox, push);
    const rect = lerpRect(lerpRect(FULL, MAP, push), CHIP, z);
    const idx = clamp((u - 3.1) / 0.42, 0, ticks.length - 1);
    shot.set(box, rect, idx, `translateY(${(1 - r) * 420}px) rotateX(${(1 - r) * 16}deg)`);
    shot.root.style.opacity = r;
    // rings switch on when each flight blocks in the captured tick sequence (idx 5 = t13, idx 6 = t14)
    shot.marks[0].e.style.opacity = prog(idx, 4.6, 5.0) * (0.75 + 0.25 * Math.sin(u * 9)) * (1 - z);
    shot.marks[1].e.style.opacity = prog(idx, 5.6, 6.0) * (0.75 + 0.25 * Math.sin(u * 9 + 1.5)) * (1 - z);
    cap.draw(u, 2.6, 0.12, 6.85);
    const nk = eo(prog(u, 4.3, 4.9));
    now.set(boxFor(NOW, 330 + mapBox[3] + 34 + (1 - nk) * 30), NOW, idx);
    now.root.style.opacity = nk * (1 - prog(u, 6.85, 7.1));
    cap2.draw(u, 5.3, 0.1, 6.85);
    label.style.opacity = prog(u, 1.0, 1.6) * (1 - prog(u, 6.8, 7.1));
    const a = ei(prog(u, 7.25, 7.75));
    const cy = mapBox[1] + mapBox[3] / 2;           // the crop zooms onto the chip, so the chip sits at the card centre
    Object.assign(amber.style, { left: mix(W / 2 - 160, 0, a) + "px", top: mix(cy - 30, 0, a) + "px", width: mix(320, W, a) + "px",
                                 height: mix(60, H, a) + "px", opacity: prog(u, 7.2, 7.35), borderRadius: (1 - a) * 8 + "px" });
  };
}

// ================================================================== S5 SPIKE (amber word slams)
function S5(root) {
  const field = el("div", "abs", root, { left: 0, top: 0, width: W + "px", height: H + "px", background: "var(--amber)" });
  const words = [["UNTIL", 230, 0.25], ["IT", 300, 0.7], ["DEADLOCKS.", 108, 1.2]].map(([w, size, a]) => {
    const e = el("div", "slam", root, { left: 0, width: W + "px", textAlign: "center", top: 675 - size * 0.45 + "px", fontSize: size + "px",
                                         color: "#0a111e", fontStretch: "112%" }, w);
    return { e, a };
  });
  const dot = el("div", "abs", root, { width: "30px", height: "30px", borderRadius: "50%", background: "var(--red)",
                                        boxShadow: "0 0 30px 10px rgba(239,100,97,.6)" });
  return (u) => {
    field.style.opacity = u < 0 ? 0 : 1;
    const drain = ec(prog(u, 1.65, 2.1));
    field.style.clipPath = `circle(${(1 - drain) * 1300}px at 990px 700px)`;
    words.forEach((w, i) => {
      const next = i < words.length - 1 ? words[i + 1].a : 99;
      const k = eo(prog(u, w.a, w.a + 0.28)), o = ei(prog(u, next - 0.06, next + 0.12));
      w.e.style.opacity = u < w.a ? 0 : (1 - o) * (i === 2 ? 1 - prog(u, 1.6, 1.8) : 1);
      w.e.style.transform = `scale(${mix(1.35, 1, k) * (1 - o * 0.2)}) translateY(${(1 - k) * 40 - o * 30}px)`;
      w.e.style.filter = `blur(${(1 - k) * 16 + o * 16}px)`;
    });
    // the full stop drops out and travels to node A of the graph
    const d = ec(prog(u, 1.6, 2.1));
    dot.style.opacity = prog(u, 1.55, 1.65) * (1 - prog(u, 2.05, 2.2));
    dot.style.left = mix(990, 540 - 15, d) + "px";
    dot.style.top = mix(700, 420 - 15, d) + "px";
  };
}

// ================================================================== S6 DEADLOCK: the climax
const NODES = {
  A: { x: 540, y: 420, kind: "f", label: "A" }, FT1: { x: 815, y: 580, kind: "r", label: "FT1", sub: "Truck" },
  B: { x: 815, y: 900, kind: "f", label: "B" }, TG1: { x: 540, y: 1060, kind: "r", label: "TG1", sub: "Tug" },
  C: { x: 265, y: 900, kind: "f", label: "C" }, G3: { x: 265, y: 580, kind: "r", label: "G3", sub: "Gate" },
};
/* holds: resource -> flight (solid); wants: flight -> resource (dashed). Order = the cycle A -> FT1 -> B -> TG1 -> C -> G3 -> A.
   Request ticks t6/t7/t8 and the block order A, B, C are the engine's (det_t07..det_t09, event log). */
const EDGES = [
  { from: "G3", to: "A", hold: true, at: 1.4 }, { from: "A", to: "FT1", hold: false, at: 1.95, tick: "t6" },
  { from: "FT1", to: "B", hold: true, at: 3.2 }, { from: "B", to: "TG1", hold: false, at: 3.75, tick: "t7" },
  { from: "TG1", to: "C", hold: true, at: 5.0 }, { from: "C", to: "G3", hold: false, at: 5.55, tick: "t8" },
];
function S6(root) {
  const P = PEAK_LOCAL;
  const wrap = el("div", "abs", root, { left: 0, top: 0, width: W + "px", height: H + "px", transformOrigin: "540px 740px" });
  const svg = svgLayer(wrap);
  const ring = sv("circle", { cx: 540, cy: 740, r: 10, fill: "none", stroke: "#ef6461", "stroke-width": 4 }, svg);
  const pulse = sv("circle", { r: 12, fill: "#ffd0cf", style: "filter: drop-shadow(0 0 12px #ef6461)" }, svg);
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
      lbl = sv("text", { x: (p1[0] + p2[0]) / 2 - uy * 40, y: (p1[1] + p2[1]) / 2 + ux * 40 + 10, "text-anchor": "middle",
                         "font-family": "JetBrains Mono", "font-size": 28, "font-weight": 600 }, svg);
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
    nodeEls[id] = { g, shape, st, n };
  }
  const cap = [
    new Words(root, "A holds Gate 3. Wants the fuel truck.", { y: 150, size: 50 }),
    new Words(root, "B holds the truck. Wants the tug.", { y: 150, size: 50 }),
    new Words(root, "C holds the tug. Wants Gate 3.", { y: 150, size: 50 }),
  ];
  const peak = new Slam(root, [{ text: "CIRCULAR WAIT.", color: "#ef6461" }], { x: M, w: W - 2 * M, y: 140, align: "left", size: 104 });
  const peakSub = new Words(root, "Nobody can move.", { y: 262, size: 46, weight: 600, base: "var(--text-2)" });
  const m1 = micro(root, "Engine scenario · deadlock A/B/C · policy DETECTION");
  // real evidence: the engine's own report (DETECTION at t8), then the same view after RECOVERY
  const RREAL = [236, 354, 901, 844];
  const real = new Shot(root, ["det_t09", "rec_t09"]);
  SHARED.real = real; SHARED.RREAL = RREAL;
  const realCap = new Words(root, "Detected at *t8.*", { y: 150, size: 64 });
  const recCap = new Words(root, "Recovery rolls back *C.*", { y: 150, size: 64 });
  const m2 = micro(root, "Real dashboard capture · Deadlocks tab");
  const cyc = ["A", "FT1", "B", "TG1", "C", "G3"].map((id) => NODES[id]);
  return (u) => {
    // camera: slow push toward the cycle, then a jolt at the peak
    const push = mix(1, 1.05, ec(prog(u, 0.2, P))) + bump(u, P, P + 0.35) * 0.025;
    const shake = Math.sin(u * 90) * 4 * bump(u, P, P + 0.3);
    wrap.style.transform = `translate(${shake}px, 0) scale(${push})`;
    const toReal = ec(prog(u, 7.75, 8.35));
    wrap.style.opacity = prog(u, 0.05, 0.4) * (1 - toReal);
    const red = (i) => prog(u, P + i * 0.07, P + i * 0.07 + 0.25);         // red sweeps around the cycle
    edges.forEach((ed, i) => {
      const k = ec(prog(u, ed.e.at, ed.e.at + (i === 5 ? 0.7 : 0.45)));
      ed.line.setAttribute("x2", mix(ed.p1[0], ed.p2[0], k));
      ed.line.setAttribute("y2", mix(ed.p1[1], ed.p2[1], k));
      const col = red(i) > 0.5 ? "#ef6461" : ed.e.hold ? "#f0b43c" : "#7d8aa3";
      ed.line.setAttribute("stroke", col);
      ed.head.setAttribute("fill", col);
      ed.head.style.opacity = prog(u, ed.e.at + 0.3, ed.e.at + 0.45);
      if (ed.lbl) { ed.lbl.setAttribute("fill", red(i) > 0.5 ? "#ef6461" : "#f0b43c"); ed.lbl.style.opacity = prog(u, ed.e.at + 0.35, ed.e.at + 0.6); }
    });
    ["A", "FT1", "B", "TG1", "C", "G3"].forEach((id, i) => {
      const ne = nodeEls[id], n = ne.n;
      const appear = eo(prog(u, 0.2 + i * 0.08, 0.8 + i * 0.08));
      ne.g.style.opacity = appear;
      ne.g.style.transformOrigin = `${n.x}px ${n.y}px`;
      ne.g.style.transform = `scale(${0.7 + appear * 0.3 + bump(u, P + i * 0.07, P + i * 0.07 + 0.4) * 0.12})`;
      const r = red(i) > 0.5;
      const blocked = n.kind === "f" && u >= { A: 2.35, B: 4.15, C: P }[id];      // A blocks at t6, B at t7, C at t8
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
    edgeG.style.filter = u > P ? `drop-shadow(0 0 ${8 + 14 * bump(u, P, P + 1.6)}px rgba(239,100,97,.9))` : "none";
    const rk = prog(u, P, P + 1.1);
    ring.setAttribute("r", 40 + eo(rk) * 620);
    ring.style.opacity = rk > 0 ? (1 - rk) * 0.8 : 0;
    // a light pulse runs around the closed cycle while nothing can move
    const lap = (Math.max(0, u - P) / 1.1) % 1, seg = Math.floor(lap * 6) % 6, f = lap * 6 - Math.floor(lap * 6);
    const pa = cyc[seg], pb = cyc[(seg + 1) % 6];
    pulse.setAttribute("cx", mix(pa.x, pb.x, f)); pulse.setAttribute("cy", mix(pa.y, pb.y, f));
    pulse.style.opacity = u > P ? prog(u, P, P + 0.2) * (1 - prog(u, 7.5, 7.8)) : 0;
    cap[0].draw(u, 0.9, 0.1, 2.6);
    cap[1].draw(u, 2.75, 0.1, 4.35);
    cap[2].draw(u, 4.55, 0.1, P - 0.2);
    peak.draw(u, P, 0.03, 7.6);
    peakSub.draw(u, P + 0.6, 0.1, 7.6);
    m1.style.opacity = prog(u, 0.5, 1.0) * (1 - toReal);
    // match-dissolve to the real Deadlocks tab; then the same view crossfades to the RECOVERY result
    const toRec = ec(prog(u, 9.8, 10.3));
    real.set(boxFor(RREAL, 330), RREAL, toRec, `scale(${mix(1.08, 1, toReal)})`);
    real.root.style.opacity = toReal;
    const g = bump(u, 9.8, 10.6);
    real.root.style.boxShadow = `0 40px 90px rgba(0,0,0,.6), 0 0 0 ${1 + g * 3}px rgba(63,201,140,${0.2 + g * 0.6}), 0 0 ${g * 70}px rgba(63,201,140,${g * 0.5})`;
    realCap.draw(u, 8.0, 0.1, 9.85);
    recCap.draw(u, 10.05, 0.1, 10.6);
    m2.style.opacity = toReal;
  };
}

// ================================================================== S7 RECOVERY (after detection)
function S7(root) {
  const BANNER = [236, 354, 900, 415];
  const k1 = el("div", "kicker", root, { left: M + "px", top: "128px" }, "Recovery · after detection");
  const c1 = new Words(root, "C restarts. *Everyone* *finishes.*", { y: 166, size: 52 });
  const rec = new Shot(root, ["rec_t09"], { fadeRight: true });
  const svg = svgLayer(root);
  // turnaround bars: values read from the engine's event log (TAT 13 / 18 / 21 ticks)
  const bars = [["B", 13], ["A", 18], ["C", 21]].map(([f, v], i) => {
    const y = 540 + i * 96;
    const lab = sv("text", { x: M, y: y + 46, "font-family": "Archivo", "font-weight": 900, "font-size": 54, fill: "#e4e8f0" }, svg);
    lab.textContent = f;
    const bar = sv("rect", { x: M + 70, y, width: 0, height: 62, rx: 8, fill: "#f0b43c" }, svg);
    const val = sv("text", { x: M + 80, y: y + 45, "font-family": "JetBrains Mono", "font-weight": 700, "font-size": 40, fill: "#0a111e" }, svg);
    val.textContent = v;
    return { bar, val, lab, v, i };
  });
  const tat = micro(root, "Turnaround, ticks · from the engine's event log", 850);
  const m = micro(root, "Real dashboard capture · policy RECOVERY (preempt)");
  return (u) => {
    // the S6 capture slides up and narrows to its banner: same view, new role
    const slide = ec(prog(u, 0.0, 0.7));
    const RREAL = SHARED.RREAL;
    rec.set(lerpRect(boxFor(RREAL, 330), boxFor(BANNER, 290), slide), lerpRect(RREAL, BANNER, slide));
    rec.root.style.boxShadow = "0 40px 90px rgba(0,0,0,.6), 0 0 0 2px rgba(63,201,140,.6)";
    k1.style.opacity = prog(u, 0.3, 0.7);
    c1.draw(u, 0.5, 0.12, 3.0);
    bars.forEach((b) => {
      const k = eo(prog(u, 1.0 + b.i * 0.25, 1.9 + b.i * 0.25));
      const full = (W - 2 * M - 80) * b.v / 21;
      b.bar.setAttribute("width", full * k);
      b.val.setAttribute("x", M + 70 + full * k - 66);
      b.val.style.opacity = prog(u, 1.5 + b.i * 0.25, 1.8 + b.i * 0.25);
      b.lab.style.opacity = prog(u, 0.9 + b.i * 0.25, 1.2 + b.i * 0.25);
    });
    tat.style.opacity = prog(u, 1.9, 2.3);
    m.style.opacity = prog(u, 0.05, 0.4);
    const ex = ec(prog(u, 3.0, 3.4));
    root.style.opacity = 1 - ex;
    root.style.transform = `translateX(${-ex * 120}px)`;
  };
}

// ================================================================== S7b AVOIDANCE (before a grant) - a separate moment
function S7b(root) {
  const BANNER = [236, 354, 900, 415];
  const BANK = [925, 700, 1440, 766];
  const wipe = el("div", "abs", root, { top: 0, width: "6px", height: H + "px", background: "var(--amber)", boxShadow: "0 0 30px 6px rgba(240,180,60,.7)" });
  const body = el("div", "abs", root, { left: 0, top: 0, width: W + "px", height: H + "px" });
  const k = el("div", "kicker", body, { left: M + "px", top: "128px" }, "Avoidance · before a grant");
  const c1 = new Words(body, "Or never deadlock at all.", { y: 166, size: 52 });
  const replay = micro(body, "Same A/B/C scenario · policy AVOIDANCE (Banker's)", 250);
  const av = new Shot(body, ["avoid_t03"], { fadeRight: true });
  const bank = new Shot(body, ["avoid_t03"]);
  const c2 = new Words(body, "Unsafe is *not* *yet* *deadlock.*", { y: 660, size: 52 });
  const c3 = new Words(body, "Banker's simply never enters an unsafe state,\nso no cycle can form.", { y: 742, size: 40, weight: 600, base: "var(--text-2)" });
  const m = micro(body, "Real dashboard capture · Deadlocks tab");
  return (u) => {
    const wk = ec(prog(u, 0, 0.55));
    wipe.style.left = mix(-10, W + 10, wk) + "px";
    wipe.style.opacity = 1 - prog(u, 0.5, 0.6);
    body.style.clipPath = `inset(0 ${100 - wk * 100}% 0 0)`;
    k.style.opacity = prog(u, 0.3, 0.6);
    c1.draw(u, 0.45, 0.11, 4.05);
    replay.style.opacity = prog(u, 0.9, 1.2);
    const ak = eo(prog(u, 1.0, 1.6));
    av.set(boxFor(BANNER, 330 + (1 - ak) * 40), BANNER);
    av.root.style.opacity = ak;
    av.root.style.boxShadow = "0 40px 90px rgba(0,0,0,.6), 0 0 0 2px rgba(240,180,60,.55)";
    const bk = eo(prog(u, 1.5, 2.1));
    bank.set(boxFor(BANK, 470 + (1 - bk) * 40), BANK);
    bank.root.style.opacity = bk;
    c2.draw(u, 2.3, 0.11, 4.05);
    c3.draw(u, 2.9, 0.06, 4.05);
    m.style.opacity = prog(u, 0.5, 0.9);
    root.style.opacity = 1 - ec(prog(u, 4.1, 4.5));
  };
}

// ================================================================== S8 SCHEDULING
function S8(root) {
  const cap = new Words(root, "Round Robin, quantum 4.", { y: 140, size: 56 });
  const GANTT = [236, 139, 1246, 454];
  const gantt = new Shot(root, ["rr_end"]);
  const METRICS = [1100, 505, 1345, 712];
  const MW = 400;
  const metrics = new Shot(root, ["rr_end"]);
  const nums = [["13.50", "avg turnaround", 588], ["8.75", "avg waiting", 768]].map(([v, l, y]) => {
    const x = M + MW + 56;
    const n = el("div", "slam", root, { left: x + "px", top: y + "px", fontSize: "128px", color: "var(--amber)", fontStretch: "100%" }, v);
    const lab = el("div", "micro", root, { left: x + 4 + "px", top: y + 124 + "px", fontSize: "24px" }, l + " · ticks");
    return { n, lab, v: parseFloat(v), digits: v.split(".")[1].length };
  });
  const cmp = el("div", "micro", root, { left: M + "px", top: "1000px", fontSize: "24px", lineHeight: "1.6" },
                 "Same workload:  FCFS 8.00 / 12.75  ·  Priority 4.75 / 9.50");
  const m = micro(root, "Real dashboard captures · Scheduler tab");
  return (u) => {
    const a = prog(u, 0.1, 0.4);
    cap.draw(u, 0.3, 0.12, 4.95);
    const wipe = ec(prog(u, 0.8, 2.3));
    gantt.set(boxFor(GANTT, 240), GANTT);
    gantt.root.style.clipPath = `inset(0 ${100 - wipe * 100}% 0 0 round 14px)`;
    gantt.root.style.opacity = a;
    const mk = eo(prog(u, 2.1, 2.7));
    metrics.set(boxFor(METRICS, 580 + (1 - mk) * 40, MW), METRICS);
    metrics.root.style.opacity = mk;
    nums.forEach((n, i) => {
      const k = ec(prog(u, 2.7 + i * 0.2, 3.7 + i * 0.2));
      n.n.textContent = (n.v * k).toFixed(n.digits);
      n.n.style.opacity = prog(u, 2.7 + i * 0.2, 2.9 + i * 0.2);
      n.n.style.textShadow = `0 0 ${40 * (1 - prog(u, 3.7, 4.5))}px rgba(240,180,60,.6)`;
      n.lab.style.opacity = prog(u, 3.1 + i * 0.2, 3.4 + i * 0.2);
    });
    cmp.style.opacity = prog(u, 3.8, 4.2);
    m.style.opacity = a;
    const ex = ec(prog(u, 4.95, 5.5));
    root.style.opacity = 1 - ex;
    root.style.transform = `translateY(${-ex * 50}px)`;
  };
}

// ================================================================== S9 BAGGAGE HANDLER: child process, IPC, route
function S9(root) {
  const cap = new Words(root, "The baggage handler is a\n*real* *child* *process.*", { y: 130, size: 56 });
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
  const pipes = [BY + 48, BY + 102].map((y) => ({ l: sv("line", { x1, y1: y, x2: x1, y2: y, stroke: "#e4e8f0", "stroke-width": 5 }, g), y }));
  const pipeLbl = sv("text", { x: (x1 + x2) / 2, y: BY + 148, "text-anchor": "middle", "font-family": "JetBrains Mono", "font-size": 26, fill: "#b4bdcf" }, g);
  pipeLbl.textContent = "2 pipes";
  const msgs = ["SCHED →", "← ORDER"].map((txt) =>
    el("div", "abs mono", root, { fontSize: "24px", fontWeight: 700, color: "#0a111e", background: "var(--amber)", padding: "4px 10px",
                                   borderRadius: "6px", whiteSpace: "nowrap" }, txt));
  // the real head-movement chart: the route the child process planned (SCAN up from 20)
  const CHART = [236, 139, 1246, 515];
  const chart = new Shot(root, ["scan_end"]);
  const ROUTE = [20, 21, 37, 44, 49, 12, 5, 3];
  const route = el("div", "abs mono", root, { left: M + "px", top: "1060px", fontSize: "36px", fontWeight: 700, color: "var(--text)", whiteSpace: "nowrap" });
  const routeSpans = ROUTE.map((p, i) => el("span", null, route, {}, (i ? " → " : "") + p));
  const moved = new Words(root, "*75* positions, one sweep.", { y: 1124, size: 44, weight: 600 });
  const m = micro(root, "Diagram + real dashboard capture · Baggage & disk tab");
  return (u) => {
    root.style.opacity = prog(u, 0.05, 0.4) * (1 - ec(prog(u, 6.3, 6.8)));
    cap.draw(u, 0.3, 0.12);
    const dk = eo(prog(u, 0.7, 1.3));
    g.style.opacity = dk;
    g.style.transform = `translateY(${(1 - dk) * 30}px)`;
    boxes.forEach((b, i) => { b.r.style.opacity = b.n.style.opacity = b.p.style.opacity = prog(u, 0.7 + i * 0.6, 1.0 + i * 0.6); });
    forkPath.setAttribute("stroke-dashoffset", 1000 * (1 - ec(prog(u, 1.0, 1.6))));
    forkHead.style.opacity = forkLbl.style.opacity = prog(u, 1.45, 1.65);
    pipes.forEach((p, i) => p.l.setAttribute("x2", mix(x1, x2, ec(prog(u, 1.8 + i * 0.15, 2.3 + i * 0.15)))));
    pipeLbl.style.opacity = prog(u, 2.2, 2.5);
    msgs.forEach((el_, i) => {
      const a = 2.55 + i * 0.9;
      const k = ec(prog(u, a, a + 0.8));
      const xa = i ? x2 - 140 : x1, xb = i ? x1 : x2 - 140;
      el_.style.left = mix(xa, xb, k) + "px";
      el_.style.top = pipes[i].y - 21 + "px";
      el_.style.opacity = clamp(bump(u, a - 0.05, a + 0.85) * 3);
    });
    const ck = eo(prog(u, 3.7, 4.3));
    chart.set(boxFor(CHART, 690 + (1 - ck) * 40), CHART);
    chart.root.style.opacity = ck;
    routeSpans.forEach((s, i) => { s.style.opacity = prog(u, 4.2 + i * 0.12, 4.4 + i * 0.12); s.style.color = i === 4 ? "var(--muted)" : "var(--text)"; });
    moved.draw(u, 5.3, 0.1);
    m.style.opacity = prog(u, 0.6, 1.1);
  };
}

// ================================================================== S9b GENUINE TERMINAL OUTPUT - its own moment
function S9b(root) {
  const TERM = [244, 148, 804, 422];
  // the child's CMD column shows a personal Windows path: redacted; everything else is the genuine ps output
  const term = new Shot(root, ["term_busy"], { marks: [
    { kind: "redact", rect: [488, 203, 1100, 222], label: "[path redacted]" },
    { kind: "ring", rect: [246, 203, 482, 222], pad: 6 },          // 9983  9981  S+  05:31  (child, parent = engine)
    { kind: "ring", rect: [246, 272, 640, 419], pad: 6 },          // the 8 threads of PID 9981
  ] });
  const cap = new Words(root, "Real PIDs. *Real* *threads.*", { y: 130, size: 56 });
  const n1 = new Words(root, "Child 9983, parent 9981.", { y: 850, size: 44, weight: 600 });
  const n2 = new Words(root, "Eight threads inside the engine.", { y: 914, size: 44, weight: 600 });
  const m = micro(root, "Real Ops-terminal capture · ps --ppid, ps -T");
  return (u) => {
    root.style.opacity = prog(u, 0.0, 0.3) * (1 - ec(prog(u, 2.3, 2.7)));
    cap.draw(u, 0.2, 0.12);
    const tk = eo(prog(u, 0.15, 0.75));
    term.set(boxFor(TERM, 300 + (1 - tk) * 40), TERM, 0, `scale(${mix(0.96, 1, tk)})`);
    term.root.style.opacity = tk;
    term.marks[1].e.style.opacity = prog(u, 0.9, 1.1);
    term.marks[2].e.style.opacity = prog(u, 1.5, 1.7);
    n1.draw(u, 0.95, 0.08);
    n2.draw(u, 1.55, 0.08);
    m.style.opacity = tk;
  };
}

// ================================================================== S10 END CARD
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
  return (u) => {
    root.style.opacity = prog(u, 0.0, 0.3);
    arc.setAttribute("stroke-dashoffset", 1200 * (1 - ec(prog(u, 0.1, 1.2))));
    arc.style.opacity = 0.55;
    title.draw(u, 0.25, 0.04, Infinity, 1.6 * (1 - ec(prog(u, 0.7, 2.0))));
    tag.draw(u, 1.2, 0.08);
    const k = eo(prog(u, 1.7, 2.3));
    url.style.opacity = k;
    url.style.transform = `translateY(${(1 - k) * 20}px)`;
    ul.style.transform = `scaleX(${ec(prog(u, 2.1, 2.9))})`;
    names.style.opacity = prog(u, 2.6, 3.2) * 0.95;
  };
}

// ------------------------------------------------------------------ timeline (local windows per scene)
scene("S1", 0.0, 4.9, S1);
scene("S2", 0.0, 6.45, S2);
scene("S3", -0.05, 3.65, S3);
scene("S4", 0.0, 7.9, S4);
scene("S5", -0.25, 2.25, S5);
scene("S6", 0.0, 11.08, S6);
scene("S7", 0.0, 3.45, S7);
scene("S7b", 0.0, 4.55, S7b);
scene("S8", -0.05, 5.55, S8);
scene("S9", 0.0, 6.85, S9);
scene("S9b", 0.0, 2.75, S9b);
scene("S10", 0.0, DURATION - BASE.S10 + 1, S10);

const grid = document.getElementById("grid");
const fade = document.getElementById("fade");
window.TIMELINE = { BASE, DURATION, PEAK: BASE.S6 + PEAK_LOCAL };
window.render = function (t) {
  for (const s of SCENES) {
    const on = t >= s.a && t < s.b;
    show(s.root, on);
    if (on) s.draw(t);
  }
  grid.style.transform = `translate(${-t * 3}px, ${-t * 1.5}px)`;
  grid.style.opacity = 1 - bump(t, BASE.S5 - 0.3, BASE.S5 + 2.0) * 0.9;
  fade.style.opacity = 1 - prog(t, 0, 0.6) + prog(t, DURATION - 0.5, DURATION);
  return t;
};

window.READY = (async () => {
  await document.fonts.load('900 100px "Archivo"');
  await document.fonts.load('700 50px "Inter Tight"');
  await document.fonts.load('600 50px "Inter Tight"');
  await document.fonts.load('800 50px "Inter Tight"');
  await document.fonts.load('200 50px "Inter"');
  await document.fonts.load('500 30px "Inter"');
  await document.fonts.load('700 30px "JetBrains Mono"');
  await document.fonts.ready;
  await Promise.all([...document.images].map((i) => i.decode().catch(() => null)));
  window.render(0);
  return true;
})();
