"""Geometry + validator tests (Developer D)."""

import pytest

from backend.fixtures.luma_skin import DEMO_RULES, luma_intent_graph, luma_spec
from backend.schemas import Feasibility, Rect, RepairConstraints, RuleStatus
from backend.services import textmetrics, validator
from backend.services.interpreter import RuleInterpreter
from backend.services.layout import apply_operations, contrast_ratio
from backend.services.strategist import StrategyConfig
from backend.pipeline import build_candidates

CFG = StrategyConfig(safe_margin_px=64, role_font_floors=DEMO_RULES["min_font_size_role"])


def validate(spec, base, constraints=None, intent=None):
    return validator.validate(spec, base, constraints, intent,
                              safe_margin_px=CFG.safe_margin_px,
                              role_font_floors=CFG.role_font_floors)


def test_rect_aabb_math():
    a = Rect(0, 0, 100, 100)
    b = Rect(150, 0, 100, 100)
    c = Rect(50, 50, 100, 100)
    assert not a.intersects(b)
    assert a.h_gap(b) == 50
    assert a.intersects(c)
    assert a.intersection(c) == Rect(50, 50, 50, 50)
    assert a.union(b) == Rect(0, 0, 250, 100)


def test_contrast_srgb_linearization():
    # known WCAG values
    assert abs(contrast_ratio("#ffffff", "#000000") - 21.0) < 0.01
    assert abs(contrast_ratio("#000000", "#000000") - 1.0) < 0.01
    cream_charcoal = contrast_ratio("#242424", "#f4efe8")
    assert cream_charcoal > 4.5  # brand text on cream passes AA


def test_pristine_fixture_fails_only_known_issues():
    """Baseline truth: original fixture has one measured overflow (cta) under
    the conservative substitute-font metric; everything else passes."""
    spec, intent = luma_spec(), luma_intent_graph()
    v = validate(spec, spec, None, intent)
    failing = [r.rule for r in v.results if r.status == RuleStatus.fail]
    assert failing == ["text_overflow"]


def test_lock_violation_detected():
    spec, intent = luma_spec(), luma_intent_graph()
    ops = [__import__("backend.schemas", fromlist=["Operation"]).Operation(
        op="translate", node_id="hero", value=[50, 0])]
    moved = apply_operations(spec, ops)
    cons = RepairConstraints(instruction="t", locks=[{"node_id": "hero", "size": True}])
    v = validate(moved, spec, cons, intent)
    lock_res = next(r for r in v.results if r.rule == "locks")
    assert lock_res.status == RuleStatus.pass_  # size preserved despite move
    cons2 = RepairConstraints(instruction="t", locks=[{"node_id": "hero", "position": True}])
    v2 = validate(moved, spec, cons2, intent)
    assert next(r for r in v2.results if r.rule == "locks").status == RuleStatus.fail


def test_cta_containment_whitelisted_but_headline_hero_not():
    """CTA/cta_bg overlap is intentional; headline/hero overlap is detected."""
    spec, intent = luma_spec(), luma_intent_graph()
    gen = validate(spec, spec, None, intent)
    assert next(r for r in gen.results if r.rule == "containment").status == RuleStatus.pass_
    assert next(r for r in gen.results if r.rule == "generic_overlap").status == RuleStatus.pass_
    # force headline onto hero
    ops = [__import__("backend.schemas", fromlist=["Operation"]).Operation(
        op="set_bbox", node_id="headline", value=[560, 220, 420, 180])]
    moved = apply_operations(spec, ops)
    v = validate(moved, spec, None, intent)
    crit = next(r for r in v.results if r.rule == "critical_spacing")
    overlap = next(r for r in v.results if r.rule == "generic_overlap")
    assert crit.status == RuleStatus.fail
    assert overlap.status == RuleStatus.fail
    assert "headline/hero" in overlap.detail


def test_deco_hero_overlap_exempt_but_not_blanket():
    spec, intent = luma_spec(), luma_intent_graph()
    v = validate(spec, spec, None, intent)
    go = next(r for r in v.results if r.rule == "generic_overlap")
    assert "deco_arch+hero" in go.detail  # explicit pair exemption, not blanket


def test_top_zone_brand_conflict_requires_exemption():
    """Without the documented exemption, a locked brand inside the top zone fails;
    with exemption it passes — never silently."""
    spec, intent = luma_spec(), luma_intent_graph()
    no_exempt = RepairConstraints(
        instruction="t", top_reserved_px=180,
        locks=[{"node_id": "brand", "position": True}])
    v = validate(spec, spec, no_exempt, intent)
    safe = next(r for r in v.results if r.rule == "safe_area")
    assert safe.status == RuleStatus.fail and "brand" in safe.detail

    exempt = RepairConstraints(
        instruction="t", top_reserved_px=180, top_zone_exempt_node_ids=["brand"],
        locks=[{"node_id": "brand", "position": True}])
    # move decoration out of the zone so ONLY the exemption logic is under test
    data = spec.model_dump()
    for n in data["nodes"]:
        if n["id"] == "deco_arch":
            n["bbox"] = [520, 200, 480, 760]
    spec2 = type(spec).model_validate(data)
    v2 = validate(spec2, spec2, exempt, intent)
    safe2 = next(r for r in v2.results if r.rule == "safe_area")
    assert safe2.status == RuleStatus.pass_
    assert "exempt: ['brand']" in safe2.detail  # exemption is explicit in the record


def test_overflow_never_false_passes_when_unmeasurable(monkeypatch):
    monkeypatch.setattr(textmetrics, "available", lambda: False)
    spec, intent = luma_spec(), luma_intent_graph()
    v = validate(spec, spec, None, intent)
    ov = next(r for r in v.results if r.rule == "text_overflow")
    assert ov.status == RuleStatus.unknown
    assert validator.feasibility_of(v) == "unverified"  # unknown blocks feasibility


def test_forbidden_copy_flagged():
    spec, intent = luma_spec(), luma_intent_graph()
    ops = [__import__("backend.schemas", fromlist=["Operation"]).Operation(
        op="set_text", node_id="headline", value="Clinically proven guaranteed results!")]
    changed = apply_operations(spec, ops)
    cons = RepairConstraints(instruction="t", forbidden_phrases=["clinically proven", "guaranteed results"])
    v = validate(changed, spec, cons, intent)
    fc = next(r for r in v.results if r.rule == "forbidden_copy")
    assert fc.status == RuleStatus.fail


def test_feasibility_policy():
    spec, intent = luma_spec(), luma_intent_graph()
    ok = validate(spec, spec, None, intent)
    assert validator.feasibility_of(ok) in ("infeasible", "unverified")  # known cta overflow


def test_min_font_floor_enforced():
    spec, intent = luma_spec(), luma_intent_graph()
    ops = [__import__("backend.schemas", fromlist=["Operation"]).Operation(
        op="set_font_size", node_id="headline", value=20)]
    shrunk = apply_operations(spec, ops)
    cons = RepairConstraints(instruction="t", min_font_size={"headline": 32})
    v = validate(shrunk, spec, cons, intent)
    mf = next(r for r in v.results if r.rule == "min_font_size")
    assert mf.status == RuleStatus.fail and "headline" in mf.detail
