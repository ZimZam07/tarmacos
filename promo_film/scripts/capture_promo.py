"""capture_promo.py - records the REAL TarmacOS dashboard for the promo film.

Usage:  python capture_promo.py          (a private instance must run at TARMAC_URL, default http://127.0.0.1:8091)

Reuses tutorial_video/scripts/cdp.py unchanged (imported, not copied or edited).
Screenshots are taken at deviceScaleFactor 2 (3840x2160) so crops stay sharp in a 1080-wide frame.
Every value the film quotes is read back from the page and written to captures/_capture_log.json.
"""
import json
import os
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
FILM = os.path.dirname(HERE)                                     # promo_film/
PROJECT = os.path.dirname(FILM)                                  # tarmacos/
sys.path.insert(0, os.path.join(PROJECT, "tutorial_video", "scripts"))
from cdp import Browser  # noqa: E402

APP_URL = os.environ.get("TARMAC_URL", "http://127.0.0.1:8091")
OUT = os.path.join(FILM, "assets", "captures")
W, H, DPR = 1920, 1080, 2

# Elements whose rectangles (CSS px) the compositions crop to. The card around each element is recorded too.
KEYS = {
    "ov_map": "#ov-map", "ov_kpis": "#ov-kpis", "ov_now": "#ov-now",
    "dl_banner": "#dl-banner", "dl_graph": "#dl-graph", "dl_log": "#dl-log", "dl_banker": "#dl-banker", "dl_matrices": "#dl-matrices",
    "sc_gantt": "#sc-gantt", "sc_metrics": "#sc-metrics",
    "dk_chart": "#dk-chart", "dk_ipc": "#dk-ipc", "dk_sum": "#dk-sum",
    "term_out": "#term-out", "log": "#log", "clock": "#clock",
}

log = []


def api(line):
    req = urllib.request.Request(APP_URL + "/api/cmd", data=json.dumps({"line": line}).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as r:
        resp = json.loads(r.read())
    if not resp.get("ok"):
        raise RuntimeError("engine command failed: %s -> %s" % (line, resp.get("error")))
    return resp


def text(b, selector, limit=2000):
    return b.eval("(() => { const e = document.querySelector(%s); return e ? e.innerText.slice(0, %d) : null; })()"
                  % (json.dumps(selector), limit))


def record(b, label, values):
    entry = {"label": label}
    entry.update(values)
    log.append(entry)
    print("  eval %-14s %s" % (label, json.dumps(values)[:220]))


def shot(b, name):
    time.sleep(0.5)
    rects = {}
    for key, sel in KEYS.items():
        r = b.eval("""(() => { const e = document.querySelector(%s); if (!e || !e.offsetParent) return null;
                      const c = e.closest('.card') || e; const a = e.getBoundingClientRect(), k = c.getBoundingClientRect();
                      return {el: [a.left, a.top, a.right, a.bottom], card: [k.left, k.top, k.right, k.bottom]}; })()""" % json.dumps(sel))
        if r:
            rects[key] = r
    b.screenshot(os.path.join(OUT, name + ".png"))
    with open(os.path.join(OUT, name + ".json"), "w") as f:
        json.dump({"dpr": DPR, "viewport": [W, H], "clock": text(b, "#clock"), "rects": rects}, f)
    print("  shot", name)


def nav(b, view):
    b.eval("location.hash = %s" % json.dumps(view))
    time.sleep(1.4)
    b.eval("document.getElementById('main').scrollTop = 0")
    time.sleep(0.2)


def main():
    os.makedirs(OUT, exist_ok=True)
    b = Browser(W, H)
    b.call("Emulation.setDeviceMetricsOverride", {"width": W, "height": H, "deviceScaleFactor": DPR, "mobile": False})
    try:
        b.nav(APP_URL + "/#overview")
        time.sleep(3)
        health = json.load(urllib.request.urlopen(APP_URL + "/api/health", timeout=10))
        record(b, "health", {"health": health})

        # S4: busy apron, one screenshot per tick (deterministic stepping)
        api("sim reset"); nav(b, "#overview")
        b.click('.scenario[data-i="1"]'); time.sleep(1.5)
        b.eval("document.getElementById('main').scrollTop = 0"); time.sleep(0.3)
        shot(b, "busy_t00")
        record(b, "busy_t00", {"now": text(b, "#ov-now"), "kpis": text(b, "#ov-kpis")})
        for t in range(1, 17):
            b.click("#btn-step"); time.sleep(0.9)
            shot(b, "busy_t%02d" % t)
            record(b, "busy_t%02d" % t, {"clock": text(b, "#clock"), "now": text(b, "#ov-now"), "map": text(b, "#ov-map", 600)})

        # S6: deadlock under DETECTION, every tick to t10
        api("sim reset"); nav(b, "#deadlocks")
        b.click('[data-p="DETECTION"]'); b.click("#dl-load"); time.sleep(1.5)
        shot(b, "det_t00")
        for t in range(1, 11):
            b.click("#dl-step"); time.sleep(0.9)
            shot(b, "det_t%02d" % t)
            record(b, "det_t%02d" % t, {"clock": text(b, "#clock"), "banner": text(b, "#dl-banner"), "graph": text(b, "#dl-graph", 400)})

        # S7a: RECOVERY (preempt) - t8, t9, end
        b.click('[data-p="RECOVERY"]')
        b.eval("(() => { const s = document.querySelector('#dl-action'); s.value = 'PREEMPT'; s.dispatchEvent(new Event('change', {bubbles: true})); })()")
        b.click("#dl-load"); time.sleep(1.5)
        for t in range(1, 10):
            b.click("#dl-step"); time.sleep(0.9)
            if t in (8, 9):
                shot(b, "rec_t%02d" % t)
                record(b, "rec_t%02d" % t, {"clock": text(b, "#clock"), "banner": text(b, "#dl-banner"), "rlog": text(b, "#dl-log")})
        b.click("#dl-end"); time.sleep(3)
        shot(b, "rec_end")
        record(b, "rec_end", {"clock": text(b, "#clock"), "banner": text(b, "#dl-banner"), "rlog": text(b, "#dl-log"),
                              "events": text(b, "#log", 3000)})

        # S7b: AVOIDANCE - t0..t3, end
        b.click('[data-p="AVOIDANCE"]'); b.click("#dl-load"); time.sleep(1.5)
        for t in range(1, 4):
            b.click("#dl-step"); time.sleep(0.9)
            shot(b, "avoid_t%02d" % t)
            record(b, "avoid_t%02d" % t, {"clock": text(b, "#clock"), "banner": text(b, "#dl-banner"), "banker": text(b, "#dl-banker"),
                                         "events": text(b, "#log", 1500)})
        b.click("#dl-end"); time.sleep(3)
        shot(b, "avoid_end")
        record(b, "avoid_end", {"clock": text(b, "#clock"), "banner": text(b, "#dl-banner"), "events": text(b, "#log", 3000)})

        # S8: Round Robin reference run
        api("sim reset"); nav(b, "#scheduler")
        b.click('[data-ref="RR"]'); time.sleep(1.5); b.click("#btn-finish"); time.sleep(3)
        shot(b, "rr_end")
        record(b, "rr_end", {"clock": text(b, "#clock"), "avg": text(b, "#sc-metrics tfoot"), "metrics": text(b, "#sc-metrics")})

        # S9: baggage cart SCAN up, planned by the child process
        api("sim reset"); nav(b, "#storage")
        b.click('[data-ref="SCAN dir=UP"]'); time.sleep(1.5); b.click("#btn-finish"); time.sleep(3)
        shot(b, "scan_end")
        record(b, "scan_end", {"sum": text(b, "#dk-sum"), "ipc": text(b, "#dk-ipc"), "chart": text(b, "#dk-chart", 600)})

        # S9: Ops terminal - real ps output
        nav(b, "#terminal")
        b.type_text("#term-input", "clear"); b.eval("document.getElementById('term-form').requestSubmit(); 'sent'"); time.sleep(0.6)
        b.click('[data-sys="children"]'); time.sleep(2.5)
        b.click('[data-sys="threads"]'); time.sleep(2.5)
        shot(b, "term_sys")
        record(b, "term_sys", {"out": text(b, "#term-out", 3000)})
        b.type_text("#term-input", "clear"); b.eval("document.getElementById('term-form').requestSubmit(); 'sent'"); time.sleep(0.5)
        api("sim reset")
    finally:
        b.close()
        with open(os.path.join(OUT, "_capture_log.json"), "w") as f:
            json.dump(log, f, indent=1)


def extra():
    """Supplementary captures: FCFS/Priority reference averages, and real threads while flights are running."""
    global log
    path = os.path.join(OUT, "_capture_log.json")
    with open(path, encoding="utf-8") as f:
        log = json.load(f)
    b = Browser(W, H)
    b.call("Emulation.setDeviceMetricsOverride", {"width": W, "height": H, "deviceScaleFactor": DPR, "mobile": False})
    try:
        b.nav(APP_URL + "/#overview")
        time.sleep(3)
        for ref, name in (("FCFS", "fcfs_end"), ("PRIORITY", "prio_end")):
            api("sim reset"); nav(b, "#scheduler")
            b.click('[data-ref="%s"]' % ref); time.sleep(1.5); b.click("#btn-finish"); time.sleep(3)
            shot(b, name)
            record(b, name, {"clock": text(b, "#clock"), "avg": text(b, "#sc-metrics tfoot")})
        # busy apron paused mid-run, then the kernel's view of the engine's threads
        api("sim reset"); nav(b, "#overview")
        b.click('.scenario[data-i="1"]'); time.sleep(1.5)
        for _ in range(12):
            b.click("#btn-step"); time.sleep(0.8)
        nav(b, "#terminal")
        b.type_text("#term-input", "clear"); b.eval("document.getElementById('term-form').requestSubmit(); 'sent'"); time.sleep(0.6)
        b.click('[data-sys="children"]'); time.sleep(2.5)
        b.click('[data-sys="threads"]'); time.sleep(2.5)
        shot(b, "term_busy")
        record(b, "term_busy", {"clock": text(b, "#clock"), "out": text(b, "#term-out", 4000)})
        b.type_text("#term-input", "clear"); b.eval("document.getElementById('term-form').requestSubmit(); 'sent'"); time.sleep(0.5)
        api("sim reset")
    finally:
        b.close()
        with open(path, "w", encoding="utf-8") as f:
            json.dump(log, f, indent=1)


if __name__ == "__main__":
    extra() if sys.argv[1:] == ["extra"] else main()
