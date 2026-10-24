# TarmacOS backend image: the C++ engine + the Python bridge (public mode).
# The dashboard itself is hosted on Vercel; the bridge also serves web/ as a fallback.
# Same OS and toolchain as development (Ubuntu 26.04, GCC 15, Python 3.14).

# ---- build: compile with -Werror and run the engine test suites on the production toolchain
FROM ubuntu:26.04 AS build
RUN apt-get update && apt-get install -y --no-install-recommends build-essential python3 procps \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY engine/ engine/
RUN make -C engine clean && make -C engine -j"$(nproc)" \
    && make -C engine test \
    && python3 engine/tests/golden/run_golden.py

# ---- runtime: engine binary, bridge, dashboard; tini reaps any orphan as PID 1
FROM ubuntu:26.04
RUN apt-get update && apt-get install -y --no-install-recommends python3 procps tini \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 tarmac
WORKDIR /app
COPY --from=build /src/engine/build/tarmac_engine engine/build/tarmac_engine
COPY bridge/server.py bridge/server.py
COPY web/ web/
USER tarmac
ENV TARMAC_PUBLIC=1 HOST=0.0.0.0 PORT=10000 PYTHONUNBUFFERED=1
EXPOSE 10000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["python3", "bridge/server.py"]
