import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { decodeBase64, type WebImageInput } from "../src/shared/webImages";

const state = vi.hoisted(() => ({ pages: [] as any[], images: [] as any[], blobs: [] as Blob[], editing: false, failLoadAt: -1, failCreateAt: -1 }));
vi.mock("express-document-sdk", () => {
  function node(id: string) {
    const data = new Map<string, string>();
    return {
      id, boundsLocal: { x: 0, y: 0, width: 0, height: 0 },
      setPositionInParent: vi.fn(),
      addOnData: { setItem: (k: string, v: string) => data.set(k, v), getItem: (k: string) => data.get(k) },
      fullContent: { applyCharacterStyles: vi.fn() },
    };
  }
  return {
    constants: {},
    editor: {
      context: { currentPage: { width: 810, height: 1012.5 } },
      loadBitmapImage: vi.fn(async (blob: Blob) => {
        if (!state.editing) throw new Error("Loading outside Adobe callback");
        if (state.blobs.length === state.failLoadAt) throw new Error("bad image");
        state.blobs.push(blob); return { id: state.blobs.length };
      }),
      keepContentActiveDuringAsync: async (_target: unknown, task: () => Promise<void>, callback: () => void) => {
        await task(); state.editing = true;
        try { callback(); } finally { state.editing = false; }
      },
      createText: (text: string) => Object.assign(node("heading"), { text }),
      createImageContainer: (bitmap: unknown, options: { initialSize: { width: number; height: number } }) => {
        if (!state.editing) throw new Error("Editing outside Adobe callback");
        if (state.images.length === state.failCreateAt) throw new Error("native creation failed");
        const image = Object.assign(node(`image-${state.images.length}`), { bitmap, options });
        state.images.push(image); return image;
      },
      documentRoot: { pages: {
        addPage: (canvas: unknown) => {
          if (!state.editing) throw new Error("Editing outside Adobe callback");
          const children: unknown[] = [];
          Object.assign(children, { append: (...items: unknown[]) => children.push(...items) });
          const page = Object.assign(node(`page-${state.pages.length}`), { canvas, artboards: [Object.assign(node("board"), { children })] });
          state.pages.push(page); return page;
        },
        remove: (page: unknown) => { state.pages = state.pages.filter((p) => p !== page); },
      } },
    },
  };
});
import { insertImageNodes } from "../src/sandbox/webImagePages";

const image = (index = 0): WebImageInput => ({ name: `photo-${index}`, blob: new Blob([new Uint8Array([0, 255, 128, 127])], { type: index % 2 ? "image/png" : "image/jpeg" }), width: index % 2 ? 1349 : 736, height: index % 2 ? 736 : 1349 });
beforeEach(() => {
  state.pages = [{ name: "Original poster", artboards: [{ children: ["existing poster elements"] }] }];
  state.images = []; state.blobs = []; state.editing = false; state.failLoadAt = -1; state.failCreateAt = -1;
  vi.stubGlobal("atob", undefined);
});
afterEach(() => vi.unstubAllGlobals());

it("decodes binary image bytes without browser globals, including padding and whitespace", () => {
  expect([...decodeBase64("AP+Afw==")]).toEqual([0, 255, 128, 127]);
  expect([...decodeBase64(" AP\n+Afw== ")]).toEqual([0, 255, 128, 127]);
  expect([...decodeBase64("AP-Afw")]).toEqual([0, 255, 128, 127]);
  for (let length = 0; length < 1024; length += 17) {
    const bytes = Uint8Array.from({ length }, (_, i) => (i * 113) % 256);
    expect(decodeBase64(Buffer.from(bytes).toString("base64"))).toEqual(bytes);
  }
});

it.each(["x", "not-base64!", "ab=c", "Zg=", "AAAA="])("rejects invalid image data: %s", (value) => {
  expect(() => decodeBase64(value)).toThrow("Invalid image Base64");
});

it("adds ten mixed-aspect images on two native reference pages without changing the poster", async () => {
  const original = state.pages[0];
  const items = Array.from({ length: 10 }, (_, i) => image(i));
  expect(await insertImageNodes(items)).toEqual({ insertedCount: 10, pageCount: 2 });
  expect(state.pages).toHaveLength(3);
  expect(state.pages[0]).toBe(original);
  expect(original.artboards[0].children).toEqual(["existing poster elements"]);
  expect(state.pages.slice(1).map((p) => p.artboards[0].children.length)).toEqual([7, 5]); // header + images
  for (let i = 0; i < 10; i++) {
    expect(state.blobs[i]).toBe(items[i].blob);
    expect([...new Uint8Array(await state.blobs[i].arrayBuffer())]).toEqual([0, 255, 128, 127]);
    const n = state.images[i];
    const { width, height } = n.options.initialSize;
    const { x, y } = n.setPositionInParent.mock.calls[0][0];
    expect(width / height).toBeCloseTo(items[i].width / items[i].height, 8);
    expect(x).toBeGreaterThanOrEqual(0); expect(y).toBeGreaterThanOrEqual(0);
    expect(x + width).toBeLessThanOrEqual(810); expect(y + height).toBeLessThanOrEqual(1012.5);
    expect(n.addOnData.getItem("creativedna.kind")).toBe("image");
  }
});

it("does not add pages if a bitmap cannot load", async () => {
  state.failLoadAt = 1;
  await expect(insertImageNodes([image(0), image(1)])).rejects.toThrow("No reference pages were added");
  expect(state.pages).toHaveLength(1); expect(state.images).toHaveLength(0);
});

it("rolls back every new page if insertion fails partway through a batch", async () => {
  state.failCreateAt = 7;
  await expect(insertImageNodes(Array.from({ length: 10 }, (_, i) => image(i)))).rejects.toThrow("native creation failed");
  expect(state.pages).toHaveLength(1);
  expect(state.pages[0].name).toBe("Original poster");
});
