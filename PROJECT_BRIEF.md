# PROJECT_BRIEF — CreativeDNA

**Pitch:** CreativeDNA is an AI design-repair assistant for Adobe Express. It
understands what a creative is trying to communicate, explores different ways
to satisfy new marketing constraints, verifies measurable rules, and applies a
chosen repair without flattening the design.

## Contracts (frozen — do not change silently)

Single source of truth: `backend/schemas.py` (Pydantic v2). TypeScript mirror:
`express-addon/src/shared/contracts.ts`. JSON Schema export:
`GET /api/v1/contracts.json`. `contract_version: 1`.

Wire conventions: bbox is `[x, y, width, height]` px, origin top-left; colors
are `#rrggbb`; feasibility is `feasible | infeasible | unverified`;
`provider_mode` is always truthful (`live | cached | fixture | heuristic`).

## Hard rules (all return pass / fail / unknown)

`canvas_bounds`, `safe_area` (margins + reserved top/bottom zones with
explicit exemptions), `locks` (±0.5 px tolerance), `min_font_size`,
`text_overflow` (Pillow substitute-font estimate, labeled; `unknown` when
unmeasurable), `contrast` (WCAG sRGB luminance; image-backed → `unknown`),
`forbidden_copy` (exact phrases), `containment` (CTA in its pill),
`critical_spacing` (designated pairs), `generic_overlap` (whitelisted
exemptions only), `prominence` (focal ≥ headline area).

Feasibility policy: any `fail` → infeasible; no fail but any `unknown` →
unverified (never auto-selected); all pass → verified-feasible within
implemented checks.

## Scoring

`J = 0.35·hierarchy + 0.25·grouping + 0.20·balance − 0.20·displacement`,
all terms documented in `backend/services/ranker.py`. J is a ranking utility,
not a probability.

## Owners (hackathon team of four)

- **A — Adobe:** `express-addon/` (sandbox bridge, node mapping via
  `node.addOnData`, patch apply, readback, panel, SVG previews).
- **B — Orchestration:** `backend/app.py`, `services/interpreter.py`,
  `services/strategist.py`, caching/provider adapters.
- **C — Semantics:** `services/intent.py` (focal, hierarchy, groups, locks,
  expendables — consumed by strategist and validator).
- **D — Geometry/eval:** `services/layout.py`, `placement.py`,
  `validator.py`, `ranker.py`, `benchmark.py`.

Integration rule: A+D jointly own readback/geometry mismatch; schema changes
require all four.

## Kill switches honored

- AI unavailable → labeled fixture strategies; geometry + Adobe stay live. ✅
- Page resize unsupported → fixed-canvas protected-zone repair, disclosed. ✅
- Image insertion fallback → cached authorized placeholder asset, disclosed. ✅
- All candidates fail → honest infeasibility + minimal relaxation. ✅
- Text metrics unreadable → overflow `unknown`, never false-pass. ✅
