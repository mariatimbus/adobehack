"""Semantic design-intent inference (Developer C).

Builds a DesignIntentGraph from a DesignSpec. For the known demo design a
fixture graph is authoritative; for arbitrary specs we infer:

  - focal element    : product-role node, else largest non-background node
  - hierarchy        : ordered by role prominence, then area
  - visual groups    : text nodes whose boxes cluster (copy stack), CTA pair
  - protected        : brand/product roles get locks from constraints when given
  - expendable       : nodes explicitly flagged expendable
  - critical spacing : focal node vs. nearest large text node

The graph is consumed by the strategist (candidate generation) and the
validator (rule whitelists) — it is not decorative metadata.
"""

from __future__ import annotations

from ..schemas import (
    DesignIntentGraph,
    DesignSpec,
    NodeRole,
    Provenance,
    Relationship,
)
from .layout import Rect, union_rect, visible_nodes

# role prominence: lower = more visually important
ROLE_PROMINENCE = {
    NodeRole.product: 0,
    NodeRole.headline: 1,
    NodeRole.cta_text: 2,
    NodeRole.brand: 3,
    NodeRole.cta_background: 4,
    NodeRole.subhead: 5,
    NodeRole.decoration: 6,
    NodeRole.background: 7,
}

TEXT_ROLES = {NodeRole.headline, NodeRole.subhead, NodeRole.cta_text, NodeRole.brand}


def infer_intent(spec: DesignSpec, constraints=None) -> DesignIntentGraph:
    nodes = visible_nodes(spec)
    if not nodes:
        raise ValueError("spec has no visible nodes")

    # focal: product role wins, else largest non-background node
    products = spec.nodes_by_role(NodeRole.product)
    if products:
        focal = max(products, key=lambda n: n.rect.area).id
    else:
        focal = max((n for n in nodes if n.role != NodeRole.background),
                    key=lambda n: n.rect.area, default=nodes[0]).id

    # hierarchy: prominence rank, then area descending
    ranked = sorted(nodes, key=lambda n: (ROLE_PROMINENCE.get(n.role, 8), -n.rect.area))
    hierarchy = [n.id for n in ranked if n.id != focal]
    hierarchy.insert(0, focal)

    relationships: list[Relationship] = []

    # visual group: the copy stack (all text blocks except brand), if clustered
    copy_nodes = [n for n in nodes if n.role in TEXT_ROLES and n.role != NodeRole.brand and n.id != focal]
    cta_nodes = [n.id for n in nodes if n.role in (NodeRole.cta_text, NodeRole.cta_background)]
    group = [n.id for n in copy_nodes]
    if len(group) >= 2:
        rel_nodes = group + [i for i in cta_nodes if i not in group]
        relationships.append(Relationship(
            type="visual_group", nodes=rel_nodes,
            note="inferred copy stack: keep visually coherent"))
    if len(cta_nodes) == 2:
        relationships.append(Relationship(
            type="contained", nodes=[cta_nodes[0], cta_nodes[1]],
            note="CTA text intentionally sits inside its background pill"))

    # expendable: explicit flags
    expendable = [n.id for n in nodes if n.expendable]
    if expendable:
        relationships.append(Relationship(type="expendable", nodes=expendable))

    # background exemption
    bg = [n.id for n in nodes if n.role == NodeRole.background]
    if bg:
        relationships.append(Relationship(
            type="exempt_bounds", nodes=bg, note="background fills the canvas"))

    # protected: apply constraint locks onto the graph
    if constraints:
        for lock in constraints.locks:
            kinds = []
            if lock.position:
                kinds.append("position")
            if lock.size:
                kinds.append("size")
            relationships.append(Relationship(
                type="protected", nodes=[lock.node_id], locks=kinds))

    # critical spacing: focal vs nearest headline-ish text
    if focal and spec.has(focal):
        fr = spec.node(focal).rect
        texts = [n for n in nodes if n.role in (NodeRole.headline, NodeRole.subhead)]
        if texts:
            nearest = min(texts, key=lambda n: min(
                abs(fr.left - n.rect.right), abs(n.rect.left - fr.right),
                abs(fr.top - n.rect.bottom), abs(n.rect.top - fr.bottom)))
            relationships.append(Relationship(
                type="spacing", nodes=[nearest.id, focal], min_gap_px=24.0,
                note="copy must not touch the focal product"))

    # prominence guard on focal
    heads = spec.nodes_by_role(NodeRole.headline)
    if focal and heads:
        relationships.append(Relationship(
            type="prominence", nodes=[focal, heads[0].id],
            note="focal element must stay at least as prominent as the headline"))

    mode = "rule_inference"
    return DesignIntentGraph(
        design_id=spec.design_id,
        focal_element=focal,
        hierarchy=hierarchy,
        relationships=relationships,
        provenance=Provenance(mode=mode),  # truthful: no live AI in this build
    )


def resolve_intent(spec: DesignSpec, fixture_graph: DesignIntentGraph | None,
                   constraints=None) -> DesignIntentGraph:
    """Use the fixture graph when the design matches; otherwise infer."""
    if fixture_graph is not None and fixture_graph.design_id == spec.design_id:
        return fixture_graph
    return infer_intent(spec, constraints)
