"""End-to-end repair pipeline: interpret -> plan -> simulate -> validate -> rank.

Shared by the FastAPI routes and the benchmark so measured behavior is
identical everywhere.
"""

from __future__ import annotations

import time

from .schemas import (
    CandidateResult,
    Canvas,
    DesignIntentGraph,
    DesignSpec,
    Feasibility,
    NodeRole,
    Operation,
    ProviderMode,
    RepairConstraints,
    TelemetryEvent,
)
from .services import ranker, strategist, validator
from .services.intent import resolve_intent
from .services.strategist import StrategyConfig, apply_with_format


def reposition_for_format(spec: DesignSpec, target) -> DesignSpec:
    """Planning canvas for format adaptation: positions scale, sizes/fonts stay."""
    sx = target.width / spec.canvas.width
    sy = target.height / spec.canvas.height
    out = spec.copy_with(canvas=Canvas(width=target.width, height=target.height))
    for n in out.nodes:
        if n.role == NodeRole.background:
            n.bbox = [0.0, 0.0, target.width, target.height]
        else:
            r = n.rect
            n.bbox = [round(r.x * sx, 3), round(r.y * sy, 3), r.w, r.h]
    return out


def _locked_ids(constraints: RepairConstraints | None) -> set[str]:
    if not constraints:
        return set()
    return {l.node_id for l in constraints.locks}


def build_candidates(spec: DesignSpec, intent: DesignIntentGraph | None,
                     constraints: RepairConstraints | None,
                     config: StrategyConfig | None = None,
                     provider_mode: ProviderMode = "fixture") -> tuple[list[CandidateResult], float]:
    """Simulate and validate every strategy. Returns (candidates, geometry_ms)."""
    t0 = time.perf_counter()
    config = config or StrategyConfig()
    base = spec
    if constraints and constraints.format_target:
        base = reposition_for_format(spec, constraints.format_target)

    # Imported/user documents often violate the safe margins. Normalize a
    # PLANNING copy first (never the comparison base, so locks and metrics
    # stay measured against the real document); strategies then compute
    # geometry against margin-compliant positions.
    planning = _margin_normalize(base, constraints, config)

    intent = resolve_intent(planning, intent, constraints)
    locked = _locked_ids(constraints)
    candidates: list[CandidateResult] = []

    for strat in strategist.generate_strategies(planning, intent, constraints, config, provider_mode):
        ops: list[Operation] = list(strat["operations"])
        issues = list(strat["issues"])
        for o in ops:
            try:
                Operation.model_validate(o)
            except Exception as exc:
                issues.append(f"invalid operation {o}: {exc}")

        # drop individually invalid ops but keep the candidate contract complete
        valid_ops = [o for o in ops if o.node_id in {n.id for n in planning.nodes}]
        try:
            resulting = apply_with_format(planning, valid_ops, constraints)
        except Exception as exc:
            resulting = base
            issues.append(f"simulation failed: {exc}")

        # shared overflow-repair pass: any measured text overflow in the result
        # gets a font reduction toward its documented floor (size-unlocked only)
        repair_ops, overflow_fixed = _overflow_repairs(base, resulting, valid_ops,
                                                       constraints, config)
        if overflow_fixed:
            try:
                resulting = apply_with_format(planning, valid_ops + repair_ops, constraints)
            except Exception as exc:
                issues.append(f"overflow repair failed: {exc}")
            valid_ops = valid_ops + repair_ops


        validation = validator.validate(resulting, base, constraints, intent,
                                        safe_margin_px=config.safe_margin_px,
                                        role_font_floors=config.role_font_floors)
        feasibility = Feasibility(validator.feasibility_of(validation))
        soft = None
        if feasibility == Feasibility.feasible:
            soft = ranker.score_candidate(base, resulting, intent, locked)

        candidates.append(CandidateResult(
            candidate_id=strat["candidate_id"],
            strategy=strat["strategy"],
            generator="ai_strategies",
            operations=valid_ops,
            validation=validation,
            feasibility=feasibility,
            soft_score=soft,
            base_version=spec.version,
            resulting_spec=resulting,
            provider_mode=strat["provider_mode"],
            rejected_reasons=issues + [
                f"{r.rule}: {r.detail}" for r in validation.results if r.status.value == "fail"],
        ))

    geometry_ms = (time.perf_counter() - t0) * 1000
    return candidates, geometry_ms


def _locked_kinds(constraints: RepairConstraints | None, node_id: str) -> set[str]:
    if not constraints:
        return set()
    return {k for l in constraints.locks if l.node_id == node_id
            for k in (("position",) if l.position else ()) + (("size",) if l.size else ())}


def _overflow_repairs(base: DesignSpec, resulting: DesignSpec,
                      ops: list[Operation], constraints: RepairConstraints | None,
                      config: StrategyConfig) -> tuple[list[Operation], bool]:
    """Font-reduction ops for any measured text overflow in the simulation.

    Only nodes whose size is not locked are touched; floors come from the
    documented role/node min-font rules. If the floor itself still overflows
    and the node's size is free, the box height grows to fit (position kept).
    Returns (ops, any_fix_attempted).
    """
    from .services import textmetrics
    floors = dict(config.role_font_floors)
    if constraints:
        floors.update(constraints.min_font_size)
    repairs: list[Operation] = []
    for n in resulting.nodes:
        if n.type.value != "text" or not n.text or not n.font_size:
            continue
        r = n.rect
        if r.w <= 0 or r.h <= 0:
            continue
        if not textmetrics.available():
            break
        fits_now, need, _ = textmetrics.fits(n.text, n.font_size, r.w, r.h)
        if fits_now:
            continue
        locked = _locked_kinds(constraints, n.id)
        if "size" not in locked:
            floor = floors.get(n.id) or floors.get(n.role.value) or 8.0
            size = n.font_size - 1.0
            while size > floor:
                if textmetrics.fits(n.text, size, r.w, r.h)[0]:
                    break
                size -= 1.0
            repairs.append(Operation(op="set_font_size", node_id=n.id, value=size))
            # re-check with the new size; if it still overflows, grow the box
            if not textmetrics.fits(n.text, size, r.w, r.h)[0] and "position" not in locked:
                need_h = textmetrics.wrapped_height(n.text, size, r.w) + 16.0
                repairs.append(Operation(op="set_bbox", node_id=n.id,
                                         value=[r.x, r.y, r.w, need_h]))
    return repairs, bool(repairs)


def _margin_normalize(base: DesignSpec, constraints: RepairConstraints | None,
                      config: StrategyConfig) -> DesignSpec:
    """Deep-copy `base` with unlocked, non-background nodes nudged into the
    safe margins. Locked nodes and hidden nodes are untouched (the validator
    reports them honestly against the real base)."""
    from .services.layout import clone_spec
    out = clone_spec(base)
    m = config.safe_margin_px
    c = out.canvas
    for n in out.nodes:
        if n.role == NodeRole.background or n.rect.w <= 0 or n.rect.h <= 0:
            continue
        if "position" in _locked_kinds(constraints, n.id):
            continue
        r = n.rect
        dx = dy = 0.0
        if r.left < m - 1e-6 and r.left > 1e-6:
            dx = m - r.left
        if r.right > c.width - m + 1e-6 and r.right < c.width - 1e-6:
            dx = (c.width - m - r.w) - r.x
        if r.bottom > c.height - m + 1e-6 and r.bottom < c.height - 1e-6:
            dy = (c.height - m - r.h) - r.y
        if dx or dy:
            n.bbox = [r.x + dx, r.y + dy, r.w, r.h]
    return out


def select_best(candidates: list[CandidateResult]) -> CandidateResult | None:
    feasible = [c for c in candidates if c.feasibility == Feasibility.feasible]
    if not feasible:
        return None
    return ranker.rank(feasible)[0]


def explain_infeasibility(candidates: list[CandidateResult]) -> str:
    """Human-readable explanation of why nothing passed."""
    if not candidates:
        return "no strategies were generated"
    lines = []
    for c in candidates:
        fails = [f"{r.rule} ({r.detail})" for r in c.validation.results if r.status.value == "fail"]
        lines.append(f"{c.candidate_id} '{c.strategy}': " + ("; ".join(fails) if fails else "no hard failures"))
    return "All candidates infeasible or unverified. Failures: " + " | ".join(lines)


def suggest_relaxation(spec: DesignSpec, intent: DesignIntentGraph | None,
                       constraints: RepairConstraints,
                       config: StrategyConfig | None = None) -> RepairConstraints | None:
    """When every candidate fails, propose a MINIMAL relaxation instead of
    fabricating a winner. Tries, in order of increasing intervention:
      1. exempt position-locked nodes from the top zone (documented demo rule)
      2. shrink the reserved zone (75% / 50% / 0)
      3. drop explicit per-node font floors beyond the brand role floors
    Returns the first relaxation that yields a verified-feasible candidate."""
    config = config or StrategyConfig()

    def relaxed(**kw) -> RepairConstraints:
        data = constraints.model_dump()
        data.update(kw)
        return RepairConstraints.model_validate(data)

    def feasible_with(c: RepairConstraints) -> bool:
        out, _ = build_candidates(spec, intent, c, config)
        return select_best(out) is not None

    brand_like = [l.node_id for l in constraints.locks if l.position]
    if constraints.top_reserved_px > 0 and brand_like:
        cand = relaxed(top_zone_exempt_node_ids=sorted(
            set(constraints.top_zone_exempt_node_ids) | set(brand_like)))
        if feasible_with(cand):
            return cand

    for frac in (0.75, 0.5, 0.0):
        cand = relaxed(top_reserved_px=round(constraints.top_reserved_px * frac, 1))
        if feasible_with(cand):
            return cand

    if constraints.min_font_size:
        cand = relaxed(min_font_size={})
        if feasible_with(cand):
            return cand
        for frac in (0.75, 0.5, 0.0):
            cand = relaxed(top_reserved_px=round(constraints.top_reserved_px * frac, 1),
                           min_font_size={})
            if feasible_with(cand):
                return cand
    return None


def make_telemetry(provider_mode: ProviderMode, total_ms: float,
                   ai_ms: float | None = None, geometry_ms: float | None = None,
                   candidates: list[CandidateResult] | None = None) -> TelemetryEvent:
    hard_pass = hard_fail = hard_unknown = None
    if candidates:
        best = select_best(candidates)
        pool = best or candidates[0]
        hard_pass, hard_fail, hard_unknown = pool.validation.passed, pool.validation.failed, pool.validation.unknown
    return TelemetryEvent(
        event="candidates",
        provider_mode=provider_mode,
        ai_duration_ms=ai_ms,
        geometry_duration_ms=geometry_ms,
        total_duration_ms=round(total_ms, 3),
        token_usage=None,
        estimated_cost_usd=0.0 if provider_mode in ("fixture", "heuristic", "cached") else None,
        cost_basis=f"{provider_mode}: no provider called => $0.00 (live AI would report actual usage)",
        hard_pass=hard_pass, hard_fail=hard_fail, hard_unknown=hard_unknown,
    )
