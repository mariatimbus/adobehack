"""Candidate ranking — deterministic soft metrics (spec §6).

For verified-feasible candidates only:

    J = 0.35 * hierarchy + 0.25 * grouping + 0.20 * balance - 0.20 * displacement

All terms normalized to [0,1] with the documented formulas below. Because the
displacement term is subtracted, J may be negative: J is a relative ranking
utility, NOT a probability or aesthetic confidence.

  hierarchy    preservation of *specified* prominence relationships: for each
               prominence pair (a must dominate b), compare the area ratio
               before/after; score = min(1, (Aa'/Ab') / (Aa/Ab)).
  grouping     for each visual_group node pair, centroid distance change d0->d1
               relative to a 25% canvas-diagonal tolerance band:
               score = clamp(1 - |d1-d0| / (0.25*diag), 0, 1).
  balance      documented proxy: area-weighted centroid of visible nodes;
               score = 1 - dist(centroid, canvas_center) / (diag/2).
  displacement mean translation distance of nodes visible in both specs,
               normalized by canvas diagonal; locked nodes excluded (they are
               guaranteed by hard rules, not double-counted as a penalty).
"""

from __future__ import annotations

import math

from ..schemas import DesignIntentGraph, DesignSpec, Rect, SoftMetrics
from .layout import visible_nodes

W = {"hierarchy": 0.35, "grouping": 0.25, "balance": 0.20, "displacement": 0.20}
GROUP_TOLERANCE = 0.25


def _diag(spec: DesignSpec) -> float:
    return math.hypot(spec.canvas.width, spec.canvas.height)


def hierarchy_score(before: DesignSpec, after: DesignSpec,
                    intent: DesignIntentGraph | None) -> float:
    pairs = []
    if intent:
        for r in intent.relationships:
            if r.type.value == "prominence" and len(r.nodes) == 2:
                pairs.append((r.nodes[0], r.nodes[1]))
    if not pairs:
        return 1.0
    scores = []
    for a, b in pairs:
        if not (before.has(a) and before.has(b) and after.has(a) and after.has(b)):
            continue
        ra0, rb0 = before.node(a).rect.area, before.node(b).rect.area
        ra1, rb1 = after.node(a).rect.area, after.node(b).rect.area
        if rb0 <= 0 or rb1 <= 0 or ra0 <= 0:
            continue
        ratio0, ratio1 = ra0 / rb0, ra1 / rb1
        scores.append(min(1.0, ratio1 / ratio0) if ratio0 > 0 else 1.0)
    return sum(scores) / len(scores) if scores else 1.0


def grouping_score(before: DesignSpec, after: DesignSpec,
                   intent: DesignIntentGraph | None) -> float:
    group: list[str] = []
    if intent:
        for r in intent.relationships:
            if r.type.value == "visual_group":
                group = list(r.nodes)
                break
    ids = [i for i in group if before.has(i) and after.has(i)]
    if len(ids) < 2:
        return 1.0
    diag = _diag(before)
    tol = GROUP_TOLERANCE * diag
    scores = []
    for i in range(len(ids)):
        for j in range(i + 1, len(ids)):
            a0, b0 = before.node(ids[i]).rect, before.node(ids[j]).rect
            a1, b1 = after.node(ids[i]).rect, after.node(ids[j]).rect
            d0 = math.hypot(a0.cx - b0.cx, a0.cy - b0.cy)
            d1 = math.hypot(a1.cx - b1.cx, a1.cy - b1.cy)
            scores.append(max(0.0, min(1.0, 1.0 - abs(d1 - d0) / tol)))
    return sum(scores) / len(scores) if scores else 1.0


def balance_score(before: DesignSpec, after: DesignSpec) -> float:
    nodes = [n for n in visible_nodes(after) if n.role.value != "background"]
    if not nodes:
        return 0.0
    total = sum(n.rect.area for n in nodes)
    if total <= 0:
        return 0.0
    cx = sum(n.rect.cx * n.rect.area for n in nodes) / total
    cy = sum(n.rect.cy * n.rect.area for n in nodes) / total
    ccx, ccy = after.canvas.width / 2, after.canvas.height / 2
    d = math.hypot(cx - ccx, cy - ccy)
    half = _diag(after) / 2
    return max(0.0, min(1.0, 1.0 - d / half)) if half > 0 else 0.0


def displacement_score(before: DesignSpec, after: DesignSpec,
                       locked: set[str] | None = None) -> float:
    """Mean normalized movement of retained nodes (0 = nothing moved)."""
    locked = locked or set()
    dists = []
    for n in before.nodes:
        if n.id in locked or not after.has(n):
            continue
        m = after.node(n.id)
        if n.rect.w <= 0 or m.rect.w <= 0:
            continue  # hidden/removed nodes are not "displaced", they are pruned
        d = math.hypot(m.rect.x - n.rect.x, m.rect.y - n.rect.y)
        dists.append(d)
    if not dists:
        return 0.0
    diag = _diag(before)
    return max(0.0, min(1.0, (sum(dists) / len(dists)) / diag)) if diag > 0 else 0.0


def score_candidate(before: DesignSpec, after: DesignSpec,
                    intent: DesignIntentGraph | None,
                    locked: set[str] | None = None) -> SoftMetrics:
    h = hierarchy_score(before, after, intent)
    g = grouping_score(before, after, intent)
    b = balance_score(before, after)
    d = displacement_score(before, after, locked)
    J = W["hierarchy"] * h + W["grouping"] * g + W["balance"] * b - W["displacement"] * d
    return SoftMetrics(hierarchy=round(h, 4), grouping=round(g, 4),
                       balance=round(b, 4), displacement=round(d, 4),
                       J=round(J, 4))


def rank(candidates: list) -> list:
    """Stable descending sort by J; feasible candidates with scores first."""
    return sorted(candidates, key=lambda c: (c.soft_score.J if c.soft_score else -1e9),
                  reverse=True)
