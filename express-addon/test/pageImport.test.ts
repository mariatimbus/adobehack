import { beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({ context: {} as Record<string, unknown>, api: {} as Record<string, (...args: any[]) => any> }));
vi.mock("express-document-sdk", () => ({
  editor: { context: sdk.context },
  constants: { SceneNodeType: { group: "Group", gridLayout: "Grid", gridCell: "Cell", mediaContainer: "Media", imageRectangle: "Bitmap", text: "Text", rectangle: "Rect" } },
}));
vi.mock("add-on-sdk-document-sandbox", () => ({
  default: { instance: { runtime: { exposeApi: (api: typeof sdk.api) => { sdk.api = api; } } } },
}));
import "../src/sandbox/code";
import { inspectImportedDesign } from "../src/shared/importedDesign";

function node(id: string, type = "Rect", bbox = [10, 20, 100, 50]) {
  const data = new Map<string, string>();
  return {
    id, type, allChildren: [] as unknown[],
    addOnData: { getItem: (key: string) => data.get(key), setItem: (key: string, value: string) => { data.set(key, value); } },
    boundsInParent: { x: 1, y: 2, width: 3, height: 4 },
    boundsInNode: vi.fn((_root: unknown) => ({ x: bbox[0], y: bbox[1], width: bbox[2], height: bbox[3] })),
    fill: { color: { red: 0.2, green: 0.4, blue: 0.6, alpha: 1 } },
    fullContent: { text: "Real page copy", characterStyleRanges: [{ fontSize: 32, color: { red: 0, green: 0, blue: 0, alpha: 1 } }] },
  };
}

let board: ReturnType<typeof node> & { width: number; height: number; children: unknown[] };
beforeEach(() => {
  board = Object.assign(node("artboard"), { width: 1200, height: 800, children: [] });
  sdk.context.currentPage = { width: 1200, height: 800, artboards: [board] };
  sdk.context.insertionParent = { id: "selected-group", visualRoot: board };
});

describe("Import my current page sandbox API", () => {
  it("imports the whole artboard, background and nested groups, regardless of selection", async () => {
    const background = node("background", "Rect", [0, 0, 1200, 800]);
    const group = node("group", "Group");
    const nested = node("nested", "Group");
    const text = node("copy", "Text", [200, 300, 450, 100]);
    const image = node("photo", "Media");
    image.allChildren = [node("internal-mask"), node("internal-bitmap", "Bitmap")];
    nested.allChildren = [text];
    group.allChildren = [nested, image];
    // Background appears only in allChildren, as in the real SDK.
    board.allChildren = [background, group, node("outside-group")];
    const { spec, state } = await sdk.api.importCurrentDesign();
    expect(spec.canvas).toEqual({ width: 1200, height: 800 });
    expect(spec.nodes.map((n: any) => n.id)).toEqual(["import_background", "import_copy", "import_photo", "import_outside-group"]);
    expect(spec.nodes.map((n: any) => n.type)).toEqual(["rectangle", "text", "image", "rectangle"]);
    expect(spec.nodes[1]).toMatchObject({ text: "Real page copy", font_size: 32, color: "#000000", bbox: [200, 300, 450, 100] });
    expect(text.boundsInNode).toHaveBeenCalledWith(board);
    expect(state.node_count).toBe(4);
    expect(state.bindings.map((b: any) => b.adobe_node_id)).toEqual(["background", "copy", "photo", "outside-group"]);
    expect(state.canvas).toEqual(spec.canvas);
  });

  it("keeps stable, unique bindings across re-imports and copied metadata", async () => {
    const a = node("a"), b = node("b");
    a.addOnData.setItem("creativedna.node_id", "node_1");
    b.addOnData.setItem("creativedna.node_id", "node_1");
    board.allChildren = [a, b];
    const first = await sdk.api.importCurrentDesign();
    const second = await sdk.api.importCurrentDesign();
    expect(first.spec.nodes.map((n: any) => n.id)).toEqual(["node_1", "import_b"]);
    expect(second.spec).toEqual(first.spec);
    expect(second.state.node_count).toBe(2);
  });

  it("reads only the current page, even if another page was imported before", async () => {
    board.allChildren = [node("page-one")];
    await sdk.api.importCurrentDesign();
    const second = Object.assign(node("second-board"), { width: 600, height: 900 });
    second.allChildren = [node("page-two")];
    sdk.context.currentPage = { width: 600, height: 900, artboards: [second] };
    sdk.context.insertionParent = { visualRoot: second };
    const imported = await sdk.api.importCurrentDesign();
    expect(imported.spec.nodes.map((n: any) => n.id)).toEqual(["import_page-two"]);
    expect(imported.spec.canvas).toEqual({ width: 600, height: 900 });
  });

  it("handles empty pages without inventing demo content", async () => {
    const { spec, state } = await sdk.api.importCurrentDesign();
    expect(spec.nodes).toEqual([]);
    expect(state.node_count).toBe(0);
  });

  it("reports unreadable text styles while still importing every element", async () => {
    const text = node("mixed", "Text");
    Object.defineProperty(text.fullContent, "characterStyleRanges", { get: () => { throw new Error("unavailable"); } });
    board.allChildren = [text, node("image", "Media")];
    const imported = await sdk.api.importCurrentDesign();
    expect(imported.spec.nodes[0]).toMatchObject({ text: "Real page copy", font_size: null, color: null });
    expect(imported.state.unsupported_properties).toContain("import_mixed: mixed or unreadable text styles");
    expect(imported.spec.nodes).toHaveLength(2);
  });

  it("inspects imported elements locally without calling a backend or changing original geometry", async () => {
    board.allChildren = [node("headline", "Text"), node("photo", "Media")];
    const { spec } = await sdk.api.importCurrentDesign();
    const original = JSON.stringify(spec);
    const fetch = vi.fn(() => { throw new TypeError("Load failed"); });
    vi.stubGlobal("fetch", fetch);
    try {
      const inspected = inspectImportedDesign(spec);
      expect(inspected.spec.nodes.find((n) => n.type === "text")?.role).toBe("headline");
      expect(inspected.spec.nodes.find((n) => n.type === "image")?.role).toBe("product");
      expect(inspected.intent.provenance.mode).toBe("rule_inference");
      expect(fetch).not.toHaveBeenCalled();
      expect(JSON.stringify(spec)).toBe(original);
    } finally { vi.unstubAllGlobals(); }
  });
});
