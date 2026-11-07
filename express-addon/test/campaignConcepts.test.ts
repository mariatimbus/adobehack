import { expect, it } from "vitest";
import { campaignConcepts } from "../src/shared/campaignConcepts";
import { wrapText } from "../src/shared/textLayout";
import type { DesignSpec } from "../src/shared/contracts";

const source: DesignSpec = {
  design_id: "imported-poster", version: 1, canvas: { width: 810, height: 1012.5 },
  nodes: [
    { id: "head", type: "text", role: "headline", bbox: [100, 100, 500, 150], font_size: 50, text: "We're back at AI Expo Europe this year!" },
    { id: "body", type: "text", role: "subhead", bbox: [100, 300, 400, 200], font_size: 25, text: "AlphaZ returns to one of the biggest AI events in Eastern Europe, and we can't wait to meet you again!" },
    { id: "venue", type: "text", role: "subhead", bbox: [100, 500, 500, 50], text: "Radisson Blu Hotel, Bucharest" },
    { id: "date", type: "text", role: "subhead", bbox: [100, 560, 500, 50], text: "1-2 November 2026" },
    { id: "cta", type: "text", role: "cta_text", bbox: [100, 700, 400, 50], text: "GET YOUR TICKET NOW!" },
    { id: "photo", type: "image", role: "product", bbox: [0, 0, 810, 1012.5] },
  ],
};

it("creates three different editable layouts with original event facts and real artwork", () => {
  const original = JSON.stringify(source);
  const concepts = campaignConcepts(source);
  expect(concepts).toHaveLength(3);
  expect(new Set(concepts.map((c) => JSON.stringify(c.spec.nodes.map((n) => n.bbox)))).size).toBe(3);
  for (const c of concepts) {
    const copy = c.spec.nodes.map((n) => n.text).join(" ").replace(/\s+/g, " ");
    expect(copy).toContain("Radisson Blu Hotel, Bucharest");
    expect(copy).toContain("1-2 November 2026");
    expect(copy).toContain("GET YOUR TICKET NOW!");
    expect(c.photoUrl).toBe("./alphaz-hero.png");
    for (const n of c.spec.nodes) {
      const [x, y, w, h] = n.bbox;
      expect(x).toBeGreaterThanOrEqual(0); expect(y).toBeGreaterThanOrEqual(0);
      expect(x + w).toBeLessThanOrEqual(c.spec.canvas.width);
      expect(y + h).toBeLessThanOrEqual(c.spec.canvas.height);
      if (n.type === "text") {
        expect(n.font_size).toBeGreaterThanOrEqual(20);
        expect(wrapText(n.text!, n.font_size!, w, c.styles[n.id]).length * n.font_size! * 1.12).toBeLessThanOrEqual(h + 0.01);
      }
    }
  }
  expect(JSON.stringify(source)).toBe(original);
});

it("fits a user-supplied longer headline instead of clipping it", () => {
  const headline = "We're back at AI Expo Europe this year with live demonstrations and new ideas to share with you";
  for (const c of campaignConcepts(source, headline)) {
    const node = c.spec.nodes.find((n) => n.id === "headline")!;
    expect(node.text!.replace(/\s+/g, " ")).toBe(headline);
    expect(wrapText(node.text!, node.font_size!, node.bbox[2], c.styles.headline).length * node.font_size! * 1.12).toBeLessThanOrEqual(node.bbox[3]);
  }
});

it("does not invent event names, dates or photos for an unrelated campaign", () => {
  const unrelated: DesignSpec = { ...source, nodes: [{ id: "title", type: "text", role: "headline", bbox: [40, 40, 500, 200], text: "A handmade collection" }] };
  for (const c of campaignConcepts(unrelated)) {
    expect(c.photoUrl).toBeUndefined();
    expect(c.spec.nodes.some((n) => /AlphaZ|Expo|2026|ticket/i.test(n.text ?? ""))).toBe(false);
  }
});
