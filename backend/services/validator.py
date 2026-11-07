"""Deterministic rule validator (spec §6 "Hard rules").

Every check returns pass / fail / unknown with the measurement method.
Feasibility policy:
  - any ``fail``                       -> infeasible
  - no fail, at least one ``unknown``  -> unverified (NOT eligible for auto-selection)
  - all applicable checks ``pass``     -> verified-feasible (within implemented checks)
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..schemas import (
    CandidateValidation,
    DesignIntentGraph,
    DesignSpec,
    Rect,
    RepairConstraints,
    RuleResult,
    RuleStatus,
)
from . import textmetrics
from .layout import contrast_ratio, visible_nodes

LOCK_TOLERANCE_PX = 0.5  # documented numerical tolerance for lock invariance
CONTRAST_MIN = 4.5  # WCAG AA for normal text


@dataclass
class RuleContext:
    spec: DesignSpec
    intent: DesignIntentGraph | None
    constraints: RepairConstraints | None
    safe_margin_px: float = 64.0
    role_font_floors: dict = field(default_factory=dict)

    # ---- relationship lookups -------------------------------------------------
    def _rels(self, rtype):
        if not self.intent:
            return []
        return [r for r in self.intent.relationships if r.type == rtype]

    def exempt_bounds_ids(self) -> set[str]:
        ids: set[str] = set()
        for r in self._rels("exempt_bounds"):
            ids.update(r.nodes)
        return ids

    def exempt_pairs(self) -> set[frozenset[str]]:
        pairs: set[frozenset[str]] = set()
        for r in self._rels("exempt_overlap"):
            if len(r.nodes) == 2:
                pairs.add(frozenset(r.nodes))
        return pairs

    def contained_pairs(self) -> set[frozenset[str]]:
        pairs: set[frozenset[str]] = set()
        for r in self._rels("contained"):
            if len(r.nodes) == 2:
                pairs.add(frozenset(r.nodes))
        return pairs

    def containment_pairs(self) -> list[tuple[str, str]]:
        """Directed (child, container) pairs — relationship node order matters."""
        return [(r.nodes[0], r.nodes[1]) for r in self._rels("contained") if len(r.nodes) == 2]

    def critical_pairs(self) -> list[tuple[str, str, float]]:
        out: list[tuple[str, str, float]] = []
        for r in self._rels("spacing"):
            if len(r.nodes) == 2 and r.min_gap_px is not None:
                out.append((r.nodes[0], r.nodes[1], r.min_gap_px))
        if self.constraints:
            existing = {(a, b) for a, b, _ in out} | {(b, a) for a, b, _ in out}
            for a, b in self.constraints.critical_pairs:
                if (a, b) not in existing and (b, a) not in existing:
                    out.append((a, b, 24.0))
        return out

    def prominence_pairs(self) -> list[tuple[str, str]]:
        return [(r.nodes[0], r.nodes[1]) for r in self._rels("prominence") if len(r.nodes) == 2]


def _build_locks(constraints: RepairConstraints | None) -> dict[str, set[str]]:
    out: dict[str, set[str]] = {}
    if constraints:
        for l in constraints.locks:
            s = out.setdefault(l.node_id, set())
            if l.position:
                s.add("position")
            if l.size:
                s.add("size")
    return out


# ---------------------------------------------------------------------------
# Individual rules
# ---------------------------------------------------------------------------


def check_canvas_bounds(ctx: RuleContext, base: DesignSpec) -> RuleResult:
    exempt = ctx.exempt_bounds_ids()
    canvas = Rect(0, 0, ctx.spec.canvas.width, ctx.spec.canvas.height)
    failures, checked = [], 0
    for n in ctx.spec.nodes:
        if n.id in exempt:
            continue
        checked += 1
        if not canvas.contains(n.rect):
            failures.append(n.id)
    return RuleResult(
        rule="canvas_bounds",
        status=RuleStatus.fail if failures else RuleStatus.pass_,
        node_ids=failures,
        method="aabb-containment",
        detail=f"{checked} non-exempt nodes checked; canvas {canvas.w:g}x{canvas.h:g}",
    )


def check_safe_area(ctx: RuleContext, base: DesignSpec) -> RuleResult:
    """Side/bottom safe margin + reserved top/bottom zones.

    The top promo zone [0, top_reserved) rejects all nodes except explicitly
    exempt ones (the documented brand exemption, spec §3). Never silently
    satisfied.
    """
    m = ctx.safe_margin_px
    c = ctx.spec.canvas
    top_zone = ctx.constraints.top_reserved_px if ctx.constraints else 0
    top_exempt = set(ctx.constraints.top_zone_exempt_node_ids) if ctx.constraints else set()
    bottom_zone = ctx.constraints.bottom_reserved_px if ctx.constraints else 0
    exempt = ctx.exempt_bounds_ids()
    failures: list[str] = []
    for n in visible_nodes(ctx.spec):
        if n.id in exempt:
            continue
        r = n.rect
        reasons = []
        if top_zone > 0 and n.id not in top_exempt and r.top < top_zone - 1e-6:
            reasons.append(f"intrudes top zone (<{top_zone:g}px)")
        if bottom_zone > 0 and r.bottom > c.height - bottom_zone + 1e-6:
            reasons.append(f"intrudes bottom zone (last {bottom_zone:g}px)")
        if r.right > c.width - m + 1e-6:
            reasons.append(f"right margin {c.width - r.right:g}px < {m:g}px")
        if r.left < m - 1e-6 and r.left > 1e-6:  # allow flush-left brand at x=64 only
            reasons.append(f"left margin {r.left:g}px < {m:g}px")
        if r.bottom > c.height - m + 1e-6 and r.bottom < c.height - 1e-6:
            reasons.append(f"bottom margin {c.height - r.bottom:g}px < {m:g}px")
        if reasons:
            failures.append(f"{n.id} ({'; '.join(reasons)})")
    return RuleResult(
        rule="safe_area",
        status=RuleStatus.fail if failures else RuleStatus.pass_,
        node_ids=[f.split(" ")[0] for f in failures],
        method="aabb-margin",
        detail=f"margin {m:g}px, top_zone {top_zone:g}px (exempt: {sorted(top_exempt) or 'none'}), bottom_zone {bottom_zone:g}px; failures: {failures or 'none'}",
    )


def check_locks(ctx: RuleContext, base: DesignSpec) -> RuleResult:
    locks = _build_locks(ctx.constraints)
    failures: list[str] = []
    for nid, kinds in locks.items():
        if not (ctx.spec.has(nid) and base.has(nid)):
            failures.append(f"{nid} (missing)")
            continue
        before, after = base.node(nid).rect, ctx.spec.node(nid).rect
        if "position" in kinds and (abs(before.x - after.x) > LOCK_TOLERANCE_PX or abs(before.y - after.y) > LOCK_TOLERANCE_PX):
            failures.append(f"{nid} (position moved {abs(before.x-after.x):.1f},{abs(before.y-after.y):.1f}px > tol {LOCK_TOLERANCE_PX})")
        if "size" in kinds and (abs(before.w - after.w) > LOCK_TOLERANCE_PX or abs(before.h - after.h) > LOCK_TOLERANCE_PX):
            failures.append(f"{nid} (size changed {after.w-before.w:.1f},{after.h-before.h:.1f}px > tol {LOCK_TOLERANCE_PX})")
    return RuleResult(
        rule="locks",
        status=RuleStatus.fail if failures else RuleStatus.pass_,
        node_ids=[f.split(" ")[0] for f in failures],
        method="delta-comparison",
        detail=f"tol ±{LOCK_TOLERANCE_PX}px; failures: {failures or 'none'}",
    )


def check_min_font(ctx: RuleContext, base: DesignSpec) -> RuleResult:
    floors: dict[str, float] = dict(ctx.role_font_floors)
    if ctx.constraints:
        floors.update(ctx.constraints.min_font_size)
        for l in ctx.constraints.locks:  # locked-size nodes must not resize fonts implicitly? no-op
            pass
    failures: list[str] = []
    for n in ctx.spec.nodes:
        if n.type.value != "text" or not n.font_size:
            continue
        floor = floors.get(n.id) or floors.get(n.role.value)
        if floor and n.font_size < floor - 1e-6:
            failures.append(f"{n.id} ({n.font_size:g}px < {floor:g}px)")
    return RuleResult(
        rule="min_font_size",
        status=RuleStatus.fail if failures else RuleStatus.pass_,
        node_ids=[f.split(" ")[0] for f in failures],
        method="arithmetic",
        detail=f"failures: {failures or 'none'}",
    )


def check_text_overflow(ctx: RuleContext, base: DesignSpec) -> RuleResult:
    if not textmetrics.available():
        return RuleResult(
            rule="text_overflow",
            status=RuleStatus.unknown,
            method="none-available",
            detail="no text measurement backend; overflow cannot be verified -> unknown (never counted as pass)",
        )
    failures: list[str] = []
    measured = 0
    for n in ctx.spec.nodes:
        if n.type.value != "text" or not n.text or not n.font_size:
            continue
        r = n.rect
        if r.w <= 0 or r.h <= 0:
            continue
        measured += 1
        fits, need, avail = textmetrics.fits(n.text, n.font_size, r.w, r.h)
        if not fits:
            failures.append(f"{n.id} (needs {need:.0f}px height, has {avail:.0f}px)")
    return RuleResult(
        rule="text_overflow",
        status=RuleStatus.fail if failures else RuleStatus.pass_,
        node_ids=[f.split(" ")[0] for f in failures],
        method=textmetrics.METHOD,
        detail=f"{measured} text nodes measured; failures: {failures or 'none'}; method is substitute-font estimation, not Adobe's renderer",
    )


def check_contrast(ctx: RuleContext, base: DesignSpec) -> RuleResult:
    """WCAG contrast for solid foreground/background pairs only.

    Text over a solid shape/background -> measured. Text over an image node ->
    unknown (pending human review). Fully image/unknown pairs are reported as
    unknown, never pass.
    """
    failures: list[str] = []
    unknowns: list[str] = []
    measured = 0
    for n in ctx.spec.nodes:
        if n.type.value != "text" or not n.color or not n.font_size:
            continue
        r = n.rect
        # find topmost solid fill node beneath the text center
        under = [u for u in ctx.spec.nodes
                 if u.id != n.id and u.fill and u.rect.left <= r.cx <= u.rect.right and u.rect.top <= r.cy <= u.rect.bottom]
        imgs = [u for u in ctx.spec.nodes
                if u.id != n.id and u.type.value == "image" and u.rect.w > 0
                and u.rect.left <= r.cx <= u.rect.right and u.rect.top <= r.cy <= u.rect.bottom]
        solid = min(under, key=lambda u: u.rect.area) if under else None
        if imgs and (not solid or solid.rect.area > min(i.rect.area for i in imgs)):
            unknowns.append(f"{n.id} (over image)")
            continue
        if solid is None:
            unknowns.append(f"{n.id} (no solid underlay)")
            continue
        measured += 1
        ratio = contrast_ratio(n.color, solid.fill)
        if ratio < CONTRAST_MIN:
            failures.append(f"{n.id} ({ratio:.2f} < {CONTRAST_MIN} on {solid.id})")
    if failures:
        status = RuleStatus.fail
    elif unknowns:
        status = RuleStatus.unknown
    else:
        status = RuleStatus.pass_
    return RuleResult(
        rule="contrast",
        status=status,
        node_ids=[x.split(" ")[0] for x in failures + unknowns],
        method="wcag-luminance-srgb",
        detail=f"measured {measured}; failures: {failures or 'none'}; unknown: {unknowns or 'none'}",
    )


def check_forbidden_copy(ctx: RuleContext, base: DesignSpec) -> RuleResult:
    phrases: list[str] = []
    if ctx.constraints:
        phrases = [p.lower() for p in ctx.constraints.forbidden_phrases]
    hits: list[str] = []
    for n in ctx.spec.nodes:
        if n.type.value != "text" or not n.text:
            continue
        t = n.text.lower()
        for p in phrases:
            if p in t:
                hits.append(f"{n.id} (contains '{p}')")
    return RuleResult(
        rule="forbidden_copy",
        status=RuleStatus.fail if hits else RuleStatus.pass_,
        node_ids=[h.split(" ")[0] for h in hits],
        method="exact-phrase-match",
        detail=f"keyword matching only — not semantic/legal review; hits: {hits or 'none'}",
    )


def check_containment(ctx: RuleContext, base: DesignSpec) -> RuleResult:
    failures: list[str] = []
    for child, container in ctx.containment_pairs():
        if ctx.spec.has(child) and ctx.spec.has(container):
            if not ctx.spec.node(container).rect.contains(ctx.spec.node(child).rect):
                failures.append(f"{child} not inside {container}")
    return RuleResult(
        rule="containment",
        status=RuleStatus.fail if failures else RuleStatus.pass_,
        node_ids=[f.split(" ")[0] for f in failures],
        method="aabb-containment",
        detail=f"whitelisted containment pairs: {sorted(' + '.join(sorted(p)) for p in ctx.contained_pairs())}; failures: {failures or 'none'}",
    )


def check_critical_spacing(ctx: RuleContext, base: DesignSpec) -> RuleResult:
    failures: list[str] = []
    checked = 0
    for a, b, gap in ctx.critical_pairs():
        if not (ctx.spec.has(a) and ctx.spec.has(b)):
            continue
        ra, rb = ctx.spec.node(a).rect, ctx.spec.node(b).rect
        if ra.w <= 0 or rb.w <= 0:
            continue
        checked += 1
        if ra.intersects(rb):
            failures.append(f"{a}/{b} overlap")
        else:
            sep = max(ra.h_gap(rb), ra.v_gap(rb))
            if sep < gap - 1e-6:
                failures.append(f"{a}/{b} gap {sep:.1f}px < {gap:g}px")
    return RuleResult(
        rule="critical_spacing",
        status=RuleStatus.fail if failures else RuleStatus.pass_,
        node_ids=[],
        method="aabb-gap",
        detail=f"{checked} designated pairs checked (intentional overlaps whitelisted separately); failures: {failures or 'none'}",
    )


def check_generic_overlap(ctx: RuleContext, base: DesignSpec) -> RuleResult:
    """Generic overlap detection with explicit exemptions (spec acceptance).

    Exempt: background, whitelisted pairs (deco behind hero), containment.
    """
    exempt = ctx.exempt_bounds_ids()
    pair_exempt = ctx.exempt_pairs() | ctx.contained_pairs()
    nodes = [n for n in visible_nodes(ctx.spec) if n.id not in exempt]
    failures: list[str] = []
    for i in range(len(nodes)):
        for j in range(i + 1, len(nodes)):
            a, b = nodes[i], nodes[j]
            if frozenset((a.id, b.id)) in pair_exempt:
                continue
            if a.rect.intersects(b.rect):
                failures.append(f"{a.id}/{b.id}")
    return RuleResult(
        rule="generic_overlap",
        status=RuleStatus.fail if failures else RuleStatus.pass_,
        node_ids=[],
        method="aabb-intersection",
        detail=f"exempt ids: {sorted(exempt)}; whitelisted pairs: {sorted('+'.join(sorted(p)) for p in pair_exempt)}; overlaps: {failures or 'none'}",
    )


def check_prominence(ctx: RuleContext, base: DesignSpec) -> RuleResult:
    failures: list[str] = []
    for a, b in ctx.prominence_pairs():
        if ctx.spec.has(a) and ctx.spec.has(b):
            if ctx.spec.node(a).rect.area < ctx.spec.node(b).rect.area - 1e-6:
                failures.append(f"{a} area {ctx.spec.node(a).rect.area:.0f} < {b} {ctx.spec.node(b).rect.area:.0f}")
    return RuleResult(
        rule="prominence",
        status=RuleStatus.fail if failures else RuleStatus.pass_,
        node_ids=[],
        method="area-comparison",
        detail=f"failures: {failures or 'none'}",
    )


ALL_RULES = [
    check_canvas_bounds,
    check_safe_area,
    check_locks,
    check_min_font,
    check_text_overflow,
    check_contrast,
    check_forbidden_copy,
    check_containment,
    check_critical_spacing,
    check_generic_overlap,
    check_prominence,
]


def validate(spec: DesignSpec, base: DesignSpec,
             constraints: RepairConstraints | None = None,
             intent: DesignIntentGraph | None = None,
             safe_margin_px: float = 64.0,
             role_font_floors: dict | None = None) -> CandidateValidation:
    ctx = RuleContext(spec=spec, intent=intent, constraints=constraints,
                      safe_margin_px=safe_margin_px, role_font_floors=role_font_floors or {})
    results = [rule(ctx, base) for rule in ALL_RULES]
    return CandidateValidation(
        passed=sum(1 for r in results if r.status == RuleStatus.pass_),
        failed=sum(1 for r in results if r.status == RuleStatus.fail),
        unknown=sum(1 for r in results if r.status == RuleStatus.unknown),
        results=results,
    )


def feasibility_of(v: CandidateValidation) -> str:
    if v.failed > 0:
        return "infeasible"
    if v.unknown > 0:
        return "unverified"
    return "feasible"
