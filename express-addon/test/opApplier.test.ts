import { describe, expect, it } from "vitest";
import type { DesignSpec } from "../src/shared/contracts";
import { applyOperations, diffPlannedObserved } from "../src/shared/opApplier";

const spec: DesignSpec = {
  design_id: "t1",
  version: 1,
  canvas: { width: 1080, height: 1080 },
  nodes: [
    { id: "bg", type: "rectangle", role: "background", bbox: [0, 0, 1080, 1080], fill: "#f4efe8" },
    { id: "headline", type: "text", role: "headline", bbox: [64, 220, 420, 180], text: "Hello", font_size: 52 },
    { id: "cta", type: "text", role: "cta_text", bbox: [92, 882, 224, 40], text: "Go", font_size: 28 },
  ],
};

describe("applyOperations", () => {
  it("applies set_text / set_bbox / set_font_size / translate / set_visible", () => {
    const out = applyOperations(spec, [
      { op: "set_text", node_id: "headline", value: "New copy" },
      { op: "set_bbox", node_id: "headline", value: [10, 20, 300, 100] },
      { op: "set_font_size", node_id: "cta", value: 24 },
      { op: "translate", node_id: "cta", value: [0, -64] },
      { op: "set_visible", node_id: "bg", value: false },
    ]);
    expect(out.nodes.find((n) => n.id === "headline")!.text).toBe("New copy");
    expect(out.nodes.find((n) => n.id === "headline")!.bbox).toEqual([10, 20, 300, 100]);
    expect(out.nodes.find((n) => n.id === "cta")!.font_size).toBe(24);
    expect(out.nodes.find((n) => n.id === "cta")!.bbox).toEqual([92, 818, 224, 40]);
    expect(out.nodes.find((n) => n.id === "bg")!.bbox[2]).toBe(0);
    // immutability of the source spec
    expect(spec.nodes.find((n) => n.id === "headline")!.text).toBe("Hello");
  });

  it("rejects unknown node ids and negative sizes", () => {
    expect(() => applyOperations(spec, [{ op: "set_text", node_id: "nope", value: "x" }])).toThrow();
    expect(() =>
      applyOperations(spec, [{ op: "set_bbox", node_id: "bg", value: [0, 0, -5, 10] }])
    ).toThrow();
  });
});

describe("diffPlannedObserved", () => {
  it("flags bbox drift beyond tolerance and text mismatch", () => {
    const diffs = diffPlannedObserved(
      [
        { node_id: "a", bbox: [0, 0, 100, 100] as [number, number, number, number], text: "Hello" },
      ],
      [
        { node_id: "a", bbox: [3, 0, 100, 100] as [number, number, number, number], text: "Hello", observed: true },
      ],
      2.0
    );
    expect(diffs).toHaveLength(1);
    expect(diffs[0].field).toBe("bbox[0]");
  });

  it("passes within tolerance and detects missing/unreadable nodes", () => {
    const ok = diffPlannedObserved(
      [{ node_id: "a", bbox: [0, 0, 100, 100] as [number, number, number, number] }],
      [{ node_id: "a", bbox: [1, 0, 100, 100] as [number, number, number, number], observed: true }],
      2.0
    );
    expect(ok).toHaveLength(0);
    const missing = diffPlannedObserved([{ node_id: "a" }], [], 2.0);
    expect(missing[0].field).toBe("presence");
    const unreadable = diffPlannedObserved(
      [{ node_id: "a", bbox: [0, 0, 1, 1] as [number, number, number, number] }],
      [{ node_id: "a", observed: false }],
      2.0
    );
    expect(unreadable[0].field).toBe("readback");
  });
});
