import { describe, expect, it } from "vitest";
import type { CandidateResult, DesignSpec } from "../src/shared/contracts";
import { candidateCards, specToSvg } from "../src/shared/svgPreview";

const spec: DesignSpec = {
  design_id: "luma-001",
  version: 1,
  canvas: { width: 1080, height: 1080 },
  nodes: [
    { id: "bg", type: "rectangle", role: "background", bbox: [0, 0, 1080, 1080], fill: "#f4efe8" },
    { id: "deco_arch", type: "rectangle", role: "decoration", bbox: [520, 120, 480, 840], fill: "#d9cfc3", expendable: true },
    { id: "brand", type: "text", role: "brand", bbox: [64, 64, 360, 56], text: "LUMA SKIN", font_size: 36, color: "#242424" },
    { id: "cta", type: "text", role: "cta_text", bbox: [92, 882, 224, 40], text: "Discover now", font_size: 28, color: "#242424" },
  ],
};

describe("specToSvg", () => {
  it("renders every visible node as a real SVG element from actual bboxes", () => {
    const svg = specToSvg(spec, { width: 216 });
    expect(svg).toContain("<svg");
    for (const n of spec.nodes) {
      if (n.type === "rectangle") {
        expect(svg).toContain(`width="${n.bbox[2]}"`);
        expect(svg).toContain(`fill="${n.fill}"`);
      } else if (n.type === "text") {
        expect(svg).toContain(n.text!.split(" ")[0]); // may wrap to multiple lines
        expect(svg).toContain(`x="${n.bbox[0]}"`);
      }
    }
    expect(svg).toContain("#f4efe8");
  });

  it("renders hidden nodes as dashed markers so pruning is visible", () => {
    const hidden: DesignSpec = JSON.parse(JSON.stringify(spec));
    hidden.nodes[1].bbox = [520, 120, 0, 0];
    const svg = specToSvg(hidden);
    expect(svg).toContain("stroke-dasharray");
  });
});

describe("candidateCards", () => {
  const baseCandidate: CandidateResult = {
    candidate_id: "c1",
    strategy: "typography_adaptation",
    generator: "ai_strategies",
    operations: [],
    validation: {
      passed: 11,
      failed: 0,
      unknown: 0,
      results: [
        { rule: "locks", status: "pass", node_ids: [], method: "delta", detail: "" },
        { rule: "text_overflow", status: "fail", node_ids: ["headline"], method: "est", detail: "headline overflow" },
      ],
    },
    feasibility: "infeasible",
    soft_score: null,
    base_version: 1,
    resulting_spec: spec,
    provider_mode: "fixture",
    rejected_reasons: ["text_overflow"],
  };

  it("surfaces failures with precise rules and keeps unknowns distinct", () => {
    const cards = candidateCards([baseCandidate], null);
    expect(cards).toHaveLength(1);
    expect(cards[0].failures[0]).toContain("text_overflow");
    expect(cards[0].feasibility).toBe("infeasible");
    expect(cards[0].softJ).toBeNull();
  });

  it("marks the selected candidate", () => {
    const ok = JSON.parse(JSON.stringify(baseCandidate));
    ok.candidate_id = "c3";
    ok.feasibility = "feasible";
    ok.soft_score = { hierarchy: 1, grouping: 1, balance: 0.9, displacement: 0, J: 0.71 };
    const cards = candidateCards([baseCandidate, ok], "c3");
    expect(cards.find((c) => c.candidateId === "c3")!.selected).toBe(true);
    expect(cards.find((c) => c.candidateId === "c3")!.softJ).toBeCloseTo(0.71);
  });
});
