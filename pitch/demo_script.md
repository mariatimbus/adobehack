# CreativeDNA — 90-second demo script

Brand: **LUMA SKIN** (fictional) · Product: Daily Hydration Serum ·
Palette: cream `#F4EFE8`, charcoal `#242424`, sage `#A8B6A1`, beige `#D9CFC3`.

Prereqs: backend running (`uvicorn backend.app:app --port 8765`), add-on
loaded in Adobe Express from `express-addon/` (built `dist/`). Everything
below is repeatable with no hidden manual steps.

| Time | Action | What the judge sees |
|---|---|---|
| 0–10 s | Panel → **Load campaign into Express** | 8 native nodes appear: `bg`, `deco_arch`, `brand`, `headline`, `subhead`, `hero` (authorized placeholder packshot), `cta_bg`, `cta`. Each is individually selectable/editable — no flattened image. |
| 10–20 s | **Inspect Intent** | Semantic graph: focal `hero`; copy stack group; `brand` position-locked; `hero` size-locked; `deco_arch` expendable; critical spacing headline↔hero ≥ 24 px; provenance labeled `fixture`. |
| 20–30 s | **Change Constraints** — type the compound instruction | “Use a longer headline, preserve hero size and brand position, reserve a 180px top promo zone”. Interpreter shows typed constraints + the documented demo rule: position-locked brand is explicitly exempted from the top zone (else infeasible). |
| 30–55 s | **Compare Repairs** | Three candidate cards with SVG mini-maps rendered from the *actual simulated* `resulting_spec`: (A) typography adaptation — fails safe_area (decoration can't satisfy top zone + bottom margin); (B) group reflow — fails safe_area (decoration intrudes zone); (C) expendable pruning — **feasible**, all 11 hard rules pass, J ≈ 0.73 with real metric breakdown. Red = measured failure; unknowns render differently (none here). |
| 55–75 s | Select **C** → **Apply selected repair in place** | Existing nodes update: headline text + widened box, decoration hidden via opacity 0 (documented), CTA font normalized. Post-apply report: node count 8 → 8 (**no duplicates**), matched plan, editability retained, unsupported measurements disclosed (font-size readback, canvas size). |
| 75–90 s | Click the headline on canvas, type | Native text editing works — the repair never flattened anything. Telemetry footer: provider `fixture`, total ms, cost basis “no provider called ⇒ $0.00”. |

## Failure-recovery branches (all honest)

- **Infeasible request** (e.g. “reserve a 900px top promo zone”): all three
  strategies fail with specific rules; the panel shows the explanation and a
  **minimal relaxation** (shrink the zone / drop the explicit font floor)
  that makes it solvable — never a fabricated win.
- **Forbidden copy** (“Clinically proven…”): `forbidden_copy` rule fails every
  candidate; the reason is shown verbatim.
- **Story format**: planning runs (1080×1920), but native artboard resize is
  read-only in the current Adobe SDK typings — the add-on says so and keeps
  the fixed-canvas repair path instead.

## Backup if live elements misbehave

Cached strategies are labeled `cached`/`fixture`; geometry, validation and
Adobe updates remain live even with AI offline. The benchmark CSV/JSON is
regenerable with `python -m backend.benchmark`.
