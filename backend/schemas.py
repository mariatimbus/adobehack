"""CreativeDNA frozen data contracts.

Versioned shared schemas between the Adobe Express add-on (TypeScript) and the
FastAPI backend. Changes here must be agreed by all four subsystem owners —
do not change silently. See PROJECT_BRIEF.md §"Contracts".

Conventions:
  - bbox is [x, y, width, height] in canvas pixels, origin top-left.
  - Colors are lowercase hex strings, e.g. "#f4efe8".
  - provider_mode is ALWAYS truthful: "live" | "cached" | "fixture" | "heuristic".
"""

from __future__ import annotations

import re
from enum import Enum
from typing import Annotated, Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

API_VERSION = "1.0.0"
CONTRACT_VERSION = 1

# ---------------------------------------------------------------------------
# Geometry primitives
# ---------------------------------------------------------------------------

BBox = Annotated[list[float], Field(min_length=4, max_length=4)]


def bbox_model() -> str:
    return "[x, y, width, height]"


_HEX_RE = re.compile(r"^#[0-9a-f]{6}$")


class Canvas(BaseModel):
    width: float = Field(gt=0, le=16384)
    height: float = Field(gt=0, le=16384)


class Rect:
    """Plain geometry helper (not a wire contract; wire format is bbox lists)."""

    __slots__ = ("x", "y", "w", "h")

    def __init__(self, x: float, y: float, w: float, h: float):
        self.x, self.y, self.w, self.h = float(x), float(y), float(w), float(h)

    @classmethod
    def from_bbox(cls, b: list[float]) -> "Rect":
        return cls(x=b[0], y=b[1], w=b[2], h=b[3])

    def to_bbox(self) -> list[float]:
        return [round(self.x, 3), round(self.y, 3), round(self.w, 3), round(self.h, 3)]

    @property
    def left(self) -> float:
        return self.x

    @property
    def top(self) -> float:
        return self.y

    @property
    def right(self) -> float:
        return self.x + self.w

    @property
    def bottom(self) -> float:
        return self.y + self.h

    @property
    def cx(self) -> float:
        return self.x + self.w / 2

    @property
    def cy(self) -> float:
        return self.y + self.h / 2

    @property
    def area(self) -> float:
        return self.w * self.h

    def translated(self, dx: float, dy: float) -> "Rect":
        return Rect(self.x + dx, self.y + dy, self.w, self.h)

    def __eq__(self, o: object) -> bool:
        return (isinstance(o, Rect) and self.x == o.x and self.y == o.y
                and self.w == o.w and self.h == o.h)

    def __repr__(self) -> str:
        return f"Rect({self.x}, {self.y}, {self.w}, {self.h})"

    def inset(self, m: float) -> "Rect":
        return Rect(self.x + m, self.y + m, max(0.0, self.w - 2 * m), max(0.0, self.h - 2 * m))

    def intersects(self, o: "Rect") -> bool:
        return not (o.left >= self.right or o.right <= self.left or o.top >= self.bottom or o.bottom <= self.top)

    def intersection(self, o: "Rect") -> "Rect":
        x0, y0 = max(self.left, o.left), max(self.top, o.top)
        x1, y1 = min(self.right, o.right), min(self.bottom, o.bottom)
        if x1 <= x0 or y1 <= y0:
            return Rect(0, 0, 0, 0)
        return Rect(x0, y0, x1 - x0, y1 - y0)

    def contains(self, o: "Rect") -> bool:
        return o.left >= self.left - 1e-9 and o.right <= self.right + 1e-9 and o.top >= self.top - 1e-9 and o.bottom <= self.bottom + 1e-9

    def h_gap(self, o: "Rect") -> float:
        """Horizontal separation between two non-overlapping-in-x rectangles."""
        if self.intersects(o):
            return 0.0
        if o.left >= self.right:
            return o.left - self.right
        if self.left >= o.right:
            return self.left - o.right
        return 0.0

    def v_gap(self, o: "Rect") -> float:
        if self.intersects(o):
            return 0.0
        if o.top >= self.bottom:
            return o.top - self.bottom
        if self.top >= o.bottom:
            return self.top - o.bottom
        return 0.0

    def union(self, o: "Rect") -> "Rect":
        x0, y0 = min(self.left, o.left), min(self.top, o.top)
        x1, y1 = max(self.right, o.right), max(self.bottom, o.bottom)
        return Rect(x0, y0, x1 - x0, y1 - y0)


# ---------------------------------------------------------------------------
# DesignSpec
# ---------------------------------------------------------------------------


class NodeType(str, Enum):
    rectangle = "rectangle"
    text = "text"
    image = "image"


class NodeRole(str, Enum):
    background = "background"
    decoration = "decoration"
    brand = "brand"
    headline = "headline"
    subhead = "subhead"
    product = "product"  # focal product image
    cta_background = "cta_background"
    cta_text = "cta_text"


class DesignNode(BaseModel):
    id: str = Field(min_length=1)
    type: NodeType
    role: NodeRole
    bbox: BBox
    fill: Optional[str] = None  # solid color; None means not a solid fill (e.g. image)
    text: Optional[str] = None
    font_size: Optional[float] = Field(default=None, gt=0, le=1024)
    color: Optional[str] = None  # solid text color
    asset_id: Optional[str] = None  # authorized, cached demo asset reference
    expendable: bool = False

    @field_validator("fill", "color")
    @classmethod
    def _hex(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.lower()
        if not _HEX_RE.match(v):
            raise ValueError(f"color must be #rrggbb hex, got {v!r}")
        return v

    @property
    def rect(self) -> Rect:
        return Rect.from_bbox(self.bbox)

    def copy_with(self, **kw: Any) -> "DesignNode":
        data = self.model_dump()
        data.update(kw)
        return DesignNode.model_validate(data)


class DesignSpec(BaseModel):
    design_id: str
    version: int = Field(ge=0)
    canvas: Canvas
    nodes: list[DesignNode] = Field(min_length=1)

    model_config = ConfigDict(json_schema_extra={"bbox_format": bbox_model()})

    @field_validator("nodes")
    @classmethod
    def _unique_ids(cls, nodes: list[DesignNode]) -> list[DesignNode]:
        ids = [n.id for n in nodes]
        dupes = {i for i in ids if ids.count(i) > 1}
        if dupes:
            raise ValueError(f"duplicate node ids: {sorted(dupes)}")
        return nodes

    def node(self, node_id: str) -> DesignNode:
        for n in self.nodes:
            if n.id == node_id:
                return n
        raise KeyError(node_id)

    def has(self, node_id: str) -> bool:
        return any(n.id == node_id for n in self.nodes)

    def nodes_by_role(self, role: NodeRole) -> list[DesignNode]:
        return [n for n in self.nodes if n.role == role]

    def copy_with(self, **kw: Any) -> "DesignSpec":
        data = self.model_dump()
        data.update(kw)
        return DesignSpec.model_validate(data)


# ---------------------------------------------------------------------------
# DesignIntentGraph
# ---------------------------------------------------------------------------


class RelationshipType(str, Enum):
    visual_group = "visual_group"
    protected = "protected"
    expendable = "expendable"
    spacing = "spacing"  # designated critical pair with min separation
    contained = "contained"  # intentional containment (e.g. cta inside cta_bg)
    exempt_bounds = "exempt_bounds"  # exempt from generic bounds/overlap rules
    exempt_overlap = "exempt_overlap"  # specific pair exempt from overlap/spacing checks
    prominence = "prominence"  # ordered visual hierarchy pairs


class Relationship(BaseModel):
    type: RelationshipType
    nodes: list[str] = Field(min_length=1)
    locks: list[Literal["position", "size"]] = []
    min_gap_px: Optional[float] = None
    note: Optional[str] = None


class Provenance(BaseModel):
    mode: Literal["fixture", "rule_inference", "live_ai", "hybrid"] = "fixture"
    reference_ids: list[str] = []
    model: Optional[str] = None
    uncertainty: Optional[str] = None


class DesignIntentGraph(BaseModel):
    design_id: str
    focal_element: str
    hierarchy: list[str]  # most prominent first
    relationships: list[Relationship]
    provenance: Provenance = Field(default_factory=Provenance)


# ---------------------------------------------------------------------------
# RepairConstraints
# ---------------------------------------------------------------------------


class NodeLock(BaseModel):
    node_id: str
    position: bool = False
    size: bool = False

    @model_validator(mode="after")
    def _some_lock(self) -> "NodeLock":
        if not (self.position or self.size):
            raise ValueError("NodeLock must lock position and/or size")
        return self


class FormatTarget(BaseModel):
    name: Literal["instagram_feed", "instagram_story", "landscape_banner"]
    width: float
    height: float


class RepairConstraints(BaseModel):
    instruction: str
    changes: dict[str, str] = Field(default_factory=dict)  # node_id -> new text
    top_reserved_px: float = 0
    top_zone_exempt_node_ids: list[str] = Field(default_factory=list)
    bottom_reserved_px: float = 0
    keep_visible: list[str] = Field(default_factory=list)  # must not be hidden/removed
    locks: list[NodeLock] = Field(default_factory=list)
    min_font_size: dict[str, float] = Field(default_factory=dict)  # node_id -> px floor
    critical_pairs: list[tuple[str, str]] = Field(default_factory=list)
    forbidden_phrases: list[str] = Field(default_factory=list)
    format_target: Optional[FormatTarget] = None
    translation: Optional[dict[str, str]] = None  # node_id -> target language (BCP-47), live AI only
    ambiguities: list[str] = Field(default_factory=list)
    unsupported: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Operations and candidates
# ---------------------------------------------------------------------------

OperationType = Literal["set_text", "set_bbox", "set_font_size", "set_visible", "translate"]

ALLOWED_OPS: tuple[OperationType, ...] = ("set_text", "set_bbox", "set_font_size", "set_visible", "translate")


class Operation(BaseModel):
    op: OperationType
    node_id: str
    value: Any  # set_text: str | set_bbox: [x,y,w,h] | set_font_size: px | set_visible: bool | translate: [dx,dy]

    @field_validator("value")
    @classmethod
    def _typed_value(cls, v: Any, info) -> Any:
        op = info.data.get("op") if info.data else None
        if op == "set_bbox":
            if not (isinstance(v, list) and len(v) == 4 and all(isinstance(x, (int, float)) for x in v)):
                raise ValueError("set_bbox value must be [x, y, w, h]")
            if v[2] < 0 or v[3] < 0:
                raise ValueError("set_bbox width/height must be >= 0")
        elif op == "translate":
            if not (isinstance(v, list) and len(v) == 2 and all(isinstance(x, (int, float)) for x in v)):
                raise ValueError("translate value must be [dx, dy]")
        elif op == "set_font_size":
            if not isinstance(v, (int, float)) or v <= 0:
                raise ValueError("set_font_size value must be a positive number")
        elif op == "set_visible":
            if not isinstance(v, bool):
                raise ValueError("set_visible value must be bool")
        elif op == "set_text":
            if not isinstance(v, str):
                raise ValueError("set_text value must be str")
        return v


class RuleStatus(str, Enum):
    pass_ = "pass"
    fail = "fail"
    unknown = "unknown"


class RuleResult(BaseModel):
    rule: str
    status: RuleStatus
    node_ids: list[str] = Field(default_factory=list)
    method: str  # how the check was performed, e.g. "aabb", "wcag-luminance", "estimated_pil"
    detail: str = ""


class CandidateValidation(BaseModel):
    passed: int
    failed: int
    unknown: int
    results: list[RuleResult]


class Feasibility(str, Enum):
    feasible = "feasible"
    infeasible = "infeasible"
    unverified = "unverified"


class SoftMetrics(BaseModel):
    hierarchy: float
    grouping: float
    balance: float
    displacement: float
    J: float


ProviderMode = Literal["live", "cached", "fixture", "heuristic"]


class CandidateResult(BaseModel):
    candidate_id: str  # "c1", "c2", "c3" or baseline ids
    strategy: str  # human-readable strategy name
    generator: Literal["ai_strategies", "heuristic_zones", "uniform_scale"] = "ai_strategies"
    operations: list[Operation]
    validation: CandidateValidation
    feasibility: Feasibility
    soft_score: Optional[SoftMetrics] = None
    base_version: int  # DesignSpec.version this candidate was built against
    resulting_spec: DesignSpec  # complete simulated result — never a placeholder
    provider_mode: ProviderMode
    rejected_reasons: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Adobe document state / verification
# ---------------------------------------------------------------------------


class NodeBinding(BaseModel):
    node_id: str  # application-level stable id
    adobe_node_id: str  # scenegraph node id
    type: NodeType
    editable: bool = True


class DocumentState(BaseModel):
    design_id: str
    version: int
    canvas: Canvas
    bindings: list[NodeBinding]
    node_count: int
    unsupported_properties: list[str] = Field(default_factory=list)


class ObservedNode(BaseModel):
    node_id: str
    adobe_node_id: Optional[str] = None
    bbox: Optional[BBox] = None
    text: Optional[str] = None
    font_size: Optional[float] = None
    visible: Optional[bool] = None
    editable: Optional[bool] = None
    observed: bool = False  # False => SDK could not read this property


class PostApplyReport(BaseModel):
    design_id: str
    base_version: int
    resulting_version: Optional[int]
    candidate_id: str
    planned: list[ObservedNode]
    observed: list[ObservedNode]
    matched: int
    mismatched: list[str]  # node_ids with discrepancies
    unsupported_measurements: list[str]
    node_count_before: int
    node_count_after: Optional[int]
    editability_retained: Optional[bool]
    constraint_violations: list[str]
    apply_duration_ms: float
    recovered: Optional[bool] = None  # None => no failure occurred
    status: Literal["verified", "verified_with_gaps", "partial_failure", "failed"]


# ---------------------------------------------------------------------------
# Telemetry
# ---------------------------------------------------------------------------


class TelemetryEvent(BaseModel):
    event: str  # e.g. "interpret", "candidates", "apply"
    provider_mode: ProviderMode
    ai_duration_ms: Optional[float] = None
    geometry_duration_ms: Optional[float] = None
    adobe_apply_duration_ms: Optional[float] = None
    total_duration_ms: float
    token_usage: Optional[int] = None
    estimated_cost_usd: Optional[float] = None
    cost_basis: Optional[str] = None  # e.g. "fixture: no provider called => $0"
    editable_node_count: Optional[int] = None
    hard_pass: Optional[int] = None
    hard_fail: Optional[int] = None
    hard_unknown: Optional[int] = None


# ---------------------------------------------------------------------------
# API envelopes
# ---------------------------------------------------------------------------


class APIError(BaseModel):
    error: str
    code: str
    detail: Optional[Any] = None


class InterpretResponse(BaseModel):
    constraints: RepairConstraints
    provider_mode: ProviderMode
    issues: list[str] = Field(default_factory=list)


class CandidatesResponse(BaseModel):
    design_id: str
    base_version: int
    candidates: list[CandidateResult]
    selected: Optional[CandidateResult] = None  # best feasible by ranker; None if none feasible
    telemetry: TelemetryEvent
    infeasibility_explanation: Optional[str] = None
    relaxation_suggestion: Optional[RepairConstraints] = None
