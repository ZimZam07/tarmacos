"""engine_client.py - drives the real tarmac_engine binary through its stdin/stdout pipes.

Used by the golden tests and handy for manual exploration:
    python3 tests/golden/engine_client.py "scenario deadlock DETECTION" "sim run-until-quiet"
prints every event the engine emits for those commands.
"""
import json
import os
import subprocess
import sys
import threading

ENGINE = os.path.join(os.path.dirname(__file__), "..", "..", "build", "tarmac_engine")


class Engine:
    def __init__(self):
        self.proc = subprocess.Popen([ENGINE], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                     text=True, bufsize=1)
        self.lines = []          # every JSON object received, in order
        self.cond = threading.Condition()
        self.next_id = 0
        self.ready = None
        self.reader = threading.Thread(target=self._read, daemon=True)
        self.reader.start()
        self.ready = self.wait_for(lambda o: o.get("type") == "ready", 10)

    def _read(self):
        for line in self.proc.stdout:
            obj = json.loads(line)
            with self.cond:
                self.lines.append(obj)
                self.cond.notify_all()
        with self.cond:
            self.lines.append({"type": "eof"})
            self.cond.notify_all()

    def wait_for(self, predicate, timeout=30, start=0):
        with self.cond:
            ok = self.cond.wait_for(lambda: any(predicate(o) for o in self.lines[start:]), timeout)
            if not ok:
                raise TimeoutError("engine did not answer in time")
            return next(o for o in self.lines[start:] if predicate(o))

    def send(self, line, timeout=60):
        """Sends one command and returns its response object."""
        self.next_id += 1
        rid = str(self.next_id)
        with self.cond:
            start = len(self.lines)
        self.proc.stdin.write("#%s %s\n" % (rid, line))
        self.proc.stdin.flush()
        return self.wait_for(lambda o: o.get("type") == "resp" and o.get("id") == rid, timeout, start)

    def ok(self, line, timeout=60):
        resp = self.send(line, timeout)
        if not resp["ok"]:
            raise AssertionError("command failed: %s -> %s" % (line, resp["error"]))
        return resp["result"]

    def events(self, epoch=None):
        with self.cond:
            return [o for o in self.lines if o.get("type") == "event" and (epoch is None or o["epoch"] == epoch)]

    def state(self):
        return self.ok("state")

    def quit(self):
        try:
            self.send("quit", 10)
        except (BrokenPipeError, TimeoutError):
            pass
        self.proc.wait(10)
        return self.proc.returncode


if __name__ == "__main__":
    engine = Engine()
    for command in sys.argv[1:]:
        print(">>", command, "->", json.dumps(engine.send(command))[:300])
    epoch = engine.state()["epoch"]
    for e in engine.events(epoch):
        print("t=%-3d %-20s %s" % (e["tick"], e["kind"], e["msg"]))
    print("exit code:", engine.quit())
