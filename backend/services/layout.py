"""Pure geometry helpers and the deterministic simulation engine.

Simulation takes a DesignSpec + validated operation list and produces a new
DesignSpec (deep copy). Geometry repair helpers are shared by the strategist,
the validator-driven repair pass and the baselines.
"""

from __future__ import annotations

import copy

from ..schemas import BBox, DesignNode, DesignSpec, Operation, Rect


def clone_spec(spec: DesignSpec) -> DesignSpec:
    return copy.deepcopy(spec)


def apply_operations(spec: DesignSpec, operations: list[Operation]) -> DesignSpec:
    """Apply an allowlisted operation list to a deep copy of the spec.

    Every node_id is validated against the spec before mutation; unknown ids
    raise ValueError (callers validate the allowlist before simulation).
    """
    out = clone_spec(spec)
    for op in operations:
        if not out.has(op.node_id):
            raise ValueError(f"operation targets unknown node {op.node_id!r}")
        node = out.node(op.node_id)
        if op.op == "set_text":
            node.text = str(op.value)
        elif op.op == "set_bbox":
            node.bbox = [float(v) for v in op.value]
        elif op.op == "set_font_size":
            node.font_size = float(op.value)
        elif op.op == "set_visible":
            if op.value is False:
                # Hide by collapsing geometry — works on every SDK. Visible=False
                # is represented as a zero-size bbox at the original origin.
                r = node.rect
                node.bbox = [r.x, r.y, 0.0, 0.0]
        elif op.op == "translate":
            dx, dy = float(op.value[0]), float(op.value[1])
            r = node.rect
            node.bbox = [r.x + dx, r.y + dy, r.w, r.h]
        else:  # pragma: no cover - OperationType is Literal-enforced
            raise ValueError(f"unsupported op {op.op!r}")
    return out


def visible_nodes(spec: DesignSpec) -> list[DesignNode]:
    return [n for n in spec.nodes if n.rect.w > 0 and n.rect.h > 0]


def union_rect(nodes: list[DesignNode]) -> Rect:
    if not nodes:
        return Rect(0, 0, 0, 0)
    r = nodes[0].rect
    for n in nodes[1:]:
        r = r.union(n.rect)
    return r


def scale_spec(spec: DesignSpec, sx: float, sy: float) -> DesignSpec:
    """Uniform/anisotropic scale of every node and font sizes (Baseline A)."""
    out = clone_spec(spec)
    for n in out.nodes:
        r = n.rect
        n.bbox = [r.x * sx, r.y * sy, r.w * sx, r.h * sy]
        if n.font_size:
            n.font_size = n.font_size * (sx + sy) / 2
    out.canvas = type(out.canvas)(width=out.canvas.width * sx, height=out.canvas.height * sy)
    return out


def clamp_into(rect: Rect, bounds: Rect) -> Rect:
    """Move (never resize) rect so it fits inside bounds."""
    x = min(max(rect.left, bounds.left), max(bounds.left, bounds.right - rect.w))
    y = min(max(rect.top, bounds.top), max(bounds.top, bounds.bottom - rect.h))
    return Rect(x, y, rect.w, rect.h)


def stack_below(anchor: Rect, w: float, h: float, gap: float, bounds: Rect) -> Rect:
    """Place a w×h block below `anchor` with `gap`, clamped into bounds."""
    return clamp_into(Rect(anchor.x, anchor.bottom + gap, w, h), bounds)


def fit_font_to_width(text: str, font_size: float, box_width: float,
                      floor: float, measurer) -> float:
    """Largest font size ≤ font_size whose single-line width fits box_width."""
    size = font_size
    while size > floor and measurer(text, size) > box_width:
        size -= 1.0
    return max(floor, size)


def contrast_ratio(fg_hex: str, bg_hex: str) -> float:
    """WCAG 2.x contrast ratio with proper sRGB linearization."""
    def lum(hex_color: str) -> float:
        h = hex_color.lstrip("#")
        rgb = [int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
        lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in rgb]
        return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]

    l1, l2 = sorted((lum(fg_hex), lum(bg_hex)), reverse=True)
    return (l1 + 0.05) / (l2 + 0.05)
