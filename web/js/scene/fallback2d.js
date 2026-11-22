// fallback2d.js - a 2D apron map used when WebGL is unavailable. Same engine data, same honesty rules.
import { store, subscribe } from "../store.js";
import { flightMap, gateStatus } from "../core/model.js";
import { selection } from "../core/state.js";
import { esc, flightColor, flightName, setHTML } from "../ui.js";
import { fname, resName } from "../core/plain.js";

function apronSvg(snap) {
  const fm = flightMap(snap);
  const gates = snap.resources.filter((r) => r.class === "GATE");
  const trucks = snap.resources.filter((r) => r.class === "FUEL_TRUCK");
  const tugs = snap.resources.filter((r) => r.class === "TUG");
  const beltX = (p) => 40 + (p - snap.disk.min) * (820 / (snap.disk.max - snap.disk.min));
  let s = `<svg viewBox="0 0 900 300" role="img" aria-label="Apron map" font-family="Inter, sans-serif">`;
  s += `<rect x="20" y="10" width="860" height="40" rx="3" fill="#0f161f" stroke="#1d2a3d"/><line x1="70" y1="30" x2="830" y2="30" stroke="#e6eef8" stroke-dasharray="14 10" opacity=".5"/>`;
  const inbound = snap.flights.filter((f) => f.state !== "TERMINATED" && f.state !== "NEW" && f.held.length === 0);
  inbound.slice(0, 6).forEach((f, i) => {
    const x = 90 + i * 120;
    s += `<g data-flight="${f.spid}" style="cursor:pointer"><rect x="${x}" y="18" width="104" height="24" rx="5" fill="${flightColor(f.spid)}"/><text x="${x + 8}" y="34" font-size="11" font-weight="700" fill="#07111f">${esc(fname(f))}</text><text x="${x + 98}" y="34" font-size="9" text-anchor="end" fill="#07111f">${esc(f.state)}</text></g>`;
  });
  s += `<path d="M 40 70 H 860" stroke="#e5b53a" stroke-width="1" opacity=".6"/>`;
  const gw = 820 / gates.length;
  gates.forEach((g, i) => {
    const x = 40 + i * gw + 6, w = gw - 12;
    const gs = gateStatus(snap, g, fm);
    s += `<g data-gate="${g.id}" style="cursor:pointer"><rect x="${x}" y="92" width="${w}" height="74" rx="7" fill="rgba(13,27,42,.9)" stroke="${gs.color}" stroke-width="1.5"/>`;
    s += `<text x="${x + 8}" y="108" font-size="11" fill="#a7b8cc">${esc(resName(g.id))} · ${esc(gs.label)}</text>`;
    if (g.owner >= 0) {
      const f = fm.get(g.owner);
      s += `<rect x="${x + 8}" y="116" width="${w - 16}" height="24" rx="5" fill="${flightColor(g.owner)}"/><text x="${x + 16}" y="132" font-size="11" font-weight="700" fill="#07111f">${esc(flightName(snap, g.owner))}</text>`;
      if (f) s += `<text x="${x + 8}" y="156" font-size="10" fill="#a7b8cc">${esc(f.phase)} · ${esc(f.state)}</text>`;
    }
    s += `</g>`;
  });
  let vx = 40;
  for (const r of [...trucks, ...tugs]) {
    const held = r.owner >= 0;
    s += `<g opacity="${r.enabled ? 1 : 0.35}" data-veh="${r.id}" style="cursor:pointer"><rect x="${vx}" y="182" width="96" height="34" rx="6" fill="${held ? "rgba(255,181,71,.14)" : "#0d1b2a"}" stroke="${held ? "#ffb547" : "#24364d"}"/>
      <text x="${vx + 8}" y="196" font-size="10" fill="#6d8198">${esc(resName(r.id))}</text>
      <text x="${vx + 8}" y="210" font-size="11" font-weight="700" fill="${held ? flightColor(r.owner) : "#6d8198"}">${held ? esc(flightName(snap, r.owner)) : r.enabled ? "free" : "closed"}</text></g>`;
    vx += 108;
  }
  s += `<line x1="40" y1="262" x2="860" y2="262" stroke="#ffb547" opacity=".5"/>`;
  for (let p = snap.disk.min; p <= snap.disk.max; p += 5) s += `<text x="${beltX(p)}" y="290" text-anchor="middle" font-size="10" fill="#6d8198">${p}</text>`;
  for (const r of [...snap.disk.waiting, ...snap.disk.batch_remaining]) s += `<circle cx="${beltX(r.position)}" cy="262" r="5" fill="${flightColor(r.spid)}"/>`;
  s += `<g transform="translate(${beltX(snap.disk.head)},0)" data-veh="CART" style="cursor:pointer"><rect x="-15" y="236" width="30" height="14" rx="3" fill="#ffb547"/><text x="0" y="246.5" font-size="8.5" font-weight="700" text-anchor="middle" fill="#1b1404">CART</text></g>`;
  s += `<text x="40" y="240" font-size="11" fill="#6d8198">Baggage belt · spots ${snap.disk.min}–${snap.disk.max} (like disk cylinders)</text>`;
  return s + `</svg>`;
}

export function mountFallback(host, reason) {
  host.innerHTML = `<div class="fallback"><div class="fb-note note amber small">3D view unavailable (${esc(reason)}). Showing the 2D apron map with the same engine data.</div><div id="fb-map"></div></div>`;
  const map = host.querySelector("#fb-map");
  map.addEventListener("click", (e) => {
    const f = e.target.closest("[data-flight]"), g = e.target.closest("[data-gate]"), v = e.target.closest("[data-veh]");
    if (f) selection.set("flight", Number(f.dataset.flight));
    else if (g) selection.set("gate", g.dataset.gate);
    else if (v) selection.set("vehicle", v.dataset.veh);
  });
  const draw = () => { if (store.snap) setHTML(map, apronSvg(store.snap)); };
  subscribe(() => requestAnimationFrame(draw));
  draw();
}
