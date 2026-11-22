// overlay.js - HTML labels projected from 3D, and SVG "assignment" links (vehicle -> flight).
// DOM is reused per key; innerHTML only changes when the label text changes.
import * as THREE from "three";

const v = new THREE.Vector3();

export class Overlay {
  constructor(labelsEl, linksEl, onPick) {
    this.el = labelsEl;
    this.svg = linksEl;
    this.items = new Map();
    this.links = new Map();
    this.w = 1;
    this.h = 1;
    this.onPick = onPick;
    labelsEl.addEventListener("click", (e) => {
      const node = e.target.closest(".lbl");
      if (node && node.dataset.pick) {
        const [type, id] = node.dataset.pick.split(":");
        onPick(type, type === "flight" ? Number(id) : id);
      }
    });
  }

  resize(w, h) {
    this.w = w;
    this.h = h;
    this.svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  }

  project(world, camera, out) {
    v.copy(world).project(camera);
    out.x = (v.x * 0.5 + 0.5) * this.w;
    out.y = (-v.y * 0.5 + 0.5) * this.h;
    out.visible = v.z < 1 && v.z > -1 && out.x > -60 && out.x < this.w + 60 && out.y > -40 && out.y < this.h + 40;
    return out;
  }

  // list: [{ key, world: Vector3, html, cls, pick, show }]
  frame(list, camera) {
    const seen = new Set();
    const pt = {};
    for (const it of list) {
      seen.add(it.key);
      let rec = this.items.get(it.key);
      if (!rec) {
        const node = document.createElement("div");
        node.className = "lbl";
        node.innerHTML = '<div class="lbl-in"></div>';
        this.el.appendChild(node);
        rec = { node, inner: node.firstChild, html: "", cls: "" };
        this.items.set(it.key, rec);
      }
      if (rec.html !== it.html) { rec.inner.innerHTML = it.html; rec.html = it.html; }
      this.project(it.world, camera, pt);
      const show = it.show && pt.visible;
      const cls = "lbl " + (it.cls || "") + (show ? "" : " hide");
      if (rec.cls !== cls) { rec.node.className = cls; rec.cls = cls; }
      if (it.pick && rec.node.dataset.pick !== it.pick) rec.node.dataset.pick = it.pick;
      if (!show) continue;
      const tf = `translate3d(${pt.x.toFixed(1)}px, ${pt.y.toFixed(1)}px, 0)`;
      if (rec.tf !== tf) { rec.node.style.transform = tf; rec.tf = tf; }
      const z = String(Math.round(1000 - v.z * 1000));
      if (rec.z !== z) { rec.node.style.zIndex = z; rec.z = z; }
    }
    for (const [key, rec] of this.items) if (!seen.has(key)) { rec.node.remove(); this.items.delete(key); }
  }

  // links: [{ key, a: Vector3, b: Vector3, color, sel }]
  frameLinks(list, camera) {
    const seen = new Set();
    const pa = {}, pb = {};
    for (const l of list) {
      seen.add(l.key);
      let path = this.links.get(l.key);
      if (!path) {
        path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        this.svg.appendChild(path);
        this.links.set(l.key, path);
      }
      this.project(l.a, camera, pa);
      this.project(l.b, camera, pb);
      if (!pa.visible || !pb.visible) { path.setAttribute("d", ""); continue; }
      const mx = (pa.x + pb.x) / 2, my = Math.min(pa.y, pb.y) - Math.max(18, Math.abs(pa.x - pb.x) * 0.18);
      path.setAttribute("d", `M${pa.x.toFixed(1)} ${pa.y.toFixed(1)} Q${mx.toFixed(1)} ${my.toFixed(1)} ${pb.x.toFixed(1)} ${pb.y.toFixed(1)}`);
      path.setAttribute("stroke", l.color);
      path.setAttribute("class", l.sel ? "sel" : "");
    }
    for (const [key, path] of this.links) if (!seen.has(key)) { path.remove(); this.links.delete(key); }
  }

  clear() {
    for (const rec of this.items.values()) rec.node.remove();
    this.items.clear();
    for (const p of this.links.values()) p.remove();
    this.links.clear();
  }
}
