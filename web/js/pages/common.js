// common.js - helpers shared by the Explorer pages.
import { esc, flightColor } from "../ui.js";
import { fname } from "../core/plain.js";

export function pageHead({ kicker, title, text, annos = [], right = "" }) {
  return `<div class="page-head"><div>
      <div class="xp-kicker">${esc(kicker)}</div>
      <h1 class="xp-title">${title}</h1>
      ${text ? `<p>${text}</p>` : ""}
      ${annos.length ? `<div class="annos">${annos.map((a) => `<span class="anno">${a}</span>`).join("")}</div>` : ""}
    </div>${right ? `<div class="row">${right}</div>` : ""}</div>`;
}

// Keyed tokens that glide between positions (CSS transform transition).
export class TokenLayer {
  constructor(container, onClick) {
    this.c = container;
    this.map = new Map();
    if (onClick) container.addEventListener("click", (e) => { const t = e.target.closest(".token"); if (t) onClick(t.dataset.key); });
  }
  // items: [{ key, x, y, html, cls }]
  set(items) {
    const seen = new Set();
    for (const it of items) {
      seen.add(it.key);
      let el = this.map.get(it.key);
      const fresh = !el;
      if (fresh) {
        el = document.createElement("div");
        el.className = "token";
        el.dataset.key = it.key;
        el.style.transform = `translate(${it.fromX ?? it.x}px, ${it.fromY ?? it.y}px)`;
        el.style.opacity = "0";
        this.c.appendChild(el);
        this.map.set(it.key, el);
        requestAnimationFrame(() => { el.style.opacity = "1"; });
      }
      if (el.__html !== it.html) { el.innerHTML = it.html; el.__html = it.html; }
      const cls = "token " + (it.cls || "");
      if (el.className !== cls) el.className = cls;
      const tf = `translate(${Math.round(it.x)}px, ${Math.round(it.y)}px)`;
      if (el.__tf !== tf) {
        el.__tf = tf;
        if (fresh) requestAnimationFrame(() => requestAnimationFrame(() => { el.style.transform = tf; }));
        else el.style.transform = tf;
      }
    }
    for (const [k, el] of this.map) {
      if (seen.has(k)) continue;
      this.map.delete(k);
      el.classList.add("leaving");
      setTimeout(() => el.remove(), 450);
    }
  }
}

export const flightToken = (f, extra = "") => `<span class="sw" style="background:${flightColor(f.spid)}"></span>${esc(fname(f))}${extra}`;

// Animate a number shown in an element (purely cosmetic count-up between two engine values).
export function setNum(el, value, digits = 0) {
  if (!el) return;
  const to = Number(value);
  if (!Number.isFinite(to)) { el.textContent = value ?? "—"; return; }
  const from = Number(el.dataset.v ?? to);
  el.dataset.v = to;
  if (from === to) { el.textContent = to.toFixed(digits); return; }
  const t0 = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - t0) / 450);
    el.textContent = (from + (to - from) * (1 - Math.pow(1 - k, 3))).toFixed(digits);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export const simControls = () => `<button class="btn small" data-sim="step" title="Advance the engine one tick">Step</button><button class="btn small" data-sim="run" title="Run / pause the engine">Run / pause</button><button class="btn small" data-sim="end" title="Run with no delay until nothing can progress">Run to end</button>`;
export function wireSim(root, ctx) {
  root.querySelectorAll("[data-sim]").forEach((b) => (b.onclick = () => {
    const s = ctx.snap;
    if (b.dataset.sim === "step") ctx.run("sim step");
    if (b.dataset.sim === "end") ctx.run("sim run-until-quiet 500");
    if (b.dataset.sim === "run") ctx.run(s && (s.sim.running || s.sim.fast) ? "sim pause" : "sim run");
  }));
}
