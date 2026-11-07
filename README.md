# CreativeDNA

Editable campaign studio for Adobe Express: import references, load your page,
apply brand guidelines, compare design scores, iterate and create new native
designs. Local generation and scoring are labeled as heuristics. The original
constraint-repair backend remains available separately.

Hackathon build per `CreativeDNA_3.1_Apex_Reality_Checked_Spec.md`: a narrow
workflow that actually works, with truthful labels everywhere.

## What works (verified)

| Capability | Status |
|---|---|
| FastAPI backend: typed contracts, fixtures, telemetry | ✅ tested |
| NL constraint interpretation (fixture-labeled interpreter) | ✅ tested |
| 3 meaningfully distinct repair strategies, all simulated | ✅ tested |
| Deterministic validator: pass / fail / unknown per rule | ✅ tested |
| Feasibility policy (unknown blocks auto-selection) | ✅ tested |
| Ranking with documented `J` formula on real metrics | ✅ tested |
| Infeasible-case detection + minimal relaxation suggestion | ✅ tested |
| Benchmark A/B/C ablation → CSV + JSON from real runs | ✅ reproducible |
| Express add-on: sandbox bridge, node mapping, patch apply, readback, SVG previews | ✅ builds, unit-tested; native creation also verified in Adobe Express |
| Square / Stories studio designs | ✅ new native pages; the legacy repair bridge still does not resize pages in place |

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
│   ├── src/ui/              #   React campaign studio: six sections
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
.venv/bin/python -m pytest tests/ -q          # backend tests
.venv/bin/uvicorn backend.app:app --port 8765 --reload --reload-dir backend # API + docs at /docs
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

Use `npm run adobe:start` rather than launching the Adobe CLI directly: the
wrapper also proxies `/api/v1` over the add-on's existing HTTPS connection to
FastAPI at `127.0.0.1:8765`. This lets Safari call the backend from the Adobe
panel without HTTP mixed-content failures. FastAPI must still be running.

The panel has six independently accessible sections:

1. **Import elements** — optional public Pinterest/web import or image uploads.
   Fetches real images, measures reference colors, and adds six images per
   separate native reference page. PNG/JPEG types and aspect ratios survive.
2. **Load elements** — reads the selected page, including text, images, shapes
   inside groups, stable native IDs and page-relative geometry. Loading is local.
3. **Brand guidelines** — parses Markdown tables, headline/body fonts and their
   fallbacks, sample copy and visual/copy rules. The supplied fictional AURELIA,
   PULSE and WILDFORM documents are bundled as examples. Generates three distinct
   compositions from the loaded copy and main photo. Secondary images/overlays
   are opt-in, since many imported image layers are masks or gradients.
4. **Analyze versions** — compares every loaded/generated version with evidence
   for attention potential, readability, hierarchy, CTA clarity and brand fit.
   These are local 0–100 rubric scores. Actual retention requires audience data;
   it is never invented. See [STUDIO.md](STUDIO.md) for the checks and limits.
5. **Iterations** — branches from a selected version, preserving its parent.
   Supports headline replacement, larger headlines, whitespace, CTA emphasis,
   square and Stories. Unsupported requests produce an explanation.
6. **New design** — chooses photos from the reference library and combines them
   with editable copy. A selected brand overrides reference colors. Each run
   creates three layouts, which can be compared, iterated and created natively.

`Create editable page` preserves the original. For imported native photos,
Adobe `visitPages` activates the source and the add-on clones the entire page
before reflowing its copied images within that page. This avoids unsafe stale
node handles and cross-page media reparenting. Only the newly created page is
removed if the operation fails. All visible edits run in supported Adobe edit
callbacks; browser Blobs are prepared before crossing the sandbox bridge.

The local development manifest enables experimental element renditions where
supported. Some Adobe versions cannot supply individual layer previews; this
is disclosed in the cards, while native image copies remain available. For
accurate previews on those versions, upload the main photo. Typography uses
system fallbacks declared in the supplied guidelines and reports missing
native fonts. Disable experimental APIs before distribution.

The standalone `?harness=1` workspace exports SVGs and does not impersonate
Adobe page creation. `Load the AI Expo sample` supplies example content. The
version library lasts for the open panel session; pages already created in
Adobe remain saved in the document. The previous constraint-repair endpoints,
validator, ranking and patch bridge remain available for backend/demo use;
the new studio UI presents the six workflows above.

## Honest limitations (never hidden)

1. **AI mode**: no AI-provider credentials exist in this environment. The
   interpreter and strategist are deterministic, labeled `provider_mode:
   "fixture"`. `LiveInterpreter` raises without credentials rather than
   faking output; wiring a real provider means implementing one method.
2. **Text measurement**: overflow checks use Pillow with a substitute font
   (method label `estimated_pil_substitute_font`), not Adobe's renderer.
   When measurement is unavailable, overflow is `unknown` — never `pass`.
3. **Adobe SDK**: verified against published typings v1.40.
   The studio sizes newly created/cloned pages through `PageNode.width/height`.
   The legacy repair bridge still reports canvas resizing as unsupported.
   `set_visible` maps to `opacity = 0` (documented). Font-size readback is
   not reliably exposed → post-apply reports list it as unsupported.
4. **Benchmark latency** is backend planning time. End-to-end Adobe apply
   latency is measured by the add-on at demo time (`apply_duration_ms`) —
   it is not fabricated in the backend CSV.
5. **Copy checks** are exact-phrase keyword matching, not legal review.

## Original repair demo (backend / legacy script)

See `pitch/demo_script.md`. Flagship constraint:

> “Use a longer headline, preserve hero size and brand position, reserve a
> 180px top promo zone”

Typical result: typography and reflow strategies fail with specific measured
reasons; expendable-pruning passes all 11 hard rules (J ≈ 0.73), is applied
in place to existing nodes, and the headline remains freely editable.
