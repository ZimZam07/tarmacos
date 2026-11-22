"""render_frames.py - renders frames of scenes/film.html with headless Chrome.

Usage:
  python render_frames.py stills OUT_DIR t1 t2 ...          one PNG per time (seconds)
  python render_frames.py seq OUT_DIR START END FPS [SCALE]   numbered PNG sequence (SCALE 0.5 = half resolution)

The page is served from promo_film/ by a temporary HTTP server on 127.0.0.1 that lives only as long as this script.
Each frame: render(t) -> wait two animation frames -> Page.captureScreenshot. No device frame, no browser chrome.
"""
import base64
import functools
import http.server
import json
import os
import sys
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
FILM = os.path.dirname(HERE)
PROJECT = os.path.dirname(FILM)
sys.path.insert(0, os.path.join(PROJECT, "tutorial_video", "scripts"))
from cdp import Browser  # noqa: E402

W, H = 1080, 1350


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def serve():
    handler = functools.partial(Quiet, directory=FILM)
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def open_film(scale=1.0):
    server = serve()
    b = Browser(W, H)
    b.call("Emulation.setDeviceMetricsOverride", {"width": W, "height": H, "deviceScaleFactor": scale, "mobile": False})
    b.nav("http://127.0.0.1:%d/scenes/film.html" % server.server_address[1])
    for _ in range(100):
        try:
            if b.eval("window.READY ? window.READY.then(() => true) : false"):
                break
        except RuntimeError:
            pass
        time.sleep(0.2)
    else:
        raise RuntimeError("film page did not become ready")
    return server, b


def frame(b, t, path):
    b.eval("window.render(%r); new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))" % float(t))
    data = b.call("Page.captureScreenshot", {"format": "png", "captureBeyondViewport": False})["data"]
    with open(path, "wb") as f:
        f.write(base64.b64decode(data))


def main():
    mode, out = sys.argv[1], sys.argv[2]
    os.makedirs(out, exist_ok=True)
    scale = float(sys.argv[6]) if mode == "seq" and len(sys.argv) > 6 else 1.0
    server, b = open_film(scale)
    try:
        if mode == "stills":
            for i, t in enumerate(sys.argv[3:], 1):
                path = os.path.join(out, "frame_%02d_t%05.2f.png" % (i, float(t)))
                frame(b, t, path)
                print("  frame", path)
        elif mode == "seq":
            start, end, fps = float(sys.argv[3]), float(sys.argv[4]), float(sys.argv[5])
            n = int(round((end - start) * fps))
            t0 = time.time()
            for i in range(n):
                path = os.path.join(out, "%05d.png" % i)
                if os.path.exists(path):        # resume: frames are deterministic, keep the ones already rendered
                    continue
                frame(b, start + i / fps, path)
                if i % 60 == 0:
                    print("  %d/%d  %.1fs" % (i, n, time.time() - t0), flush=True)
        errors = b.eval("JSON.stringify(window.__errors || [])")
        if errors and errors != "[]":
            print("page errors:", errors)
    finally:
        b.close()
        server.shutdown()


if __name__ == "__main__":
    main()
