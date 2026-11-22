// world.js - the static airport: painted airfield, lights, terminal, stands, jet bridges, tower.
// Everything here is environment. Engine-driven state (stand status, jet-bridge extension) is set by
// the scene host through the small API returned by buildWorld().
import * as THREE from "three";
import { BELT, CONNECTORS, DEPOT, LANE, REMOTE_COUNT, ROAD, RWY, STAND_Z, TERMINAL, TOWER, TWY, beltX, gateX, remoteSlot } from "./layout.js";

const AREA = { x0: -420, x1: 400, z0: -230, z1: 150 };

// ---------------------------------------------------------------- painted airfield texture
function paintAirfield(widthPx) {
  const W = AREA.x1 - AREA.x0, H = AREA.z1 - AREA.z0;
  const s = widthPx / W;
  const c = document.createElement("canvas");
  c.width = widthPx;
  c.height = Math.round(H * s);
  const g = c.getContext("2d");
  const X = (x) => (x - AREA.x0) * s, Z = (z) => (z - AREA.z0) * s;
  const rect = (x0, z0, x1, z1, fill) => { g.fillStyle = fill; g.fillRect(X(x0), Z(z0), (x1 - x0) * s, (z1 - z0) * s); };
  const line = (pts, color, w, dash) => {
    g.strokeStyle = color; g.lineWidth = w * s; g.setLineDash(dash ? dash.map((d) => d * s) : []);
    g.beginPath(); pts.forEach(([x, z], i) => (i ? g.lineTo(X(x), Z(z)) : g.moveTo(X(x), Z(z)))); g.stroke();
  };

  // grass with faint speckle
  g.fillStyle = "#08111b";
  g.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = `rgba(${40 + Math.random() * 30},${60 + Math.random() * 40},${70 + Math.random() * 40},${Math.random() * 0.05})`;
    g.fillRect(Math.random() * c.width, Math.random() * c.height, 2 + Math.random() * 6, 2 + Math.random() * 6);
  }

  const TW = "#141d29", AP = "#18222f", RW = "#0f161f";
  // apron + remote apron + depot
  rect(-345, LANE.z - 22, 305, 47, AP);
  rect(-350, -40, -200, 130, AP);
  rect(222, -20, 300, 47, AP);
  // taxiways
  const tw = 24;
  rect(TWY.x0, TWY.z - tw / 2, TWY.x1, TWY.z + tw / 2, TW);
  for (const cx of CONNECTORS) rect(cx - tw / 2, TWY.z, cx + tw / 2, LANE.z, TW);
  rect(-334, RWY.z, -310, TWY.z + tw / 2, TW);
  rect(RWY.exitX - tw / 2, RWY.z, RWY.exitX + tw / 2, TWY.z, TW);
  // runway
  rect(RWY.x0, RWY.z - RWY.width / 2, RWY.x1, RWY.z + RWY.width / 2, RW);
  // runway shoulders
  line([[RWY.x0, RWY.z - RWY.width / 2 - 1.5], [RWY.x1, RWY.z - RWY.width / 2 - 1.5]], "rgba(255,255,255,0.05)", 3);
  line([[RWY.x0, RWY.z + RWY.width / 2 + 1.5], [RWY.x1, RWY.z + RWY.width / 2 + 1.5]], "rgba(255,255,255,0.05)", 3);

  // runway markings
  const white = "rgba(236,242,250,0.9)";
  line([[RWY.x0 + 4, RWY.z - RWY.width / 2 + 1], [RWY.x1 - 4, RWY.z - RWY.width / 2 + 1]], white, 0.8);
  line([[RWY.x0 + 4, RWY.z + RWY.width / 2 - 1], [RWY.x1 - 4, RWY.z + RWY.width / 2 - 1]], white, 0.8);
  line([[RWY.x0 + 60, RWY.z], [RWY.x1 - 60, RWY.z]], white, 0.9, [24, 16]);
  for (const end of [-1, 1]) {
    const xe = end < 0 ? RWY.x0 + 6 : RWY.x1 - 30;
    for (let k = -6; k <= 6; k++) {
      if (k === 0) continue;
      rect(xe, RWY.z + k * 2.2 - 0.7, xe + 24, RWY.z + k * 2.2 + 0.7, white);
    }
    // aiming point + touchdown zone
    const xa = end < 0 ? RWY.x0 + 110 : RWY.x1 - 150;
    rect(xa, RWY.z - 9, xa + 40, RWY.z - 5.5, white);
    rect(xa, RWY.z + 5.5, xa + 40, RWY.z + 9, white);
    for (let k = 0; k < 3; k++) {
      const xt = end < 0 ? RWY.x0 + 175 + k * 40 : RWY.x1 - 205 - k * 40;
      rect(xt, RWY.z - 10, xt + 18, RWY.z - 8, white);
      rect(xt, RWY.z + 8, xt + 18, RWY.z + 10, white);
    }
  }
  const num = (text, x, z, rot) => {
    g.save(); g.translate(X(x), Z(z)); g.rotate(rot); g.fillStyle = white;
    g.font = `700 ${Math.round(14 * s)}px Inter, Arial, sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(text, 0, 0); g.restore();
  };
  num("09", RWY.x0 + 44, RWY.z, Math.PI / 2);
  num("27", RWY.x1 - 44, RWY.z, -Math.PI / 2);

  // taxiway centre lines (yellow) and hold-short bars
  const yel = "rgba(240,190,70,0.85)";
  line([[TWY.x0, TWY.z], [TWY.x1, TWY.z]], yel, 0.5);
  line([[LANE.x0, LANE.z], [LANE.x1, LANE.z]], yel, 0.5);
  for (const cx of CONNECTORS) line([[cx, TWY.z], [cx, LANE.z]], yel, 0.5);
  line([[-322, TWY.z], [-322, RWY.z]], yel, 0.5);
  line([[RWY.exitX, RWY.z], [RWY.exitX, TWY.z]], yel, 0.5);
  for (const x of [-322, RWY.exitX]) {
    line([[x - 11, RWY.z + RWY.width / 2 + 7], [x + 11, RWY.z + RWY.width / 2 + 7]], yel, 0.5);
    line([[x - 11, RWY.z + RWY.width / 2 + 8.4], [x + 11, RWY.z + RWY.width / 2 + 8.4]], yel, 0.5, [1.6, 1.2]);
  }
  // stands: lead-in lines, stop bars, safety boxes, numbers
  for (let i = 0; i < 6; i++) {
    const gx = gateX(i);
    line([[gx, LANE.z], [gx, STAND_Z + 19]], yel, 0.45);
    rect(gx - 3, STAND_Z + 19, gx + 3, STAND_Z + 19.6, yel);
    g.strokeStyle = "rgba(255,92,108,0.35)"; g.lineWidth = 0.35 * s; g.setLineDash([]);
    g.strokeRect(X(gx - 22), Z(STAND_Z - 22), 44 * s, 45 * s);
    g.fillStyle = "rgba(230,238,248,0.75)"; g.font = `700 ${Math.round(5 * s)}px Inter, Arial, sans-serif`;
    g.textAlign = "center"; g.fillText(String(i + 1), X(gx - 14), Z(STAND_Z + 21));
  }
  // remote stands
  for (let i = 0; i < REMOTE_COUNT; i++) {
    const r = remoteSlot(i);
    g.strokeStyle = "rgba(230,238,248,0.13)"; g.lineWidth = 0.35 * s; g.setLineDash([]);
    g.strokeRect(X(r.x - 20), Z(r.z - 18), 40 * s, 36 * s);
    line([[r.x - 18, r.z], [r.x + 20, r.z]], "rgba(240,190,70,0.4)", 0.35);
  }
  line([[-207, -40], [-207, 125]], yel, 0.45);
  // service road
  line([[-215, ROAD.z - 4], [300, ROAD.z - 4]], "rgba(230,238,248,0.35)", 0.35);
  line([[-215, ROAD.z + 4], [300, ROAD.z + 4]], "rgba(230,238,248,0.35)", 0.35);
  line([[-215, ROAD.z], [300, ROAD.z]], "rgba(230,238,248,0.25)", 0.3, [3, 3]);
  // baggage belt = disk cylinders 0..49
  rect(beltX(0) - 3, BELT.z - 3, beltX(49) + 3, BELT.z + 3, "rgba(255,181,71,0.07)");
  line([[beltX(0), BELT.z], [beltX(49), BELT.z]], "rgba(255,181,71,0.55)", 0.4);
  g.textAlign = "center";
  for (let p = 0; p <= 49; p++) {
    const major = p % 5 === 0;
    line([[beltX(p), BELT.z - (major ? 2.4 : 1.2)], [beltX(p), BELT.z + (major ? 2.4 : 1.2)]], "rgba(255,181,71,0.6)", major ? 0.35 : 0.2);
    if (major) {
      g.fillStyle = "rgba(255,200,120,0.75)";
      g.font = `600 ${Math.round(2.6 * s)}px "JetBrains Mono", monospace`;
      g.fillText(String(p), X(beltX(p)), Z(BELT.z + 6));
    }
  }
  g.fillStyle = "rgba(255,200,120,0.6)";
  g.font = `600 ${Math.round(2.4 * s)}px Inter, Arial, sans-serif`;
  g.textAlign = "left";
  g.fillText("BAGGAGE BELT · DISK CYLINDERS 0–49", X(beltX(0)), Z(BELT.z - 4.6));
  // depot bays
  for (let i = 0; i < 4; i++) {
    g.strokeStyle = "rgba(230,238,248,0.2)"; g.lineWidth = 0.3 * s;
    g.strokeRect(X(DEPOT.x - 4 + i * 14), Z(DEPOT.z - 8), 10 * s, 16 * s);
    g.strokeRect(X(DEPOT.x - 4 + i * 14), Z(DEPOT.z + 14), 10 * s, 14 * s);
  }
  g.fillStyle = "rgba(230,238,248,0.45)";
  g.font = `600 ${Math.round(2.6 * s)}px Inter, Arial, sans-serif`;
  g.fillText("GROUND SERVICES DEPOT", X(DEPOT.x - 4), Z(DEPOT.z - 10.5));
  g.fillText("REMOTE STANDS", X(-345), Z(-44));
  return c;
}

// ---------------------------------------------------------------- glow points (lights)
let glowTex = null;
function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.18, "rgba(255,255,255,0.85)");
  grd.addColorStop(0.45, "rgba(255,255,255,0.18)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

function lightPoints(positions, color, size) {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(positions.flat(), 3));
  const m = new THREE.PointsMaterial({ color, size, map: glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, opacity: 0 });
  const pts = new THREE.Points(geom, m);
  pts.userData.target = 1;
  pts.renderOrder = 2;
  return pts;
}

// ---------------------------------------------------------------- terminal facade texture
function facadeTexture() {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = "#0b1828";
  g.fillRect(0, 0, 1024, 128);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 64; col++) {
      const lit = Math.random();
      const warm = Math.random() < 0.25;
      const a = lit < 0.15 ? 0.15 : 0.45 + Math.random() * 0.5;
      g.fillStyle = warm ? `rgba(255,205,140,${a})` : `rgba(120,210,255,${a})`;
      g.fillRect(4 + col * 16, 14 + row * 36, 12, 24);
    }
  }
  g.fillStyle = "rgba(32,200,255,0.9)";
  g.fillRect(0, 122, 1024, 3);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------- build
export function buildWorld(renderer, quality) {
  const group = new THREE.Group();
  const disposables = [];
  const track = (o) => { disposables.push(o); return o; };

  // sky dome with a soft horizon glow
  const skyGeo = track(new THREE.SphereGeometry(4200, 24, 12));
  const colors = [];
  const pos = skyGeo.attributes.position;
  const top = new THREE.Color("#030912"), mid = new THREE.Color("#0a1b2e"), hor = new THREE.Color("#173452");
  for (let i = 0; i < pos.count; i++) {
    const h = pos.getY(i) / 4200;
    const col = h > 0.25 ? top.clone().lerp(mid, Math.max(0, 1 - (h - 0.25) / 0.75) * 0.6) : mid.clone().lerp(hor, Math.max(0, 1 - Math.abs(h) / 0.25));
    colors.push(col.r, col.g, col.b);
  }
  skyGeo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  const sky = new THREE.Mesh(skyGeo, track(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false })));
  group.add(sky);

  // stars
  const starPos = [];
  for (let i = 0; i < 700; i++) {
    const th = Math.random() * Math.PI * 2, ph = Math.random() * 0.45 * Math.PI;
    starPos.push(3900 * Math.cos(th) * Math.sin(ph + 0.3), 3900 * Math.cos(ph + 0.3) * 0.9 + 300, 3900 * Math.sin(th) * Math.sin(ph + 0.3));
  }
  const starGeo = track(new THREE.BufferGeometry());
  starGeo.setAttribute("position", new THREE.Float32BufferAttribute(starPos, 3));
  group.add(new THREE.Points(starGeo, track(new THREE.PointsMaterial({ color: 0x9fbbe0, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0.55, fog: false }))));

  // distant ground
  const ground = new THREE.Mesh(track(new THREE.PlaneGeometry(9000, 9000).rotateX(-Math.PI / 2)), track(new THREE.MeshLambertMaterial({ color: 0x08111b })));
  ground.position.y = -0.08;
  ground.receiveShadow = true;
  group.add(ground);

  // painted airfield
  const texW = quality === "high" ? 4096 : quality === "performance" ? 2048 : 3072;
  const airTex = track(new THREE.CanvasTexture(paintAirfield(texW)));
  airTex.colorSpace = THREE.SRGBColorSpace;
  airTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const field = new THREE.Mesh(
    track(new THREE.PlaneGeometry(AREA.x1 - AREA.x0, AREA.z1 - AREA.z0).rotateX(-Math.PI / 2)),
    track(new THREE.MeshStandardMaterial({ map: airTex, roughness: 0.92, metalness: 0.0 })),
  );
  field.position.set((AREA.x0 + AREA.x1) / 2, 0, (AREA.z0 + AREA.z1) / 2);
  field.receiveShadow = true;
  group.add(field);

  // ---------------- lights (glow points, ramped up by setLightLevel)
  const lightGroups = [];
  const rEdge = [], thrG = [], endR = [], twyBlue = [], twyGreen = [], appr = [];
  for (let x = RWY.x0 + 6; x <= RWY.x1 - 6; x += 28) { rEdge.push([x, 0.6, RWY.z - RWY.width / 2 - 1.2]); rEdge.push([x, 0.6, RWY.z + RWY.width / 2 + 1.2]); }
  for (let k = -7; k <= 7; k++) { thrG.push([RWY.x0 + 2, 0.6, RWY.z + k * 2.2]); endR.push([RWY.x1 - 2, 0.6, RWY.z + k * 2.2]); }
  for (let x = TWY.x0; x <= TWY.x1; x += 22) { twyBlue.push([x, 0.5, TWY.z - 13]); twyBlue.push([x, 0.5, TWY.z + 13]); }
  for (let x = TWY.x0; x <= TWY.x1; x += 12) twyGreen.push([x, 0.4, TWY.z]);
  for (const cx of CONNECTORS) for (let z = TWY.z; z <= LANE.z; z += 11) twyGreen.push([cx, 0.4, z]);
  for (let z = RWY.z; z <= TWY.z; z += 10) { twyGreen.push([-322, 0.4, z]); twyGreen.push([RWY.exitX, 0.4, z]); }
  for (let x = LANE.x0; x <= LANE.x1; x += 14) twyGreen.push([x, 0.4, LANE.z]);
  for (let d = 30; d <= 300; d += 30) for (let k = -2; k <= 2; k++) appr.push([RWY.x0 - d, 0.8, RWY.z + k * 3.2]);
  const add = (pts, color, size, delay) => { const p = lightPoints(pts, color, size); p.userData.delay = delay; group.add(p); lightGroups.push(p); disposables.push(p.geometry, p.material); return p; };
  add(appr, 0xfff2d6, 7, 0.0);
  add(thrG, 0x3dffa6, 6.5, 0.25);
  add(rEdge, 0xfff4e0, 5.5, 0.45);
  add(endR, 0xff4b5c, 6.5, 0.6);
  add(twyBlue, 0x4f86ff, 4.5, 0.85);
  add(twyGreen, 0x39e6a0, 3.2, 1.0);

  // sequenced flasher ("rabbit") on the approach lights: an environment effect, not an engine event
  const rabbitPts = [];
  for (let d = 300; d >= 30; d -= 30) rabbitPts.push([RWY.x0 - d, 1.0, RWY.z]);
  const rabbit = lightPoints(rabbitPts, 0xffffff, 16);
  const rabbitAlpha = new Float32Array(rabbitPts.length);
  rabbit.geometry.setAttribute("alpha", new THREE.BufferAttribute(rabbitAlpha, 1));
  rabbit.material.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute float alpha;\nvarying float vA;").replace("#include <fog_vertex>", "#include <fog_vertex>\nvA = alpha;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying float vA;").replace("#include <premultiplied_alpha_fragment>", "gl_FragColor.a *= vA;\n#include <premultiplied_alpha_fragment>");
  };
  group.add(rabbit);
  disposables.push(rabbit.geometry, rabbit.material);

  // ---------------- terminal
  const facade = track(facadeTexture());
  facade.wrapS = THREE.RepeatWrapping;
  facade.repeat.set(3, 1);
  const tw = TERMINAL.x1 - TERMINAL.x0, td = TERMINAL.z1 - TERMINAL.z0;
  const wallMat = track(new THREE.MeshStandardMaterial({ color: 0x1b2a3c, roughness: 0.7, metalness: 0.2 }));
  const glassFront = track(new THREE.MeshStandardMaterial({ color: 0x0d1d2e, roughness: 0.2, metalness: 0.6, emissive: 0xffffff, emissiveMap: facade, emissiveIntensity: 0.9 }));
  const glassSide = glassFront.clone();
  disposables.push(glassSide);
  const roofMat = track(new THREE.MeshStandardMaterial({ color: 0x22344a, roughness: 0.55, metalness: 0.35 }));
  const term = new THREE.Mesh(track(new THREE.BoxGeometry(tw, TERMINAL.h, td)), [glassSide, glassSide, roofMat, wallMat, wallMat, glassFront]);
  term.position.set((TERMINAL.x0 + TERMINAL.x1) / 2, TERMINAL.h / 2, (TERMINAL.z0 + TERMINAL.z1) / 2);
  term.castShadow = true;
  term.receiveShadow = true;
  group.add(term);
  const roof = new THREE.Mesh(track(new THREE.BoxGeometry(tw + 10, 1.4, td + 8)), roofMat);
  roof.position.set(term.position.x, TERMINAL.h + 0.7, term.position.z - 2);
  roof.castShadow = true;
  group.add(roof);
  const crown = new THREE.Mesh(track(new THREE.CylinderGeometry(td / 2.2, td / 2.2, tw * 0.55, 24, 1, false, 0, Math.PI).rotateZ(Math.PI / 2)), roofMat);
  crown.position.set(term.position.x, TERMINAL.h + 1.2, term.position.z);
  crown.scale.set(1, 0.32, 1);
  group.add(crown);
  // a glowing name line on the roof edge
  const strip = new THREE.Mesh(track(new THREE.BoxGeometry(tw + 10, 0.35, 0.35)), track(new THREE.MeshBasicMaterial({ color: 0x20c8ff })));
  strip.position.set(term.position.x, TERMINAL.h + 1.45, TERMINAL.z0 - 2.2);
  group.add(strip);

  // ---------------- stands: status frame, rotunda, jet bridge
  const gates = new Map();
  const frameShape = (w, d, t) => {
    const s = new THREE.Shape();
    s.moveTo(-w / 2, -d / 2); s.lineTo(w / 2, -d / 2); s.lineTo(w / 2, d / 2); s.lineTo(-w / 2, d / 2); s.closePath();
    const h = new THREE.Path();
    h.moveTo(-w / 2 + t, -d / 2 + t); h.lineTo(-w / 2 + t, d / 2 - t); h.lineTo(w / 2 - t, d / 2 - t); h.lineTo(w / 2 - t, -d / 2 + t); h.closePath();
    s.holes.push(h);
    return s;
  };
  const frameGeo = track(new THREE.ShapeGeometry(frameShape(46, 47, 0.9)).rotateX(-Math.PI / 2));
  const padGeo = track(new THREE.PlaneGeometry(44, 45).rotateX(-Math.PI / 2));
  const rotGeo = track(new THREE.CylinderGeometry(2.6, 2.6, 6.2, 16));
  const tunnelGeo = track(new THREE.BoxGeometry(3.2, 3.0, 1).translate(0, 0, 0.5));
  const legGeo = track(new THREE.CylinderGeometry(0.35, 0.35, 4.4, 8));
  const bridgeMat = track(new THREE.MeshStandardMaterial({ color: 0x9aa9bb, roughness: 0.45, metalness: 0.5 }));
  const rotMat = track(new THREE.MeshStandardMaterial({ color: 0x2a3d54, roughness: 0.5, metalness: 0.4 }));
  for (let i = 0; i < 6; i++) {
    const id = "G" + (i + 1);
    const gx = gateX(i);
    const frameMat = new THREE.MeshBasicMaterial({ color: 0x2fd69a, transparent: true, opacity: 0.35, depthWrite: false });
    const padMat = new THREE.MeshBasicMaterial({ color: 0x2fd69a, transparent: true, opacity: 0.0, depthWrite: false });
    disposables.push(frameMat, padMat);
    const frame = new THREE.Mesh(frameGeo, frameMat);
    frame.position.set(gx, 0.12, STAND_Z + 0.5);
    const pad = new THREE.Mesh(padGeo, padMat);
    pad.position.set(gx, 0.1, STAND_Z + 0.5);
    pad.userData.pick = { type: "gate", id };
    frame.userData.pick = { type: "gate", id };
    const rot = new THREE.Mesh(rotGeo, rotMat);
    const rx = gx + 12, rz = TERMINAL.z0 - 4;
    rot.position.set(rx, 3.1, rz);
    rot.castShadow = true;
    const bridge = new THREE.Group();
    bridge.position.set(rx, 5.2, rz);
    const tunnel = new THREE.Mesh(tunnelGeo, bridgeMat);
    tunnel.rotation.order = "YXZ";
    tunnel.castShadow = true;
    const leg = new THREE.Mesh(legGeo, rotMat);
    bridge.add(tunnel, leg);
    group.add(frame, pad, rot, bridge);
    const retracted = new THREE.Vector3(gx + 8, 0, STAND_Z + 32);
    const door = new THREE.Vector3(gx + 4.2, 0, STAND_Z + 13.2);
    gates.set(id, { id, gx, frame, pad, bridge, tunnel, leg, ext: 0, target: 0, retracted, door, rx, rz, status: "free", color: new THREE.Color(0x2fd69a), pulse: false });
  }
  const setBridge = (gt, k) => {
    const p = gt.retracted.clone().lerp(gt.door, k);
    const dx = p.x - gt.rx, dz = p.z - gt.rz;
    const len = Math.hypot(dx, dz);
    gt.tunnel.scale.set(1, 1, len);
    gt.tunnel.rotation.y = Math.atan2(dx, dz);
    gt.tunnel.rotation.x = Math.atan2(5.2 - (3.3 + 1.0 * k + 0.4), len) * 0.9;
    gt.leg.position.set(dx * 0.92, -2.6, dz * 0.92);
  };
  for (const gt of gates.values()) setBridge(gt, 0);

  // ---------------- tower
  const towerMat = track(new THREE.MeshStandardMaterial({ color: 0x23354b, roughness: 0.6, metalness: 0.3 }));
  const shaft = new THREE.Mesh(track(new THREE.CylinderGeometry(3.6, 5.5, TOWER.h, 16)), towerMat);
  shaft.position.set(TOWER.x, TOWER.h / 2, TOWER.z);
  shaft.castShadow = true;
  const cabGlass = track(new THREE.MeshStandardMaterial({ color: 0x0c2236, roughness: 0.1, metalness: 0.7, emissive: 0x1fa8d8, emissiveIntensity: 0.55 }));
  const cab = new THREE.Mesh(track(new THREE.CylinderGeometry(9.5, 7.2, 7, 10)), cabGlass);
  cab.position.set(TOWER.x, TOWER.h + 3.5, TOWER.z);
  const cap = new THREE.Mesh(track(new THREE.CylinderGeometry(6.5, 10.2, 2.2, 10)), towerMat);
  cap.position.set(TOWER.x, TOWER.h + 8.1, TOWER.z);
  const mast = new THREE.Mesh(track(new THREE.CylinderGeometry(0.25, 0.25, 12, 6)), towerMat);
  mast.position.set(TOWER.x, TOWER.h + 15, TOWER.z);
  const beaconMat = track(new THREE.MeshBasicMaterial({ color: 0xff4b5c }));
  const beacon = new THREE.Mesh(track(new THREE.SphereGeometry(0.7, 10, 8)), beaconMat);
  beacon.position.set(TOWER.x, TOWER.h + 21.2, TOWER.z);
  group.add(shaft, cab, cap, mast, beacon);
  const beaconGlow = lightPoints([[TOWER.x, TOWER.h + 21.2, TOWER.z]], 0xff4b5c, 26);
  beaconGlow.userData.delay = 0;
  group.add(beaconGlow);
  disposables.push(beaconGlow.geometry, beaconGlow.material);

  // ---------------- hangar (environment)
  const hangar = new THREE.Mesh(track(new THREE.CylinderGeometry(26, 26, 70, 20, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2)), towerMat);
  hangar.position.set(-300, 0, 162);
  hangar.scale.set(1, 0.8, 1);
  hangar.castShadow = true;
  group.add(hangar);

  // ---------------- apron flood lights: poles + soft light pools
  const poolTex = (() => {
    const c = document.createElement("canvas"); c.width = c.height = 128;
    const g = c.getContext("2d"); const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, "rgba(255,226,170,0.55)"); grd.addColorStop(0.5, "rgba(255,226,170,0.16)"); grd.addColorStop(1, "rgba(255,226,170,0)");
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  disposables.push(poolTex);
  const poolMat = track(new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
  const poolGeo = track(new THREE.PlaneGeometry(70, 70).rotateX(-Math.PI / 2));
  const poleGeo = track(new THREE.CylinderGeometry(0.4, 0.5, 24, 6));
  const lampPts = [];
  for (const x of [-180, -120, -60, 0, 60, 120, 180]) {
    const pole = new THREE.Mesh(poleGeo, towerMat);
    pole.position.set(x, 12, ROAD.z + 6);
    const pool = new THREE.Mesh(poolGeo, poolMat);
    pool.position.set(x, 0.2, 4);
    group.add(pole, pool);
    lampPts.push([x, 24.5, ROAD.z + 6]);
  }
  add(lampPts, 0xffe2aa, 12, 1.2);

  // ---------------- lighting rig
  const hemi = new THREE.HemisphereLight(0x5a7fae, 0x0b1320, 1.35);
  group.add(hemi);
  const moon = new THREE.DirectionalLight(0xbcd6ff, 1.6);
  moon.position.set(-260, 420, 260);
  moon.target.position.set(0, 0, -30);
  group.add(moon, moon.target);
  const fill = new THREE.DirectionalLight(0xffc98a, 0.35);
  fill.position.set(300, 120, 300);
  group.add(fill);

  function configureShadows(q) {
    moon.castShadow = q !== "performance";
    const size = q === "high" ? 4096 : 2048;
    moon.shadow.mapSize.set(size, size);
    const cam = moon.shadow.camera;
    cam.left = -380; cam.right = 380; cam.top = 260; cam.bottom = -260; cam.near = 50; cam.far = 1200;
    cam.updateProjectionMatrix();
    moon.shadow.bias = -0.0006;
    moon.shadow.normalBias = 0.6;
    moon.shadow.map?.dispose();
    moon.shadow.map = null;
  }
  configureShadows(quality);

  // ---------------- runtime API
  let level = 0, levelTarget = 1, clock = 0;
  const api = {
    group,
    gates,
    lightGroups,
    setLightLevel(k, instant = false) { levelTarget = k; if (instant) level = k; },
    configureShadows,
    setGateStatus(id, status, color, pulse) {
      const gt = gates.get(id);
      if (!gt) return;
      gt.status = status;
      gt.color.set(color);
      gt.pulse = pulse;
    },
    setBridgeTarget(id, k) { const gt = gates.get(id); if (gt) gt.target = k; },
    update(dt, reduced) {
      clock += dt;
      level += (levelTarget - level) * Math.min(1, dt * 0.9);
      for (const p of lightGroups) {
        const k = Math.min(1, Math.max(0, (level * 1.6 - p.userData.delay * 0.55)));
        p.material.opacity = k;
      }
      poolMat.opacity = Math.min(1, Math.max(0, level * 1.5 - 0.6));
      glassFront.emissiveIntensity = 0.15 + 0.85 * level;
      glassSide.emissiveIntensity = 0.1 + 0.5 * level;
      cabGlass.emissiveIntensity = 0.15 + 0.5 * level;
      // aerodrome beacon: slow, soft blink
      const b = reduced ? 0.8 : 0.35 + 0.65 * Math.max(0, Math.sin(clock * 2.2));
      beaconMat.color.setRGB(1 * b, 0.29 * b, 0.36 * b);
      beaconGlow.material.opacity = b * level;
      // rabbit: a light pulse running towards the threshold every 2 s
      const n = rabbitAlpha.length;
      const ph = (clock % 2.0) / 0.9;
      for (let i = 0; i < n; i++) rabbitAlpha[i] = reduced ? 0 : Math.max(0, 1 - Math.abs(ph * n - i) * 0.9) * level;
      rabbit.geometry.attributes.alpha.needsUpdate = true;
      rabbit.material.opacity = level;
      // stands and bridges
      for (const gt of gates.values()) {
        gt.frame.material.color.copy(gt.color);
        gt.pad.material.color.copy(gt.color);
        const pulse = gt.pulse && !reduced ? 0.5 + 0.5 * Math.sin(clock * 3.2) : 0.6;
        gt.frame.material.opacity = gt.status === "closed" ? 0.12 : gt.status === "free" ? 0.32 : 0.55 + 0.4 * pulse;
        gt.pad.material.opacity = gt.status === "free" || gt.status === "closed" ? 0 : 0.05 + 0.06 * pulse;
        if (Math.abs(gt.ext - gt.target) > 0.001) {
          gt.ext += Math.sign(gt.target - gt.ext) * Math.min(Math.abs(gt.target - gt.ext), dt * (reduced ? 10 : 0.42));
          setBridge(gt, EASE_BRIDGE(gt.ext));
        }
      }
    },
    dispose() {
      for (const d of disposables) d.dispose?.();
      airTex.dispose();
    },
  };
  return api;
}

const EASE_BRIDGE = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
