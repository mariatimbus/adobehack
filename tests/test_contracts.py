"""Contract tests: schemas, fixtures, operation allowlist, versioning."""

import pytest
from pydantic import ValidationError

from backend.fixtures.luma_skin import luma_intent_graph, luma_spec
from backend.schemas import DesignSpec, NodeLock, Operation, RepairConstraints


def test_fixture_has_exactly_eight_intended_nodes():
    spec = luma_spec()
    assert [n.id for n in spec.nodes] == [
        "bg", "deco_arch", "brand", "headline", "subhead", "hero", "cta_bg", "cta"]


def test_fixture_matches_spec_bboxes():
    spec = luma_spec()
    b = {n.id: n.bbox for n in spec.nodes}
    assert b["bg"] == [0, 0, 1080, 1080]
    assert b["deco_arch"] == [520, 120, 480, 840]
    assert b["brand"] == [64, 64, 360, 56]
    assert b["headline"] == [64, 220, 420, 180]
    assert b["hero"] == [560, 180, 420, 620]
    assert b["cta_bg"] == [64, 860, 280, 84]
    assert b["cta"] == [92, 882, 224, 40]


def test_duplicate_node_ids_rejected():
    spec = luma_spec().model_dump()
    spec["nodes"].append(dict(spec["nodes"][1]))
    with pytest.raises(ValidationError):
        DesignSpec.model_validate(spec)


def test_bad_hex_rejected():
    spec = luma_spec().model_dump()
    spec["nodes"][0]["fill"] = "red"
    with pytest.raises(ValidationError):
        DesignSpec.model_validate(spec)


def test_operation_value_typing():
    with pytest.raises(ValidationError):
        Operation(op="set_bbox", node_id="x", value=[1, 2, -3, 4])
    with pytest.raises(ValidationError):
        Operation(op="set_visible", node_id="x", value="yes")
    with pytest.raises(ValidationError):
        Operation(op="translate", node_id="x", value=[1])
    op = Operation(op="set_text", node_id="headline", value="Hello")
    assert op.value == "Hello"


def test_node_lock_requires_kind():
    with pytest.raises(ValidationError):
        NodeLock(node_id="hero")


def test_fixture_intent_graph_structure():
    g = luma_intent_graph()
    assert g.focal_element == "hero"
    types = {r.type.value for r in g.relationships}
    assert {"visual_group", "protected", "expendable", "contained",
            "spacing", "prominence", "exempt_bounds", "exempt_overlap"} <= types
    assert g.provenance.mode == "fixture"


def test_constraints_defaults():
    c = RepairConstraints(instruction="test")
    assert c.top_reserved_px == 0 and c.locks == [] and c.changes == {}
