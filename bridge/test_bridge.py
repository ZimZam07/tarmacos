"""test_bridge.py - integration tests: HTTP bridge <-> real engine.

Run from the tarmacos directory:  python3 -m unittest bridge/test_bridge.py -v
Starts the real bridge (which starts the real engine) on a free port.
"""
import json
import os
import signal
import socket
import subprocess
import sys
import time
import unittest
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class BridgeTest(unittest.TestCase):
    ENV = {}  # extra environment for the bridge (public-mode tests set TARMAC_PUBLIC etc.)

    @classmethod
    def setUpClass(cls):
        cls.port = free_port()
        env = {k: v for k, v in os.environ.items() if not k.startswith("TARMAC_")}
        env.update(cls.ENV)
        cls.proc = subprocess.Popen([sys.executable, os.path.join(ROOT, "bridge", "server.py"), "--port", str(cls.port)],
                                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, env=env)
        deadline = time.time() + 10
        while time.time() < deadline:
            try:
                health = cls.get("/api/health")
                if health.get("online") or health.get("ok"):
                    return
            except OSError:
                time.sleep(0.1)
        raise RuntimeError("bridge did not start")

    @classmethod
    def tearDownClass(cls):
        cls.proc.send_signal(signal.SIGINT)
        cls.output = cls.proc.communicate(timeout=10)[0]

    @classmethod
    def url(cls, path):
        return "http://127.0.0.1:%d%s" % (cls.port, path)

    @classmethod
    def get(cls, path):
        with urllib.request.urlopen(cls.url(path), timeout=10) as r:
            return json.loads(r.read())

    def post(self, path, body, headers=None):
        req = urllib.request.Request(self.url(path), data=json.dumps(body).encode(),
                                     headers={"Content-Type": "application/json", **(headers or {})})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    def cmd(self, line):
        status, body = self.post("/api/cmd", {"line": line})
        self.assertEqual(status, 200, body)
        return body

    def test_1_command_round_trip(self):
        body = self.cmd("state")
        self.assertTrue(body["ok"])
        self.assertEqual(body["result"]["type"], "snapshot")

    def test_2_engine_errors_are_forwarded(self):
        body = self.cmd("flight create X1 TURNAROUND 42")
        self.assertFalse(body["ok"])
        self.assertEqual(body["error"]["code"], "E_BAD_ARG")
        status, body = self.post("/api/cmd", {"line": "a\nb"})
        self.assertEqual(status, 400)
        status, body = self.post("/api/cmd", {"line": "quit"})
        self.assertEqual(status, 400)

    def test_3_scenario_through_http_matches_engine_tests(self):
        self.assertTrue(self.cmd("scenario deadlock AVOIDANCE")["ok"])
        self.assertTrue(self.cmd("sim run-until-quiet 100")["ok"])
        flights = {f["flight_no"]: f["finish"] for f in self.cmd("state")["result"]["flights"]}
        self.assertEqual(flights, {"A-AI301": 15, "B-6E302": 10, "C-UK303": 18})

    def test_4_sse_stream_delivers_snapshots(self):
        self.cmd("sim reset")
        with urllib.request.urlopen(self.url("/api/stream"), timeout=10) as stream:
            events = []
            started = time.time()
            while time.time() - started < 5 and len([e for e in events if e == "snapshot"]) < 1:
                line = stream.readline().decode().strip()
                if line.startswith("event: "):
                    events.append(line[7:])
            self.assertIn("engine", events)
            self.assertIn("snapshot", events)

    def test_5_sys_commands_are_real_and_restricted(self):
        status, body = self.post("/api/sys", {"cmd": "children"})
        self.assertEqual(status, 200)
        child_pid = self.cmd("sys info")["result"]["child_pid"]
        self.assertIn(str(child_pid), body["output"])
        status, body = self.post("/api/sys", {"cmd": "rm -rf /"})
        self.assertEqual(status, 400)

    def test_6_static_files_and_path_traversal(self):
        with urllib.request.urlopen(self.url("/"), timeout=10) as r:
            self.assertIn(b"TarmacOS", r.read())
        with self.assertRaises(urllib.error.HTTPError):
            urllib.request.urlopen(self.url("/../bridge/server.py"), timeout=10)

    def test_7_offline_and_restart(self):
        engine_pid = self.get("/api/health")["engine_pid"]
        os.kill(engine_pid, signal.SIGKILL)
        time.sleep(0.5)
        status, body = self.post("/api/cmd", {"line": "state"})
        self.assertEqual(status, 503)
        self.assertEqual(body["error"]["code"], "E_ENGINE_OFFLINE")
        status, body = self.post("/api/engine/restart", {})
        self.assertEqual(status, 200)
        self.assertNotEqual(body["status"]["engine_pid"], engine_pid)
        self.assertTrue(self.cmd("state")["ok"])



def alive(pid):
    try:
        with open("/proc/%d/stat" % pid) as f:
            return f.read().split(") ")[1][0] != "Z"
    except OSError:
        return False


class PublicModeTest(BridgeTest):
    """TARMAC_PUBLIC=1: one engine per browser session, limits, CORS (the hosted setup)."""
    ENV = {"TARMAC_PUBLIC": "1", "TARMAC_MAX_SESSIONS": "3", "TARMAC_MAX_SESSIONS_PER_IP": "3",
           "TARMAC_ALLOWED_ORIGINS": "https://tarmacos.example,https://tarmacos-*-team.example",
           "TARMAC_TRUST_PROXY": "0"}

    # The inherited local-mode tests do not apply here.
    test_1_command_round_trip = test_2_engine_errors_are_forwarded = None
    test_3_scenario_through_http_matches_engine_tests = test_4_sse_stream_delivers_snapshots = None
    test_5_sys_commands_are_real_and_restricted = test_7_offline_and_restart = None

    def scmd(self, sid, line):
        status, body = self.post("/api/cmd?sid=" + sid, {"line": line})
        self.assertEqual(status, 200, body)
        return body

    def test_p1_session_id_required(self):
        status, body = self.post("/api/cmd", {"line": "state"})
        self.assertEqual(status, 400)
        status, body = self.post("/api/cmd?sid=bad", {"line": "state"})
        self.assertEqual(status, 400)

    def test_p2_sessions_are_isolated_and_capped(self):
        a, b, c = "sessionAAAA", "sessionBBBB", "sessionCCCC"
        self.assertTrue(self.scmd(b, "flight create B1 TURNAROUND 2")["ok"])
        self.assertTrue(self.scmd(a, "scenario deadlock DETECTION")["ok"])
        self.assertTrue(self.scmd(a, "sim reset")["ok"])
        pid_a = self.scmd(a, "sys info")["result"]["engine_pid"]
        pid_b = self.scmd(b, "sys info")["result"]["engine_pid"]
        self.assertNotEqual(pid_a, pid_b)
        flights_b = [f["flight_no"] for f in self.scmd(b, "state")["result"]["flights"]]
        self.assertEqual(flights_b, ["B1"])  # A's reset did not touch B
        status, body = self.post("/api/sys?sid=" + b, {"cmd": "ps"})
        self.assertIn(str(pid_b), body["output"])
        self.assertTrue(self.scmd(c, "state")["ok"])
        status, body = self.post("/api/cmd?sid=sessionDDDD", {"line": "state"})
        self.assertEqual(status, 503)
        self.assertEqual(body["error"]["code"], "E_CAPACITY")
        health = self.get("/api/health")
        self.assertEqual((health["sessions"], health["max_sessions"]), (3, 3))

    def test_p3_cors_only_for_allowed_origins(self):
        for origin, allowed in (("https://tarmacos.example", True), ("https://tarmacos-git-x-team.example", True),
                                ("https://evil.example", False)):
            req = urllib.request.Request(self.url("/api/health"), method="OPTIONS", headers={"Origin": origin})
            with urllib.request.urlopen(req, timeout=10) as r:
                self.assertEqual(r.status, 204)
                self.assertEqual(r.headers.get("Access-Control-Allow-Origin"), origin if allowed else None)


class PublicIdleTest(BridgeTest):
    """Idle public sessions are stopped: engine threads joined, child reaped, sid expired."""
    ENV = {"TARMAC_PUBLIC": "1", "TARMAC_IDLE_SECONDS": "1", "TARMAC_REAP_INTERVAL": "1", "TARMAC_TRUST_PROXY": "0"}
    test_1_command_round_trip = test_2_engine_errors_are_forwarded = None
    test_3_scenario_through_http_matches_engine_tests = test_4_sse_stream_delivers_snapshots = None
    test_5_sys_commands_are_real_and_restricted = test_7_offline_and_restart = None

    def test_i1_idle_session_is_cleaned_up(self):
        status, body = self.post("/api/cmd?sid=idleSession1", {"line": "sys info"})
        self.assertEqual(status, 200)
        engine_pid, child_pid = body["result"]["engine_pid"], body["result"]["child_pid"]
        self.assertTrue(alive(engine_pid) and alive(child_pid))
        deadline = time.time() + 10
        while time.time() < deadline and (alive(engine_pid) or alive(child_pid)):
            time.sleep(0.2)
        self.assertFalse(alive(engine_pid))
        self.assertFalse(alive(child_pid))
        status, body = self.post("/api/cmd?sid=idleSession1", {"line": "state"})
        self.assertEqual(status, 410)
        self.assertEqual(body["error"]["code"], "E_SESSION_EXPIRED")
        self.assertEqual(self.get("/api/health")["sessions"], 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
