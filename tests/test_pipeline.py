"""Pipeline tests: flagship demo, infeasibility, ranking, interpreter honesty."""

import pytest

from backend.fixtures.luma_skin import DEMO_RULES, FORBIDDEN_PHRASES, luma_intent_graph, luma_spec
from backend.pipeline import build_candidates, select_best, suggest_relaxation
from backend.schemas import Feasibility, RepairConstraints
from backend.services.interpreter import LiveInterpreter, RuleInterpreter
from backend.services.strategist import StrategyConfig
from backend.services import ranker

CFG = StrategyConfig(safe_margin_px=64, role_font_floors=DEMO_RULES["min_font_size_role"])
LONG = "Hydration that adapts to your skin barrier all day"


def flagship_constraints():
    spec = luma_spec()
    return RuleInterpreter().interpret(
        "Use a longer headline, preserve hero size and brand position, reserve a 180px top promo zone",
        known_node_ids=[n.id for n in spec.nodes],
        role_of={n.id: n.role.value for n in spec.nodes},
        headline_text=LONG)


def test_flagship_pipeline_three_distinct_candidates():
    spec, intent = luma_spec(), luma_intent_graph()
    cons = flagship_constraints()
    cands, geo_ms = build_candidates(spec, intent, cons, CFG)
    assert len(cands) == 3
    strategies = {c.strategy for c in cands}
    assert strategies == {"typography_adaptation", "group_reflow", "expendable_pruning"}
    # distinct operation lists, not renamed shifts
    op_sets = {tuple(sorted((o.op, o.node_id) for o in c.operations)) for c in cands}
    assert len(op_sets) == 3
    # every candidate carries a complete resulting spec
    for c in cands:
        assert len(c.resulting_spec.nodes) == 8
        assert c.provider_mode == "fixture"
        assert c.base_version == spec.version


def test_flagship_best_is_verified_feasible():
    spec, intent = luma_spec(), luma_intent_graph()
    cons = flagship_constraints()
    cands, _ = build_candidates(spec, intent, cons, CFG)
    best = select_best(cands)
    assert best is not None
    assert best.feasibility == Feasibility.feasible
    # winning candidate is not "c3 by construction": the id must match the
    # strategy that passed all hard rules; at least one other must fail
    others = [c for c in cands if c.candidate_id != best.candidate_id]
    assert any(c.feasibility == Feasibility.infeasible for c in others)
    # locks honored
    hero = best.resulting_spec.node("hero")
    brand = best.resulting_spec.node("brand")
    assert hero.bbox[2:] == [420, 620]            # size lock
    assert brand.bbox == [64, 64, 360, 56]        # position lock
    # longer headline applied
    assert best.resulting_spec.node("headline").text == LONG


def test_every_candidate_has_rejection_reasons_when_infeasible():
    spec, intent = luma_spec(), luma_intent_graph()
    cons = flagship_constraints()
    cands, _ = build_candidates(spec, intent, cons, CFG)
    for c in cands:
        if c.feasibility == Feasibility.infeasible:
            assert c.rejected_reasons


def test_infeasible_case_all_rejected_with_relaxation():
    spec, intent = luma_spec(), luma_intent_graph()
    cons = RuleInterpreter().interpret(
        "Preserve brand position and hero size, reserve a 900px top promo zone, "
        "keep the headline font above 60px",
        known_node_ids=[n.id for n in spec.nodes],
        role_of={n.id: n.role.value for n in spec.nodes},
        headline_text=LONG)
    cons.forbidden_phrases = list(FORBIDDEN_PHRASES)
    cands, _ = build_candidates(spec, intent, cons, CFG)
    assert all(c.feasibility != Feasibility.feasible for c in cands)
    relaxation = suggest_relaxation(spec, intent, cons, CFG)
    assert relaxation is not None
    # a relaxation exists that makes the problem solvable (exemption or zone shrink)
    cands2, _ = build_candidates(spec, intent, relaxation, CFG)
    assert select_best(cands2) is not None


def test_candidate_c_does_not_win_by_name():
    """Ranker scores by measured J only; renaming ids must not change the winner."""
    spec, intent = luma_spec(), luma_intent_graph()
    cons = flagship_constraints()
    cands, _ = build_candidates(spec, intent, cons, CFG)
    feasible = [c for c in cands if c.feasibility == Feasibility.feasible]
    best = ranker.rank(feasible)[0]
    renamed = []
    for i, c in enumerate(feasible):
        renamed.append(c.model_copy(update={"candidate_id": f"zz{i}"}))
    best2 = ranker.rank(renamed)[0]
    assert best2.strategy == best.strategy


def test_ranker_metrics_are_real_values():
    spec, intent = luma_spec(), luma_intent_graph()
    cons = flagship_constraints()
    cands, _ = build_candidates(spec, intent, cons, CFG)
    best = select_best(cands)
    m = best.soft_score
    for v in (m.hierarchy, m.grouping, m.balance, m.displacement):
        assert 0.0 <= v <= 1.0
    expected = 0.35 * m.hierarchy + 0.25 * m.grouping + 0.20 * m.balance - 0.20 * m.displacement
    assert abs(m.J - round(expected, 4)) < 1e-3


def test_story_format_adaptation():
    spec, intent = luma_spec(), luma_intent_graph()
    cons = RuleInterpreter().interpret(
        "Adapt this campaign for Instagram Stories, keep the CTA visible, preserve hero size",
        known_node_ids=[n.id for n in spec.nodes],
        role_of={n.id: n.role.value for n in spec.nodes},
        current_texts={"headline": "Hydration, made simple."})
    cands, _ = build_candidates(spec, intent, cons, CFG)
    best = select_best(cands)
    assert best is not None
    assert best.resulting_spec.canvas.height == 1920
    assert best.resulting_spec.node("hero").bbox[2:] == [420, 620]  # size lock kept
    cta = best.resulting_spec.node("cta")
    assert cta.rect.w > 0  # keep_visible honored


def test_translation_labeled_fixture_not_live():
    spec = luma_spec()
    it = RuleInterpreter()
    cons = it.interpret(
        "translate the headline into French",
        known_node_ids=[n.id for n in spec.nodes],
        role_of={n.id: n.role.value for n in spec.nodes},
        current_texts={"headline": "Hydration, made simple."})
    assert cons.translation == {"headline": "fr"}
    assert cons.changes["headline"] == "Une hydratation, en toute simplicité."
    assert it.provider_mode == "fixture"


def test_live_interpreter_refuses_without_credentials():
    live = LiveInterpreter(api_key=None)
    with pytest.raises(Exception):
        live.interpret("hello", known_node_ids=["a"])


def test_unknown_instruction_reports_ambiguity():
    spec = luma_spec()
    cons = RuleInterpreter().interpret(
        "please make it pop more",
        known_node_ids=[n.id for n in spec.nodes],
        role_of={n.id: n.role.value for n in spec.nodes})
    assert cons.ambiguities  # nothing actionable recognized -> explicit


def test_interpretation_exemption_documented():
    spec = luma_spec()
    cons = RuleInterpreter().interpret(
        "preserve brand position, reserve a 180px top zone",
        known_node_ids=[n.id for n in spec.nodes],
        role_of={n.id: n.role.value for n in spec.nodes})
    assert "brand" in cons.top_zone_exempt_node_ids
    assert any("exempt" in a.lower() for a in cons.ambiguities)
