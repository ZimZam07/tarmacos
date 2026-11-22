// models.js - procedural low-poly models. Geometries are built once and shared by every instance;
// materials are cached (one accent material per flight colour).
import * as THREE from "three";

const geo = {};
const mats = {};

function mat(key, make) {
  if (!mats[key]) mats[key] = make();
  return mats[key];
}

export const MAT = {
  body: () => mat("body", () => new THREE.MeshStandardMaterial({ color: 0xe9eef5, roughness: 0.42, metalness: 0.15 })),
  belly: () => mat("belly", () => new THREE.MeshStandardMaterial({ color: 0xaab6c4, roughness: 0.5, metalness: 0.2 })),
  engine: () => mat("engine", () => new THREE.MeshStandardMaterial({ color: 0x8e9aab, roughness: 0.35, metalness: 0.55 })),
  dark: () => mat("dark", () => new THREE.MeshStandardMaterial({ color: 0x141c27, roughness: 0.6, metalness: 0.2 })),
  glass: () => mat("glass", () => new THREE.MeshStandardMaterial({ color: 0x0b1522, roughness: 0.15, metalness: 0.6, emissive: 0x16304a, emissiveIntensity: 0.6 })),
  navRed: () => mat("navRed", () => new THREE.MeshBasicMaterial({ color: 0xff4b5c })),
  navGreen: () => mat("navGreen", () => new THREE.MeshBasicMaterial({ color: 0x3dffa6 })),
  white: () => mat("white", () => new THREE.MeshBasicMaterial({ color: 0xffffff })),
  accent: (hex) => mat("acc" + hex, () => new THREE.MeshStandardMaterial({ color: new THREE.Color(hex), roughness: 0.4, metalness: 0.2, emissive: new THREE.Color(hex), emissiveIntensity: 0.08 })),
  amber: () => mat("amber", () => new THREE.MeshStandardMaterial({ color: 0xffb547, roughness: 0.45, metalness: 0.2 })),
  truckTank: () => mat("tank", () => new THREE.MeshStandardMaterial({ color: 0xd9dfe7, roughness: 0.3, metalness: 0.5 })),
  tug: () => mat("tug", () => new THREE.MeshStandardMaterial({ color: 0xf2c14e, roughness: 0.5, metalness: 0.15 })),
  loader: () => mat("loader", () => new THREE.MeshStandardMaterial({ color: 0x3fd0b0, roughness: 0.5, metalness: 0.15 })),
  bag: (hex) => mat("bag" + hex, () => new THREE.MeshStandardMaterial({ color: new THREE.Color(hex), roughness: 0.6, emissive: new THREE.Color(hex), emissiveIntensity: 0.35 })),
};

// ---------------------------------------------------------------- aircraft (~38 m long, 34 m span)
function aircraftGeometries() {
  if (geo.aircraft) return geo.aircraft;
  const prof = [[0, -19], [0.35, -18.8], [0.9, -17.6], [1.55, -15.5], [2.05, -12.5], [2.15, -9], [2.15, 12], [2.05, 14.2], [1.75, 16.2], [1.25, 17.7], [0.6, 18.7], [0, 19.1]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  const fuselage = new THREE.LatheGeometry(prof, 20).rotateX(Math.PI / 2);

  const wingShape = new THREE.Shape();
  // (x, -z) in shape space; extruded thickness becomes height after rotation
  wingShape.moveTo(-1.5, -3.6);
  wingShape.lineTo(-17.2, 5.4);
  wingShape.lineTo(-17.2, 7.0);
  wingShape.lineTo(-1.5, 4.6);
  wingShape.lineTo(1.5, 4.6);
  wingShape.lineTo(17.2, 7.0);
  wingShape.lineTo(17.2, 5.4);
  wingShape.lineTo(1.5, -3.6);
  wingShape.closePath();
  const wing = new THREE.ExtrudeGeometry(wingShape, { depth: 0.38, bevelEnabled: false }).rotateX(-Math.PI / 2);

  const stabShape = new THREE.Shape();
  stabShape.moveTo(-0.8, 14.4);
  stabShape.lineTo(-6.6, 17.6);
  stabShape.lineTo(-6.6, 18.6);
  stabShape.lineTo(-0.8, 18.3);
  stabShape.lineTo(0.8, 18.3);
  stabShape.lineTo(6.6, 18.6);
  stabShape.lineTo(6.6, 17.6);
  stabShape.lineTo(0.8, 14.4);
  stabShape.closePath();
  const stab = new THREE.ExtrudeGeometry(stabShape, { depth: 0.25, bevelEnabled: false }).rotateX(-Math.PI / 2);

  const finShape = new THREE.Shape();
  finShape.moveTo(12.6, 1.4);
  finShape.lineTo(18.9, 1.4);
  finShape.lineTo(19.2, 8.6);
  finShape.lineTo(17.2, 8.6);
  finShape.closePath();
  const fin = new THREE.ExtrudeGeometry(finShape, { depth: 0.32, bevelEnabled: false }).rotateY(Math.PI / 2).translate(-0.16, 0, 0);

  const engine = new THREE.CylinderGeometry(1.15, 1.0, 4.4, 16, 1, true).rotateX(Math.PI / 2);
  const intake = new THREE.CircleGeometry(1.1, 16).translate(0, 0, 2.15);
  const cockpit = new THREE.BoxGeometry(2.6, 0.55, 1.3);
  const gear = new THREE.CylinderGeometry(0.18, 0.18, 2.4, 6);
  const tyre = new THREE.CylinderGeometry(0.55, 0.55, 0.5, 10).rotateZ(Math.PI / 2);
  const light = new THREE.SphereGeometry(0.32, 8, 6);
  const ring = new THREE.RingGeometry(21, 23.2, 48).rotateX(-Math.PI / 2);
  geo.aircraft = { fuselage, wing, stab, fin, engine, intake, cockpit, gear, tyre, light, ring };
  return geo.aircraft;
}

export function makeAircraft(accentHex) {
  const g = aircraftGeometries();
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 3.3;
  root.add(body);

  const fus = new THREE.Mesh(g.fuselage, MAT.body());
  const wing = new THREE.Mesh(g.wing, MAT.body());
  wing.position.set(0, -0.9, 0);
  const stab = new THREE.Mesh(g.stab, MAT.body());
  stab.position.set(0, 0.6, 0);
  const fin = new THREE.Mesh(g.fin, MAT.accent(accentHex));
  fin.position.set(0, 0.8, 0);
  const cockpit = new THREE.Mesh(g.cockpit, MAT.glass());
  cockpit.position.set(0, 1.25, 16.2);
  cockpit.rotation.x = -0.35;
  body.add(fus, wing, stab, fin, cockpit);
  for (const sx of [-6.2, 6.2]) {
    const e = new THREE.Mesh(g.engine, MAT.engine());
    e.position.set(sx, -1.95, 3.1);
    const intake = new THREE.Mesh(g.intake, MAT.accent(accentHex));
    intake.position.copy(e.position);
    body.add(e, intake);
  }
  // landing gear (hidden in flight)
  const gearGroup = new THREE.Group();
  for (const [x, z] of [[0, 14], [-2.6, -1.5], [2.6, -1.5]]) {
    const leg = new THREE.Mesh(g.gear, MAT.dark());
    leg.position.set(x, -2.1, z);
    const tyre = new THREE.Mesh(g.tyre, MAT.dark());
    tyre.position.set(x, -2.75, z);
    gearGroup.add(leg, tyre);
  }
  body.add(gearGroup);

  // nav lights: left (+x) red, right (-x) green, beacon on top
  const navL = new THREE.Mesh(g.light, MAT.navRed());
  navL.position.set(17.2, -0.7, -6.2);
  const navR = new THREE.Mesh(g.light, MAT.navGreen());
  navR.position.set(-17.2, -0.7, -6.2);
  const beacon = new THREE.Mesh(g.light, MAT.navRed().clone());
  beacon.position.set(0, 2.25, 2);
  const strobe = new THREE.Mesh(g.light, MAT.white().clone());
  strobe.position.set(0, 1.1, -19.1);
  body.add(navL, navR, beacon, strobe);

  // selection ring (on the ground)
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x20c8ff, transparent: true, opacity: 0.0, depthWrite: false });
  const ring = new THREE.Mesh(g.ring, ringMat);
  ring.position.y = 0.15;
  root.add(ring);

  root.traverse((o) => { if (o.isMesh && o !== ring) o.castShadow = true; });
  return { root, body, gear: gearGroup, beacon, strobe, ring, fin };
}

// ---------------------------------------------------------------- ground vehicles
function box(w, h, d) { return new THREE.BoxGeometry(w, h, d); }

export function makeFuelTruck() {
  if (!geo.truck) {
    geo.truck = {
      chassis: box(2.8, 0.8, 9.2).translate(0, 1.0, 0),
      cab: box(2.8, 2.1, 2.4).translate(0, 2.3, 3.6),
      tank: new THREE.CylinderGeometry(1.25, 1.25, 6.0, 14).rotateX(Math.PI / 2).translate(0, 2.7, -1.2),
      win: box(2.6, 0.7, 0.1).translate(0, 2.8, 4.82),
    };
  }
  const g = geo.truck;
  const root = new THREE.Group();
  root.add(new THREE.Mesh(g.chassis, MAT.dark()), new THREE.Mesh(g.cab, MAT.amber()), new THREE.Mesh(g.tank, MAT.truckTank()), new THREE.Mesh(g.win, MAT.glass()));
  root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return root;
}

export function makeTug() {
  if (!geo.tug) {
    geo.tug = {
      base: box(3.6, 1.3, 6.2).translate(0, 0.95, 0),
      cab: box(2.0, 1.3, 1.8).translate(0, 2.2, -1.6),
      bar: box(0.3, 0.3, 3.2).translate(0, 0.7, 4.4),
    };
  }
  const g = geo.tug;
  const root = new THREE.Group();
  root.add(new THREE.Mesh(g.base, MAT.tug()), new THREE.Mesh(g.cab, MAT.dark()), new THREE.Mesh(g.bar, MAT.dark()));
  root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return root;
}

export function makeCart() {
  if (!geo.cart) {
    geo.cart = {
      tractor: box(2.2, 1.6, 3.0).translate(0, 1.1, 0),
      seat: box(2.0, 0.9, 1.2).translate(0, 2.2, -0.6),
      trailer: box(2.4, 1.0, 3.6),
      bags: box(2.0, 0.8, 3.0),
    };
  }
  const g = geo.cart;
  const root = new THREE.Group();
  root.add(new THREE.Mesh(g.tractor, MAT.amber()), new THREE.Mesh(g.seat, MAT.dark()));
  for (let i = 0; i < 2; i++) {
    const t = new THREE.Mesh(g.trailer, MAT.dark());
    t.position.set(0, 0.9, -4.2 - i * 4.2);
    const b = new THREE.Mesh(g.bags, MAT.truckTank());
    b.position.set(0, 1.8, -4.2 - i * 4.2);
    root.add(t, b);
  }
  root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return root;
}

export function makeLoader() {
  if (!geo.loader) {
    geo.loader = {
      base: box(2.4, 1.1, 6.5).translate(0, 0.9, 0),
      ramp: box(1.4, 0.25, 8.0).rotateX(-0.42).translate(0, 2.8, 1.6),
    };
  }
  const g = geo.loader;
  const root = new THREE.Group();
  root.add(new THREE.Mesh(g.base, MAT.loader()), new THREE.Mesh(g.ramp, MAT.dark()));
  root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return root;
}

export function makeBag(hex) {
  if (!geo.bag) geo.bag = box(1.6, 1.1, 1.6).translate(0, 0.6, 0);
  return new THREE.Mesh(geo.bag, MAT.bag(hex));
}

export function disposeAll() {
  for (const k of Object.keys(geo)) for (const g of Object.values(geo[k] instanceof THREE.BufferGeometry ? { g: geo[k] } : geo[k])) g.dispose?.();
  for (const m of Object.values(mats)) m.dispose();
}
