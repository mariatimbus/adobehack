"""Shared deterministic placement solver.

Used by the group-reflow strategy and by Baseline B (heuristic responsive
zones) — identical geometry, the difference is that AI strategies choose
*which* operations to emit based on the intent graph while the baseline just
runs the zone template.
"""

from __future__ import annotations

from ..schemas import DesignIntentGraph, DesignSpec, Rect, RepairConstraints
from . import textmetrics
from .layout import Rect as R


def content_region(spec: DesignSpec, constraints: RepairConstraints | None,
                   margin: float = 64.0) -> R:
    c = spec.canvas
    top = margin
    bottom = c.height - margin
    if constraints:
        top = max(top, constraints.top_reserved_px)
        bottom = min(bottom, c.height - constraints.bottom_reserved_px)
    return R(margin, top, c.width - 2 * margin, max(0.0, bottom - top))


def group_ids(intent: DesignIntentGraph | None) -> list[str]:
    if not intent:
        return []
    for r in intent.relationships:
        if r.type.value == "visual_group":
            return list(r.nodes)
    return []


def stack_layout(spec: DesignSpec, ids: list[str], region: R,
                 gap: float = 24.0) -> dict[str, R]:
    """Stack nodes top-to-bottom in `ids` order inside `region`.

    Text nodes get the wrapped height of their (possibly updated) text; other
    nodes keep their size. Widths: text nodes get the full region width unless
    already narrower and short; we keep original widths clamped to region.
    """
    out: dict[str, R] = {}
    y = region.top
    for nid in ids:
        if not spec.has(nid):
            continue
        n = spec.node(nid)
        r = n.rect
        w = min(r.w if r.w > 0 else region.w, region.w)
        if n.type.value == "text" and n.text and n.font_size:
            h = textmetrics.wrapped_height(n.text, n.font_size, w) + 8.0
            h = max(h, n.font_size * 1.25)
        else:
            h = r.h
        if y + h > region.bottom and out:
            y = region.bottom - h  # overflow: clamp, validator will flag
        out[nid] = R(region.left, y, w, h)
        y += h + gap
    return out


def zone_layout(spec: DesignSpec, intent: DesignIntentGraph | None,
                constraints: RepairConstraints | None,
                margin: float = 64.0) -> dict[str, R]:
    """Heuristic responsive zones: brand top, hero middle, copy stack, CTA bottom.

    Deterministic, intent-aware (focal stays central and prominent) — this is
    Baseline B's engine and the starting point for reflow strategies.
    """
    region = content_region(spec, constraints, margin)
    c = spec.canvas
    out: dict[str, R] = {}

    focal = intent.focal_element if intent else None
    grp = group_ids(intent)
    cta_ids = [i for i in grp if i.startswith("cta")]
    copy_ids = [i for i in grp if i not in cta_ids]

    # brand pinned to region top-left
    for r in (intent.relationships if intent else []):
        if r.type.value == "protected" and "position" in r.locks:
            if spec.has(r.nodes[0]):
                n = spec.node(r.nodes[0])
                if r.nodes[0] not in out:
                    out[r.nodes[0]] = n.rect  # keep exactly (locked)

    y = region.top
    # copy stack occupies the top band
    stack_h = 0.0
    tmp: dict[str, R] = {}
    for nid in copy_ids:
        if not spec.has(nid):
            continue
        n = spec.node(nid)
        w = min(n.rect.w, region.w)
        h = (textmetrics.wrapped_height(n.text, n.font_size, w) + 8.0) if (
            n.type.value == "text" and n.text and n.font_size) else n.rect.h
        tmp[nid] = R(region.left, y, w, max(h, (n.font_size or 0) * 1.25))
        y += tmp[nid].h + 20.0
        stack_h = y

    # hero centered in the remaining middle band
    mid_top = max(region.top, stack_h + 8.0)
    cta_h = 0.0
    cta_boxes: dict[str, R] = {}
    for nid in cta_ids:
        if spec.has(nid):
            cta_boxes[nid] = spec.node(nid).rect
            cta_h = max(cta_h, spec.node(nid).rect.h)
    mid_bottom = region.bottom - (cta_h + 40.0 if cta_h else 0.0)
    if focal and spec.has(focal):
        fr = spec.node(focal).rect
        if fr.h > 0 and mid_bottom > mid_top:
            scale = min(1.0, (mid_bottom - mid_top) / fr.h)
        else:
            scale = 0.0  # no room: geometry collapses, validator reports infeasibility
        h = fr.h * scale
        w = fr.w * scale
        out[focal] = R(region.left + (region.w - w) / 2, mid_top + (mid_bottom - mid_top - h) / 2, w, h)

    out.update(tmp)

    # CTA pinned above the bottom margin
    cy = region.bottom - cta_h if cta_h else region.bottom
    for nid, r in cta_boxes.items():
        out[nid] = R(r.x, cy, r.w, r.h)
    return out
