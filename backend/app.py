"""CreativeDNA FastAPI application (Developer B orchestration layer).

All routes return versioned, typed contracts from schemas.py. provider_mode
labels are truthful: this deployment has no AI credentials, so interpretation
and strategy generation run in labeled fixture mode.
"""

from __future__ import annotations

import json
import logging
import os
import time
from collections import deque
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from . import schemas
from .fixtures.luma_skin import DEMO_RULES, luma_intent_graph, luma_spec
from .pipeline import (
    build_candidates,
    explain_infeasibility,
    make_telemetry,
    select_best,
    suggest_relaxation,
)
from .services import validator
from .services.intent import infer_intent
from .services.interpreter import get_interpreter
from .services.strategist import StrategyConfig

API_KEY = os.environ.get("CREATIVEDNA_AI_API_KEY")  # server-side only; None in this env

app = FastAPI(title="CreativeDNA", version=schemas.API_VERSION)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # add-on iframe -> local backend; tighten for production
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("creativedna")

_TELEMETRY_PATH = Path(__file__).parent / "benchmark_data" / "telemetry.jsonl"
_TELEMETRY_PATH.parent.mkdir(parents=True, exist_ok=True)
_telemetry_ring: deque[dict] = deque(maxlen=200)


def record_telemetry(event: schemas.TelemetryEvent) -> None:
    payload = event.model_dump()
    _telemetry_ring.append(payload)
    with open(_TELEMETRY_PATH, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(payload) + "\n")
    log.info("telemetry %s", payload)


def _config() -> StrategyConfig:
    return StrategyConfig(
        safe_margin_px=DEMO_RULES["safe_margin_px"],
        role_font_floors=DEMO_RULES["min_font_size_role"],
    )


def _role_of(spec: schemas.DesignSpec) -> dict[str, str]:
    return {n.id: n.role.value for n in spec.nodes}


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.get("/api/v1/health")
def health() -> dict:
    return {
        "status": "ok",
        "api_version": schemas.API_VERSION,
        "contract_version": schemas.CONTRACT_VERSION,
        "ai_mode": "fixture" if not API_KEY else "live",
        "text_measurement": "estimated_pil" if __import__("backend.services.textmetrics", fromlist=["available"]).available() else "unavailable",
    }


@app.get("/api/v1/design/demo")
def design_demo() -> dict:
    """The known 8-node LUMA SKIN campaign + its semantic intent graph."""
    spec, intent = luma_spec(), luma_intent_graph()
    return {"spec": spec.model_dump(), "intent": intent.model_dump(), "rules": DEMO_RULES}


class IntentRequest(BaseModel):
    spec: schemas.DesignSpec


@app.post("/api/v1/intent")
def intent_route(req: IntentRequest) -> schemas.DesignIntentGraph:
    return infer_intent(req.spec, None)


class InterpretRequest(BaseModel):
    instruction: str = Field(min_length=3)
    design_id: str = "luma-001"
    headline_text: str | None = None
    current_texts: dict[str, str] | None = None  # node_id -> current copy (enables labeled fixture translation)


@app.post("/api/v1/interpret", response_model=schemas.InterpretResponse)
def interpret_route(req: InterpretRequest) -> schemas.InterpretResponse:
    spec = luma_spec()
    interpreter = get_interpreter(API_KEY)
    t0 = time.perf_counter()
    constraints = interpreter.interpret(
        req.instruction,
        known_node_ids=[n.id for n in spec.nodes],
        role_of=_role_of(spec),
        headline_text=req.headline_text,
        current_texts=req.current_texts,
    )
    ai_ms = (time.perf_counter() - t0) * 1000
    issues = list(constraints.ambiguities) + list(constraints.unsupported)
    record_telemetry(schemas.TelemetryEvent(
        event="interpret", provider_mode=interpreter.provider_mode,
        ai_duration_ms=round(ai_ms, 3), total_duration_ms=round(ai_ms, 3),
        estimated_cost_usd=0.0 if interpreter.provider_mode != "live" else None,
        cost_basis=f"{interpreter.provider_mode}: no provider called => $0.00",
    ))
    return schemas.InterpretResponse(
        constraints=constraints, provider_mode=interpreter.provider_mode, issues=issues)


class CandidatesRequest(BaseModel):
    instruction: str | None = None
    constraints: schemas.RepairConstraints | None = None
    design_id: str = "luma-001"
    headline_text: str | None = None
    current_texts: dict[str, str] | None = None
    # bring-your-own extras (from uploaded brand guidelines / references)
    forbidden_phrases: list[str] | None = None
    min_font_size: dict[str, float] | None = None
    reference_summary: str | None = None


@app.post("/api/v1/candidates", response_model=schemas.CandidatesResponse)
def candidates_route(req: CandidatesRequest) -> schemas.CandidatesResponse:
    """Full pipeline: interpret (if needed) -> plan -> simulate -> validate -> rank."""
    t_total = time.perf_counter()
    spec, intent = luma_spec(), luma_intent_graph()
    interpreter = get_interpreter(API_KEY)

    t_ai = time.perf_counter()
    if req.constraints is not None:
        constraints = req.constraints
        ai_ms = None
    elif req.instruction:
        current = {n.id: n.text for n in spec.nodes if n.text}
        constraints = interpreter.interpret(
            req.instruction,
            known_node_ids=[n.id for n in spec.nodes],
            role_of=_role_of(spec),
            headline_text=req.headline_text,
            current_texts=req.current_texts or current,
        )
        ai_ms = (time.perf_counter() - t_ai) * 1000
    else:
        raise HTTPException(status_code=422, detail={"error": "provide instruction or constraints",
                                                     "code": "EMPTY_REQUEST"})

    # merge bring-your-own extras (uploaded brand guidelines), without
    # overwriting anything the instruction itself produced
    if req.forbidden_phrases:
        existing = {p.lower() for p in constraints.forbidden_phrases}
        constraints.forbidden_phrases += [
            p for p in req.forbidden_phrases if p.lower() not in existing]
    if req.min_font_size:
        for k, v in req.min_font_size.items():
            constraints.min_font_size.setdefault(k, v)

    candidates, geometry_ms = build_candidates(spec, intent, constraints, _config(),
                                               provider_mode=interpreter.provider_mode)
    selected = select_best(candidates)
    explanation = None
    relaxation = None
    if selected is None:
        explanation = explain_infeasibility(candidates)
        relaxation = suggest_relaxation(spec, intent, constraints, _config())

    total_ms = (time.perf_counter() - t_total) * 1000
    telemetry = make_telemetry(interpreter.provider_mode, total_ms, ai_ms, geometry_ms, candidates)
    telemetry = telemetry.model_copy(update={
        "editable_node_count": sum(1 for n in candidates[0].resulting_spec.nodes),
        "event": "candidates",
    })
    record_telemetry(telemetry)

    return schemas.CandidatesResponse(
        design_id=spec.design_id,
        base_version=spec.version,
        candidates=candidates,
        selected=selected,
        telemetry=telemetry,
        infeasibility_explanation=explanation,
        relaxation_suggestion=relaxation,
    )


class PreflightRequest(BaseModel):
    candidate: schemas.CandidateResult
    constraints: schemas.RepairConstraints | None = None


@app.post("/api/v1/verify/preflight", response_model=schemas.CandidateValidation)
def preflight_route(req: PreflightRequest) -> schemas.CandidateValidation:
    """Re-run deterministic validation on a candidate's complete resulting_spec.

    Idempotent: does not mutate anything. The add-on calls this before apply.
    """
    spec, intent = luma_spec(), luma_intent_graph()
    if req.candidate.base_version != spec.version:
        raise HTTPException(status_code=409, detail={
            "error": f"stale candidate: base_version {req.candidate.base_version} != current {spec.version}",
            "code": "VERSION_MISMATCH"})
    cfg = _config()
    return validator.validate(
        req.candidate.resulting_spec, spec, req.constraints, intent,
        safe_margin_px=cfg.safe_margin_px, role_font_floors=cfg.role_font_floors)


@app.get("/api/v1/rules")
def rules() -> list[dict]:
    """Documented hard-rule catalogue surfaced in the UI."""
    import inspect
    catalog = []
    for r in validator.ALL_RULES:
        doc = inspect.getdoc(r) or ""
        catalog.append({"rule": r.__name__.replace("check_", ""),
                        "doc": doc.splitlines()[0] if doc else "documented in validator source",
                        "statuses": "pass | fail | unknown"})
    return catalog


# ---------------------------------------------------------------------------
# Bring-your-own assets (user-provided)
# ---------------------------------------------------------------------------


class BrandGuidelinesRequest(BaseModel):
    text: str = Field(min_length=10)
    filename: str | None = None


@app.post("/api/v1/brand-guidelines")
def brand_guidelines_route(req: BrandGuidelinesRequest) -> dict:
    """Deterministic parser for uploaded brand-guideline text files.
    Labeled rule_based_extraction — not AI."""
    from .services.userassets import parse_brand_guidelines
    return parse_brand_guidelines(req.text).to_dict()


@app.post("/api/v1/style-references")
async def style_references_route(files: list[UploadFile] = File(...)) -> dict:
    """Deterministic image analysis for inspiration uploads (e.g. a Pinterest
    board export). Labeled heuristic_vision — not live multimodal AI."""
    from .services.userassets import analyze_style_reference, summarize_references
    analyses = []
    errors = []
    for f in files:
        try:
            data = await f.read()
            analyses.append(analyze_style_reference(data))
        except Exception as exc:
            errors.append({"filename": f.filename, "error": str(exc)})
    return {"analyses": analyses, "summary": summarize_references(analyses), "errors": errors}


@app.get("/api/v1/telemetry")
def telemetry() -> list[dict]:
    return list(_telemetry_ring)


# ---------------------------------------------------------------------------
# Shared-contract export for the TypeScript add-on
# ---------------------------------------------------------------------------


@app.get("/api/v1/contracts.json")
def contracts() -> dict:
    models = {name: getattr(schemas, name) for name in dir(schemas)}
    out = {}
    for name, model in models.items():
        if isinstance(model, type) and issubclass(model, BaseModel) and model is not BaseModel:
            out[name] = model.model_json_schema(ref_template="#/components/schemas/{model}")
    return {"api_version": schemas.API_VERSION, "contract_version": schemas.CONTRACT_VERSION,
            "components": out}
