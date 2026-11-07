"""Bring-your-own tests: brand guideline parsing, style reference analysis."""

import io
import json
from pathlib import Path

from fastapi.testclient import TestClient

from backend.app import app
from backend.services.userassets import (
    analyze_style_reference,
    parse_brand_guidelines,
    summarize_references,
)

client = TestClient(app)

SAMPLE_GUIDE = """
ACME Skincare — Brand Guidelines (internal)
Our palette: cream #F4EFE8 for backgrounds, charcoal #242424 for text, sage #A8B6A1 accents.
Typeface: Inter for headlines, Source Sans for body.
Minimum 32pt font for headlines.
Never move or resize the logo. Do not change the product packshot.
Forbidden: guaranteed results. Prohibited: clinically proven miracle cures. Never say: botox in a bottle.
"""


def test_brand_guideline_parser_extracts_rules():
    g = parse_brand_guidelines(SAMPLE_GUIDE)
    assert g.palette == ["#f4efe8", "#242424", "#a8b6a1"]
    assert "Inter" in g.fonts or "Source Sans" in g.fonts
    assert g.min_font_size.get("headline", 0) >= 40  # 32pt -> px conversion
    assert "brand" in g.locked_roles
    assert "hero" in g.locked_roles
    assert "guaranteed results" in g.forbidden_phrases
    assert "clinically proven miracle cures" in g.forbidden_phrases
    assert "botox in a bottle" in g.forbidden_phrases
    assert g.provenance == "rule_based_extraction"


def test_brand_guideline_parser_warns_on_empty():
    g = parse_brand_guidelines("just some random text with nothing useful in it at all")
    assert g.warnings  # no colors, no forbidden section -> warnings surfaced


def test_style_reference_analysis_is_deterministic_and_labeled():
    png = Path("express-addon/assets-public/serum-packshot.png").read_bytes()
    a1 = analyze_style_reference(png)
    a2 = analyze_style_reference(png)
    assert a1 == a2  # deterministic
    assert len(a1["dominant_colors"]) == 5
    assert abs(sum(c["share"] for c in a1["dominant_colors"]) - 1.0) < 0.02
    assert "heuristic_vision" in a1["provenance"]
    assert "not live multimodal AI" in a1["provenance"]
    assert a1["orientation"] == "portrait"
    s = summarize_references([a1, a1])
    assert "2 reference image(s)" in s


def test_api_brand_guidelines_endpoint():
    r = client.post("/api/v1/brand-guidelines", json={"text": SAMPLE_GUIDE, "filename": "guide.txt"})
    assert r.status_code == 200
    body = r.json()
    assert body["palette"] and body["forbidden_phrases"]


def test_api_style_references_endpoint_multipart():
    png = Path("express-addon/assets-public/serum-packshot.png").read_bytes()
    r = client.post(
        "/api/v1/style-references",
        files=[("files", ("a.png", png, "image/png")), ("files", ("b.png", png, "image/png"))],
    )
    assert r.status_code == 200
    body = r.json()
    assert len(body["analyses"]) == 2
    assert "2 reference image(s)" in body["summary"]
    assert body["errors"] == []


def test_guidelines_forbidden_phrases_flow_into_candidates():
    """Uploaded guidelines must actually affect the repair pipeline."""
    r = client.post("/api/v1/candidates", json={
        "instruction": "Use the headline 'Hydration with guaranteed results for everyone', preserve hero size",
        "headline_text": None,
        "forbidden_phrases": ["guaranteed results"],
    })
    assert r.status_code == 200
    body = r.json()
    assert body["selected"] is None or all(
        c["feasibility"] != "feasible" for c in body["candidates"]
    ), "forbidden copy from uploaded guidelines must block feasibility"
    fc = [res for c in body["candidates"] for res in c["validation"]["results"]
          if res["rule"] == "forbidden_copy" and res["status"] == "fail"]
    assert fc, "forbidden_copy must fail with the uploaded phrase"


def test_supplied_markdown_brands_keep_palette_fonts_and_copy_separate():
    expected = {
        "aurelia": ("AURELIA", "#f7f4ef", "Cormorant Garamond", "Georgia", "Your routine, refined."),
        "pulse": ("PULSE", "#101b32", "Space Grotesk", "Arial", "Your money. A clearer picture."),
        "wildform": ("WILDFORM", "#203b32", "Archivo Black", "Arial Black", "GO FIND YOUR OUTSIDE."),
    }
    for filename, (name, first_color, font, fallback, headline) in expected.items():
        text = Path(f"express-addon/assets-public/brand-guidelines/{filename}.md").read_text()
        g = parse_brand_guidelines(text)
        assert g.name == name
        assert len(g.palette) == 5 and g.palette[0] == first_color
        assert len(g.colors) == 5 and g.colors[0]["hex"] == first_color
        assert g.typography["headline"] == {"family": font, "fallback": fallback}
        assert g.sample_copy["headline"] == headline
        assert g.sample_copy["cta"] and g.copy_rules and g.visual_rules and g.tone
        assert g.min_font_size == {}  # Logo width is not a minimum headline size.
        assert not any("|" in phrase for phrase in g.forbidden_phrases)
        assert font in g.fonts
    aurelia = parse_brand_guidelines(Path("express-addon/assets-public/brand-guidelines/aurelia.md").read_text())
    assert "instant results" in aurelia.forbidden_phrases
