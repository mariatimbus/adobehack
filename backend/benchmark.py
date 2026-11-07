"""Reproducible benchmark (spec §11): Baseline A vs Baseline B vs CreativeDNA.

Every number comes from an actual execution in this process. Nothing is
hardcoded. Ground truth (feasible / infeasible) is documented per case
separately from solver predictions.

  Baseline A — uniform_scale:      naive scale, no semantics
  Baseline B — heuristic_zones:    responsive zone template, no AI strategies
  C        — ai_strategies:        intent-driven candidate generation + same validator
"""

from __future__ import annotations

import csv
import json
import statistics
import time
from pathlib import Path

from .fixtures.luma_skin import DEMO_RULES, FORBIDDEN_PHRASES, luma_intent_graph, luma_spec
from .schemas import (
    CandidateResult,
    CandidateValidation,
    Feasibility,
    ProviderMode,
)
from .pipeline import build_candidates, select_best
from .services import validator
from .services.layout import apply_operations, scale_spec
from .services.placement import zone_layout
from .services.strategist import StrategyConfig, validate_operations
from .services.interpreter import RuleInterpreter

OUT_DIR = Path(__file__).parent / "benchmark_data"

LONG_HEADLINE = "Hydration that adapts to your skin barrier all day"

# Ground truth is documented separately from predictions (spec §11).
CASES = [
    {
        "case_id": "case-01-topzone-longheadline",
        "instruction": "Use a longer headline, preserve hero size and brand position, "
                       "reserve a 180px top promo zone",
        "headline_text": LONG_HEADLINE,
        "ground_truth": "feasible",
        "notes": "Flagship compound constraint (spec §5 fixture)",
    },
    {
        "case_id": "case-02-infeasible-topzone",
        "instruction": "Preserve brand position and hero size, reserve a 900px top promo zone, "
                       "keep the headline font above 60px",
        "headline_text": LONG_HEADLINE,
        "ground_truth": "infeasible",
        "notes": "Brand locked at y=64 inside a 900px zone; only a tiny canvas strip remains. "
                 "Minimal relaxation: shrink the zone.",
    },
    {
        "case_id": "case-03-story-format",
        "instruction": "Adapt this campaign for Instagram Stories, keep the CTA visible, "
                       "preserve hero size",
        "headline_text": None,
        "ground_truth": "feasible",
        "notes": "1080x1080 -> 1080x1920 format adaptation with locks",
    },
    {
        "case_id": "case-04-forbidden-copy",
        "instruction": "Use the headline 'Clinically proven hydration, guaranteed results' "
                       "and preserve hero size and brand position",
        "headline_text": None,
        "ground_truth": "infeasible",
        "notes": "Forbidden marketing claims must be rejected by the copy rule",
    },
    {
        "case_id": "case-05-bottomzone-reflow",
        "instruction": "Reserve a 200px bottom promo zone and keep the CTA visible",
        "headline_text": None,
        "ground_truth": "feasible",
        "notes": "CTA must move up out of the reserved bottom strip",
    },
]

VARIANTS = ["uniform_scale", "heuristic_zones", "ai_strategies"]


def _config() -> StrategyConfig:
    return StrategyConfig(safe_margin_px=DEMO_RULES["safe_margin_px"],
                          role_font_floors=DEMO_RULES["min_font_size_role"])


def _validate(spec, base, constraints, intent) -> CandidateValidation:
    cfg = _config()
    return validator.validate(spec, base, constraints, intent,
                              safe_margin_px=cfg.safe_margin_px,
                              role_font_floors=cfg.role_font_floors)


def run_variant(variant: str, spec, intent, constraints) -> tuple[CandidateResult, float]:
    """Execute one variant, returning (best_or_representative_candidate, latency_ms)."""
    cfg = _config()
    t0 = time.perf_counter()

    if variant == "uniform_scale":
        from .schemas import Canvas
        target = constraints.format_target if constraints and constraints.format_target else None
        if target:
            s = min(target.width / spec.canvas.width, target.height / spec.canvas.height)
            result = scale_spec(spec, s, s)
            result = result.copy_with(canvas=Canvas(width=target.width, height=target.height))
        else:
            result = scale_spec(spec, 1.0, 1.0)  # fixed canvas: naive scale is a no-op
        ops = []
        provider: ProviderMode = "heuristic"
        strat = "uniform_scale"
    elif variant == "heuristic_zones":
        from .schemas import Operation
        working = spec
        if constraints and constraints.format_target:
            from .pipeline import reposition_for_format
            working = reposition_for_format(spec, constraints.format_target)
        boxes = zone_layout(working, intent, constraints, cfg.safe_margin_px)
        ops = [Operation(op="set_bbox", node_id=nid, value=b.to_bbox())
               for nid, b in boxes.items()
               if not (constraints and any(l.node_id == nid and l.position for l in constraints.locks))]
        issues = validate_operations(ops, working)
        ops = [o for o in ops if not issues]
        result = apply_operations(working, ops)
        provider = "heuristic"
        strat = "heuristic_responsive_zones"
    else:
        cands, geo_ms = build_candidates(spec, intent, constraints, cfg, provider_mode="fixture")
        best = select_best(cands)
        elapsed = (time.perf_counter() - t0) * 1000
        if best is None:
            # representative = the least-bad candidate (fewest failures)
            rep = min(cands, key=lambda c: (c.validation.failed, c.validation.unknown))
            return rep, elapsed
        return best, elapsed

    elapsed = (time.perf_counter() - t0) * 1000
    validation = _validate(result, spec, constraints, intent)
    cand = CandidateResult(
        candidate_id=f"{variant}-0",
        strategy=strat,
        generator="ai_strategies" if variant == "ai_strategies" else variant,  # truthful label below
        operations=ops,
        validation=validation,
        feasibility=Feasibility(validator.feasibility_of(validation)),
        soft_score=None,
        base_version=spec.version,
        resulting_spec=result,
        provider_mode=provider,
        rejected_reasons=[f"{r.rule}: {r.detail}" for r in validation.results if r.status.value == "fail"],
    )
    return cand, elapsed


def run_benchmark(write: bool = True, repeats: int = 5) -> dict:
    spec, intent = luma_spec(), luma_intent_graph()
    interpreter = RuleInterpreter()
    cfg = _config()
    rows: list[dict] = []
    latencies: dict[str, list[float]] = {v: [] for v in VARIANTS}

    for case in CASES:
        cons = interpreter.interpret(
            case["instruction"],
            known_node_ids=[n.id for n in spec.nodes],
            role_of={n.id: n.role.value for n in spec.nodes},
            headline_text=case["headline_text"],
        )
        cons.forbidden_phrases = list(FORBIDDEN_PHRASES)
        for variant in VARIANTS:
            # real executions; `repeats` runs for latency, first run for outcomes
            cand, first_ms = run_variant(variant, spec, intent, cons)
            for _ in range(repeats - 1):
                _, ms = run_variant(variant, spec, intent, cons)
                latencies[variant].append(ms)
            latencies[variant].append(first_ms)

            predicted = "feasible" if cand.feasibility == Feasibility.feasible else "infeasible"
            rows.append({
                "case_id": case["case_id"],
                "variant": variant,
                "predicted": predicted,
                "ground_truth": case["ground_truth"],
                "correct": predicted == case["ground_truth"],
                "hard_pass": cand.validation.passed,
                "hard_fail": cand.validation.failed,
                "hard_unknown": cand.validation.unknown,
                "editable_nodes_retained": sum(1 for n in cand.resulting_spec.nodes
                                               if n.rect.w > 0 and n.rect.h > 0),
                "total_nodes": len(cand.resulting_spec.nodes),
                "failed_rules": ";".join(sorted({r.rule for r in cand.validation.results
                                                 if r.status.value == "fail"})),
                "median_latency_ms": round(statistics.median(latencies[variant]), 3),
                "provider_mode": cand.provider_mode,
                "soft_J": cand.soft_score.J if cand.soft_score else "",
            })

    per_variant: dict[str, dict] = {}
    for variant in VARIANTS:
        vrows = [r for r in rows if r["variant"] == variant]
        feasible_cases = [r for r in vrows if r["ground_truth"] == "feasible"]
        infeasible_cases = [r for r in vrows if r["ground_truth"] == "infeasible"]
        per_variant[variant] = {
            "feasible_success_rate": (sum(1 for r in feasible_cases if r["correct"]) / len(feasible_cases)) if feasible_cases else None,
            "false_feasible_rate": (sum(1 for r in infeasible_cases if not r["correct"]) / len(infeasible_cases)) if infeasible_cases else None,
            "total_hard_failures": sum(r["hard_fail"] for r in vrows),
            "total_hard_unknowns": sum(r["hard_unknown"] for r in vrows),
            "median_latency_ms": round(statistics.median(latencies[variant]), 3),
            "repeats_per_case": repeats,
        }

    summary = {
        "benchmark": "creativedna-ablation",
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "cases": len(CASES),
        "variants": VARIANTS,
        "note": "All values from real in-process executions. Ground truth documented "
                "per case, separate from predictions. Adobe apply latency is measured "
                "by the add-on at demo time and reported separately — never fabricated here.",
        "per_variant": per_variant,
        "rows": rows,
        "case_notes": {c["case_id"]: c["notes"] for c in CASES},
    }

    if write:
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        with open(OUT_DIR / "results.csv", "w", newline="", encoding="utf-8") as fh:
            writer = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
            writer.writeheader()
            writer.writerows(rows)
        with open(OUT_DIR / "results.json", "w", encoding="utf-8") as fh:
            json.dump(summary, fh, indent=2)
    return summary


if __name__ == "__main__":
    s = run_benchmark()
    print(json.dumps(s["per_variant"], indent=2))
    for r in s["rows"]:
        print(f"{r['case_id']:<34} {r['variant']:<16} pred={r['predicted']:<10} "
              f"p/f/u={r['hard_pass']}/{r['hard_fail']}/{r['hard_unknown']} J={r['soft_J']}")
