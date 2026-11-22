// camera.js - a damped orbit camera with pan/zoom, eased preset transitions and follow mode.
//   left drag: orbit · right drag / shift+drag: pan · wheel / pinch: zoom · two-finger drag: pan
import * as THREE from "three";
import { TOWER } from "./layout.js";

const deg = Math.PI / 180;
export const PRESETS = {
  overview: { target: [-10, 0, -50], radius: 560, theta: -28 * deg, phi: 52 * deg, label: "Airport overview" },
  runway: { target: [-40, 0, -150], radius: 330, theta: -62 * deg, phi: 66 * deg, label: "Runway" },
  gates: { target: [0, 0, 6], radius: 250, theta: 158 * deg, phi: 50 * deg, label: "Gate operations" },
  ground: { target: [90, 0, 14], radius: 175, theta: 140 * deg, phi: 46 * deg, label: "Ground services" },
  tower: null, // computed: the camera sits in the tower cab
};

function towerPreset() {
  const target = new THREE.Vector3(-30, 0, -40);
  const eye = new THREE.Vector3(TOWER.x - 6, TOWER.h + 4, TOWER.z - 6);
  const off = eye.clone().sub(target);
  const radius = off.length();
  return { target: target.toArray(), radius, theta: Math.atan2(off.x, off.z), phi: Math.acos(off.y / radius), label: "Control tower" };
}

export class CameraRig {
  constructor(camera, dom) {
    this.camera = camera;
    this.dom = dom;
    this.target = new THREE.Vector3(...PRESETS.overview.target);
    this.radius = PRESETS.overview.radius;
    this.theta = PRESETS.overview.theta;
    this.phi = PRESETS.overview.phi;
    this.goal = { target: this.target.clone(), radius: this.radius, theta: this.theta, phi: this.phi };
    this.tween = null;
    this.follow = null;     // () => Vector3 | null
    this.idleSpin = 0;      // rad/s (intro)
    this.enabled = true;
    this.limits = { minR: 40, maxR: 1300, minPhi: 8 * deg, maxPhi: 86 * deg };
    this.pointers = new Map();
    this.onUserMove = null;
    this.bind();
    this.apply();
  }

  bind() {
    const el = this.dom;
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    el.addEventListener("pointerdown", (e) => {
      if (!this.enabled) return;
      el.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, button: e.button, shift: e.shiftKey });
    });
    el.addEventListener("pointermove", (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p || !this.enabled) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > 3) p.dragged = true;
      if (this.pointers.size === 2) return this.pinch();
      if (!p.dragged) return;
      this.userInput();
      if (p.button === 2 || p.shift || e.shiftKey) this.pan(dx, dy);
      else this.orbit(dx, dy);
    });
    const up = (e) => {
      this.pointers.delete(e.pointerId);
      this.lastPinch = null;
    };
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("wheel", (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      this.userInput();
      const k = Math.exp(Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 120) * 0.0016);
      this.goal.radius = THREE.MathUtils.clamp(this.goal.radius * k, this.limits.minR, this.limits.maxR);
    }, { passive: false });
  }

  pinch() {
    const [a, b] = [...this.pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (this.lastPinch) {
      this.userInput();
      this.goal.radius = THREE.MathUtils.clamp(this.goal.radius * (this.lastPinch.d / Math.max(d, 1)), this.limits.minR, this.limits.maxR);
      this.pan(mid.x - this.lastPinch.mid.x, mid.y - this.lastPinch.mid.y);
    }
    a.dragged = b.dragged = true;
    this.lastPinch = { d, mid };
  }

  userInput() {
    this.tween = null;
    this.idleSpin = 0;
    if (this.follow && this.onUserMove) this.onUserMove();
  }

  orbit(dx, dy) {
    this.goal.theta -= dx * 0.0052;
    this.goal.phi = THREE.MathUtils.clamp(this.goal.phi - dy * 0.0042, this.limits.minPhi, this.limits.maxPhi);
  }

  pan(dx, dy) {
    const s = this.goal.radius * 0.0016;
    const right = new THREE.Vector3(Math.cos(this.theta), 0, -Math.sin(this.theta));
    const fwd = new THREE.Vector3(Math.sin(this.theta), 0, Math.cos(this.theta));
    this.goal.target.addScaledVector(right, -dx * s).addScaledVector(fwd, -dy * s);
    this.goal.target.x = THREE.MathUtils.clamp(this.goal.target.x, -700, 600);
    this.goal.target.z = THREE.MathUtils.clamp(this.goal.target.z, -450, 300);
    this.follow = null;
  }

  // Smooth, eased transition to a framing. duration in seconds.
  flyTo(spec, duration = 1.6) {
    const to = {
      target: spec.target.isVector3 ? spec.target.clone() : new THREE.Vector3(...spec.target),
      radius: spec.radius ?? this.goal.radius,
      theta: spec.theta ?? this.goal.theta,
      phi: spec.phi ?? this.goal.phi,
    };
    // shortest way round
    let dth = to.theta - this.theta;
    while (dth > Math.PI) dth -= 2 * Math.PI;
    while (dth < -Math.PI) dth += 2 * Math.PI;
    to.theta = this.theta + dth;
    this.tween = { from: { target: this.target.clone(), radius: this.radius, theta: this.theta, phi: this.phi }, to, t: 0, dur: Math.max(0.01, duration) };
    this.goal = { target: to.target.clone(), radius: to.radius, theta: to.theta, phi: to.phi };
  }

  preset(name, duration) {
    const p = name === "tower" ? towerPreset() : PRESETS[name];
    if (!p) return;
    this.follow = null;
    this.idleSpin = 0;
    this.flyTo(p, duration);
  }

  focusOn(point, radius = 150, duration = 1.2) {
    this.flyTo({ target: point.clone().setY(0), radius, phi: Math.min(this.goal.phi, 58 * deg) }, duration);
  }

  update(dt) {
    if (this.tween) {
      const tw = this.tween;
      tw.t = Math.min(1, tw.t + dt / tw.dur);
      const k = tw.t < 0.5 ? 4 * tw.t ** 3 : 1 - (-2 * tw.t + 2) ** 3 / 2;
      this.target.copy(tw.from.target).lerp(tw.to.target, k);
      this.radius = tw.from.radius + (tw.to.radius - tw.from.radius) * k;
      this.theta = tw.from.theta + (tw.to.theta - tw.from.theta) * k;
      this.phi = tw.from.phi + (tw.to.phi - tw.from.phi) * k;
      if (tw.t >= 1) this.tween = null;
    } else {
      if (this.idleSpin) this.goal.theta += this.idleSpin * dt;
      if (this.follow) {
        const p = this.follow();
        if (p) this.goal.target.lerp(new THREE.Vector3(p.x, 0, p.z), Math.min(1, dt * 2.5));
      }
      const k = Math.min(1, dt * 7);
      this.target.lerp(this.goal.target, k);
      this.radius += (this.goal.radius - this.radius) * k;
      this.theta += (this.goal.theta - this.theta) * k;
      this.phi += (this.goal.phi - this.phi) * k;
    }
    this.apply();
  }

  apply() {
    const sp = Math.sin(this.phi);
    this.camera.position.set(
      this.target.x + this.radius * sp * Math.sin(this.theta),
      this.target.y + this.radius * Math.cos(this.phi),
      this.target.z + this.radius * sp * Math.cos(this.theta),
    );
    this.camera.lookAt(this.target);
  }
}
