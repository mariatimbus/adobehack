"""AlphaZ / AI Expo Europe demo campaign — the hackathon's own poster.

Recreated as a NATIVE editable design (8 nodes) from the provided poster
(postare.pdf, authorized by the team for the demo). The full poster raster is
kept as reference; the hero uses a clean photo crop (alphaz-hero.png).
"""

from __future__ import annotations

import copy

from ..schemas import DesignIntentGraph, DesignNode, DesignSpec, NodeRole, NodeType, Provenance, Relationship

ALPHAZ_BRAND = {
    "name": "AlphaZ",
    "event": "AI Expo Europe",
    "palette": {"navy": "#0c141c", "cyan": "#35e0e8", "white": "#ffffff", "mist": "#c8d6dd"},
    "cta": "GET YOUR TICKET NOW!",
}

AUTHORIZED_ASSETS = {
    "alphaz-hero": {
        "description": "Photo crop from the team's AI Expo Europe poster (postare.pdf), authorized for the hackathon demo",
        "rights": "Team-provided asset; usage authorized for this demo.",
    },
    "demo-postare": {
        "description": "Full poster raster, reference only",
        "rights": "Team-provided asset; usage authorized for this demo.",
    },
}


def alphaz_spec() -> DesignSpec:
    """Native recreation of the poster: 8 editable nodes on 1080x1350."""
    p = ALPHAZ_BRAND["palette"]
    return DesignSpec(
        design_id="alphaz-001",
        version=1,
        canvas={"width": 1080, "height": 1350},
        nodes=[
            DesignNode(id="bg", type=NodeType.rectangle, role=NodeRole.background,
                       bbox=[0, 0, 1080, 1350], fill=p["navy"]),
            DesignNode(id="deco_circuits", type=NodeType.rectangle, role=NodeRole.decoration,
                       bbox=[984, 200, 32, 1150], fill="#0f2a33", expendable=True),
            DesignNode(id="brand", type=NodeType.text, role=NodeRole.brand,
                       bbox=[64, 56, 260, 46], text="AlphaZ", font_size=34, color=p["white"]),
            DesignNode(id="headline", type=NodeType.text, role=NodeRole.headline,
                       bbox=[64, 200, 620, 280], text="We're back at AI Expo Europe this year!",
                       font_size=56, color=p["white"]),
            DesignNode(id="subhead", type=NodeType.text, role=NodeRole.subhead,
                       bbox=[64, 510, 620, 230],
                       text="AlphaZ returns to one of the biggest AI events in Eastern Europe. "
                            "Radisson Blu Hotel, Bucharest · 1–2 November 2026",
                       font_size=30, color=p["mist"]),
            DesignNode(id="hero", type=NodeType.image, role=NodeRole.product,
                       bbox=[720, 200, 300, 945], asset_id="alphaz-hero"),
            DesignNode(id="cta_bg", type=NodeType.rectangle, role=NodeRole.cta_background,
                       bbox=[64, 880, 460, 88], fill=p["cyan"]),
            DesignNode(id="cta", type=NodeType.text, role=NodeRole.cta_text,
                       bbox=[96, 904, 396, 42], text=ALPHAZ_BRAND["cta"], font_size=30,
                       color=p["navy"]),
        ],
    )


def alphaz_intent_graph() -> DesignIntentGraph:
    return DesignIntentGraph(
        design_id="alphaz-001",
        focal_element="hero",
        hierarchy=["hero", "headline", "cta", "brand", "subhead", "deco_circuits"],
        relationships=[
            Relationship(type="visual_group", nodes=["headline", "subhead", "cta_bg", "cta"],
                         note="copy stack; keep visually coherent"),
            Relationship(type="protected", nodes=["brand"], locks=["position"]),
            Relationship(type="protected", nodes=["hero"], locks=["size"]),
            Relationship(type="expendable", nodes=["deco_circuits"]),
            Relationship(type="contained", nodes=["cta", "cta_bg"],
                         note="CTA text sits inside its pill"),
            Relationship(type="exempt_bounds", nodes=["bg"], note="background fills the canvas"),
            Relationship(type="exempt_overlap", nodes=["deco_circuits", "hero"],
                         note="circuit strip runs behind the photo edge by design"),
            Relationship(type="spacing", nodes=["headline", "hero"], min_gap_px=24,
                         note="copy must not touch the photo"),
            Relationship(type="prominence", nodes=["hero", "headline"],
                         note="photo must stay at least as prominent as the headline"),
        ],
        provenance=Provenance(mode="fixture", reference_ids=["demo-postare"]),
    )


# Flagship demo constraint for the AlphaZ campaign (spec §5 analog).
ALPHAZ_FLAGSHIP_INSTRUCTION = (
    "Use a longer headline, preserve hero size and brand position, reserve a 180px top promo zone"
)
ALPHAZ_FLAGSHIP_HEADLINE = (
    "We're back at AI Expo Europe this year — bigger stand, live demos and a surprise for you!"
)


def fresh_alphaz_state():
    return copy.deepcopy(alphaz_spec()), copy.deepcopy(alphaz_intent_graph())
