"""Import-your-own-page tests: role inference + candidates on an arbitrary spec."""

from backend.fixtures.luma_skin import DEMO_RULES
from backend.schemas import DesignSpec, NodeRole, NodeType
from backend.services.intent import infer_roles
from backend.services.strategist import StrategyConfig
from backend.pipeline import build_candidates, select_best
from fastapi.testclient import TestClient
from backend.app import app

client = TestClient(app)


def unlabeled_spec() -> DesignSpec:
    """An 'imported' page: correct geometry, all roles neutral (decoration)."""
    return DesignSpec.model_validate({
        "design_id": "imported-test",
        "version": 1,
        "canvas": {"width": 1080, "height": 1080},
        "nodes": [
            {"id": "n1", "type": "rectangle", "role": "decoration", "bbox": [0, 0, 1080, 1080], "fill": "#ffffff"},
            {"id": "n2", "type": "text", "role": "decoration", "bbox": [60, 60, 300, 50],
             "text": "ACME", "font_size": 30, "color": "#111111"},
            {"id": "n3", "type": "text", "role": "decoration", "bbox": [60, 300, 500, 200],
             "text": "Big claim here", "font_size": 60, "color": "#111111"},
            {"id": "n4", "type": "image", "role": "decoration", "bbox": [600, 200, 400, 600]},
            {"id": "n5", "type": "rectangle", "role": "decoration", "bbox": [60, 900, 260, 80], "fill": "#aabbcc"},
            {"id": "n6", "type": "text", "role": "decoration", "bbox": [90, 925, 200, 35],
             "text": "Buy now", "font_size": 26, "color": "#111111"},
        ],
    })


def test_infer_roles_assigns_sensible_roles():
    spec = infer_roles(unlabeled_spec())
    roles = {n.id: n.role for n in spec.nodes}
    assert roles["n1"] == NodeRole.background      # full-canvas rectangle
    assert roles["n4"] == NodeRole.product         # largest (only) image
    assert roles["n2"] == NodeRole.brand           # top-most small text
    assert roles["n3"] == NodeRole.headline        # biggest text
    assert roles["n5"] == NodeRole.cta_background  # pill behind CTA text
    assert roles["n6"] == NodeRole.cta_text        # text on the pill


def test_candidates_run_on_imported_spec():
    spec = infer_roles(unlabeled_spec())
    from backend.services.intent import infer_intent
    intent = infer_intent(spec, None)
    cfg = StrategyConfig(safe_margin_px=DEMO_RULES["safe_margin_px"],
                         role_font_floors=DEMO_RULES["min_font_size_role"])
    from backend.schemas import RepairConstraints
    cons = RepairConstraints(
        instruction="test",
        changes={"n3": "A much longer claim that needs more room in the layout"},
        top_reserved_px=180,
        locks=[{"node_id": "n4", "size": True}],
    )
    cands, _ = build_candidates(spec, intent, cons, cfg)
    assert len(cands) == 3
    # at least one strategy must be feasible on the user's own design
    assert select_best(cands) is not None


def test_api_infer_roles_endpoint():
    r = client.post("/api/v1/design/infer-roles", json={"spec": unlabeled_spec().model_dump()})
    assert r.status_code == 200
    body = r.json()
    assert "rule_inference" in body["provenance"]
    roles = {n["id"]: n["role"] for n in body["spec"]["nodes"]}
    assert roles["n3"] == "headline"


def test_api_candidates_with_custom_spec():
    spec = infer_roles(unlabeled_spec())
    r = client.post("/api/v1/candidates", json={
        "instruction": "Make the headline longer and reserve a 180px top zone",
        "headline_text": "A much longer claim that needs more room in the layout",
        "spec": spec.model_dump(),
    })
    assert r.status_code == 200
    body = r.json()
    assert body["design_id"] == "imported-test"
    assert len(body["candidates"]) == 3
