// layout.js - the airport's geometry (world units ~ metres; x east, z south, y up) and route builders.
// Routes only decide HOW an aircraft travels between two stations; WHICH station it must reach always
// comes from the engine snapshot (model.flightStation).
import * as THREE from "three";
import { airPath, groundPath, loopPath } from "./paths.js";

export const RWY = { z: -150, x0: -340, x1: 340, width: 32, touchdown: -262, exitX: 60 };
export const TWY = { z: -95, x0: -320, x1: 320 };
export const LANE = { z: -40, x0: -300, x1: 300 };
export const CONNECTORS = [-215, 30, 215];          // taxiway <-> apron taxilane
export const ROAD = { z: 28 };                      // head-of-stand service road
export const BELT = { z: 39 };                      // baggage belt road (disk cylinders)
export const TERMINAL = { x0: -196, x1: 196, z0: 50, z1: 92, h: 15 };
export const TOWER = { x: 228, z: 108, h: 62 };
export const DEPOT = { x: 238, z: 6 };
export const REMOTE_LANE_X = -207;
export const arrivesByAirOp = (op) => op === "TURNAROUND" || op === "ARRIVAL";

export const gateX = (index) => -150 + 60 * index;            // G1..G6
export const gateIndex = (id) => Number(String(id).slice(1)) - 1;
export const beltX = (p) => -150 + 7.5 * (p - 5);             // belt position 5,13,...,45 lines up with G1..G6
export const STAND_Z = 0;

// Remote stands for flights on the ground without a gate (heading east, 3 x 4 grid).
const REMOTE = [];
for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) REMOTE.push({ x: -238 - c * 45, z: -14 + r * 40 });
export const remoteSlot = (i) => REMOTE[i % REMOTE.length];
export const REMOTE_COUNT = REMOTE.length;

// Holding stack: a racetrack north-west of the threshold; one altitude level per waiting aircraft.
export const HOLD = { cx: -600, cz: -330, half: 90, r: 58, base: 70, step: 15 };
export function holdLoop(level) {
  const y = HOLD.base + HOLD.step * level;
  const pts = [];
  const n = 10;
  for (let i = 0; i <= n; i++) { const a = -Math.PI / 2 + (Math.PI * i) / n; pts.push([HOLD.cx + HOLD.half + HOLD.r * Math.cos(a), y, HOLD.cz + HOLD.r * Math.sin(a)]); }
  for (let i = 0; i <= n; i++) { const a = Math.PI / 2 + (Math.PI * i) / n; pts.push([HOLD.cx - HOLD.half + HOLD.r * Math.cos(a), y, HOLD.cz + HOLD.r * Math.sin(a)]); }
  return loopPath(pts);
}

export const ENTRY = new THREE.Vector3(-1050, 150, -420);   // where inbound aircraft appear (far, high)
export const EXIT_AIR = new THREE.Vector3(780, 170, -150);  // where departures fade out

// --------------------------------------------------------------- aircraft routes
// A move: { path, dur (s), ease, reverse, air, fadeIn, fadeOut, needsTug, loop }

const v = (x, y, z) => new THREE.Vector3(x, y, z);
const speedDur = (path, speed, min, max) => Math.min(max, Math.max(min, path.length / speed));

export function moveToHold(from, level) {
  const loop = holdLoop(level);
  const join = loop.pts[0];
  const path = airPath([from.clone(), v((from.x + join.x) / 2, (from.y + join.y) / 2 + 10, (from.z + join.z) / 2 + 30), join.clone()]);
  return [
    { path, dur: speedDur(path, 95, 3, 6), ease: "soft", air: true },
    { path: loop, dur: loop.length / 45, loop: true, air: true },
  ];
}

export function moveFinal(from) {
  const path = airPath([
    from.clone(),
    v(Math.min(from.x + 80, -700), Math.max(from.y - 5, 75), (from.z + RWY.z) / 2 - 40),
    v(-720, 62, RWY.z),
    v(-480, 26, RWY.z),
    v(RWY.touchdown, 0.4, RWY.z),
  ]);
  return [{ path, dur: speedDur(path, 120, 3.5, 6.5), ease: "soft", air: true }];
}

export function moveRoll() {
  const path = groundPath([[RWY.touchdown, RWY.z], [RWY.exitX - 28, RWY.z]]);
  return [{ path, dur: 3.2, ease: "out" }];
}

function connectorFor(x0, gx) {
  let best = CONNECTORS[0], cost = Infinity;
  for (const c of CONNECTORS) { const k = Math.abs(x0 - c) + Math.abs(c - gx); if (k < cost) { cost = k; best = c; } }
  return best;
}

export function moveTaxiIn(gateId) {
  const gx = gateX(gateIndex(gateId));
  const cx = connectorFor(RWY.exitX, gx);
  const path = groundPath([[RWY.exitX - 28, RWY.z], [RWY.exitX, RWY.z], [RWY.exitX, TWY.z], [cx, TWY.z], [cx, LANE.z], [gx, LANE.z], [gx, STAND_Z]], 16);
  return [{ path, dur: speedDur(path, 38, 3, 7), ease: "inOut" }];
}

export function moveRemoteToStand(slot, gateId) {
  const gx = gateX(gateIndex(gateId));
  const path = groundPath([[slot.x, slot.z], [REMOTE_LANE_X, slot.z], [REMOTE_LANE_X, LANE.z], [gx, LANE.z], [gx, STAND_Z]], 14);
  return [{ path, dur: speedDur(path, 22, 4, 10), ease: "inOut" }];
}

// Pushback: the aircraft rolls BACKWARDS off the stand onto the taxilane, ending nose-west.
export function pushbackPath(gateId) {
  const gx = gateX(gateIndex(gateId));
  return groundPath([[gx, STAND_Z], [gx, LANE.z + 6], [gx + 26, LANE.z]], 12);
}
export function movePush(gateId, tug) {
  const path = pushbackPath(gateId);
  return [{ path, dur: 4, ease: "inOut", reverse: true, needsTug: tug || null }];
}

export function moveTaxiOutFrom(start) {
  const path = groundPath([[start.x, start.z], [Math.min(start.x - 20, CONNECTORS[0] + 10), LANE.z], [CONNECTORS[0], LANE.z], [CONNECTORS[0], TWY.z], [-322, TWY.z], [-322, RWY.z], [-300, RWY.z]], 16);
  return { path, dur: speedDur(path, 40, 4, 9), ease: "inOut" };
}

export function moveTakeoff() {
  const roll = groundPath([[-300, RWY.z], [90, RWY.z]]);
  const climb = airPath([v(90, 0.4, RWY.z), v(240, 22, RWY.z), v(480, 85, RWY.z - 10), EXIT_AIR.clone()]);
  return [
    { path: roll, dur: 5.2, ease: "in2" },
    { path: climb, dur: 5.5, ease: "linear", air: true, fadeOut: true },
  ];
}

export function moveRemoteToRunway(slot) {
  const path = groundPath([[slot.x, slot.z], [REMOTE_LANE_X, slot.z], [REMOTE_LANE_X, LANE.z], [CONNECTORS[0], LANE.z], [CONNECTORS[0], TWY.z], [-322, TWY.z], [-322, RWY.z], [-300, RWY.z]], 14);
  return { path, dur: speedDur(path, 26, 5, 12), ease: "inOut" };
}

export function moveStandToRemote(gateId, slot) {
  const push = pushbackPath(gateId);
  const end = push.end;
  const taxi = groundPath([[end.x, end.z], [REMOTE_LANE_X, LANE.z], [REMOTE_LANE_X, slot.z], [slot.x, slot.z]], 14);
  return [{ path: push, dur: 4, ease: "inOut", reverse: true }, { path: taxi, dur: speedDur(taxi, 22, 4, 10), ease: "inOut" }];
}

export const standPose = (gateId) => ({ pos: v(gateX(gateIndex(gateId)), 0, STAND_Z), dir: v(0, 0, 1) });
export const remotePose = (slot) => ({ pos: v(slot.x, 0, slot.z), dir: v(1, 0, 0) });

// --------------------------------------------------------------- vehicle helpers
export function vehiclePath(from, to, toDir) {
  const pts = [[from.x, from.z]];
  const remote = to.x < REMOTE_LANE_X + 5 || from.x < REMOTE_LANE_X + 5;
  pts.push([from.x, ROAD.z]);
  if (remote) {
    if (from.x < REMOTE_LANE_X + 5) { pts.length = 1; pts.push([REMOTE_LANE_X, from.z], [REMOTE_LANE_X, ROAD.z]); }
    if (to.x < REMOTE_LANE_X + 5) { pts.push([REMOTE_LANE_X, ROAD.z], [REMOTE_LANE_X, to.z]); }
    else pts.push([to.x, ROAD.z]);
  } else {
    pts.push([to.x, ROAD.z]);
  }
  // final approach to the service point along its own heading
  if (toDir) pts.push([to.x - toDir.x * 8, to.z - toDir.z * 8]);
  pts.push([to.x, to.z]);
  return groundPath(pts, 7, 0);
}
