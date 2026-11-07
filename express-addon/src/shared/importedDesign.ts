import type { DesignIntentGraph, DesignNode, DesignSpec } from "./contracts";

/** Local, deterministic inspection: importing a page never needs a network
 * request. Repairs can still use the backend once the page is loaded. */
export function inspectImportedDesign(source: DesignSpec): { spec: DesignSpec; intent: DesignIntentGraph } {
  const spec: DesignSpec = {
    ...source, canvas: { ...source.canvas },
    nodes: source.nodes.map((n) => ({ ...n, bbox: [...n.bbox] })),
  };
  const area = (n: DesignNode) => n.bbox[2] * n.bbox[3];
  const largest = (nodes: DesignNode[]) => nodes.reduce<DesignNode | undefined>(
    (best, n) => !best || area(n) > area(best) ? n : best, undefined);
  const visible = spec.nodes.filter((n) => n.bbox[2] > 0 && n.bbox[3] > 0);
  const rects = visible.filter((n) => n.type === "rectangle");
  const texts = visible.filter((n) => n.type === "text");
  for (const r of rects) {
    if (area(r) >= spec.canvas.width * spec.canvas.height * 0.9) r.role = "background";
  }
  const hero = largest(visible.filter((n) => n.type === "image"));
  if (hero) hero.role = "product";
  // Largest copy is the headline; don't mislabel a lone top headline as branding.
  const headline = texts.find((n) => n.role === 'headline') ?? texts.reduce<DesignNode | undefined>((best, n) =>
    !best || (n.font_size ?? 12) * n.bbox[2] > (best.font_size ?? 12) * best.bbox[2] ? n : best, undefined);
  if (headline) headline.role = "headline";
  const brand = texts.find((n) => n.role === 'brand') ?? texts.filter((n) => n !== headline && n.bbox[1] < spec.canvas.height * 0.25 && !/\b(?:get|buy|shop|explore|discover|register|sign up|join|book)\b/i.test(n.text ?? ''))
    .sort((a, b) => a.bbox[1] - b.bbox[1])[0];
  if (brand) brand.role = "brand";
  for (const t of texts) {
    if (t === headline || t === brand) continue;
    const [x, y, w, h] = t.bbox;
    const pill = rects.find((r) => {
      const [rx, ry, rw, rh] = r.bbox;
      return r.fill && r.role !== "background" && x >= rx && y >= ry && x + w <= rx + rw && y + h <= ry + rh;
    });
    t.role = pill || t.role === 'cta_text' || /^(?:get (?:your |the )?(?:ticket|tickets)|buy\b|shop\b|explore\b|discover\b|register\b|sign up\b|join us\b|book\b)/i.test(t.text?.trim() ?? '') ? "cta_text" : "subhead";
    if (pill) pill.role = "cta_background";
  }
  const focal = hero ?? headline ?? largest(visible.filter((n) => n.role !== "background")) ?? spec.nodes[0];
  const hierarchy = [focal, headline, brand, ...visible].filter((n): n is DesignNode => !!n);
  const relationships: DesignIntentGraph["relationships"] = [];
  const copy = texts.filter((n) => n !== brand).map((n) => n.id);
  if (copy.length > 1) relationships.push({ type: "visual_group", nodes: copy, note: "Inferred copy group; review detected roles." });
  const backgrounds = rects.filter((n) => n.role === "background").map((n) => n.id);
  if (backgrounds.length) relationships.push({ type: "exempt_bounds", nodes: backgrounds });
  return {
    spec,
    intent: {
      design_id: spec.design_id, focal_element: focal?.id ?? "",
      hierarchy: [...new Set(hierarchy.map((n) => n.id))], relationships,
      provenance: { mode: "rule_inference", reference_ids: [] },
    },
  };
}
