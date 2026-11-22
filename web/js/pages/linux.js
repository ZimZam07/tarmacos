// linux.js - Linux & IPC: the Ops terminal (engine protocol + fixed real-Linux inspections).
import { command, sys } from "../api.js";
import { badge, esc, REAL, setHTML } from "../ui.js";
import { pageHead } from "./common.js";

const SYS = ["threads", "children", "fds", "ps"];
const lines = [];
const history = [];
let historyPos = 0;
const WELCOME = [
  ["src", "TarmacOS Ops Terminal"],
  ["ok", "Engine commands go to the C++ engine (try: help, state, flight create AI204 TURNAROUND 2, sched set RR q=2)."],
  ["ok", "Real Linux inspections run against the engine process with fixed arguments (no shell):"],
  ["real", "  sys threads    ps -T: every pthread of the engine (compare TIDs with Threads & Sync)"],
  ["real", "  sys children   ps --ppid: the baggage-handler child process"],
  ["real", "  sys fds        ls -l /proc/PID/fd: the pipe file descriptors"],
  ["real", "  sys ps         ps: process summary (NLWP = number of threads)"],
  ["ok", "Local: clear"],
];

function print(kind, text) {
  lines.push([kind, text]);
  if (lines.length > 400) lines.splice(0, lines.length - 400);
  const out = document.getElementById("term-out");
  if (out) { out.insertAdjacentHTML("beforeend", `<div class="${kind}">${esc(text)}</div>`); out.scrollTop = out.scrollHeight; }
}

let queue = Promise.resolve();
const execute = (line) => (queue = queue.then(() => executeNow(line)));
async function executeNow(line) {
  print("prompt", "ops> " + line);
  const words = line.trim().split(/\s+/);
  if (words[0] === "clear") { lines.length = 0; document.getElementById("term-out").innerHTML = ""; return; }
  if (words[0] === "sys" && SYS.includes(words[1])) {
    const r = await sys(words[1]);
    if (!r.ok) return print("err", `${r.error.code}: ${r.error.msg}`);
    print("src", `[REAL LINUX] $ ${r.command}`);
    print("real", r.output.trimEnd());
    return;
  }
  const r = await command(line);
  print("src", "[ENGINE]");
  if (r.ok) print("ok", line.trim() === "state" ? `snapshot: tick ${r.result.tick}, epoch ${r.result.epoch}, ${r.result.flights.length} flights, ${r.result.threads.length} threads, policy ${r.result.deadlock.policy}, cpu ${r.result.cpu.algo}` : JSON.stringify(r.result, null, 2));
  else print("err", `${r.error.code}: ${r.error.msg}`);
}

export default {
  mount(root) {
    root.innerHTML = pageHead({
      kicker: "LINUX & IPC",
      title: "Proof in the kernel",
      text: "Two kinds of command, clearly labelled. <b>ENGINE</b> commands use the same text protocol as the dashboard. <b>REAL LINUX</b> commands run <code>ps</code> and <code>ls</code> on the engine's PID, showing that the threads, the child process and the pipes really exist. Arbitrary shell commands are deliberately not available.",
      annos: [REAL("ps -T, ps --ppid, /proc/PID/fd"), "<b>IPC</b>: fork() + 2 pipes + poll() + waitpid()"],
      right: SYS.map((s) => `<button class="btn small" data-sys="${s}">sys ${s}</button>`).join(""),
    }) + `<div class="grid side"><div class="term"><div class="term-out" id="term-out"></div>
        <form class="term-in" id="term-form"><span class="prompt">ops&gt;</span><input id="term-input" autocomplete="off" spellcheck="false" placeholder="type a command, e.g. sys threads" aria-label="command"></form></div>
      <div class="card"><div class="card-head"><span class="card-title">Engine ↔ child process</span></div><div id="lx-ipc"></div></div></div>`;
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
  },
  update(snap) {
    const ipc = snap.ipc;
    setHTML(document.getElementById("lx-ipc"), `<dl class="kv"><dt>Engine PID</dt><dd class="mono">${ipc.engine_pid}</dd><dt>Child PID</dt><dd class="mono">${ipc.child_pid} ${badge(ipc.status === "RUNNING" ? "real" : "err", ipc.status)}</dd>
      <dt>Request pipe (write)</dt><dd class="mono">fd ${ipc.request_fd}</dd><dt>Result pipe (read)</dt><dd class="mono">fd ${ipc.result_fd}</dd>
      <dt>Exchanges</dt><dd>${ipc.exchanges}</dd><dt>In flight</dt><dd>${ipc.in_flight ? "yes" : "no"}</dd><dt>Live threads</dt><dd>${snap.threads.length}</dd></dl>
      <div class="note" style="margin-top:12px;font-size:12px">The child survives a reset (it is stateless). On quit the engine sends <code>QUIT</code>, closes its write end, reads to EOF and reaps the child with <code>waitpid</code>, so no zombie is left.</div>`);
  },
};
