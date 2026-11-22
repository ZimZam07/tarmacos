// paths.js - motion paths with arc-length parameterisation and easing profiles.
// Ground routes are polylines whose corners are rounded with quadratic fillets (no overshoot);
// air routes are centripetal Catmull-Rom splines. Both are sampled densely once, then evaluated in O(log n).
import * as THREE from "three";

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

export class Path {
  constructor(points) {
    this.pts = points.length > 1 ? points : [points[0], points[0].clone()];
    this.cum = [0];
    for (let i = 1; i < this.pts.length; i++) this.cum.push(this.cum[i - 1] + this.pts[i].distanceTo(this.pts[i - 1]));
    this.length = this.cum[this.cum.length - 1];
  }

  get start() { return this.pts[0]; }
  get end() { return this.pts[this.pts.length - 1]; }

  // Position and unit direction at fraction u (0..1) of the length.
  at(u, outPos, outDir) {
    const s = Math.min(Math.max(u, 0), 1) * this.length;
    let lo = 0, hi = this.cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid] < s) lo = mid; else hi = mid;
    }
    const seg = this.cum[hi] - this.cum[lo] || 1;
    const t = (s - this.cum[lo]) / seg;
    outPos.copy(this.pts[lo]).lerp(this.pts[hi], t);
    if (outDir) {
      // Direction averaged over a short window, so headings turn smoothly through fillets.
      const i0 = Math.max(lo - 1, 0), i1 = Math.min(hi + 1, this.pts.length - 1);
      outDir.copy(this.pts[i1]).sub(this.pts[i0]);
      if (outDir.lengthSq() < 1e-8) outDir.set(0, 0, 1);
      outDir.normalize();
    }
    return outPos;
  }

  endDir(out) {
    const n = this.pts.length;
    out.copy(this.pts[n - 1]).sub(this.pts[Math.max(n - 3, 0)]);
    return out.lengthSq() > 1e-8 ? out.normalize() : out.set(0, 0, 1);
  }
}

// [x, z] corner points -> dense rounded polyline at height y.
export function groundPath(points, radius = 14, y = 0) {
  const P = [];
  for (const p of points) {
    const v = p.isVector3 ? new THREE.Vector3(p.x, y, p.z) : new THREE.Vector3(p[0], y, p[1]);
    if (!P.length || P[P.length - 1].distanceToSquared(v) > 0.01) P.push(v);
  }
  if (P.length < 3) return new Path(densify(P, 6));
  const out = [P[0].clone()];
  for (let i = 1; i < P.length - 1; i++) {
    const A = P[i - 1], C = P[i], B = P[i + 1];
    _a.copy(A).sub(C);
    _b.copy(B).sub(C);
    const la = _a.length(), lb = _b.length();
    const r = Math.min(radius, la / 2, lb / 2);
    const s = C.clone().addScaledVector(_a.normalize(), r);
    const e = C.clone().addScaledVector(_b.normalize(), r);
    out.push(s);
    for (let k = 1; k < 10; k++) {
      const t = k / 10, it = 1 - t;
      out.push(new THREE.Vector3(
        it * it * s.x + 2 * it * t * C.x + t * t * e.x, y,
        it * it * s.z + 2 * it * t * C.z + t * t * e.z));
    }
    out.push(e);
  }
  out.push(P[P.length - 1].clone());
  return new Path(densify(out, 6));
}

// Inserts points so no segment is longer than `step` (keeps direction smoothing local).
function densify(points, step) {
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const n = Math.max(1, Math.ceil(a.distanceTo(b) / step));
    for (let k = 1; k <= n; k++) out.push(a.clone().lerp(b, k / n));
  }
  return out;
}

export function airPath(points, samples = 220) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => (p.isVector3 ? p.clone() : new THREE.Vector3(p[0], p[1], p[2]))), false, "centripetal");
  return new Path(curve.getSpacedPoints(samples));
}

export function loopPath(points, samples = 240) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])), true, "centripetal");
  return new Path(curve.getSpacedPoints(samples));
}

export const EASE = {
  linear: (t) => t,
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  soft: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  out: (t) => 1 - Math.pow(1 - t, 3),
  in: (t) => t * t * t,
  in2: (t) => t * t,
};
