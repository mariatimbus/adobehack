"""Counterfactual repair strategist (Developers B+C).

Generates up to three *meaningfully distinct* repair strategies. Each strategy
is a deterministic layout algorithm parameterized by the semantic intent
graph — not three renamed coordinate shifts. All candidates are simulated and
validated; any number, including zero, may be feasible.

Strategies:
  A  typography_adaptation  — keep composition; fix type/boxes only
  B  group_reflow           — move the copy stack as a coherent unit
  C  expendable_pruning     — remove decoration, rebalance the canvas

provider_mode is truthful: without AI credentials every strategy is labeled
"fixture" (deterministic intent-driven layout), never "live".
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..schemas import (
    DesignIntentGraph,
    DesignSpec,
    NodeRole,
    Operation,
    ProviderMode,
    Rect,
    RepairConstraints,
)
from . import textmetrics
from .layout import apply_operations, clamp_into
from .placement import content_region, group_ids, stack_layout, zone_layout


@dataclass
class StrategyConfig:
    safe_margin_px: float = 64.0
    role_font_floors: dict = field(default_factory=dict)
    min_gap_px: float = 24.0


def _floors(config: StrategyConfig, constraints: RepairConstraints | None) -> dict[str, float]:
    floors = dict(config.role_font_floors)
    if constraints:
        floors.update(constraints.min_font_size)
    return floors


def _font_floor(node_id: str, role: str, floors: dict[str, float]) -> float:
    return floors.get(node_id) or floors.get(role) or 8.0


def _locked(constraints: RepairConstraints | None) -> dict[str, set[str]]:
    out: dict[str, set[str]] = {}
    if constraints:
        for l in constraints.locks:
            s = out.setdefault(l.node_id, set())
            if l.position:
                s.add("position")
            if l.size:
                s.add("size")
    return out


def _keep_visible(constraints: RepairConstraints | None) -> set[str]:
    return set(constraints.keep_visible) if constraints else set()


def _fit_font(text: str, width: float, height: float, start: float, floor: float) -> float:
    """Largest font ≤ start whose wrapped block fits width×height; floor if none."""
    size = start
    while size > floor:
        if textmetrics.available():
            if textmetrics.wrapped_height(text, size, width) + 8.0 <= height:
                return size
        size -= 1.0
    return floor


def _contained_pairs(intent: DesignIntentGraph | None) -> dict[str, str]:
    """child -> container"""
    out = {}
    if intent:
        for r in intent.relationships:
            if r.type.value == "contained" and len(r.nodes) == 2:
                out[r.nodes[0]] = r.nodes[1]
    return out


# ---------------------------------------------------------------------------
# Strategy A — typography adaptation
# ---------------------------------------------------------------------------

def typography_strategy(spec: DesignSpec, intent: DesignIntentGraph | None,
                        constraints: RepairConstraints | None,
                        config: StrategyConfig) -> list[Operation]:
    ops: list[Operation] = []
    floors = _floors(config, constraints)
    locks = _locked(constraints)
    region = content_region(spec, constraints, config.safe_margin_px)

    copy_changes = constraints.changes if constraints else {}

    # text changes first
    for nid, text in copy_changes.items():
        if spec.has(nid):
            ops.append(Operation(op="set_text", node_id=nid, value=text))

    # enlarge / re-fit text boxes in place, never moving locked nodes
    for nid, text in copy_changes.items():
        if not spec.has(nid):
            continue
        node = spec.node(nid)
        if nid in locks and "size" in locks[nid]:
            continue  # cannot resize a size-locked node; validator will judge overflow
        r = node.rect
        # widest box that keeps clearance from every node to the right whose
        # vertical span overlaps this box (focal product, decoration, ...)
        max_right = region.right
        for other in spec.nodes:
            if other.id == nid or other.role == NodeRole.background or other.rect.w <= 0:
                continue
            if other.rect.left <= r.left:
                continue
            if other.rect.top < r.bottom and other.rect.bottom > r.top:
                max_right = min(max_right, other.rect.left - config.min_gap_px)
        width = max(120.0, max_right - r.x)
        height = max(r.h, (node.font_size or 24) * 1.25)
        if textmetrics.available() and node.font_size:
            need = textmetrics.wrapped_height(text, node.font_size, width) + 8.0
            if need > height:
                height = need  # grow the box first, then shrink type as fallback
        ops.append(Operation(op="set_bbox", node_id=nid, value=[r.x, r.y, width, height]))

    # resolve top-zone intrusion by minimal downward nudges (unlocked only)
    if constraints and constraints.top_reserved_px > 0:
        top_zone = constraints.top_reserved_px
        exempt = set(constraints.top_zone_exempt_node_ids)
        for n in spec.nodes:
            if n.id in exempt or n.role == NodeRole.background:
                continue
            if "position" in locks.get(n.id, set()):
                continue  # locked: exemption was documented at interpretation time
            r = n.rect
            if r.top < top_zone and r.w > 0:
                ops.append(Operation(op="translate", node_id=n.id, value=[0.0, top_zone - r.top]))

    # symmetric bottom-zone resolution: nudge intruders up (unlocked only)
    if constraints and constraints.bottom_reserved_px > 0:
        limit = spec.canvas.height - constraints.bottom_reserved_px
        for n in spec.nodes:
            if n.role == NodeRole.background or "position" in locks.get(n.id, set()):
                continue
            r = n.rect
            if r.bottom > limit and r.w > 0:
                ops.append(Operation(op="translate", node_id=n.id, value=[0.0, limit - r.bottom]))
    return ops


# ---------------------------------------------------------------------------
# Strategy B — group reflow
# ---------------------------------------------------------------------------

def reflow_strategy(spec: DesignSpec, intent: DesignIntentGraph | None,
                    constraints: RepairConstraints | None,
                    config: StrategyConfig) -> list[Operation]:
    ops: list[Operation] = []
    floors = _floors(config, constraints)
    locks = _locked(constraints)
    grp = group_ids(intent)
    if not grp:
        return typography_strategy(spec, intent, constraints, config)

    # measure layout against the FUTURE copy: apply text changes to a working
    # copy first, then compute the stack geometry from it
    from .layout import apply_operations
    text_ops = [Operation(op="set_text", node_id=nid, value=txt)
                for nid, txt in (constraints.changes if constraints else {}).items()
                if spec.has(nid)]
    working = apply_operations(spec, text_ops) if text_ops else spec

    region = content_region(spec, constraints, config.safe_margin_px)
    boxes = stack_layout(working, grp, region, gap=20.0)
    child_of = _contained_pairs(intent)
    containers = set(child_of.values())

    for nid in grp:
        if not spec.has(nid):
            continue
        box = boxes.get(nid)
        if box is None:
            continue
        node = spec.node(nid)
        fully_locked = "position" in locks.get(nid, set()) and "size" in locks.get(nid, set())
        if fully_locked:
            continue
        if nid in containers:
            # containers keep their size; children are re-seated inside below
            if "size" not in locks.get(nid, set()):
                ops.append(Operation(op="set_bbox", node_id=nid, value=box.to_bbox()))
            continue
        if "position" not in locks.get(nid, set()) and "size" not in locks.get(nid, set()):
            ops.append(Operation(op="set_bbox", node_id=nid, value=box.to_bbox()))
        # contained children are re-seated inside their containers below

    # re-seat contained children (CTA text) inside their moved containers
    for child, container in child_of.items():
        if not (spec.has(child) and spec.has(container)):
            continue
        cb = boxes.get(container)
        if cb is None:
            continue
        cr = spec.node(child).rect
        ops.append(Operation(op="set_bbox", node_id=child, value=[
            cb.x + max(8.0, (cb.w - cr.w) / 2), cb.y + (cb.h - cr.h) / 2, cr.w, cr.h]))
    return ops


# ---------------------------------------------------------------------------
# Strategy C — expendable pruning + rebalance
# ---------------------------------------------------------------------------

def pruning_strategy(spec: DesignSpec, intent: DesignIntentGraph | None,
                     constraints: RepairConstraints | None,
                     config: StrategyConfig) -> list[Operation]:
    ops: list[Operation] = []
    floors = _floors(config, constraints)
    locks = _locked(constraints)
    keep_vis = _keep_visible(constraints)

    expendable = [n.id for n in spec.nodes if n.expendable]
    if intent:
        for r in intent.relationships:
            if r.type.value == "expendable":
                expendable = list(dict.fromkeys(expendable + r.nodes))
    expendable = [e for e in dict.fromkeys(expendable)
                  if e not in keep_vis and "size" not in locks.get(e, set())]

    for nid in expendable:
        ops.append(Operation(op="set_visible", node_id=nid, value=False))

    # start from typography fixes, then rebalance horizontally into freed space
    ops.extend(typography_strategy(spec, intent, constraints, config))

    # if decoration was removed and hero position is free, nudge hero toward the
    # optical center of the remaining composition while keeping the documented
    # clearance from every copy element (never create an overlap)
    focal = intent.focal_element if intent else None
    region = content_region(spec, constraints, config.safe_margin_px)
    if expendable and focal and spec.has(focal) and focal not in keep_vis:
        if "position" not in locks.get(focal, set()):
            fr = spec.node(focal).rect
            copy_ids = [n.id for n in spec.nodes
                        if n.role in (NodeRole.headline, NodeRole.subhead, NodeRole.cta_text, NodeRole.brand)]
            copy_right = max((spec.node(i).rect.right for i in copy_ids if spec.has(i)),
                             default=region.left)
            lo = copy_right + config.min_gap_px
            hi = region.right - fr.w
            if hi >= lo:
                target_x = min(max(fr.x, lo), hi)
                dx = target_x - fr.x
                if abs(dx) > 1.0:
                    ops.append(Operation(op="translate", node_id=focal, value=[round(dx, 1), 0.0]))
    return ops


# ---------------------------------------------------------------------------
# Candidate assembly
# ---------------------------------------------------------------------------

STRATEGIES = [
    ("typography_adaptation", typography_strategy,
     "Keep the composition; adapt type sizes and text boxes in place"),
    ("group_reflow", reflow_strategy,
     "Move the copy stack as one coherent group into the valid zone"),
    ("expendable_pruning", pruning_strategy,
     "Remove expendable decoration and rebalance the remaining composition"),
]


def validate_operations(ops: list[Operation], spec: DesignSpec) -> list[str]:
    """Pre-simulation contract check: allowlist, node ids, units, bounds."""
    issues: list[str] = []
    for op in ops:
        if op.op not in ("set_text", "set_bbox", "set_font_size", "set_visible", "translate"):
            issues.append(f"{op.op}: op not in allowlist")
        if not spec.has(op.node_id):
            issues.append(f"{op.node_id}: unknown node id")
        if op.op == "set_bbox":
            x, y, w, h = op.value
            if w <= 0 or h <= 0:
                issues.append(f"{op.node_id}: non-positive bbox size")
            if abs(x) > 1e6 or abs(y) > 1e6:
                issues.append(f"{op.node_id}: bbox out of sane range")
    return issues


def generate_strategies(spec: DesignSpec, intent: DesignIntentGraph | None,
                        constraints: RepairConstraints | None,
                        config: StrategyConfig | None = None,
                        provider_mode: ProviderMode = "fixture") -> list[dict]:
    """Returns [{'candidate_id', 'strategy', 'description', 'operations'}...].

    provider_mode must be truthful; this build has no live AI credentials.
    """
    config = config or StrategyConfig()
    out = []
    for i, (name, fn, desc) in enumerate(STRATEGIES, start=1):
        try:
            ops = fn(spec, intent, constraints, config)
        except Exception as exc:  # a strategy that crashes yields no candidate
            ops = []
            desc = f"{desc} [strategy error: {exc}]"
        issues = validate_operations(ops, spec)
        out.append({
            "candidate_id": f"c{i}",
            "strategy": name,
            "description": desc,
            "operations": ops,
            "issues": issues,
            "provider_mode": provider_mode,
        })
    return out


def apply_with_format(spec: DesignSpec, ops: list[Operation],
                      constraints: RepairConstraints | None) -> DesignSpec:
    """Apply ops; if a format target exists, first resize the canvas so the
    simulation runs against the target geometry."""
    from ..schemas import Canvas
    working = spec
    if constraints and constraints.format_target:
        working = spec.copy_with(canvas=Canvas(
            width=constraints.format_target.width,
            height=constraints.format_target.height))
    return apply_operations(working, ops)
