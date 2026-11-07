"""AlphaZ poster campaign tests: contract + flagship rehearsal."""

from backend.fixtures.alphaz import (ALPHAZ_FLAGSHIP_HEADLINE, ALPHAZ_FLAGSHIP_INSTRUCTION,
                                     alphaz_intent_graph, alphaz_spec)
from backend.fixtures.luma_skin import DEMO_RULES
from backend.pipeline import build_candidates, select_best
from backend.schemas import Feasibility, NodeRole
from backend.services.interpreter import RuleInterpreter
from backend.services.strategist import StrategyConfig

CFG = StrategyConfig(safe_margin_px=64, role_font_floors=DEMO_RULES["min_font_size_role"])


def test_alphaz_fixture_shape():
    spec, intent = alphaz_spec(), alphaz_intent_graph()
    assert len(spec.nodes) == 8
    assert spec.canvas.height == 1350
    assert [n.id for n in spec.nodes] == [
        "bg", "deco_circuits", "brand", "headline", "subhead", "hero", "cta_bg", "cta"]
    roles = {n.id: n.role for n in spec.nodes}
    assert roles["hero"] == NodeRole.product
    assert roles["deco_circuits"].value == "decoration" and spec.node("deco_circuits").expendable
    assert intent.focal_element == "hero"


def test_alphaz_flagship_all_strategies_ranked():
    spec, intent = alphaz_spec(), alphaz_intent_graph()
    cons = RuleInterpreter().interpret(
        ALPHAZ_FLAGSHIP_INSTRUCTION,
        known_node_ids=[n.id for n in spec.nodes],
        role_of={n.id: n.role.value for n in spec.nodes},
        headline_text=ALPHAZ_FLAGSHIP_HEADLINE)
    assert cons.top_reserved_px == 180
    assert {l.node_id for l in cons.locks} == {"hero", "brand"}

    cands, _ = build_candidates(spec, intent, cons, CFG)
    assert len(cands) == 3
    # headline applied and, if feasible, winner carries the longer copy
    best = select_best(cands)
    assert best is not None, "flagship should be feasible on the poster campaign"
    assert best.feasibility == Feasibility.feasible
    assert best.resulting_spec.node("headline").text == ALPHAZ_FLAGSHIP_HEADLINE
    assert best.resulting_spec.node("hero").bbox[2:] == [300, 945]   # size lock
    assert best.resulting_spec.node("brand").bbox == [64, 56, 260, 46]  # position lock
    # ranker separation is honest math: J values are real and close-but-ordered
    js = [c.soft_score.J for c in cands if c.soft_score]
    assert js == sorted(js, reverse=True)


def test_alphaz_demo_endpoint():
    from fastapi.testclient import TestClient
    from backend.app import app
    client = TestClient(app)
    r = client.get("/api/v1/design/demo?demo=alphaz")
    assert r.status_code == 200
    body = r.json()
    assert body["spec"]["design_id"] == "alphaz-001"
    assert body["flagship"]["instruction"] == ALPHAZ_FLAGSHIP_INSTRUCTION
