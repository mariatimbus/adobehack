"""API integration tests (FastAPI TestClient) + benchmark integrity tests."""

import csv
import json
import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app import app
from backend.benchmark import OUT_DIR, run_benchmark

client = TestClient(app)

LONG = "Hydration that adapts to your skin barrier all day"


def test_health():
    r = client.get("/api/v1/health")
    assert r.status_code == 200
    body = r.json()
    assert body["ai_mode"] == "fixture"
    assert body["contract_version"] == 1


def test_design_demo():
    r = client.get("/api/v1/design/demo")
    assert r.status_code == 200
    body = r.json()
    assert len(body["spec"]["nodes"]) == 8
    assert body["intent"]["focal_element"] == "hero"


def test_interpret_route():
    r = client.post("/api/v1/interpret", json={
        "instruction": "Make the headline longer, keep the product size unchanged, "
                       "preserve the logo position and reserve 180 pixels at the top",
        "headline_text": LONG})
    assert r.status_code == 200
    body = r.json()
    c = body["constraints"]
    assert body["provider_mode"] == "fixture"
    assert c["top_reserved_px"] == 180
    locks = {l["node_id"]: l for l in c["locks"]}
    assert locks["hero"]["size"] is True
    assert locks["brand"]["position"] is True
    assert "brand" in c["top_zone_exempt_node_ids"]


def test_candidates_route_full_contract():
    r = client.post("/api/v1/candidates", json={
        "instruction": "Use a longer headline, preserve hero size and brand position, "
                       "reserve a 180px top promo zone",
        "headline_text": LONG})
    assert r.status_code == 200
    body = r.json()
    assert len(body["candidates"]) == 3
    sel = body["selected"]
    assert sel is not None and sel["feasibility"] == "feasible"
    assert sel["resulting_spec"]["nodes"]  # complete resulting spec
    tel = body["telemetry"]
    assert tel["provider_mode"] == "fixture"
    assert tel["estimated_cost_usd"] == 0.0
    assert "no provider called" in tel["cost_basis"]


def test_preflight_version_mismatch_rejected():
    r = client.post("/api/v1/candidates", json={
        "instruction": "reserve a 180px top zone",
        "headline_text": LONG})
    cand = r.json()["candidates"][0]
    cand["base_version"] = 999  # stale patch
    r2 = client.post("/api/v1/verify/preflight", json={"candidate": cand})
    assert r2.status_code == 409


def test_rules_catalog():
    r = client.get("/api/v1/rules")
    names = {rule["rule"] for rule in r.json()}
    assert {"canvas_bounds", "safe_area", "locks", "text_overflow",
            "contrast", "forbidden_copy", "containment", "critical_spacing",
            "generic_overlap", "prominence"} <= names


def test_benchmark_outputs_real_executions(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.benchmark.OUT_DIR", tmp_path)
    summary = run_benchmark(write=True, repeats=3)
    csv_path = tmp_path / "results.csv"
    json_path = tmp_path / "results.json"
    assert csv_path.exists() and json_path.exists()
    rows = list(csv.DictReader(open(csv_path)))
    assert len(rows) == 5 * 3
    ai = [r for r in rows if r["variant"] == "ai_strategies"]
    feasible_gt = [r for r in ai if r["ground_truth"] == "feasible"]
    infeasible_gt = [r for r in ai if r["ground_truth"] == "infeasible"]
    assert all(r["predicted"] == "feasible" for r in feasible_gt)
    assert all(r["predicted"] == "infeasible" for r in infeasible_gt)
    assert all(float(r["median_latency_ms"]) > 0 for r in rows)
    # ground truth documented separately from predictions
    doc = json.load(open(json_path))
    assert doc["case_notes"]
    for r in rows:
        assert r["ground_truth"] in ("feasible", "infeasible")


def test_benchmark_summary_differentiates_variants(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.benchmark.OUT_DIR", tmp_path)
    summary = run_benchmark(write=False, repeats=2)
    pv = summary["per_variant"]
    # the ablation must show a difference, or the benchmark proves nothing
    assert pv["ai_strategies"]["feasible_success_rate"] == 1.0
    assert pv["uniform_scale"]["feasible_success_rate"] == 0.0
    assert pv["heuristic_zones"]["feasible_success_rate"] == 0.0
    assert pv["ai_strategies"]["false_feasible_rate"] == 0.0
