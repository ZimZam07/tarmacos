// terminal.js - Ops Terminal: engine commands plus a fixed set of real Linux inspections.
import { command, sys } from "../api.js";
import { badge, esc, REAL } from "../ui.js";

const ICON = `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2" y="3" width="16" height="14" rx="2"/><path d="M5 8l3 2-3 2M10 13h5"/></svg>`;
const SYS = ["threads", "children", "fds", "ps"];
const lines = [];
const history = [];
let historyPos = 0;

const WELCOME = [
  ["src", "TarmacOS Ops Terminal"],
  ["ok", "Engine commands are sent to the C++ engine (try: help, state, flight create AI101 TURNAROUND 2, sched set RR q=2)."],
  ["ok", "Real Linux inspections run on the engine process with fixed arguments (no shell):"],
  ["real", "  sys threads    ps -T: every pthread of the engine (compare TIDs with Threads & sync)"],
  ["real", "  sys children   ps --ppid: the baggage-handler child process"],
  ["real", "  sys fds        ls -l /proc/PID/fd: the pipe file descriptors"],
  ["real", "  sys ps         ps: process summary (NLWP = number of threads)"],
  ["ok", "Local: clear"],
];

function print(kind, text) {
  lines.push([kind, text]);
  if (lines.length > 400) lines.splice(0, lines.length - 400);
  const out = document.getElementById("term-out");
  if (out) {
    out.insertAdjacentHTML("beforeend", `<div class="${kind}">${esc(text)}</div>`);
    out.scrollTop = out.scrollHeight;
  }
}

function summarise(line, result) {
  if (line.trim() === "state") {
    return `snapshot: tick ${result.tick}, epoch ${result.epoch}, ${result.flights.length} flights, ${result.threads.length} threads, policy ${result.deadlock.policy}, cpu ${result.cpu.algo}`;
  }
  return JSON.stringify(result, null, 2);
}

// Commands run strictly one after another so their output never interleaves.
let queue = Promise.resolve();
function execute(line) {
  queue = queue.then(() => executeNow(line));
  return queue;
}

async function executeNow(line) {
  print("prompt", "ops> " + line);
  const words = line.trim().split(/\s+/);
  if (words[0] === "clear") {
    lines.length = 0;
    document.getElementById("term-out").innerHTML = "";
    return;
  }
  if (words[0] === "sys" && SYS.includes(words[1])) {
    const r = await sys(words[1]);
    if (!r.ok) return print("err", `${r.error.code}: ${r.error.msg}`);
    print("src", `[REAL LINUX] $ ${r.command}`);
    print("real", r.output.trimEnd());
    return;
  }
  const r = await command(line);
  print("src", "[ENGINE]");
  if (r.ok) print("ok", summarise(line, r.result));
  else print("err", `${r.error.code}: ${r.error.msg}`);
}

export default {
  id: "terminal",
  label: "Ops terminal",
  icon: ICON,
  concept: {
    title: "Linux operations console (Lab M1)",
    text: "Two kinds of command, clearly labelled. <b>ENGINE</b> commands are the same text protocol that the dashboard and the shell scripts use. <b>REAL LINUX</b> commands run ps and ls against the engine's real PID, proving that the threads, the child process and the pipes exist in the kernel.",
    tags: [REAL("ps -T, ps --ppid, /proc/PID/fd"), badge("", "Lab M1 · Unix commands")],
  },
  mount(root) {
    root.innerHTML = `
      <div class="view-head"><div><h1 class="view-title">Ops terminal</h1>
        <div class="view-sub">Engine protocol and real process inspection. Arbitrary shell commands are deliberately not available.</div></div>
        <div class="row">${SYS.map((s) => `<button class="btn small" data-sys="${s}">sys ${s}</button>`).join("")}</div></div>
      <div class="term"><div class="term-out" id="term-out"></div>
        <form class="term-in" id="term-form"><span class="prompt">ops&gt;</span><input id="term-input" autocomplete="off" spellcheck="false" placeholder="type a command, e.g. sys threads" aria-label="command"></form></div>`;
    const out = root.querySelector("#term-out");
    if (!lines.length) WELCOME.forEach(([k, t]) => lines.push([k, t]));
    out.innerHTML = lines.map(([k, t]) => `<div class="${k}">${esc(t)}</div>`).join("");
    out.scrollTop = out.scrollHeight;
    const input = root.querySelector("#term-input");
    root.querySelector("#term-form").onsubmit = (e) => {
      e.preventDefault();
      const line = input.value.trim();
      if (!line) return;
      history.push(line);
      historyPos = history.length;
      input.value = "";
      execute(line);
    };
    input.onkeydown = (e) => {
      if (e.key === "ArrowUp" && historyPos > 0) { input.value = history[--historyPos]; e.preventDefault(); }
      if (e.key === "ArrowDown") { historyPos = Math.min(history.length, historyPos + 1); input.value = history[historyPos] || ""; }
    };
    root.querySelectorAll("[data-sys]").forEach((b) => (b.onclick = () => execute("sys " + b.dataset.sys)));
    setTimeout(() => input.focus(), 0);
  },
  update() {},
};
