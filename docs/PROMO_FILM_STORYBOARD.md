# TarmacOS LinkedIn film: storyboard and production plan

Status: **proposal for approval**. No assets have been generated, no credits spent, and no application or deployment file has been changed. Creative basis: [MAIN_DEMO_REFERENCE_ANALYSIS.md](MAIN_DEMO_REFERENCE_ANALYSIS.md).

## Locked format

| | |
|---|---|
| Output | **Standalone full-frame motion-graphics film.** No laptop, monitor, phone or physical screen appears or frames the content at any point. |
| Duration | **56 s** (10 scenes) |
| Frame | **1080 × 1350 (4:5)**, 30 fps, H.264 High yuv420p, AAC 48 kHz, −14 LUFS |
| Palette | `#0a111e` / `#0d1626` navy base, panels `#111b2e`, lines `#22314f`, text `#e4e8f0`, **amber `#f0b43c`** (only accent), deadlock red `#ef6461` (deadlock scene only), state colours only inside real UI. All taken from `web/css/app.css`. |
| Type | Archivo (wght 900, wdth 112) for slams · Inter Tight 700 for captions · Inter 200 for the hook line · JetBrains Mono for technical labels. All SIL Open Font License. |
| Grid | A subtle navy blueprint grid (60 px cells, lines at 6 % opacity) as the constant ground. Content stays inside a 72 px safe margin. |

## Verified facts used in the film

Every on-screen number is taken from these sources. Capture-time values are re-read from the live engine and logged before rendering.

| Claim | Source |
|---|---|
| Flights are **simulated** processes (SPIDs), each run by its own real pthread; ground services are real pthreads | README "Limitations"; ARCHITECTURE "1 pthread per flight / per ground service"; golden T-O3, T-O4 |
| Busy apron: 5 flights, 3 gates, 1 fuel truck, 1 tug | README demo step 7 |
| Deadlock: A holds Gate 3 and wants the truck; B holds the truck and wants the tug; C holds the tug and wants Gate 3. Detected at **t8**, wait-for edges A→B→C→A | Deadlocks tab scenario text; golden T-G3 |
| Recovery: victim **C** rolled back at t8; flights finish **B t13, A t18, C t21** | golden T-G4; README |
| Avoidance: Banker's **defers C's tug request at t2** (UNSAFE_DEFERRED); no deadlock forms | golden T-G7 |
| Round Robin q=4: **avg WT 8.75, avg TAT 13.50** (FCFS 8.00 / 12.75, Priority 4.75 / 9.50) | golden `test_scheduling`; README |
| Baggage handler = a real child process: `fork()`, two `pipe()`s, `poll()` with timeout, binary `sem_t` (one exchange at a time), `waitpid()`; messages `SCHED …` → `ORDER …` | `engine/src/baggage_ipc.cpp` lines 1, 94–105, 137, 180–191, 213–227 |
| SCAN ↑ from head 20: 21 → 37 → 44 → edge 49 → 12 → 5 → 3, **75** positions moved | golden disk test (order + total 75); README step 6 |
| Every dashboard value comes from the C++ engine; the dashboard computes no OS results | README "Technology" |
| URL `https://tarmacos-kohl.vercel.app` | HTTP 200 checked 2026-10-25; re-checked before delivery |

Not used: test counts, line counts, performance figures (left out to keep the film focused; nothing is shown that the film has not verified).

---

## Storyboard

**Source** key: **REAL** = screenshot of the running TarmacOS dashboard (captured, never edited); **SVG** = HTML/SVG/CSS motion graphics drawn in the composition; **REAL+SVG** = a real crop with drawn highlights or labels over it, which never change the UI's content.

### S1 · Hook · 0:00–0:04.0 · SVG

| Time | On screen (exact text) |
|---|---|
| 0.2–1.6 | `What if an airport` (Inter 200, white, glowing write-on with a light pen tip) |
| 1.8–2.4 | `ran like an` (Inter Tight 700) |
| 2.4–3.6 | `OPERATING` / `SYSTEM?` (Archivo 900, two lines, letters land amber and cool to white; `?` stays amber) |

Visual: black fades to navy as an **amber taxiway centreline** (dashed, like the apron map's dashes) draws left to right under the text.
**Transition → S2:** the headline lifts away with a ghost trail. The centreline stays and becomes the spine of the mapping list (match-cut on the line).

### S2 · The idea · 0:04.0–0:10.0 · SVG

Four rows build down the centreline, about 1.2 s each. The left term is white and the right term amber, joined by a small arrow:

```
Flights            →  processes
Ground crews       →  threads
Gates · trucks · tugs →  shared resources
Baggage cart       →  disk head
```

Microtype under row 1 (JetBrains Mono, muted): `simulated processes · each on a real POSIX thread`

**Transition → S3:** the four amber words fly to the centre and merge into a point of light, which flares into the title.

### S3 · Title · 0:10.0–0:13.5 · SVG

| Time | On screen |
|---|---|
| 10.0–11.4 | `TARMAC` (white) + `OS` (amber): letter build with bloom, as in the dashboard brand mark `Tarmac`**`OS`** |
| 11.6–13.0 | `Airport ground control, run by a real C++ engine on Linux.` (Inter Tight, 2 lines) |
| 11.6 | Microtype: `C++17 · POSIX threads · fork & pipes · no frameworks` |

**Transition → S4:** the title recedes (scale 1 → 0.85, fades) while the real dashboard rises from below as a **borderless floating plane**, tilted 14° on X and settling flat (the one deliberate perspective move in the film).

### S4 · Product reveal · 0:13.5–0:21.0 · REAL (+SVG captions)

| Time | Shot | On screen |
|---|---|---|
| 13.5–15.0 | The whole dashboard (Overview, Busy apron, running) as a plane settling flat: establishes that it is a real product | — |
| 15.0–18.5 | **Push in** to the apron map crop (gates with coloured flight chips, fuel/tug slots, CART on the belt), stepping through **4–5 consecutive captured ticks** with 0.15 s dissolves so the chips really change state | `Five flights. Three gates.` / `One fuel truck. One tug.` (top caption, word sweep) |
| 18.5–21.0 | Crop slides to the KPI cards + the "Now (t=…)" line showing a flight blocked waiting | `Every value comes from the engine.` |

**Transition → S5:** push into the amber **BLOCKED** chip; it fills the frame and becomes the amber field of S5 (whip-zoom with motion blur).

### S5 · Spike · 0:21.0–0:23.0 · SVG

Full-bleed amber, navy Archivo 900, one word per music hit (about 0.5 s each), with blurred swaps:

`UNTIL` · `IT` · `DEADLOCKS.`

**Transition → S6:** the period of `DEADLOCKS.` drops, shrinks to a red dot, and the amber field drains to navy. The dot becomes node A of the graph.

### S6 · Deadlock · 0:23.0–0:31.0 · SVG → REAL+SVG

| Time | Shot | On screen |
|---|---|---|
| 23.0–24.6 | SVG resource-allocation graph builds node by node (layout matches the dashboard's graph: flights as circles, Gate 3 / FT1 / TG1 as squares). Solid = holds, dashed = wants | `A holds Gate 3. Wants the fuel truck.` |
| 24.6–26.2 | | `B holds the truck. Wants the tug.` |
| 26.2–27.8 | | `C holds the tug. Wants Gate 3.` |
| 27.8–29.0 | The three dashed edges close the loop and the cycle turns **red**, with a pulse running around it | `Circular wait.` |
| 29.0–31.0 | **Match-dissolve to the REAL Deadlocks tab crop** at t8 (graph + red banner `Deadlock detected at t=8: …` exactly as captured); a thin amber highlight frame on the banner | `Detected at t8.` |

**Transition → S7:** the red cycle **breaks** at edge C→Gate 3 (it snaps with a spark) and the frame splits horizontally into two stacked panels.

### S7 · Two ways out · 0:31.0–0:37.0 · REAL+SVG

Split screen, stacked (works in 4:5):

| Panel | Shot | On screen |
|---|---|---|
| Top: **RECOVERY** (31.0–37.0) | REAL crop: the green `Recovered at t=8` banner + the recovery log line, exactly as captured | `Recovery: roll back C.` · then three ticks land on a mini timeline: `B t13 · A t18 · C t21` |
| Bottom: **AVOIDANCE** (32.0–37.0) | REAL crop: the event log row `UNSAFE_DEFERRED` / the deferred-request state at t2 | `Avoidance: Banker's says not yet.` · `No cycle ever forms.` |

**Transition → S8:** the mini timeline (t13 / t18 / t21) slides down and stretches into the Gantt chart's time axis.

### S8 · Scheduling · 0:37.0–0:43.0 · REAL+SVG

| Time | Shot | On screen |
|---|---|---|
| 37.0–40.0 | REAL Scheduler Gantt crop (RR q=4, run to end), revealed left to right by a wipe that follows the axis, as if it were being scheduled | `Round Robin · quantum 4` |
| 40.0–43.0 | Crop shifts to the metrics row; SVG count-ups sit over the panel, positioned on the real numbers | `Avg waiting 8.75` · `Avg turnaround 13.50` · microtype `FCFS 8.00 / 12.75 · Priority 4.75 / 9.50 · matches the hand calculation` |

**Transition → S9:** the Gantt bars slide together into one amber bar, which becomes the baggage belt (positions 0–49).

### S9 · Real OS mechanisms · 0:43.0–0:51.0 · SVG → REAL

| Time | Shot | On screen |
|---|---|---|
| 43.0–44.5 | Belt bar + cart marker | `The baggage handler is a real process.` |
| 44.5–47.5 | Precise SVG diagram: `ENGINE · PID ####` ⇄ two pipes ⇄ `CHILD · PID ####` (the PIDs are those of the capture run). Labels appear in sequence: `fork()` · `pipe() × 2` · `poll() timeout` · `sem_t: one exchange at a time` · `waitpid()`. A light puck carries `SCHED SCAN UP …` down one pipe and `ORDER …` back up the other | — |
| 47.5–49.5 | The `ORDER` reply draws the **SCAN path** on the belt: 20 → 21 → 37 → 44 → 49 → 12 → 5 → 3 | `75 positions moved.` |
| 49.5–51.0 | **REAL** Ops-terminal crop: `sys children` (the `ps --ppid` output showing the child PID) with `sys threads` lines (`futex_do_wait`) behind | `Real PIDs. Real threads.` |

**Transition → S10:** the terminal text dims away; the SCAN polyline lifts off the belt and becomes the arc behind the end title.

### S10 · End card · 0:51.0–0:56.0 · SVG

| Time | On screen |
|---|---|
| 51.0–52.4 | `TARMAC`**`OS`**: the biggest slam of the film; amber over-bloom then develops to crisp white + amber |
| 52.4 | `An airport, run like an operating system.` |
| 52.8 | `tarmacos-kohl.vercel.app` (JetBrains Mono, amber underline draws) |
| 53.2 | `Zimran Ullah · Aadit Bhutani · Tanush Adarsh` (muted) |
| 53.2–56.0 | Hold (2.8 s, enough to read the URL); music button on the last hit |

---

## Shot sources at a glance

| Scene | Real footage | HTML/SVG | Higgsfield |
|---|---|---|---|
| S1 Hook | — | ✔ | (optional backdrop, see below) |
| S2 Idea | — | ✔ | — |
| S3 Title | — | ✔ | — |
| S4 Reveal | ✔ Overview, Busy apron, 5–7 tick sequence | captions | — |
| S5 Spike | — | ✔ | — |
| S6 Deadlock | ✔ Deadlocks tab at t8 | ✔ graph build (engine data) | — |
| S7 Two ways out | ✔ Recovery banner/log, Avoidance deferral | timeline ticks | — |
| S8 Scheduling | ✔ Gantt + metrics | wipe, count-ups | — |
| S9 Mechanisms | ✔ Ops terminal `sys children` / `sys threads` | ✔ IPC diagram, SCAN path | — |
| S10 End | — | ✔ | — |

About 24 of the 56 s show real dashboard or terminal footage; the rest are diagrams and type built from the same verified data.

### Higgsfield assessment

- **Balance: 0 credits (free plan).** Nothing can be generated without buying credits. The recommendation tool lists Seedance 2.5 / Kling 3.0 / Grok Video 1.5 for text-to-video but returns **no price**, so I cannot quote a cost; it would show at checkout.
- **Recommendation: don't use it.** The film's identity is precise graphics plus real product evidence. AI footage of an airport would add a stock-footage feel, could look like a real airport or airline, and none of the models offer 4:5 natively (it would need cropping from 3:4 or 9:16).
- **Only sensible use, if you want it:** one 4–5 s abstract, textless night-apron background (amber taxiway lights, dark navy, slow drift) behind the S1 hook, heavily darkened so the type dominates. The storyboard works fully without it.

---

## How the standalone film is rendered

1. **Real footage capture.** Run a private TarmacOS instance in WSL on port 8091 (the documented recording setup; production Render/Vercel are not touched). A new capture plan, kept in a new `promo_film/` folder that imports the existing `tutorial_video/scripts/cdp.py` without modifying it, drives the real dashboard with real clicks:
   - Busy apron (5–7 consecutive ticks)
   - deadlock DETECTION t0…t8
   - RECOVERY run
   - AVOIDANCE up to t2+
   - Scheduler RR q=4 to end
   - Baggage SCAN ↑
   - Ops terminal `sys children` + `sys threads`

   Viewport 1920×1080 at **deviceScaleFactor 2** (3840×2160 PNG), plus element rectangles and an `eval:` log of every displayed value. I compare the logged values with the table above before anything is rendered.
2. **Composition.** One HTML page per scene at 1080×1350, sharing `tokens.css` (palette copied from `app.css`), vendored fonts, and a small dependency-free timeline/easing library. Each page exposes `render(t)` and is a pure function of time. Real captures are placed as `<img>` crops: transformed only by position, scale and gentle perspective, never retouched. Overlays are drawn beside or around the UI, not over its data.
3. **Frame rendering.** Headless Chrome through CDP: set the viewport to 1080×1350, then for each frame call `render(t)`, wait one animation frame and take `Page.captureScreenshot`. 56 s × 30 fps = 1,680 frames. Fast moves (S4→S5 whip, S5 slams, S6 cycle snap) get **6 sub-frames averaged** for real motion blur.
4. **Finish.** The bundled ffmpeg 7.1 encodes PNG → H.264 (CRF 16, `yuv420p`, `+faststart`), mixes the music and sound effects, applies two-pass `loudnorm` to −14 LUFS, and checks the result (streams, loudness, contact sheet).
5. **Review gates** (so you approve before the expensive steps):
   1. **Style frames:** one still per scene (10 PNGs) after capture.
   2. **Animatic:** a half-resolution, silent, no-blur render of the full timing.
   3. **Final master**, plus a thumbnail PNG of the S1/S3 frame.

Every frame comes straight from the composition, with no device mock-up, bezel, reflection or room. The dashboard appears only as a borderless floating panel on the navy grid.

**Mobile readability rule:** in any shot where UI text must be read, the crop is at most about 760 CSS px wide, so 12–13.5 px dashboard text renders at 17 px or more in the 1080-wide frame (sharp, from the DPR-2 source). Only S4's opening establishing shot shows the whole dashboard, and it carries no information the viewer must read.

---

## Missing assets, licensing and costs

| Item | Status | What is needed |
|---|---|---|
| **Music** | **Missing** | A track licensed for use in a LinkedIn post, about 100–120 BPM, with clear hits for S5 and the end. Either supply one, or I can build a minimal **procedurally generated** bed (pulse, risers, hits from numpy noise and sine synthesis), which is licence-free but plainer. Hit points are 2.4, 10.0, 21.0/21.5/22.0, 29.0, 51.0 s. |
| Sound effects (whooshes, ticks, the cycle snap) | Missing | Generated procedurally (licence-free), or supplied with the music |
| Fonts: Inter, Inter Tight, Archivo, JetBrains Mono | Not installed | Download from Google Fonts / the official repos (OFL: free, embedding in video allowed). **Needs your OK to download.** |
| Dashboard captures | The existing October captures are 1080p (DPR 1) and from older runs | A fresh capture at DPR 2 from a local WSL engine. Needs WSL running and the built engine (`engine/build/tarmac_engine` exists). |
| Higgsfield | 0 credits | Not needed. Optional S1 backdrop only after you buy credits; price shown at checkout. |
| Voiceover | Not used | — (the film is designed for muted autoplay) |
| Brand/IP | — | No airline logos; flight codes stay as they are in the app (simulation). Team credit on the end card. The URL is shown; the private GitHub repo is not. |

**Disk/time estimate:** about 1,700 PNG frames plus sub-frames take about 3–5 GB temporarily (cleaned after encoding). Rendering takes roughly 10–20 min per full pass on this machine (estimate).

## Questions for approval

1. Approve the **56 s, 4:5** storyboard and the exact text above (or mark changes)?
2. **Music:** will you supply a licensed track, or should I make the procedural bed?
3. **Higgsfield:** skip (recommended), or buy credits for the optional S1 backdrop?
4. OK to **download the four OFL fonts** and run a private capture engine in WSL on port 8091?
5. End-card credit line: are all three names correct and wanted?
