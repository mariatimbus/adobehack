# CreativeDNA

AI-powered marketing design adaptation for Adobe Express — understands the
semantic intent of an editable campaign, interprets compound natural-language
constraints, generates multiple verified repair strategies, and applies the
best feasible one to **native, editable Adobe Express elements**.

Hackathon build per `CreativeDNA_3.1_Apex_Reality_Checked_Spec.md`: a narrow
workflow that actually works, with truthful labels everywhere.

## What works (verified)

| Capability | Status |
|---|---|
| FastAPI backend: typed contracts, fixtures, telemetry | ✅ tested (38 pytest tests) |
| NL constraint interpretation (fixture-labeled interpreter) | ✅ tested |
| 3 meaningfully distinct repair strategies, all simulated | ✅ tested |
| Deterministic validator: pass / fail / unknown per rule | ✅ tested |
| Feasibility policy (unknown blocks auto-selection) | ✅ tested |
| Ranking with documented `J` formula on real metrics | ✅ tested |
| Infeasible-case detection + minimal relaxation suggestion | ✅ tested |
| Benchmark A/B/C ablation → CSV + JSON from real runs | ✅ reproducible |
| Express add-on: sandbox bridge, node mapping, patch apply, readback, SVG previews | ✅ builds, unit-tested (8 vitest tests); requires Adobe Express to run |
| Square → Story native artboard resize | ⚠️ **not supported by SDK** (artboard size is read-only) — disclosed; format planning still runs server-side |

## Repository layout

```text
creativedna/
├── backend/                 # FastAPI + Pydantic v2 (Developer B/C/D services)
│   ├── schemas.py           #   frozen contracts (single source of truth)
│   ├── app.py               #   API routes + telemetry
│   ├── pipeline.py          #   interpret → plan → simulate → validate → rank
│   ├── benchmark.py         #   ablation: uniform_scale / heuristic_zones / ai_strategies
│   ├── fixtures/luma_skin.py#   the known 8-node LUMA SKIN campaign
│   └── services/            #   intent, interpreter, strategist, placement,
│                            #   layout, validator, ranker, textmetrics
├── express-addon/           # Adobe Express add-on (Developer A)
│   ├── manifest.json
│   ├── src/sandbox/code.ts  #   real document-sandbox bridge (applyDesign,
│   │                        #   applyRepairPatch, readDocumentState, verifyAppliedPatch)
│   ├── src/ui/              #   React panel: Load → Inspect → Constrain →
│   │                        #   Compare → Apply → Verify
│   ├── src/shared/          #   TS contract mirror + pure opApplier + SVG previews
│   └── test/                #   vitest unit tests
├── tests/                   # pytest: contracts, geometry, pipeline, API
└── pitch/demo_script.md     # 90-second demo script
```

## Run it

### 1. Backend (Python 3.11+)

```bash
cd creativedna
uv venv .venv && VIRTUAL_ENV=.venv uv pip install fastapi "uvicorn[standard]" pydantic pytest httpx pillow
.venv/bin/python -m pytest tests/ -q          # 38 tests
.venv/bin/uvicorn backend.app:app --port 8765 # API + docs at /docs
```

### 2. Benchmark (real executions → CSV + JSON)

```bash
.venv/bin/python -m backend.benchmark
# writes backend/benchmark_data/results.{csv,json}
```

Latest measured summary (this machine, fixture mode — re-run to reproduce):

- `ai_strategies`: feasible-case success **3/3**, false-feasible **0/2**, median ~3–6 ms per planning run.
- `uniform_scale` and `heuristic_zones`: **0/3** feasible-case success on identical inputs.
- Numbers are real executions; ground truth is documented per case, separate from predictions.

### 3. Adobe Express add-on

```bash
cd express-addon
npm install
npm test        # vitest: pure modules
npm run build   # dist/ui (panel) + dist/sandbox/code.js
```

**One-time setup (needs your macOS password to trust a local SSL cert):**

```bash
cd express-addon
npx @adobe/ccweb-add-on-ssl setup --hostname localhost
```

**Run in Adobe Express:**

```bash
cd express-addon
npm run adobe:start   # builds, packages adobe-src/, starts the dev server
```

The CLI prints an Adobe Express URL — open it while logged into
express.adobe.com. The panel creates the 8-node LUMA SKIN campaign natively,
walks the demo states, and applies the selected repair in place — no flattened
images. In the **Bring your own** section you can: replace the hero with your
own poster (native image node via `loadBitmapImage`/`createImageContainer`),
upload brand guidelines (`.txt/.md`) whose extracted palette/locks/forbidden
phrases flow into the repair pipeline, and upload inspiration images (e.g. a
Pinterest board export) for deterministic, honestly labeled style analysis.

A labeled development harness is also available outside Express:
`python3 -m http.server 8099` inside `express-addon/dist/ui`, then open
`http://localhost:8099/?harness=1` (in-memory stand-in, clearly marked as not
the Adobe integration).

## Honest limitations (never hidden)

1. **AI mode**: no AI-provider credentials exist in this environment. The
   interpreter and strategist are deterministic, labeled `provider_mode:
   "fixture"`. `LiveInterpreter` raises without credentials rather than
   faking output; wiring a real provider means implementing one method.
2. **Text measurement**: overflow checks use Pillow with a substitute font
   (method label `estimated_pil_substitute_font`), not Adobe's renderer.
   When measurement is unavailable, overflow is `unknown` — never `pass`.
3. **Adobe SDK**: verified against published typings v1.40.
   `ArtboardNode` size is read-only → no native page resize; Square → Story
   planning still runs server-side and the add-on discloses the gap.
   `set_visible` maps to `opacity = 0` (documented). Font-size readback is
   not reliably exposed → post-apply reports list it as unsupported.
4. **Benchmark latency** is backend planning time. End-to-end Adobe apply
   latency is measured by the add-on at demo time (`apply_duration_ms`) —
   it is not fabricated in the backend CSV.
5. **Copy checks** are exact-phrase keyword matching, not legal review.

## Demo (90 seconds)

See `pitch/demo_script.md`. Flagship constraint:

> “Use a longer headline, preserve hero size and brand position, reserve a
> 180px top promo zone”

Typical result: typography and reflow strategies fail with specific measured
reasons; expendable-pruning passes all 11 hard rules (J ≈ 0.73), is applied
in place to existing nodes, and the headline remains freely editable.
