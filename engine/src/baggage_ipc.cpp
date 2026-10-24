// baggage_ipc.cpp - fork(), pipe(), read()/write(), poll() and waitpid().
#include "baggage_ipc.h"

#include <fcntl.h>
#include <poll.h>
#include <sys/wait.h>
#include <unistd.h>

#include <cerrno>
#include <cstring>
#include <sstream>

// write() may write fewer bytes than asked; keep writing until done.
static bool writeAll(int fd, const std::string& text) {
    size_t done = 0;
    while (done < text.size()) {
        ssize_t n = write(fd, text.data() + done, text.size() - done);
        if (n < 0) {
            if (errno == EINTR) continue;
            return false;
        }
        done += (size_t)n;
    }
    return true;
}

// ---------------- child side ----------------

static std::string handleChildRequest(const std::string& line) {
    // SCHED <algo> <dir> <head> <min> <max> <n> <p1> ... <pn>
    std::istringstream in(line);
    std::string word, algoText, dirText;
    int head, minCyl, maxCyl, count;
    in >> word >> algoText >> dirText >> head >> minCyl >> maxCyl >> count;
    DiskAlgo algo;
    Direction dir;
    if (!in || word != "SCHED" || !parseDiskAlgo(algoText, algo) || !parseDirection(dirText, dir) || count < 0)
        return "ERROR bad request\n";
    std::vector<int> positions(count);
    for (int i = 0; i < count; i++) in >> positions[i];
    if (!in) return "ERROR bad request\n";

    DiskPlan plan = planDisk(algo, dir, head, minCyl, maxCyl, positions);
    if (!plan.error.empty()) return "ERROR " + plan.error + "\n";

    std::ostringstream out;
    out << "ORDER " << plan.order.size();
    for (int p : plan.order) out << ' ' << p;
    out << " PATH " << plan.path.size();
    for (int p : plan.path) out << ' ' << p;
    out << " MOVE " << plan.totalMovement << " PID " << getpid() << "\n";
    return out.str();
}

void baggageChildMain(int requestReadFd, int resultWriteFd) {
    // The child never uses the engine's stdin/stdout (those are the bridge's
    // pipes); closing them means the bridge sees EOF as soon as the parent exits.
    int devNull = open("/dev/null", O_RDWR);
    if (devNull >= 0) {
        dup2(devNull, STDIN_FILENO);
        dup2(devNull, STDOUT_FILENO);
        close(devNull);
    }

    std::string pending;
    char chunk[512];
    while (true) {
        ssize_t n = read(requestReadFd, chunk, sizeof chunk);
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) break;  // 0 = EOF: the parent closed its write end
        pending.append(chunk, (size_t)n);

        size_t newline;
        while ((newline = pending.find('\n')) != std::string::npos) {
            std::string line = pending.substr(0, newline);
            pending.erase(0, newline + 1);
            if (line == "QUIT") {
                close(requestReadFd);
                close(resultWriteFd);
                _exit(0);
            }
            if (!writeAll(resultWriteFd, handleChildRequest(line))) _exit(2);
        }
    }
    close(requestReadFd);
    close(resultWriteFd);
    _exit(0);
}

// ---------------- parent side ----------------

bool BaggageHandlerProcess::start(std::string& error) {
    int requestPipe[2], resultPipe[2];
    if (pipe(requestPipe) != 0 || pipe(resultPipe) != 0) {
        error = std::string("pipe() failed: ") + std::strerror(errno);
        return false;
    }
    if (sem_init(&channelLock, 0, 1) != 0) {
        error = std::string("sem_init failed: ") + std::strerror(errno);
        return false;
    }

    pid_t pid = fork();
    if (pid < 0) {
        error = std::string("fork() failed: ") + std::strerror(errno);
        return false;
    }
    if (pid == 0) {
        // Child: keep the read end of the request pipe and the write end of
        // the result pipe; close the other two so EOF works correctly.
        close(requestPipe[1]);
        close(resultPipe[0]);
        baggageChildMain(requestPipe[0], resultPipe[1]);
    }

    // Parent: the opposite ends. If the parent kept requestPipe[0] open, the
    // child would never see EOF after the parent stops writing.
    close(requestPipe[0]);
    close(resultPipe[1]);
    childPid = pid;
    requestWriteFd = requestPipe[1];
    resultReadFd = resultPipe[0];
    status = "RUNNING";
    return true;
}

bool BaggageHandlerProcess::readLine(std::string& line, int timeoutMs, std::string& error) {
    while (true) {
        size_t newline = readBuffer.find('\n');
        if (newline != std::string::npos) {
            line = readBuffer.substr(0, newline);
            readBuffer.erase(0, newline + 1);
            return true;
        }
        // poll() waits for data with a timeout, so a stuck child cannot hang the engine.
        pollfd pfd{resultReadFd, POLLIN, 0};
        int ready = poll(&pfd, 1, timeoutMs);
        if (ready < 0 && errno == EINTR) continue;
        if (ready == 0) { error = "timed out waiting for the baggage handler"; return false; }
        if (ready < 0) { error = std::string("poll() failed: ") + std::strerror(errno); return false; }
        char chunk[512];
        ssize_t n = read(resultReadFd, chunk, sizeof chunk);
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) { error = "baggage handler closed the pipe (EOF)"; return false; }
        readBuffer.append(chunk, (size_t)n);
    }
}

static bool parseReply(const std::string& line, DiskPlan& plan, std::string& error) {
    std::istringstream in(line);
    std::string word;
    in >> word;
    if (word == "ERROR") { error = "baggage handler reported: " + line.substr(6); return false; }
    size_t count;
    plan = DiskPlan();
    if (word != "ORDER" || !(in >> count)) { error = "malformed reply: " + line; return false; }
    plan.order.resize(count);
    for (size_t i = 0; i < count; i++) in >> plan.order[i];
    in >> word >> count;
    if (word != "PATH") { error = "malformed reply: " + line; return false; }
    plan.path.resize(count);
    for (size_t i = 0; i < count; i++) in >> plan.path[i];
    in >> word >> plan.totalMovement;
    if (!in || word != "MOVE") { error = "malformed reply: " + line; return false; }
    return true;
}

bool BaggageHandlerProcess::requestPlan(DiskAlgo algo, Direction dir, int head, int minCyl, int maxCyl,
                                        const std::vector<int>& positions, DiskPlan& plan, std::string& error) {
    if (status != "RUNNING") {
        error = "baggage handler process is not running (" + status + ")";
        return false;
    }
    std::ostringstream request;
    request << "SCHED " << diskAlgoName(algo) << ' ' << directionName(dir) << ' ' << head << ' ' << minCyl << ' '
            << maxCyl << ' ' << positions.size();
    for (int p : positions) request << ' ' << p;
    request << '\n';

    sem_wait(&channelLock);  // binary semaphore: one exchange at a time
    bool ok = writeAll(requestWriteFd, request.str());
    std::string reply;
    if (!ok) error = std::string("write() to baggage handler failed: ") + std::strerror(errno);
    if (ok) ok = readLine(reply, 1000, error);
    if (ok) {
        messagesSent++;
        messagesReceived++;
        lastSent = request.str().substr(0, request.str().size() - 1);
        lastReceived = reply;
    }
    sem_post(&channelLock);

    if (!ok) {
        status = "FAILED";
        checkIfExited();
        return false;
    }
    return parseReply(reply, plan, error);
}

void BaggageHandlerProcess::describeExit(int waitStatus) {
    if (WIFEXITED(waitStatus))
        exitDescription = "exited with status " + std::to_string(WEXITSTATUS(waitStatus));
    else if (WIFSIGNALED(waitStatus))
        exitDescription = "killed by signal " + std::to_string(WTERMSIG(waitStatus));
    else
        exitDescription = "stopped";
}

void BaggageHandlerProcess::checkIfExited() {
    if (childPid <= 0 || status == "EXITED") return;
    int waitStatus = 0;
    pid_t r = waitpid(childPid, &waitStatus, WNOHANG);  // reap without blocking
    if (r == childPid) {
        describeExit(waitStatus);
        status = "EXITED";
    }
}

int BaggageHandlerProcess::stop() {
    if (childPid <= 0) return -1;
    if (status == "RUNNING") writeAll(requestWriteFd, "QUIT\n");
    if (requestWriteFd >= 0) close(requestWriteFd);  // the child also sees EOF
    requestWriteFd = -1;
    if (status != "EXITED") {
        int waitStatus = 0;
        while (waitpid(childPid, &waitStatus, 0) < 0 && errno == EINTR) {
        }
        describeExit(waitStatus);
        status = "EXITED";
    }
    if (resultReadFd >= 0) close(resultReadFd);
    resultReadFd = -1;
    sem_destroy(&channelLock);
    return 0;
}
