// config.js - where the dashboard finds the bridge.
// apiBase "" = same origin, i.e. the local bridge started by ./scripts/run_dev.sh.
// The Vercel build (scripts/build_web.mjs) writes a copy with apiBase = $TARMAC_API_BASE.
window.TARMAC_CONFIG = { apiBase: "" };
