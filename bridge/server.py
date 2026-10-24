"""TarmacOS bridge - connects the browser dashboard to the C++ engine.

    browser --HTTP POST /api/cmd--> bridge --text line on stdin pipe--> tarmac_engine
    browser <--SSE /api/stream----- bridge <--JSON lines on stdout pipe-- tarmac_engine

The bridge contains NO simulation logic: it forwards command lines, matches
responses by id, and streams the engine's latest snapshot to every open
dashboard. Python standard library only (no packages to install).

Two modes:
  local  (default)        one engine, started at boot, shared by every tab - the lab setup.
  public (TARMAC_PUBLIC=1) one engine PER BROWSER SESSION (?sid=...), so visitors of a hosted
                          copy cannot reset or disturb each other. Sessions are capped, limited
                          per client IP, and idle sessions are stopped (threads joined, child reaped).

Run from the tarmacos directory:   python3 bridge/server.py [--port 8080] [--host 127.0.0.1]
Configuration for hosting is read from the environment - see docs/DEPLOYMENT.md.
"""
import argparse
import fnmatch
import json
import os
import queue
import re
import signal
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENGINE_PATH = os.path.join(ROOT, "engine", "build", "tarmac_engine")
WEB_DIR = os.path.join(ROOT, "web")
CONTENT_TYPES = {".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
                 ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".ico": "image/x-icon"}


def env_int(name, default):
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


PUBLIC = os.environ.get("TARMAC_PUBLIC") == "1"
MAX_SESSIONS = env_int("TARMAC_MAX_SESSIONS", 12)           # engines running at once
MAX_SESSIONS_PER_IP = env_int("TARMAC_MAX_SESSIONS_PER_IP", 4)
IDLE_DETACHED = env_int("TARMAC_IDLE_SECONDS", 600)          # stop when no dashboard is open this long
IDLE_ABANDONED = env_int("TARMAC_MAX_IDLE_SECONDS", 3600)    # stop when no command arrives this long
REAP_INTERVAL = env_int("TARMAC_REAP_INTERVAL", 15)          # seconds between idle checks
RATE_LIMIT = env_int("TARMAC_RATE_LIMIT", 120)               # requests per client IP per 10 s
ALLOWED_ORIGINS = [o.strip().rstrip("/") for o in os.environ.get("TARMAC_ALLOWED_ORIGINS", "").split(",") if o.strip()]
TRUST_PROXY = os.environ.get("TARMAC_TRUST_PROXY", "1" if PUBLIC else "0") == "1"
SID_RE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
LOCAL_SID = "local"

# Fixed, argument-checked Linux commands for the Ops Terminal. They are run with
# an argv list (no shell), and the only variable part is the engine's own PID.
SYS_COMMANDS = {
    "threads": lambda pid: ["ps", "-T", "-o", "spid,stat,wchan:22,comm", "-p", str(pid)],
    "children": lambda pid: ["ps", "-o", "pid,ppid,stat,etime,cmd", "--ppid", str(pid)],
    "fds": lambda pid: ["ls", "-l", "/proc/%d/fd" % pid],
    "ps": lambda pid: ["ps", "-o", "pid,ppid,nlwp,stat,rss,etime,cmd", "-p", str(pid)],
}


def log(*parts):
    print(time.strftime("%Y-%m-%dT%H:%M:%S"), "bridge:", *parts, file=sys.stderr, flush=True)


def error(code, msg):
    return {"ok": False, "error": {"code": code, "msg": msg}}


class EngineProcess:
    """Owns one engine child process and the two pipes to it."""

    def __init__(self, sid=LOCAL_SID, owner_ip=None):
        self.sid = sid
        self.owner_ip = owner_ip
        self.lock = threading.Lock()
        self.proc = None
        self.pid = None
        self.child_pid = None
        self.online = False
        self.next_id = 0
        self.waiting = {}            # request id -> [threading.Event, response]
        self.latest_snapshot = None  # raw JSON text of the newest snapshot
        self.snapshot_version = 0
        self.listeners = set()       # one queue per SSE client
        self.last_error = ""
        self.last_command = time.time()
        self.last_seen = time.time()  # last command or open stream
        self.last_restart = 0.0

    def start(self):
        if not os.path.exists(ENGINE_PATH):
            self.last_error = ("engine binary not found" if PUBLIC
                               else "engine binary not found at %s (run: make -C engine)" % ENGINE_PATH)
            log(self.last_error)
            return False
        proc = subprocess.Popen([ENGINE_PATH], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                text=True, bufsize=1)
        with self.lock:
            self.proc = proc
            self.pid = proc.pid
            self.online = True
            self.latest_snapshot = None
        threading.Thread(target=self._read_loop, args=(proc,), daemon=True).start()
        self.broadcast_status()
        return True

    def _read_loop(self, proc):
        for line in proc.stdout:
            line = line.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                continue
            kind = msg.get("type")
            if kind == "resp":
                with self.lock:
                    slot = self.waiting.get(msg.get("id"))
                if slot:
                    slot[1] = msg
                    slot[0].set()
            elif kind == "snapshot":
                with self.lock:
                    self.latest_snapshot = line
                    self.snapshot_version += 1
                self.notify("snapshot")
            elif kind == "ready":
                self.child_pid = msg.get("child_pid")
                self.broadcast_status()  # dashboards learn the child's PID
        # EOF: the engine exited (crash, quit or kill).
        with self.lock:
            if self.proc is proc:
                self.online = False
            for slot in self.waiting.values():
                slot[0].set()
        code = proc.wait()
        if PUBLIC:
            log("session %s: engine PID %s exited with status %s" % (self.sid[:8], proc.pid, code))
        self.broadcast_status()

    def send(self, line, timeout):
        with self.lock:
            if not self.online:
                return None
            self.next_id += 1
            rid = "b%d" % self.next_id
            slot = [threading.Event(), None]
            self.waiting[rid] = slot
            proc = self.proc
            self.last_command = self.last_seen = time.time()
        try:
            proc.stdin.write("#%s %s\n" % (rid, line))
            proc.stdin.flush()
        except (BrokenPipeError, OSError):
            with self.lock:
                self.waiting.pop(rid, None)
            return None
        slot[0].wait(timeout)
        with self.lock:
            self.waiting.pop(rid, None)
        return slot[1] if slot[1] else ("timeout" if self.online else None)

    def stop(self):
        with self.lock:
            proc = self.proc
        if not proc or proc.poll() is not None:
            return
        try:
            proc.stdin.write("quit\n")
            proc.stdin.flush()
            proc.wait(3)
        except (BrokenPipeError, OSError, subprocess.TimeoutExpired):
            proc.terminate()
            try:
                proc.wait(2)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()

    def restart(self):
        self.stop()
        return self.start()

    # ---- server-sent events ----
    def status(self):
        return {"online": self.online, "engine_pid": self.pid if self.online else None,
                "child_pid": self.child_pid if self.online else None, "error": self.last_error}

    def status_json(self):
        return json.dumps(self.status())

    def notify(self, what):
        for q in list(self.listeners):
            try:
                q.put_nowait(what)
            except queue.Full:
                pass  # this client is still busy; it will pick up the latest snapshot anyway

    def broadcast_status(self):
        self.notify("status")


class SessionError(Exception):
    def __init__(self, code, msg, http=503):
        super().__init__(msg)
        self.code, self.msg, self.http = code, msg, http


class Sessions:
    """Local mode: one shared engine. Public mode: one engine per session id, with limits."""

    def __init__(self):
        self.lock = threading.Lock()
        self.engines = {}    # sid -> EngineProcess
        self.expired = {}    # sid -> time it was stopped for inactivity

    def get(self, sid):
        with self.lock:
            return self.engines.get(LOCAL_SID if not PUBLIC else sid)

    def get_or_create(self, sid, ip):
        if not PUBLIC:
            return self.engines[LOCAL_SID]
        with self.lock:
            eng = self.engines.get(sid)
            if eng:
                eng.last_seen = time.time()
                return eng
            if sid in self.expired:
                raise SessionError("E_SESSION_EXPIRED", "this simulation was stopped after a period of inactivity", 410)
            if len(self.engines) >= MAX_SESSIONS:
                raise SessionError("E_CAPACITY", "all %d simulation slots are in use; try again in a few minutes"
                                   % MAX_SESSIONS)
            if sum(1 for e in self.engines.values() if e.owner_ip == ip) >= MAX_SESSIONS_PER_IP:
                raise SessionError("E_CAPACITY", "too many simultaneous simulations from your network "
                                   "(close other TarmacOS tabs)", 429)
            eng = EngineProcess(sid, ip)
            if not eng.start():
                raise SessionError("E_ENGINE_OFFLINE", "the engine could not be started")
            self.engines[sid] = eng
            count = len(self.engines)
        log("session %s: started engine PID %s (%d/%d running)" % (sid[:8], eng.pid, count, MAX_SESSIONS))
        return eng

    def start_local(self):
        eng = EngineProcess()
        self.engines[LOCAL_SID] = eng
        return eng.start()

    def reap_forever(self):
        while True:
            time.sleep(REAP_INTERVAL)
            now = time.time()
            victims = []
            with self.lock:
                for sid, eng in list(self.engines.items()):
                    detached = not eng.listeners and now - eng.last_seen > IDLE_DETACHED
                    abandoned = now - eng.last_command > IDLE_ABANDONED
                    if detached or abandoned:
                        victims.append((sid, eng, "no dashboard open" if detached else "no commands"))
                        del self.engines[sid]
                        self.expired[sid] = now
                for sid, when in list(self.expired.items()):
                    if now - when > 86400:
                        del self.expired[sid]
            for sid, eng, why in victims:
                eng.last_error = "E_SESSION_EXPIRED"
                eng.stop()
                eng.broadcast_status()  # open streams learn the session ended
                log("session %s: stopped (%s), %d running" % (sid[:8], why, len(self.engines)))

    def stop_all(self):
        with self.lock:
            engines = list(self.engines.values())
            self.engines.clear()
        for eng in engines:
            eng.stop()

    def summary(self):
        with self.lock:
            return {"sessions": len(self.engines), "max_sessions": MAX_SESSIONS}


SESSIONS = Sessions()


class RateLimiter:
    """Fixed 10-second window per client IP (public mode only)."""

    def __init__(self, limit):
        self.limit = limit
        self.lock = threading.Lock()
        self.window = 0
        self.counts = {}

    def allow(self, ip):
        now = int(time.time() // 10)
        with self.lock:
            if now != self.window:
                self.window, self.counts = now, {}
            self.counts[ip] = self.counts.get(ip, 0) + 1
            return self.counts[ip] <= self.limit


RATE = RateLimiter(RATE_LIMIT)


def origin_allowed(origin):
    origin = origin.rstrip("/")
    return any(fnmatch.fnmatchcase(origin, pattern) for pattern in ALLOWED_ORIGINS)


class Handler(BaseHTTPRequestHandler):
    server_version = "TarmacOSBridge/1.1"

    def log_message(self, fmt, *args):  # keep the console quiet
        pass

    # ---- request context ----
    def client_ip(self):
        if TRUST_PROXY:
            forwarded = self.headers.get("True-Client-IP") or self.headers.get("X-Forwarded-For", "").split(",")[0]
            if forwarded.strip():
                return forwarded.strip()
        return self.client_address[0]

    def query(self):
        return parse_qs(urlsplit(self.path).query)

    def session_id(self):
        sid = (self.query().get("sid") or [self.headers.get("X-Tarmac-Session", "")])[0]
        if not PUBLIC:
            return LOCAL_SID
        if not SID_RE.match(sid or ""):
            raise SessionError("E_BAD_REQUEST", "a valid session id (sid) is required", 400)
        return sid

    def cors_headers(self):
        origin = self.headers.get("Origin")
        if origin and origin_allowed(origin):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")

    def limited(self):
        if PUBLIC and not RATE.allow(self.client_ip()):
            self.send_json(429, error("E_RATE_LIMIT", "too many requests; slow down"))
            return True
        return False

    def send_json(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return None
        if length > 10000:
            return None
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except (json.JSONDecodeError, UnicodeDecodeError):
            return None
        return body if isinstance(body, dict) else None

    # ---------------- OPTIONS (CORS preflight) ----------------
    def do_OPTIONS(self):
        self.send_response(204)
        self.cors_headers()
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Tarmac-Session")
        self.send_header("Access-Control-Max-Age", "600")
        self.send_header("Content-Length", "0")
        self.end_headers()

    # ---------------- GET ----------------
    def do_GET(self):
        path = urlsplit(self.path).path
        try:
            if path == "/api/stream":
                if self.limited():
                    return
                return self.stream()
            if path == "/api/health":
                return self.health()
        except SessionError as exc:
            return self.send_json(exc.http, error(exc.code, exc.msg))
        return self.serve_static(path)

    def health(self):
        if not PUBLIC:
            return self.send_json(200, SESSIONS.get(LOCAL_SID).status())
        # Public: overall service health, plus this session's engine if a sid was given.
        sid = (self.query().get("sid") or [""])[0]
        eng = SESSIONS.get(sid) if SID_RE.match(sid) else None
        ok = os.path.exists(ENGINE_PATH)
        body = {"ok": ok, "public": True, **SESSIONS.summary(),
                "session": eng.status() if eng else None}
        return self.send_json(200 if ok else 503, body)

    def serve_static(self, path):
        rel = "index.html" if path in ("/", "") else path.lstrip("/")
        full = os.path.realpath(os.path.join(WEB_DIR, rel))
        if not full.startswith(os.path.realpath(WEB_DIR) + os.sep) or not os.path.isfile(full):
            return self.send_json(404, {"error": "not found"})
        with open(full, "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", CONTENT_TYPES.get(os.path.splitext(full)[1], "application/octet-stream"))
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)

    def start_stream(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "keep-alive")
        self.send_header("X-Accel-Buffering", "no")  # ask reverse proxies not to buffer
        self.cors_headers()
        self.end_headers()

    def stream(self):
        try:
            engine = SESSIONS.get_or_create(self.session_id(), self.client_ip())
        except SessionError as exc:
            # Tell the dashboard why, then close; EventSource retries after `retry` ms.
            self.start_stream()
            self.wfile.write(b"retry: 15000\n\n")
            self.write_event("engine", json.dumps({"online": False, "engine_pid": None, "child_pid": None,
                                                   "error": exc.code, "msg": exc.msg}))
            return
        self.start_stream()
        q = queue.Queue(maxsize=4)
        engine.listeners.add(q)
        sent_version = -1
        try:
            self.write_event("engine", engine.status_json())
            while True:
                # Send the newest snapshot (at most 10 per second), never a backlog.
                with engine.lock:
                    version, snap = engine.snapshot_version, engine.latest_snapshot
                if snap and version != sent_version:
                    self.write_event("snapshot", snap)
                    sent_version = version
                try:
                    what = q.get(timeout=15)
                    if what == "status":
                        self.write_event("engine", engine.status_json())
                        if engine.last_error == "E_SESSION_EXPIRED":
                            return
                    time.sleep(0.1)
                except queue.Empty:
                    # A named event (not an SSE comment) so the dashboard can see it and
                    # detect a silently dead connection.
                    self.write_event("ping", "{}")
                    engine.last_seen = time.time()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            engine.listeners.discard(q)
            engine.last_seen = time.time()

    def write_event(self, name, data):
        self.wfile.write(("event: %s\ndata: %s\n\n" % (name, data)).encode())
        self.wfile.flush()

    # ---------------- POST ----------------
    def do_POST(self):
        path = urlsplit(self.path).path
        if self.limited():
            return
        body = self.read_json()
        if body is None:
            return self.send_json(400, error("E_BAD_REQUEST", "invalid JSON body"))
        if path not in ("/api/cmd", "/api/sys", "/api/engine/restart"):
            return self.send_json(404, error("E_NOT_FOUND", "unknown endpoint"))
        try:
            engine = SESSIONS.get_or_create(self.session_id(), self.client_ip())
        except SessionError as exc:
            return self.send_json(exc.http, error(exc.code, exc.msg))
        if path == "/api/cmd":
            return self.handle_engine_command(engine, body)
        if path == "/api/sys":
            return self.handle_sys_command(engine, body)
        if PUBLIC and engine.online and time.time() - engine.last_restart < 5:
            return self.send_json(429, error("E_RATE_LIMIT", "the engine was restarted moments ago"))
        engine.last_restart = time.time()
        ok = engine.restart()
        return self.send_json(200 if ok else 500, {"ok": ok, "status": engine.status()})

    def handle_engine_command(self, engine, body):
        line = body.get("line")
        if not isinstance(line, str) or not line.strip() or "\n" in line or "\r" in line or len(line) > 300:
            return self.send_json(400, error("E_BAD_REQUEST", "line must be one command of at most 300 characters"))
        if line.strip().split()[0] == "quit":
            return self.send_json(400, error("E_BAD_REQUEST", "stop the bridge with Ctrl+C to quit the engine"))
        resp = engine.send(line.strip(), timeout=90)
        if resp is None:
            return self.send_json(503, error("E_ENGINE_OFFLINE", "the engine is not running"))
        if resp == "timeout":
            return self.send_json(504, error("E_TIMEOUT", "the engine did not answer"))
        return self.send_json(200, resp)

    def handle_sys_command(self, engine, body):
        name = body.get("cmd")
        if not isinstance(name, str) or name not in SYS_COMMANDS:
            return self.send_json(400, error("E_BAD_REQUEST", "allowed: " + ", ".join(sorted(SYS_COMMANDS))))
        if not engine.online:
            return self.send_json(503, error("E_ENGINE_OFFLINE", "engine offline"))
        argv = SYS_COMMANDS[name](engine.pid)
        try:
            done = subprocess.run(argv, capture_output=True, text=True, timeout=5)
            output = done.stdout + done.stderr
        except (OSError, subprocess.TimeoutExpired) as exc:
            output = "could not run %s: %s" % (argv[0], exc)
        return self.send_json(200, {"ok": True, "command": " ".join(argv), "output": output})


def main():
    parser = argparse.ArgumentParser(description="TarmacOS bridge")
    parser.add_argument("--port", type=int, default=env_int("PORT", 8080))
    parser.add_argument("--host", default=os.environ.get("HOST", "127.0.0.1"))
    args = parser.parse_args()

    if PUBLIC:
        if not os.path.exists(ENGINE_PATH):
            log("engine binary not found at", ENGINE_PATH)
            sys.exit(1)
        threading.Thread(target=SESSIONS.reap_forever, daemon=True).start()
    elif not SESSIONS.start_local():
        sys.exit(1)
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    server.daemon_threads = True

    def shutdown(*_):
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    if PUBLIC:
        log("public mode on %s:%d - one engine per session (max %d, %d per IP), allowed origins: %s"
            % (args.host, args.port, MAX_SESSIONS, MAX_SESSIONS_PER_IP, ", ".join(ALLOWED_ORIGINS) or "(none)"))
    else:
        print("TarmacOS bridge on http://%s:%d  (engine PID %s, Ctrl+C to stop)"
              % (args.host, args.port, SESSIONS.get(LOCAL_SID).pid), flush=True)
    try:
        server.serve_forever()
    finally:
        SESSIONS.stop_all()
        server.server_close()
        print("bridge stopped; engine shut down cleanly", flush=True)


if __name__ == "__main__":
    main()
