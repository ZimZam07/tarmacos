"""run_golden.py - end-to-end tests of the real engine binary.

Each test starts the engine, drives it through its stdin pipe and compares the
results with the hand-calculated values in tarmacos_blueprint/09 section 8.
Run with:  make golden      (from the engine directory)
"""
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
from engine_client import Engine  # noqa: E402

RESULTS = []


def check(name, condition, detail=""):
    RESULTS.append((name, bool(condition), detail))
    print(("  ok    " if condition else "  FAIL  ") + name + ("" if condition else "   " + str(detail)))


def flight_map(state):
    return {f["flight_no"]: f for f in state["flights"]}


def gantt_by_name(state):
    names = {f["spid"]: f["flight_no"] for f in state["flights"]}
    return ["%s:%d-%d" % (names.get(s["spid"], "-"), s["start"], s["end"]) for s in state["cpu"]["gantt"]]


def run_scenario(engine, scenario, max_ticks=300):
    engine.ok("scenario " + scenario)
    engine.ok("sim run-until-quiet %d" % max_ticks, timeout=120)
    return engine.state()


# ---------------------------------------------------------------- scheduling

def test_scheduling(engine):
    expected = {
        "FCFS": (["P1:0-6", "P2:6-9", "P3:9-17", "P4:17-19"], [0, 6, 9, 17], [6, 9, 17, 19], 8.0, 12.75),
        "PRIORITY": (["P2:0-3", "P4:3-5", "P1:5-11", "P3:11-19"], [5, 0, 11, 3], [11, 3, 19, 5], 4.75, 9.5),
        "RR": (["P1:0-4", "P2:4-7", "P3:7-11", "P4:11-13", "P1:13-15", "P3:15-19"], [9, 4, 11, 11],
               [15, 7, 19, 13], 8.75, 13.5),
    }
    for algo, (gantt, waits, tats, avg_wt, avg_tat) in expected.items():
        s = run_scenario(engine, "sched-ref " + algo)
        f = flight_map(s)
        check("T-G1 sched-ref %s Gantt" % algo, gantt_by_name(s) == gantt, gantt_by_name(s))
        check("T-G1 sched-ref %s waiting times" % algo, [f["P%d" % i]["waiting"] for i in range(1, 5)] == waits)
        check("T-G1 sched-ref %s turnaround times" % algo, [f["P%d" % i]["turnaround"] for i in range(1, 5)] == tats)
        check("T-G1 sched-ref %s averages" % algo,
              s["cpu"]["avg_waiting"] == avg_wt and s["cpu"]["avg_turnaround"] == avg_tat,
              (s["cpu"]["avg_waiting"], s["cpu"]["avg_turnaround"]))

    s = run_scenario(engine, "emergency preempt=off")
    f = flight_map(s)
    check("T-G2 emergency preempt=off", gantt_by_name(s) == ["AI101:0-5", "EMRG7:5-7"] and
          (f["AI101"]["waiting"], f["EMRG7"]["waiting"], f["EMRG7"]["turnaround"]) == (0, 3, 5), gantt_by_name(s))
    s = run_scenario(engine, "emergency preempt=on")
    f = flight_map(s)
    check("T-G2 emergency preempt=on", gantt_by_name(s) == ["AI101:0-2", "EMRG7:2-4", "AI101:4-7"] and
          (f["AI101"]["turnaround"], f["EMRG7"]["turnaround"], f["EMRG7"]["waiting"]) == (7, 2, 0), gantt_by_name(s))


# ---------------------------------------------------------------- deadlock

def kinds(engine, epoch):
    return [e["kind"] for e in engine.events(epoch)]


def finishes(state):
    f = flight_map(state)
    return tuple((f[n]["end_status"], f[n]["finish"]) for n in ("A-AI301", "B-6E302", "C-UK303"))


def test_deadlock(engine):
    s = run_scenario(engine, "deadlock DETECTION")
    k = kinds(engine, s["epoch"])
    states = [f["state"] for f in s["flights"]]
    detected = [e for e in engine.events(s["epoch"]) if e["kind"] == "DEADLOCK_DETECTED"]
    check("T-G3 DETECTION finds the cycle {A,B,C} at tick 8",
          s["deadlock"]["deadlocked"] == [1, 2, 3] and detected and detected[0]["tick"] == 8, detected)
    check("T-G3 DETECTION does not recover (all stay BLOCKED)",
          states == ["BLOCKED"] * 3 and "RECOVERED" not in k and s["sim"]["quiet"], states)
    edges = sorted((e["from"], e["to"]) for e in s["deadlock"]["edges"])
    check("T-G3 wait-for edges A->B, B->C, C->A", edges == [(1, 2), (2, 3), (3, 1)], edges)
    check("T-G3 allocation matrix matches ownership",
          s["deadlock"]["matrices"]["allocation"] == [[1, 0, 0], [0, 1, 0], [0, 0, 1]] and
          s["deadlock"]["matrices"]["request"] == [[0, 1, 0], [0, 0, 1], [1, 0, 0]])

    s = run_scenario(engine, "deadlock RECOVERY action=PREEMPT")
    k = kinds(engine, s["epoch"])
    check("T-G4 RECOVERY/PREEMPT: victim C, all complete B=13 A=18 C=21",
          finishes(s) == (("DONE", 18), ("DONE", 13), ("DONE", 21)) and "RECOVERED" in k, finishes(s))
    check("T-G4 RECOVERY leaves no deadlock and no invariant errors",
          s["deadlock"]["deadlocked"] == [] and s["deadlock"]["last_detected"] == [1, 2, 3] and
          s["sim"]["invariant_error"] == "")

    s = run_scenario(engine, "deadlock RECOVERY action=TERMINATE")
    check("T-G5 RECOVERY/TERMINATE: B=12 A=15, C ABORTED",
          finishes(s) == (("DONE", 15), ("DONE", 12), ("ABORTED", 9)), finishes(s))

    s = run_scenario(engine, "deadlock PREVENTION")
    k = kinds(engine, s["epoch"])
    check("T-G6 PREVENTION: C refused at t8, B=13 A=16 C=21, no deadlock",
          finishes(s) == (("DONE", 16), ("DONE", 13), ("DONE", 21)) and "POLICY_REFUSED" in k and
          "DEADLOCK_DETECTED" not in k, finishes(s))

    s = run_scenario(engine, "deadlock AVOIDANCE")
    ev = engine.events(s["epoch"])
    deferred = [e for e in ev if e["kind"] == "UNSAFE_DEFERRED"]
    check("T-G7 AVOIDANCE: C's tug request deferred at t2 as UNSAFE",
          deferred and deferred[0]["tick"] == 2 and deferred[0]["data"]["spid"] == 3, deferred[:1])
    check("T-G7 AVOIDANCE: B=10 A=15 C=18, no deadlock",
          finishes(s) == (("DONE", 15), ("DONE", 10), ("DONE", 18)) and
          "DEADLOCK_DETECTED" not in [e["kind"] for e in ev], finishes(s))

    ref = engine.ok("deadlock banker-ref request=2")
    check("T-U6 BANKER-REF via engine: safe <P1,P2,P3>, R2 unsafe",
          ref["safety"]["sequence"] == [0, 1, 2] and ref["request"]["verdict"] == "UNSAFE")


# ---------------------------------------------------------------- memory and disk

def test_memory(engine):
    s = run_scenario(engine, "mem-ref string=silberschatz frames=3")
    m = s["memory"]
    frames = [f["vpn"] for f in m["frames"]]
    check("T-G8 FIFO Silberschatz: 15 faults, 5 hits, frames 7/0/1",
          (m["faults"], m["hits"], frames) == (15, 5, [7, 0, 1]), (m["faults"], m["hits"], frames))
    s = run_scenario(engine, "mem-ref string=belady frames=3")
    check("T-G8 FIFO Belady 3 frames: 9 faults", s["memory"]["faults"] == 9, s["memory"]["faults"])
    s = run_scenario(engine, "mem-ref string=belady frames=4")
    check("T-G8 FIFO Belady 4 frames: 10 faults (anomaly)", s["memory"]["faults"] == 10, s["memory"]["faults"])
    engine.ok("scenario mem-ref string=silberschatz frames=3")
    engine.ok("sim run-until-quiet 2")
    x = engine.ok("mem xlate 0 0 42")
    check("T-G8 address translation page 0 offset 42 -> 298", x.get("physical") == 298, x)


def test_disk(engine):
    expected = {"FCFS UP": ([5, 37, 12, 44, 21, 3], 145), "SSTF UP": ([21, 12, 5, 3, 37, 44], 60),
                "SCAN UP": ([21, 37, 44, 12, 5, 3], 75), "SCAN DOWN": ([12, 5, 3, 21, 37, 44], 64)}
    for label, (order, movement) in expected.items():
        algo, direction = label.split()
        s = run_scenario(engine, "disk-ref %s dir=%s" % (algo, direction))
        d = s["disk"]
        served = [x["position"] for x in d["served"]]
        ipc = [e for e in engine.events(s["epoch"]) if e["kind"] == "IPC_EXCHANGE"]
        check("T-G9 disk %s: order and total movement %d" % (label, movement),
              d["order"] == order and served == order and d["total_movement"] == movement and
              d["last_batch_movement"] == movement, (d["order"], served, d["total_movement"]))
        check("T-G9 disk %s planned by the child process" % label,
              ipc and ipc[0]["data"]["child_pid"] == s["ipc"]["child_pid"] != s["ipc"]["engine_pid"])


# ---------------------------------------------------------------- live airport

def test_contention_and_determinism(engine):
    s = run_scenario(engine, "contention", 400)
    statuses = [f["end_status"] for f in s["flights"]]
    check("T-G11 contention: all 5 flights complete", statuses == ["DONE"] * 5, statuses)
    check("T-G11 contention: invariants held every tick",
          s["sim"]["invariant_error"] == "" and s["sim"]["invariant_checks"] == s["tick"], s["sim"])
    check("T-G11 contention: no resource still held", all(r["owner"] == -1 for r in s["resources"]))
    k = kinds(engine, s["epoch"])
    # 3 TURNAROUND flights x 2 services + 1 ARRIVAL (baggage) + 1 DEPARTURE (refuel) = 8 worker threads
    check("T-G11 contention: real blocking, 8 service threads joined, baggage served",
          "RES_BLOCKED" in k and k.count("THREAD_JOINED") == 8 and k.count("DISK_REQ_SERVED") == 12,
          (k.count("RES_BLOCKED"), k.count("THREAD_JOINED"), k.count("DISK_REQ_SERVED")))

    def signature(scenario):
        st = run_scenario(engine, scenario, 400)
        out = []
        for e in engine.events(st["epoch"]):
            # Real PIDs and the epoch number legitimately differ between runs.
            msg = re.sub(r"(PID|epoch) \d+", r"\1 x", e["msg"])
            out.append((e["tick"], e["kind"], msg))
        return out

    for scenario in ("contention", "deadlock RECOVERY", "deadlock AVOIDANCE"):
        runs = [signature(scenario) for _ in range(10)]
        check("T-G10 determinism: '%s' identical over 10 runs" % scenario, all(r == runs[0] for r in runs))


# ---------------------------------------------------------------- real OS evidence

def proc_threads(pid):
    with open("/proc/%d/status" % pid) as f:
        for line in f:
            if line.startswith("Threads:"):
                return int(line.split()[1])
    return -1


def pipe_inodes(pid):
    inodes = {}
    for fd in os.listdir("/proc/%d/fd" % pid):
        try:
            target = os.readlink("/proc/%d/fd/%s" % (pid, fd))
        except OSError:
            continue
        if target.startswith("pipe:"):
            inodes[int(fd)] = target
    return inodes


def test_os_evidence():
    engine = Engine()
    info = engine.ok("sys info")
    pid, child = info["engine_pid"], info["child_pid"]
    with open("/proc/%d/status" % child) as f:
        ppid = [int(line.split()[1]) for line in f if line.startswith("PPid:")][0]
    check("T-O1 child is a real process whose parent is the engine", child != pid and ppid == pid, (pid, child, ppid))

    # fds 0-2 are inherited from whoever started the engine; look at the engine's own pipes.
    parent_pipes = {fd: p for fd, p in pipe_inodes(pid).items() if fd > 2}
    child_pipes = {fd: p for fd, p in pipe_inodes(child).items() if fd > 2}
    shared = set(parent_pipes.values()) & set(child_pipes.values())
    check("T-O2 engine and child share exactly two pipes (one end each)",
          sorted(parent_pipes) == sorted([info["request_fd"], info["result_fd"]]) and len(child_pipes) == 2 and
          len(shared) == 2, (parent_pipes, child_pipes))
    child_stdio = [os.readlink("/proc/%d/fd/%d" % (child, fd)) for fd in (0, 1)]
    check("T-O2 child does not hold the engine's stdin/stdout", child_stdio == ["/dev/null", "/dev/null"], child_stdio)

    check("T-O3 idle engine has 3 threads (main, clock, intake)", proc_threads(pid) == 3, proc_threads(pid))
    for name in ("AA1", "AA2", "AA3"):
        engine.ok("flight create %s CUSTOM 1 burst=3" % name)
    check("T-O3 three flights add three pthreads", proc_threads(pid) == 6, proc_threads(pid))
    engine.ok("sim run-until-quiet")
    time.sleep(0.2)
    check("T-O3 finished flight threads are joined", proc_threads(pid) == 3, proc_threads(pid))

    engine.ok("scenario deadlock DETECTION")
    engine.ok("sim run-until-quiet")
    flights = [t for t in engine.state()["threads"] if t["kind"] == "flight"]
    check("T-O4 deadlocked flights are real threads waiting on a condition variable",
          len(flights) == 3 and all("cond_wait" in t["state"] for t in flights) and proc_threads(pid) == 6,
          [t["state"] for t in flights])

    started = time.time()
    engine.ok("sim reset")
    elapsed = time.time() - started
    check("T-R1 reset during a deadlock finishes quickly and joins all threads",
          elapsed < 1.0 and proc_threads(pid) == 3, (elapsed, proc_threads(pid)))
    check("T-R1 child process survives reset", engine.ok("sys info")["child_pid"] == child)

    for _ in range(50):
        engine.ok("scenario contention")
        engine.ok("sim step 5")
    engine.ok("sim reset")
    check("T-R2 50 reset cycles leave no leaked threads", proc_threads(pid) == 3, proc_threads(pid))

    # T-O6: hold the consumer, let two baggage services fill the bounded buffer.
    engine.ok("debug intake hold")
    engine.ok("flight create BG1 ARRIVAL 1")
    engine.ok("flight create BG2 ARRIVAL 1")
    engine.ok("sim step 40")
    time.sleep(1.5)
    st = engine.state()
    blocked = [t for t in st["threads"] if "sem_wait(empty)" in t["state"]]
    check("T-O6 bounded buffer full: full=4 empty=0 and a producer blocked in sem_wait",
          st["sync"]["full_sem"] == 4 and st["sync"]["empty_sem"] == 0 and len(blocked) == 1,
          (st["sync"], [t["state"] for t in st["threads"]]))
    engine.ok("debug intake release")
    engine.ok("sim run-until-quiet")
    st = engine.state()
    check("T-O6 after release every bag is delivered and both flights finish",
          [f["end_status"] for f in st["flights"]] == ["DONE", "DONE"] and st["sync"]["consumed"] == 6)

    code = engine.quit()
    time.sleep(0.2)
    check("T-O5 quit exits 0 and the child is reaped (no zombie)",
          code == 0 and not os.path.exists("/proc/%d" % child), (code, os.path.exists("/proc/%d" % child)))
    exit_line = [o for o in engine.lines if o.get("type") == "exit"]
    check("T-O5 exit status of the child is reported", exit_line and "exited with status 0" in exit_line[0]["child"],
          exit_line)


# ---------------------------------------------------------------- errors

def test_errors():
    engine = Engine()

    def code(line):
        resp = engine.send(line)
        return None if resp["ok"] else resp["error"]["code"]

    version = engine.state()["version"]
    check("T-E1 E_PARSE (malformed option)", code("sched set FCFS q=") == "E_PARSE")
    check("T-E1 E_UNKNOWN_CMD", code("bogus") == "E_UNKNOWN_CMD")
    check("T-E1 E_BAD_ARG (priority 12)", code("flight create AI1 TURNAROUND 12") == "E_BAD_ARG")
    check("T-E1 E_BAD_ARG (CUSTOM without burst)", code("flight create AI1 CUSTOM 1") == "E_BAD_ARG")
    check("T-E1 E_BAD_ARG (unknown op type)", code("flight create AI1 GLIDER 1") == "E_BAD_ARG")
    check("T-E1 E_UNKNOWN_FLIGHT", code("flight abort 99") == "E_UNKNOWN_FLIGHT")
    check("T-E1 invalid commands do not change the state", engine.state()["version"] == version)

    engine.ok("flight create AI1 CUSTOM 1 burst=2")
    check("T-E2 E_DUPLICATE_FLIGHT", code("flight create AI1 CUSTOM 1 burst=2") == "E_DUPLICATE_FLIGHT")
    engine.ok("sim run-until-quiet")
    check("T-E5 E_FLIGHT_DONE", code("flight abort 1") == "E_FLIGHT_DONE")

    engine.ok("scenario deadlock DETECTION")
    engine.ok("sim step 2")
    time.sleep(0.3)
    check("T-E3 E_BUSY when changing the policy while resources are held", code("deadlock policy AVOIDANCE") == "E_BUSY")
    engine.ok("sim run")
    check("T-E1 E_STATE when stepping while running", code("sim step") == "E_STATE")
    engine.ok("sim pause")

    engine.ok("sim reset")
    for i in range(24):
        engine.ok("flight create L%d CUSTOM 1 burst=1 arrive=100" % i)
    check("T-E2 E_LIMIT at the 25th active flight", code("flight create L99 CUSTOM 1 burst=1") == "E_LIMIT")
    engine.ok("sim reset")

    # T-E4: kill the child process; the engine must report E_IPC and keep running.
    child = engine.ok("sys info")["child_pid"]
    os.kill(child, 9)
    time.sleep(0.2)
    engine.ok("scenario disk-ref FCFS")
    engine.ok("sim step 3")
    time.sleep(0.5)
    st = engine.state()
    errors = [e for e in engine.events(st["epoch"]) if e["kind"] == "ERROR" and "E_IPC" in e["msg"]]
    check("T-E4 killed child -> E_IPC, requests stay queued, engine alive",
          errors and len(st["disk"]["waiting"]) == 6 and st["ipc"]["status"] in ("FAILED", "EXITED"), st["ipc"])
    info = engine.ok("sys info")
    check("T-E4 dead child is reaped and its exit status recorded",
          info["child_status"] == "EXITED" and "signal 9" in info["child_exit"], info)
    check("T-E4 engine still quits cleanly", engine.quit() == 0)


def main():
    print("TarmacOS golden tests (real engine)")
    engine = Engine()
    try:
        test_scheduling(engine)
        test_deadlock(engine)
        test_memory(engine)
        test_disk(engine)
        test_contention_and_determinism(engine)
    finally:
        check("T-B3 engine quits with exit code 0", engine.quit() == 0)
    test_os_evidence()
    test_errors()
    failed = [r for r in RESULTS if not r[1]]
    print("%d checks, %d failures" % (len(RESULTS), len(failed)))
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
