// sound.js - optional, subtle audio cues synthesised with Web Audio (no files). Off by default.
import { onEvents } from "./journal.js";
import { settings } from "./state.js";

let ctx = null;
let master = null;

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.18;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

function tone(freqs, { dur = 0.35, type = "sine", gain = 0.5, gap = 0.09 } = {}) {
  const ac = audio();
  if (!ac) return;
  freqs.forEach((f, i) => {
    const t0 = ac.currentTime + i * gap;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  });
}

const CUES = {
  FLIGHT_ADMITTED: () => tone([660, 880], { dur: 0.3, gain: 0.25 }),
  RES_GRANTED: (d) => (/^G/.test(d.resource) ? tone([523, 784], { dur: 0.28, gain: 0.22 }) : null),
  DEADLOCK_DETECTED: () => tone([220, 185], { dur: 0.6, type: "triangle", gain: 0.35, gap: 0.22 }),
  RECOVERED: () => tone([392, 523, 659], { dur: 0.35, gain: 0.25 }),
  FLIGHT_TERMINATED: (d) => (d.status === "DONE" ? tone([784, 1046], { dur: 0.3, gain: 0.18 }) : null),
};

export function initSound() {
  let last = 0;
  onEvents((fresh) => {
    if (!settings.sound || fresh.length > 30) return;
    const now = performance.now();
    for (const e of fresh) {
      const cue = CUES[e.kind];
      if (!cue || now - last < 350) continue; // never more than ~3 cues per second
      last = now;
      cue(e.data);
    }
  });
  settings.on((_, patch) => { if (patch.sound) tone([660, 990], { dur: 0.25, gain: 0.2 }); });
}
