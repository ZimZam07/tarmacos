# `main_demo` reference analysis and TarmacOS LinkedIn film blueprint

Status: **analysis only**. No film has been produced, the reference video was not modified, and no application, deployment or production file was changed.

Method: the video was decoded with the `ffmpeg` 7.1 binary bundled with the Python package `imageio-ffmpeg` (no system ffmpeg is installed). I made contact sheets at 2 frames per second covering the full 92.6 s, full-resolution crops at 35 key timestamps, and 6–8 fps strips across the fastest passages (0–4 s, 28.9–32.5 s and 79.6–81.6 s). I also ran a scene-change pass (threshold 0.25), an EBU R128 loudness measurement and a spectral-flux onset analysis of the audio. I could not *listen* to the audio, so every statement about sound below comes from measurement and is labelled as such.

---

## 1. Reference video metadata

| Property | Value |
|---|---|
| Path | `C:\Users\Zimran Ullah\Downloads\os_project\main_demo.MP4` (one level above this repository) |
| Container | MP4 (`isom`, compatible `isomiso2avc1mp41`), 11,632,040 bytes |
| Duration | 92.64 s (1:32.6) |
| Video | H.264 High, yuv420p, BT.709 tv-range, progressive, **720 × 1280 (9:16 portrait)**, 30 fps, about 923 kb/s, encoder tag "AVC Coding" (typical of a phone or social-app export) |
| Audio | AAC **HE-AAC**, 44.1 kHz stereo, about 74 kb/s |
| Loudness (measured) | Integrated **−14.2 LUFS**, loudness range **2.9 LU** (LRA low −15.8 / high −12.9 LUFS). It is heavily compressed and delivered at the usual social-platform target. |
| Hard cuts (scene score > 0.25) | Only **two**: 80.4 s and 86.0 s. Both are dark-to-white-paper changes inside the screen. Everything else is continuous. |
| Inner-film timecode | At 0.0 s the laptop shows player chrome reading `00:00 / 01:32`: a 1:32 film is playing full-screen. |

### What the reference actually is (essential context)

The reference is **not** a screen recording. It is a **phone-camera shot of a laptop** (an RGB-backlit gaming keyboard, in a dim room with a warm lamp at top right and a backlit blue Bombay Sapphire bottle at right) playing a motion-graphics film full-screen. On top of the phone footage sits a **static social overlay** for the entire duration:

- `Motion graphics ?` in a white condensed sans, centred near the top
- an Adobe After Effects app icon struck through with a red ✗, next to an orange Claude-style starburst icon

So there are **two layers of art direction**:

1. **The inner film:** a code-generated kinetic-typography explainer (blueprint grid, ice-white and orange type, technical diagrams). This is where nearly all of the design craft lives.
2. **The outer framing:** handheld (very slightly drifting) phone capture, real room light, screen glow spilling onto the keyboard, and the overlay question. This is what makes it feel *authentic* and "I just made this on my laptop" rather than an advert.

Both layers matter to how it lands. Only the first can be reproduced purely in software (see §6).

---

## 2. Visual-style analysis

### A. Typography

Font identifications are **closest-match estimates** made from glyph shapes in 720p phone footage of a screen. None are confirmed.

| Role | Observed treatment | Closest free alternative (OFL, Google Fonts) |
|---|---|---|
| **Opening line** "What if I told you" | Thin, hairline humanist sans in sentence case with wide spacing, drawn as a glowing light-trace (it looks like a stroke write-on), with a lens-flare "pen tip" leading each letter | Inter Thin/ExtraLight, or Manrope ExtraLight |
| **Narrative captions** ("you can create", "without even opening", "Instead of controlling…") | Bold-to-heavy neo-grotesk in sentence case with **tight negative tracking** and roughly 1.0 line height, set at about 4–6 % of screen width. Left-aligned and anchored to the grid. | Inter Tight Bold/ExtraBold |
| **Display slams** (MOTION GRAPHICS, CLAUDE OPUS 5.5, PRETTY INSANE.) | Ultra-black, slightly extended grotesk in ALL CAPS, very tight tracking, two stacked lines (the second often a different colour), filling about 75–85 % of screen width | Archivo (wdth 112–125, wght 900), or Inter Black |
| **Word slams on orange** (AND / THIS / IS / WHERE / GETS / CRAZY.) | The same black grotesk in deep navy-charcoal (about `#2a2b3d`) on full-bleed orange (about `#f08a5d`), centred, one word per beat | Archivo Black |
| **Technical microtype** (`Fig. 1`, `t = 0.000`, `0001`, axis ticks, `PROMPT`, `TO CLAUDE`, panel labels) | Tiny monospace caps at about 1 % of width, low contrast. It is texture rather than content: blueprint credibility. | JetBrains Mono / IBM Plex Mono |
| **Prompt and code** ("Create a 15-second cinematic…", `scene.ts`) | Monospace, typed character by character with a caret. Keywords get an orange underline or orange colour, and code uses syntax colours (orange numbers on white). | JetBrains Mono |
| **Paper "forms"** (FORM 2-B, FORM 9) | A grey header bar with black condensed caps (`FORM 2-B`), letter-spaced mono sub-labels, and typewriter-style mono body in grey with red-orange emphasis | Archivo Black + IBM Plex Mono |
| **Dictionary card** "pro·ce·dur·al" | A large transitional/old-style **serif** with an italic definition list: a deliberate genre shift | Instrument Serif / Newsreader |

**Hierarchy:** at most **three levels** are ever on screen: (1) one dominant line (caption or slam), (2) one supporting graphic (diagram, panel, code), and (3) microtype texture. A frame never shows two competing headlines.

**Colour as typographic emphasis:** the defining trick is a **word-level colour sweep**. As each caption is revealed, the *newest* word(s) appear in **orange** and then cool to white once the next word arrives ("you can **create**", "Instead of **controlling**", "Claude doesn't actually **generate**"). It behaves like karaoke and implicitly tracks the narration. On display slams, letters arrive in orange left to right, then cool to an **ice-white → pale-blue gradient** (MOTION GRAPHICS at 2.3–3.3 s). On CLAUDE OPUS 5.5 the reverse happens: the second line stays warm.

**How text enters, settles and exits (frame-verified):**

- **Write-on with light pen** (0.0–1.3 s): the glyphs of "What if I told you" trace in with a bright flare at the writing head. An underline then draws beneath the finished line.
- **Echo/ghost exit** (1.5 s, 35 s, 41 s): the outgoing line splits into 2–4 offset translucent copies (a stepped motion trail) while sliding up and out. A new line enters below at the same moment, so exits and entrances overlap by about 0.2–0.3 s.
- **Letter-by-letter build** for display words (about 25–30 ms per letter, `M`, `MO`, `MOTI`…), with each letter rising in from a slight blur.
- **Typewriter** for prompts and form text, at about **15 characters per second** (measured: "Does this replace" builds in about 1.1 s, 80.6–81.6 s).
- **Word slams** at **about 0.33–0.5 s per word**, measured on the 6 fps strip: `↵` 29.5 → AND 29.7 → THIS 30.0 → IS 30.4 → WHERE 30.6 → GETS 30.9 → CRAZY. 31.2–32.0. Each change is a fast vertical or zoom swap with **heavy directional motion blur** (IS → WHERE shows both words smeared together). Spectral-flux onsets at 29.4 / 29.9 / 30.3 / 30.7 s line up with these swaps, so the slams are cut to audio hits.
- **Strike-through** as text animation: "After Effects?" arrives while an orange ✗ is drawn across a fake AE timeline (5.6 s). On paper, a red-marker line is drawn left to right across the old pipeline (58–62 s).

**Typography and graphics interact constantly:** captions sit *on* the grid. Underlines extend into connector lines (the 15.3 s caption's underline continues into an L-shaped orange path), and labels are attached to diagram nodes. Type is treated as one more animated layer of the diagram, not as subtitles laid on top.

### B. Motion graphics

- **Blueprint world:** a navy grid (about `#16233a` with lighter major lines) is the constant ground. It is engineering paper, a dark-mode measurement space. Crosshair axes with tick marks sweep in (2.0–2.3 s), and a large arc or circle is drawn as a construction line.
- **Diagram language:** thin-stroke rectangles (1–2 px, white or ice blue) with mono labels (`CLAUDE / the model`, `MCP SERVER`, `AFTER EFFECTS`, `output.mp4`, `{ code }`), dashed edges, arrowheads, and small orange **spark-particle bursts** where something happens on an edge (7.6 s) or fails (an orange ✗ on "no direct path", 33.6 s). Nodes draw on, and edges grow from source to target.
- **UI pastiches:** a Graph-Editor bezier curve with handles and a cursor dragging one (13.6–15.3 s). A prompt card. A preview + chat split view in which each chat instruction shows a red/green code diff (`- transition: cut()` / `+ transition: morph(0.6, ease.inOutCubic)`) while the preview square changes colour and the scrubber moves (70–80 s). A dense field of hundreds of keyframe dots receding in perspective (76–80 s).
- **Pseudo-3D:** a **Tron-style perspective floor grid** with the prompt typed on a plane floating above it (20–29 s). **Wireframe cube, pyramid and sphere** hover in 3D (28.6 s). Panels tilt or rotate slightly on Y as they enter (41.6 s: the MOTION card swings in on a hinge with orange speed-lines). This is all flat-shaded line art. There are **no lit, textured 3D materials** anywhere. Depth comes from perspective, layering and glow, not from rendering.
- **Light and bloom:** every bright element has a soft bloom. Orange elements glow strongly, and white type has a cool halo. In the closing PRETTY INSANE. the whole slam is first bathed in a warm orange **overexposed bloom**, then "develops" to crisp white/blue + orange (91.0 → 92.4 s). That is a clean resolve.
- **Film-strip motif:** "frame by frame" shows the MOTION card duplicated into film-strip frames that slide horizontally (50.3 s), collapsing to a single frame with an orange ▶ (51.6 s). It is a literal visualisation of rendering.
- **Comic paper inserts:** two light-mode "government form" scenes (FORM 2-B *Production pipeline, motion graphics — revised edition — follow the arrows*; FORM 9 *Exit questionnaire — one answer per question — be honest*). They contain typed fields, a red marker strike-through, a rubber-stamp `NO KEYFRAMES` slapped on at an angle, and a checkbox where `NOT REALLY` gets a red ✗. This is the video's humour and its pacing relief.
- **Particles:** sparse orange sparks and a moving bright "puck" or light-dot that travels along paths (the scrubber, the arc from `idea` to the working animation at 89.5 s).

### C. Composition and art direction

- **Palette:** navy-blueprint base (about `#0f1a2e` → `#16233a`), **ice white** (about `#e8f2ff`) to **pale blue** for primary type, **one warm accent: orange** (about `#f07a3c` / `#f08a5d`), and an occasional red-orange for errors and stamps. The paper scenes invert to off-white (about `#ecebea`) with charcoal and red. Strict **one-accent discipline**: orange only ever means "this is the new or important thing."
- **Outer palette contrast:** the warm tungsten room and the cyan bottle frame the cool screen. That warm/cool split makes the phone footage look graded even though it is not.
- **Layout:** a **left-aligned** caption at upper-left or upper-centre plus **one** diagram or panel in the centre or lower half. Slams are centred. Generous negative space: the grid is visible around everything. Most frames use only about 40–60 % of the screen for content.
- **Clutter control:** microtype is tiny and low-contrast, so it reads as texture. Only one element animates "loudly" at a time. Panels share a single stroke weight and corner style. Colour is limited to white, blue and orange.
- **Balance:** about 55 % kinetic type, 35 % diagram/UI pastiche, 10 % comic paper and slam breaks. There is **no real product footage**: every "UI" is a stylised redraw. Note this for TarmacOS, where real UI is the proof.

### D. Editing, rhythm and pacing

- **One continuous camera take.** Every transition happens *inside* the screen. Caption phrases change about **every 1.5–3 s**, and a full idea (a "scene") lasts about **3–10 s**.
- **Tempo (measured, approximate):** the onset autocorrelation peaks at about 0.70 s (≈ 86 BPM) and about 0.91 s (≈ 66 BPM). It is a moderate pulse, and the word-slam passage locks to individual audio hits.
- **Audio character (measured, not heard):** the 300–3400 Hz band holds about 58 % of energy, with very little sub-150 Hz bass, and energy modulates at a 3–6 Hz syllabic rate. This is consistent with **voiceover over a light music bed**. The captions read exactly like a narration transcript ("What if I told you you can create motion graphics like this without even opening After Effects?"), so the on-screen words almost certainly mirror a spoken script. Treat this as an inference; I could not confirm it.
- **The hook (0–4 s):** a rhetorical question in delicate type on black (curiosity), then an immediate jump to the loudest typographic moment of the first half (MOTION GRAPHICS in about 1 s of build). The overlay question + crossed-out AE icon gives the premise in under a second, even muted.
- **Build:** problem (AE timeline crossed out) → reveal (CLAUDE OPUS 5.5) → mechanism (prompt → code → frames) → **mid-point energy spike** (orange word slams at 29–32 s, almost exactly 1/3 of the way in) → proof of control (chat edits) → comic reality check (FORM 9: "NOT REALLY") → resolve.
- **Ending (86–92.6 s):** it returns from the light paper to the navy grid, a single arc connects `idea` → working animation, then the biggest slam of the film, PRETTY INSANE., with a bloom that settles. The final frame is held for under 1 s. It ends on the emotional verdict, not on a logo or CTA.

### E. Production quality: what makes it polished

**Essential to its identity:**

1. A coherent **design system**: one grid, one accent colour, three type roles, one stroke weight.
2. **Word-level colour sweep** synced to the voice, so the text always tracks the speaker.
3. **Overlapping transitions** (the exit trail overlaps the next entrance). Nothing ever cuts to black or idles.
4. **Diagrams as explanation**: every abstract claim gets a node/edge picture.
5. **Rhythmic contrast**: navy ↔ orange slams ↔ white paper, used sparingly (once for the slams, twice for paper).
6. **The authenticity frame**: phone-filmed laptop plus overlay question.
7. **Bloom and soft glow** on bright elements, which is what makes it "cinematic" rather than flat.

**Decorative (nice, not load-bearing):** wireframe primitives, Tron floor, spark bursts, microtype annotations, the dictionary serif card, the room props and RGB keyboard.

---

## 3. Timestamped scene breakdown

Timestamps are taken from frame sampling: they are accurate to about ±0.25 s at 2 fps and about ±0.1 s in the 6–8 fps passages. Bracketed words were cut off or partly visible and are inferred.

| Timestamp | What appears | Typography | Motion and transition | Camera/composition | Why it works |
|---|---|---|---|---|---|
| 0.0–1.4 | Black screen with corner crop marks and player timecode `00:00 / 01:32`. "What if I told you" | Hairline sans, sentence case, glowing | Stroke write-on with a flare at the pen tip; an underline draws in | Phone on laptop, centred text; overlay "Motion graphics ?" + struck AE icon / Claude icon | Curiosity hook; the overlay gives the premise before a word is read |
| 1.4–2.2 | The line exits; "you can create" enters bottom-left | Bold tight grotesk; "create" orange | Echo/ghost trail exit up; crosshair axes + construction arc sweep in; grid fades up | Left-aligned caption on emerging grid | Overlapped exit/entry keeps momentum |
| 2.2–3.7 | **MOTION / GRAPHICS** + "like this" | Ultra-black caps, two lines; letters land orange, then cool to ice-white/blue | Letter-by-letter build about 25–30 ms/letter; bloom | Fills about 80 % of width; small timeline callout lower right | First big visual payoff by 3 s |
| 3.7–6.4 | Fake AE timeline (TEXT 01, SHAPE 02, CAMERA…) is crossed out by an orange ✗; "without even opening / **After Effects?**" | Caption + heavy two-colour slam (After white / Effects orange / "ts?" outlined) | The ✗ draws diagonally; the slam rises in; outline letters fill | Panel centre, slam bottom-left | Names the incumbent and dismisses it visually |
| 6.4–10.0 | "And no —" + diagram CLAUDE → MCP SERVER → AFTER EFFECTS, spark burst on the first edge; "I'm not talking about an After Effects [plugin]" | Heavy caption with an em-dash; mono node labels | Nodes draw on, edges grow, particle burst; exit with RGB/blur smear | Horizontal three-node flow mid-screen | Pre-empts the obvious objection with a diagram |
| 10.0–12.9 | "This is" / **CLAUDE / OPUS 5.5** + spec table (`MODEL claude-opus-5-5`, `MEDIUM words in, code out`) | Ice-white CLAUDE, warm OPUS, orange "5.5" | An orange rule wipes in, letters build, the version digits flicker in | Centred slam with a hairline rule frame | The reveal moment, formatted like a product spec sheet |
| 12.9–15.5 | "Instead of controlling / After Effects," + Graph-Editor bezier, cursor dragging a handle (`manual adjustments: 1 → 4`) | Caption with orange sweep | Curve reshapes while the cursor drags; counter increments | Panel centre-left | Dramatises the tedium it replaces |
| 15.5–19.0 | "you basically / tell Claude" + prompt card "what you want the animation to look like." | Caption + mono prompt text with underline | The underline grows into an L-path that becomes the card; text types | Card centre | Turns the claim into an interface |
| 19.0–29.4 | "For example:" then **3D floor grid**; the prompt types in mono: "Create a 15-second cinematic motion graphics sequence with kinetic typography, smooth shape transitions, 3D elements and seamless camera movement." Keyword chips + token panel; wireframe cube/pyramid/sphere float up | Large mono, about 15 cps, orange underline on keywords | Camera dolly/tilt over the perspective floor; text plane tracks; 3D primitives rise | Low-angle perspective, text above the horizon | The longest beat (about 10 s); the typing gives the viewer reading time |
| 29.4–32.3 | `↵` then **AND · THIS · IS · WHERE · IT · GETS · CRAZY.** on full-bleed orange | Black grotesk, charcoal on orange | Whip-zoom into the orange square; word swaps every 0.3–0.5 s with motion blur, cut to audio onsets | Centred, one word per frame | Mid-film energy spike and colour shock; the only full-bleed colour moment |
| 32.3–36.0 | "Claude doesn't actually generate / an MP4 directly." Diagram CLAUDE ⇢ ✗ "no direct path" ⇢ output.mp4 (`0 bytes, not generated`), then a route via **{ code }** | Caption with sweep | ✗ spark; the path re-routes down → `{ code }` → up to the file; exit with ghost trail | Three-node L-route | Corrects a misconception and teaches the mechanism |
| 36.0–48.0 | "It writes the animation itself as code." `scene.ts` code panel + live MOTION preview with labelled parts (The text, transitions, particles, positions, shapes, easing); "— basically every visual element is defined mathematically over time." + `x(t) = x₀ + (x₁ − x₀)·e(t)` | Caption + syntax-coloured mono + italic math | The preview card swings in on a 3D hinge with speed lines; labels pop on in turn; easing inset | Code left, preview right: a split composition | Credibility: shows the real substance |
| 48.0–52.0 | "Then that code is rendered / frame by frame / and turned into a video." MOTION card → film strip → ▶ tile | Caption with sweep | The card duplicates into a sliding film strip and collapses into a player with an orange ▶ | Horizontal strip across the full width | Literal, memorable metaphor |
| 52.0–62.5 | Paper **FORM 2-B**: "So instead of:" After Effects → layers → keyframes → graph editor → render, struck through by a red marker; "you're essentially doing:" Prompt → code → render → video + stamp **NO KEYFRAMES** | Black condensed header, mono form text, red emphasis | Fade to white (the camera auto-exposure visibly shifts); fields type in; the marker line draws; the stamp slams at an angle | Document layout, top-aligned | Comic register change; makes before/after explicit |
| 62.5–65.0 | Back to the grid: "And because the animation is **procedural**," + dictionary card *pro·ce·dur·al (adj.) 1. made by a procedure, not stored by hand 2. of an animation: a function of time, f(t). Change the function and every frame follows.* | Serif display + italic list | The serif writes on; orange sweep on "procedural" | Left-aligned card | A genre shift gives variety and the key concept in one line |
| 65.0–77.0 | "you can literally tell Claude:" PREVIEW (glowing square/circle morphing, scrubber) + CHAT column: "Make this transition smoother." / "Change the colour." / "Slow this section down." / "Make the ending seamlessly loop into the beginning." each with a code diff; "And it can modify the underlying [code]" + loop diagram | Caption + mono chat + diff colours | Each request types in, its diff appears, and the preview responds (white → orange, square ↔ circle) | Split view, preview left / chat right | Shows iteration and control, the real benefit |
| 77.0–80.4 | "Instead of you manually moving / hundreds of keyframes." over a perspective field of keyframe dots | Caption, orange "keyframes" | Dense dot field drifts in depth | Full-width texture | Visual weight of "hundreds" |
| 80.4–86.0 | **Hard cut** to paper **FORM 9** *Exit questionnaire*: "Does this replace After Effects?" ☐ YES ☐ NO ☒ NOT REALLY; "But for certain types o[f motion graphics]:" ☑ kinetic typography ☑ diagrams and explainers ☐ chart… | Header + typewriter mono | Typewriter about 15 cps; the page scrolls; checkboxes tick | Document | Honesty beat that disarms the scepticism of "AI hype" |
| 86.0–91.0 | **Hard cut** back to the grid: "the fact that you can go from an / **idea** / [without] / to a working **animation**" with a glowing arc from the `idea` node to a playing preview | Caption with sweep | The arc draws, a light puck travels along it, "without [touching a timeline]" types under it | Left node → right panel | Restates the whole thesis in one gesture |
| 91.0–92.6 | **PRETTY / INSANE.** | Ultra-black two-line slam | Orange over-bloom flash develops into crisp white/blue + orange; a construction arc behind it; hold < 1 s | Centred, about 85 % of width | An emotional verdict as the button, with the bloom settle as the resolve |

---

## 4. Typography and animation observations (production rules distilled)

1. **Three type roles plus microtype.** Never mix more than one display line with one caption.
2. **Caption = narration.** Phrases of 2–6 words, revealed word by word. The newest word is accent-coloured for about 0.3–0.6 s, then cools to white.
3. **Slam = verdict.** 1–2 words per line in ultra-black caps, built letter by letter (about 25–30 ms stagger) with blur-in. Use only at section peaks (about 4 times in 92 s).
4. **Typewriter = evidence** (prompts, code, forms) at about 15 cps with a visible caret.
5. **Exit with a trail, enter on the overlap** (about 0.2–0.3 s), so there is never a dead frame.
6. **One accent colour** with fixed semantics: orange = new or important / action / failure.
7. **Motion blur on every fast move**; ease-out (expo or cubic) on settle. Nothing moves linearly except scrubbers and the typewriter.
8. **Bloom** on bright type and accent elements; a stronger bloom only on the final slam.

## 5. Camera, transition and compositing techniques

| Technique | Where | Notes for reproduction |
|---|---|---|
| Continuous single take (outer) | Whole film | Phone handheld, slight drift, fixed framing |
| In-screen push/dolly | 19–29 s, 36–48 s | A virtual camera over 2D/3D planes |
| Perspective floor grid + floating text plane | 19–29 s | A CSS 3D transform (`perspective`, `rotateX`) or a WebGL plane |
| Y-axis hinge swing-in with speed lines | 41.6 s | CSS 3D `rotateY` + a motion-blurred streak layer |
| Ghost/echo trail exits | 1.5, 9.6, 35, 41 s | 3–4 delayed copies at decreasing opacity, or temporal frame blending |
| Whip-zoom into a colour field | 29.4–29.7 s | Scale an element up past the frame + radial/directional blur |
| Motion-blurred word swaps | 29.7–32 s | Sub-frame accumulation (render N sub-frames and average) |
| Chromatic/RGB smear | 9.6 s, 35 s | Offset R/G/B copies of a layer |
| Over-bloom → develop | 91–92.4 s | Gaussian-blurred additive glow layer whose intensity animates down |
| Brightness cut to white paper | 52, 80.4 s | In the reference this is a camera exposure response; in software, fade with a short over-exposure |
| Static overlay (outer) | Whole film | Text + two icons composited over the phone video |

---

## 6. Production feasibility (environment checked, not assumed)

### What is installed or available (verified on this machine, 2026-10-25)

| Capability | Status | Evidence |
|---|---|---|
| FFmpeg | **Available as a bundled binary**: `ffmpeg 7.1` (gyan.dev essentials) inside `imageio-ffmpeg 0.6.0`. Not on PATH, and there is no system `ffprobe`. | Includes libx264/x265, libfreetype, harfbuzz, libass, librubberband and the `tmix`/`minterpolate` filters |
| Headless browser | **Google Chrome 155** installed, plus Edge 155 | `C:\Program Files\Google\Chrome\Application\chrome.exe` |
| Browser automation | **Already built in this repo**: `tutorial_video/scripts/cdp.py` (standard library DevTools client: headless Chrome, real clicks, `Page.captureScreenshot`, device metrics) and `capture.py` (scripted dashboard capture plans) | Used to make the six tutorial lessons |
| Python | 3.14.2 with numpy 2.4, Pillow 12.2, OpenCV 5.0, SciPy 1.17, matplotlib, fontTools, **piper-tts 1.8 + onnxruntime** (offline TTS voice `en_US-lessac-medium` in `tutorial_video/voices/`) | `pip list` |
| Node.js | Installed (`node`, `npm`, `npx`); global packages: only `pnpm`. **No** Puppeteer, Playwright, Remotion or Motion Canvas installed. | `npm ls -g` |
| The real app | **WSL2 Ubuntu running**, so the engine can be run locally (the documented recording instance on port 8091). The live deployment answered HTTP 200 (dashboard 0.14 s, Render bridge 0.36 s when warm). | `wsl -l -v`, `curl` |
| Fonts | Locally only Segoe UI, Bahnschrift, Consolas and Impact. **Inter, JetBrains Mono, Archivo and Instrument Serif are not installed.** Google Fonts is reachable (HTTP 200), so OFL fonts can be downloaded and vendored. | `C:\Windows\Fonts` listing |
| Blender | **Not installed** | not on PATH, no `Blender Foundation` folder |
| After Effects / NLE | **None found** | — |
| ImageMagick | Not installed (`convert` resolves to Windows' disk tool) | — |
| Music library | **No music asset in the project** | — |
| GPU | Not confirmed; the existing CDP launcher uses `--disable-gpu`, so WebGL would fall back to software rendering | — |

### Recommended technique: deterministic HTML/CSS/SVG/Canvas → headless Chrome frames → FFmpeg

Each scene is a web page exposing `render(t)`. A capture script steps `t` at exactly 1/30 s, calls `render(t)` and screenshots via CDP (the same mechanism as `cdp.py`). FFmpeg then encodes the PNG sequence and muxes audio. The approach is deterministic, independent of frame rate, uses the dashboard's own web stack and fonts, and needs nothing new installed apart from vendored OFL font files.

| Effect | Feasibility | Method |
|---|---|---|
| Blueprint grid, diagrams, node/edge draw-ons, arcs, light pucks | **Faithful** | SVG `stroke-dashoffset`, canvas |
| Word-by-word captions with colour sweep, letter builds, typewriter | **Faithful** | DOM spans with per-word/letter timing functions |
| Ultra-black display slams, word slams on colour | **Faithful** (once fonts are vendored) | CSS + Archivo / Inter Black |
| Bloom/glow | **Faithful** | Layered `filter: blur()` copies with `mix-blend-mode: screen`, or canvas |
| Perspective floor, hinge swings, 3D wireframe primitives | **Good approximation** | CSS 3D transforms; wireframes as projected SVG lines (no WebGL needed) |
| Motion blur on slams and whips | **Good approximation** | Render 4–8 sub-frames per output frame and average them (numpy or `tmix`); this multiplies capture time |
| Ghost/echo trails, RGB smear | **Faithful** | Duplicated layers with time offsets and colour channels |
| **Real TarmacOS UI** inside the composition | **Faithful, and better than the reference** | Fresh `capture.py` screenshots at `deviceScaleFactor: 2` (3840×2160) from a local engine, so crops and zooms stay crisp; step-by-step captures (one per tick) become animated sequences (deadlock forming, Gantt growing) |
| Lit, textured 3D (a modelled aircraft, an apron in 3D) | **Impractical** without Blender; a three.js scene in software WebGL is possible but slow and off-style. The reference uses none, so it is not needed. | — |
| Phone-filmed "laptop in a room" outer layer | **Not reproducible in software convincingly.** A CSS laptop mock-up looks like a template. **Practical option:** you film your own laptop playing the finished inner film with your phone, exactly as the reference was made. | Optional |
| Voiceover | Possible with Piper offline TTS, but a synthetic voice would undercut a polished promo. A recorded human VO is better if wanted. | Optional |
| Music | **Not available locally.** You would need to supply a track you are licensed to use; generating one with numpy is possible but would sound amateur. | Needs user input |

---

## 7. TarmacOS: what it is and what is worth showing

**Purpose:** an Operating Systems Lab mini-project (course 24B11CS312) by Zimran Ullah, Aadit Bhutani and Tanush Adarsh. It is an interactive **airport ground-operations control centre** in which OS concepts are the operating logic: flights = processes, ground services = POSIX threads, gates/fuel trucks/tugs = shared resources, the baggage cart = a disk head, and a **real forked child process** plans the cart's route over pipes.

**Audience of the film:** technical recruiters, software engineers and engineering managers. They need, fast: *what is it, is it real engineering, and is it different from a typical student project?*

**Architecture (verified in source and docs):**

- **Engine:** C++17 on Linux, about 4,600 lines in `engine/src/`, with direct POSIX use (`fork`, `pipe`, `poll`, `waitpid`, `pthread_*`, `sem_*`). No third-party libraries and no `std::thread`.
- **Deterministic lockstep:** real threads block for real, but all shared decisions are resolved at end-of-tick in a fixed order. Every scenario run is byte-identical, and the golden tests check this over 10 runs.
- **Bridge:** Python standard library only (about 790 lines), HTTP + Server-Sent Events. The engine is driven over stdin/stdout JSON lines. In public mode it runs **one isolated engine per browser session**, with caps.
- **Dashboard:** plain HTML/CSS/ES modules (about 2,000 lines), with no framework and no build step. It renders engine snapshots only.
- **Tests:** 31 unit tests (105 checks), 74 golden end-to-end checks, and 13 bridge tests (README "Last result": 0 failures).
- **Deployed:** https://tarmacos-kohl.vercel.app (Vercel dashboard + Render engine/bridge).

**Visual identity (from `web/css/app.css`):** deep-navy apron `#0a111e` / panels `#111b2e`, **taxiway amber `#f0b43c`** as the accent, ATC blue `#4ba3e3`, and state colours green `#3fc98c` / amber / red `#ef6461` / violet `#a48cf0`. The fonts are Inter and JetBrains Mono, falling back to Segoe UI and Consolas when not installed. This **already resembles the reference's art direction**: navy + one warm accent + white + mono microtype. The film can use TarmacOS's own amber where the reference uses orange, and it will feel native to the product.

**Strongest demonstrable moments (all real, from the README demo and the existing captures):**

| Rank | Moment | Why it is visual | Real values to show |
|---|---|---|---|
| 1 | **Three-way deadlock**: A/B/C take Gate 3, the fuel truck and the tug; the resource-allocation graph turns **red** at t8 ("deadlock detected"). Then **Recovery** rolls victim C back and everyone finishes. | A cycle forming is instantly readable, has drama and resolves | Detect at t8; finishes at t=13 (B), 18 (A), 21 (C) |
| 2 | **Avoidance (Banker's)**: C's tug request is *deferred* at t2, so no cycle ever forms | A "prevented disaster" beat, the counterpart to #1 | Deferred at t2; safe sequence ⟨P1, P2, P3⟩ in the BANKER-REF example |
| 3 | **Busy apron overview**: five flights, colour-coded state chips, 3 gates, 1 truck, 1 tug, an amber CART on the belt | The "airport OS" concept in one frame | 5 flights; live KPIs |
| 4 | **Scheduler Gantt** (RR q=4), built tick by tick | Colourful bars grow on a timeline | Avg WT 8.75 / TAT 13.50 (FCFS 8.00/12.75, Priority 4.75/9.50) |
| 5 | **Baggage cart = disk head (SCAN)** planned by a **real child PID** over pipes | An amber polyline path, plus a "real PID" proof | 21 → 37 → 44 → 49 → 12 → 5 → 3, total 75 |
| 6 | **Ops terminal: `sys threads`** showing real Linux TIDs in `futex_do_wait` / `anon_pipe_read` | The "this isn't fake" proof engineers respect | Real `ps -T` output (IDs change per run) |
| 7 | **Memory: FIFO paging** with a reference string and page-fault cells | Grid of red FAULT / green HIT cells | 15 faults (Silberschatz, 3 frames) |

**What makes it different from a typical student project:** real kernel-level primitives rather than a simulated toy, determinism *despite* real concurrency, a working public deployment with per-visitor isolated engines, a framework-free stack, golden tests, and a **domain metaphor** that makes OS theory tangible to non-specialists.

**Honesty constraints the film must respect** (from the README "Limitations"):

- Flights are **logical** processes (SPIDs). **Only the baggage handler is a real OS process.** Never say "each flight is a Linux process." "Each ground service is a real POSIX thread" is true.
- Memory and disk are **algorithm simulations**; no real memory or disk is managed.
- Time is in discrete ticks.

---

## 8. Proposed LinkedIn film concept

### Working title: **"Flights are processes."**

A text-led kinetic film in the reference's grammar (blueprint grid, word-sweep captions, black slams, diagrams, one comic paper insert), but with the **real TarmacOS dashboard as the hero footage**, which is the one ingredient the reference lacks.

### Format recommendation

| Decision | Recommendation | Reasoning |
|---|---|---|
| **Duration** | **about 45 s** (target 42–48 s) | The reference needs 92 s because it explains a workflow *and* tells jokes. Its own premise → reveal → mechanism → spike arc fits in about 32 s. The TarmacOS story (concept → product → three proof moments → architecture → end card) needs about 45 s at the reference's caption rate (a phrase every 1.5–3 s). Feed viewers decide within the first 2–3 s, and recruiters rarely watch a 90 s student-project video to the end. Optionally add a 15 s cut-down (hook + deadlock + end card). |
| **Aspect ratio** | **4:5 portrait, 1080 × 1350** master | The reference is 9:16 because it is phone footage. LinkedIn's feed is used heavily on mobile, where a taller frame takes more of the screen. 4:5 still looks deliberate on desktop and leaves room above and below a 16:9 UI crop for kinetic type. Optional 16:9 1920×1080 alternate for a website or desktop embed. |
| **Frame rate** | 30 fps | Matches the reference; smooth type motion |
| **Encoding** | H.264 High, yuv420p, about 12–16 Mb/s, AAC 48 kHz, **−14 LUFS** integrated (the reference measures −14.2) | Survives LinkedIn re-encoding; loudness parity with the reference |
| **Sound** | Music bed with hits on the slams; **no voiceover** | Feed video usually autoplays **muted**, so the on-screen words must carry everything, as the reference's captions already do. A synthetic voice would cheapen it. |
| **Outer layer** | Software-only (clean full-frame) by default; *optionally* you film your laptop playing it, reference-style | See §6: the phone frame cannot be faked convincingly |

### Scene structure (about 45 s, estimates)

| # | Time | Beat | On-screen (draft copy) | Visual | Real UI? |
|---|---|---|---|---|---|
| 1 | 0.0–2.5 | **Hook** | "What if an airport / ran like an **operating system**?" | Hairline write-on on black; the grid and an amber runway centreline draw in | — |
| 2 | 2.5–7.5 | **The mapping** | FLIGHTS → **PROCESSES** · GROUND CREWS → **THREADS** · GATES → **RESOURCES** · BAGGAGE CART → **DISK HEAD** | Four quick swaps (about 1.2 s each); the left word morphs into the right, which lands in amber | — |
| 3 | 7.5–10.0 | **Title slam** | **TARMAC / OS** · "Airport ground operations, run by a real C++ engine" | Black slam, letter build, bloom; spec-sheet microtype (`C++17 · POSIX threads · fork/pipe`) | — |
| 4 | 10.0–15.0 | **Product reveal** | "Every value on screen comes from the engine." | The real Busy-apron overview swings in on a hinge, then a slow push to the apron map and state chips | **Yes** |
| 5 | 15.0–17.0 | **Spike** (amber slams) | AND · THEN · IT · DEADLOCKS. | Full-bleed **amber** word slams cut to music hits, like the reference's orange beat | — |
| 6 | 17.0–23.5 | **Deadlock** | "A holds the gate. B holds the truck. C holds the tug." → **DEADLOCK DETECTED · t8** | Real Deadlocks tab, stepped captures t0→t8; the graph edges turn red; a vector highlight traces the cycle | **Yes** |
| 7 | 23.5–27.5 | **Recovery / avoidance** | "Recovery rolls back C." · "Or Banker's says no, and it never forms." | Cycle breaks; split: Recovery result ↔ Avoidance "deferred at t2" | **Yes** |
| 8 | 27.5–31.5 | **Scheduler** | "Round Robin, q = 4" · WT **8.75** · TAT **13.50** | The real Gantt builds tick by tick; numbers count up | **Yes** |
| 9 | 31.5–36.0 | **"It's real."** | "Not simulated threads. Real ones." · `ps -T` | The real Ops terminal types `sys threads`; TIDs and `futex_do_wait` glow; then SCAN path 21→37→44→49→12→5→3 drawn by a **real child PID** | **Yes** |
| 10 | 36.0–39.5 | **Comic paper insert** | FLIGHT STRIP / *Exam question vs. this project*: ☒ draw a Gantt chart by hand ☑ run it on real threads | A light paper scene (a flight-progress strip or boarding pass instead of the reference's "FORM") with a marker strike and an amber stamp **DETERMINISTIC ×10** | — |
| 11 | 39.5–43.0 | **Architecture** | C++17 engine → Python bridge → vanilla JS · "105 + 74 checks · 0 failures" | A three-node diagram with a pipe/SSE light puck; one session = one isolated engine | — |
| 12 | 43.0–46.0 | **Resolve** | **TARMAC / OS** · `tarmacos-kohl.vercel.app` · team credit | Big slam, over-bloom → develop (the reference's ending technique); hold 1.5 s for the URL | — |

All numbers above come from the README's verified demo values. They should be **re-read from the actual capture run** (as the tutorial pipeline already does with its `eval:` lines) before rendering.

### Copy principles

- Lines of 2–6 words; the newest word in amber; one claim per beat.
- Claims are limited to what the engine really does (see §7 honesty constraints).
- First frame = the hook text (it doubles as the thumbnail if LinkedIn autoplay is off).

---

## 9. Recommended production pipeline

```
 (1) Capture real UI                (2) Compose scenes            (3) Render frames            (4) Finish
 WSL: bridge on :8091          →    film/scenes/*.html        →   CDP: render(t) per frame →   ffmpeg (imageio-ffmpeg 7.1)
 capture.py plan @ DPR 2            render(t) deterministic       Page.captureScreenshot      PNG seq → H.264 1080×1350
 per-tick PNG + rect JSON           vendored OFL fonts            optional N-subframe          music mux, loudnorm −14 LUFS
 eval: log of real values           design tokens = app.css       motion blur (numpy)          contact-sheet QA
```

1. **Fonts:** download OFL fonts (Inter / Inter Tight, Archivo, JetBrains Mono, optionally Instrument Serif) into a film-assets folder. This needs your approval because it is a download.
2. **Capture:** start a private recording engine in WSL on port 8091 (as `tutorial_video/README.md` documents), add a new capture plan (Busy apron, Deadlock DETECTION step t0…t8, RECOVERY run, AVOIDANCE t2, RR to end, SCAN ↑, `sys threads`) at **deviceScaleFactor 2**, and log the real values. Do **not** record against the production Render service: per-IP session caps and restarts (see DEPLOYMENT.md).
3. **Compose:** one HTML file per scene sharing a `tokens.css` copied from `app.css`. A small timeline library (pure JS easing + keyframe helpers, no CDN dependency) and an SVG/DOM kinetic-type module (word sweep, letter build, typewriter, ghost trail, bloom).
4. **Render:** extend the CDP client with a frame loop: `Emulation.setDeviceMetricsOverride(1080×1350)`, call `render(t)`, wait for `requestAnimationFrame`, screenshot. 45 s × 30 fps = 1,350 frames. Use sub-frame motion blur only on fast beats (slams, whips) to limit render time.
5. **Finish:** encode with libx264 (CRF about 16, `-pix_fmt yuv420p`, `+faststart`), add music with hits aligned to the slam timestamps, run two-pass `loudnorm` to −14 LUFS, then QA with the existing `inspect_video.py` (streams, loudness, contact sheets).
6. **Optional outer layer:** play the finished film full-screen on your laptop in a dim room and film it with your phone, as in the reference.

Everything new would live in a separate folder (for example `promo_film/`), like `tutorial_video/`, without touching `engine/`, `bridge/`, `web/` or the deployment configuration.

---

## 10. Risks and technical constraints

| Risk | Impact | Mitigation |
|---|---|---|
| **Readability on mobile:** the dashboard uses 12–13.5 px text at 1920 px width; shown whole in a 1080-wide frame it is illegible | High | Never show the full dashboard for long; crop and zoom into one panel per beat, use DPR 2 captures, and put the *message* in kinetic type, not in UI text |
| **No music asset** | High for polish | You supply a track you are licensed to use (or approve a simple generated pulse as a placeholder) |
| **Overclaiming** ("every flight is a Linux process") | Credibility with engineers | Use the §7 honesty constraints; re-verify every number from the capture log |
| **Fonts not installed** | Medium | Vendor OFL fonts; never rely on system fallbacks during render |
| **Render time:** CDP screenshot loop, and motion blur multiplies it | Medium | Sub-frames only on fast beats; preview renders at half resolution; per-scene caching |
| **Software WebGL** (`--disable-gpu`) | Low | Avoid WebGL; CSS 3D and SVG cover every effect needed |
| **Live demo cold start:** Render Free sleeps, so the first visitor from LinkedIn may wait; restarts wipe sessions; per-IP cap of 4 | Medium (viewer experience) | Mention "may take a moment to wake" in the post text, or wake it before posting; don't push backend changes after posting |
| **Repository is private** (`github.com/ZimZam07/tarmacos`) | Medium | Show only the live URL on the end card, unless you decide to make the repo public |
| **Team credit:** three authors | Reputational | Include teammates on the end card and in the post |
| **Flight codes resemble real airline designators** (AI, 6E, UK, SG, IX) | Low | No airline logos or branding; it is labelled a simulation |
| **Reference is a phone capture of a screen:** some colours and fine details are approximate (estimated hex values, font matches) | Low | Treat the §2 values as art-direction targets, not specs |
| **LinkedIn specifics** (Projects-section video support, autoplay and thumbnail behaviour) were not verified | Low–medium | Check at upload; keep a strong first frame and a separate thumbnail PNG ready |
| **Thread and process IDs change** per engine run | Low | Capture once, then keep copy and captures in sync (the `tutorial_video` README already warns about this) |

---

*Working files for this analysis (contact sheets, crops, extracted mono audio) are in the session scratchpad, not in the repository.*
