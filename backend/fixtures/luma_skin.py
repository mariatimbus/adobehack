"""LUMA SKIN demo fixtures — the known 8-node campaign.

Fictional skincare brand used for the hackathon demo. The hero references an
authorized, cached demo asset; no external image rights are required.
"""

from __future__ import annotations

import copy

from ..schemas import DesignIntentGraph, DesignNode, DesignSpec, NodeRole, NodeType, Provenance, Relationship

LUMA_BRAND = {
    "name": "LUMA SKIN",
    "product": "Daily Hydration Serum",
    "palette": {"cream": "#f4efe8", "charcoal": "#242424", "sage": "#a8b6a1", "beige": "#d9cfc3"},
    "goal": "awareness",
    "cta": "Discover now",
}

AUTHORIZED_ASSETS = {
    "authorized-serum-packshot": {
        "description": "Fictional LUMA SKIN Daily Hydration Serum packshot (demo-generated placeholder asset)",
        "rights": "Generated for the hackathon demo; no third-party rights involved. Cached locally in the add-on.",
    }
}

# Approved copy vocabulary (small, per spec §3). Anything outside that is not
# auto-rejected — only exact forbidden phrases are hard failures.
APPROVED_VOCABULARY = [
    "hydration", "skin", "serum", "lightweight", "everyday", "barrier",
    "luma", "discover", "now", "simple", "adapts", "day", "glow",
]

FORBIDDEN_PHRASES = [
    "guaranteed results", "clinically proven", "#1 dermatologist", "miracle cure",
    "permanent wrinkle removal", " botox alternative", "instant facelift",
]


def luma_spec() -> DesignSpec:
    """The canonical 8-node LUMA SKIN 1080x1080 campaign."""
    return DesignSpec(
        design_id="luma-001",
        version=1,
        canvas={"width": 1080, "height": 1080},
        nodes=[
            DesignNode(id="bg", type=NodeType.rectangle, role=NodeRole.background,
                       bbox=[0, 0, 1080, 1080], fill=LUMA_BRAND["palette"]["cream"]),
            DesignNode(id="deco_arch", type=NodeType.rectangle, role=NodeRole.decoration,
                       bbox=[520, 120, 480, 840], fill=LUMA_BRAND["palette"]["beige"], expendable=True),
            DesignNode(id="brand", type=NodeType.text, role=NodeRole.brand,
                       bbox=[64, 64, 360, 56], text="LUMA SKIN", font_size=36,
                       color=LUMA_BRAND["palette"]["charcoal"]),
            DesignNode(id="headline", type=NodeType.text, role=NodeRole.headline,
                       bbox=[64, 220, 420, 180], text="Hydration, made simple.",
                       font_size=52, color=LUMA_BRAND["palette"]["charcoal"]),
            DesignNode(id="subhead", type=NodeType.text, role=NodeRole.subhead,
                       bbox=[64, 430, 420, 90], text="Lightweight everyday hydration.",
                       font_size=28, color=LUMA_BRAND["palette"]["charcoal"]),
            DesignNode(id="hero", type=NodeType.image, role=NodeRole.product,
                       bbox=[560, 180, 420, 620], asset_id="authorized-serum-packshot"),
            DesignNode(id="cta_bg", type=NodeType.rectangle, role=NodeRole.cta_background,
                       bbox=[64, 860, 280, 84], fill=LUMA_BRAND["palette"]["sage"]),
            DesignNode(id="cta", type=NodeType.text, role=NodeRole.cta_text,
                       bbox=[92, 882, 224, 40], text="Discover now", font_size=28,
                       color=LUMA_BRAND["palette"]["charcoal"]),
        ],
    )


def luma_intent_graph() -> DesignIntentGraph:
    """Fixture intent graph for luma-001 (spec §5)."""
    return DesignIntentGraph(
        design_id="luma-001",
        focal_element="hero",
        hierarchy=["hero", "headline", "cta", "brand", "subhead", "deco_arch"],
        relationships=[
            Relationship(type="visual_group", nodes=["headline", "subhead", "cta_bg", "cta"],
                         note="marketing copy stack; keep visually coherent"),
            Relationship(type="protected", nodes=["brand"], locks=["position"]),
            Relationship(type="protected", nodes=["hero"], locks=["size"]),
            Relationship(type="expendable", nodes=["deco_arch"]),
            Relationship(type="contained", nodes=["cta", "cta_bg"],
                         note="CTA text intentionally sits inside its background pill"),
            Relationship(type="exempt_bounds", nodes=["bg"], note="background always fills canvas"),
            Relationship(type="exempt_overlap", nodes=["deco_arch", "hero"],
                         note="decorative arch sits behind the product shot by design"),
            Relationship(type="spacing", nodes=["headline", "hero"], min_gap_px=24,
                         note="designated critical pair: copy must not touch the product"),
            Relationship(type="prominence", nodes=["hero", "headline"],
                         note="hero must stay at least as prominent as headline"),
        ],
        provenance=Provenance(mode="fixture", reference_ids=[]),
    )


# Demo rule configuration (spec §3): canvas rules applied on top of constraints.
DEMO_RULES = {
    "safe_margin_px": 64,
    "min_font_size_role": {"headline": 32, "cta_text": 24, "brand": 24, "subhead": 20},
    "critical_pairs": [("headline", "hero")],
    "forbidden_phrases": FORBIDDEN_PHRASES,
}


def fresh_demo_state() -> tuple[DesignSpec, DesignIntentGraph]:
    """Deep-copied fixture state so callers can mutate freely."""
    return copy.deepcopy(luma_spec()), copy.deepcopy(luma_intent_graph())
