// timeline.js - the slim live event strip at the bottom and the expandable full event log.
// Both list real engine events from the journal (deduplicated, in order).
import { category, journal, onEvents } from "../core/journal.js";
import { CATEGORY_LABEL, describe } from "../core/plain.js";
import { store } from "../store.js";
import { selection } from "../core/state.js";
import { esc, ICONS, setHTML } from "../ui.js";

const FILTERS = [["all", "All"], ["cpu", "Scheduling"], ["res", "Resources"], ["svc", "Services"], ["dead", "Deadlock"], ["mem", "Memory"], ["disk", "Disk / IPC"]];
const QUIET = new Set(["PAGE_FAULT"]); // very frequent; kept in the log, left out of the strip

export function initTimeline() {
  const strip = document.getElementById("timeline");
  const panel = document.getElementById("log-panel");
  strip.innerHTML = `<span class="tl-label">${ICONS.log.replace("<svg", '<svg width="14" height="14"')}Live</span><div class="tl-track" id="tl-track"></div>
    <button class="btn small ghost" id="tl-open" title="Open the full event log">Event log ${ICONS.expand.replace("<svg", '<svg width="13" height="13"')}</button>`;
  panel.innerHTML = `<div class="drawer-head"><div><div class="title-md">Event log</div><div class="tiny muted" id="log-count"></div></div><span class="spacer"></span>
    <div class="seg" id="log-filter">${FILTERS.map(([k, l], i) => `<button data-f="${k}" class="${i ? "" : "on"}">${l}</button>`).join("")}</div>
    <button class="btn small icon ghost" id="log-close" aria-label="Close">${ICONS.close}</button></div><div class="log-list" id="log-list"></div>`;
  let filter = "all";
  let open = false;
  const track = document.getElementById("tl-track");
  const list = document.getElementById("log-list");

  document.getElementById("tl-open").onclick = () => { open = !open; panel.classList.toggle("open", open); renderLog(); };
  document.getElementById("log-close").onclick = () => { open = false; panel.classList.remove("open"); };
  document.getElementById("log-filter").onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    filter = b.dataset.f;
    document.querySelectorAll("#log-filter button").forEach((x) => x.classList.toggle("on", x === b));
    renderLog();
  };
  const pickFlight = (e) => {
    const n = e.target.closest("[data-spid]");
    if (n) selection.set("flight", Number(n.dataset.spid));
  };
  track.addEventListener("click", pickFlight);
  list.addEventListener("click", pickFlight);

  function chipHtml(e) {
    const spid = e.data.spid > 0 ? e.data.spid : "";
    return `<span class="tl-ev c-${category(e.kind)}" ${spid ? `data-spid="${spid}" style="cursor:pointer"` : ""} title="tick ${e.tick}"><span class="ic"></span><span class="t">t${e.tick}</span>${esc(describe(e, store.snap))}</span>`;
  }

  function renderStrip(fresh, reset) {
    if (reset) track.innerHTML = "";
    const add = fresh.filter((e) => !QUIET.has(e.kind)).slice(-6);
    for (const e of add) track.insertAdjacentHTML("afterbegin", chipHtml(e));
    while (track.children.length > 18) track.lastElementChild.remove();
    if (!track.children.length) track.innerHTML = `<span class="tiny muted">Waiting for engine events. Press Run, or load a scenario.</span>`;
  }

  function renderLog() {
    if (!open) return;
    const evs = journal.events.filter((e) => filter === "all" || category(e.kind) === filter).slice(-400).reverse();
    document.getElementById("log-count").textContent = `${journal.events.length} events this epoch${journal.gaps ? ` · ${journal.gaps} burst(s) faster than the stream (see snapshot totals)` : ""}`;
    setHTML(list, evs.length ? evs.map((e) => `<div class="log-item c-${category(e.kind)}" ${e.data.spid > 0 ? `data-spid="${e.data.spid}" style="cursor:pointer"` : ""}>
      <span class="t">t${e.tick}</span><span class="k" title="${esc(e.kind)}">${esc(CATEGORY_LABEL[category(e.kind)])}</span><span class="m">${esc(describe(e, store.snap))}</span></div>`).join("")
      : `<div class="empty">No events${filter === "all" ? "" : " in this category"} yet.</div>`);
  }

  onEvents((fresh, { reset }) => {
    renderStrip(fresh, reset);
    renderLog();
  });
  renderStrip([], true);
}
