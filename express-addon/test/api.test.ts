import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { backendBase, fetchCandidates, fetchDemoDesign, analyzeStyleReferences } from "../src/ui/api";

const storage = new Map<string, string>();
beforeEach(() => {
  storage.clear();
  vi.stubGlobal("window", { location: { protocol: "https:", hostname: "localhost", origin: "https://localhost:5241" } });
  vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null });
});
afterEach(() => vi.unstubAllGlobals());

it("uses the panel HTTPS origin, including when the old HTTP default was saved", () => {
  expect(backendBase()).toBe("https://localhost:5241");
  storage.set("creativedna.backend", "http://localhost:8765/");
  expect(backendBase()).toBe("https://localhost:5241");
  storage.set("creativedna.backend", "https://custom-api.example/");
  expect(backendBase()).toBe("https://custom-api.example");
});

it("keeps HTTP development harnesses working", () => {
  vi.stubGlobal("window", { location: { protocol: "http:", hostname: "localhost", origin: "http://localhost:8099" } });
  expect(backendBase()).toBe("http://localhost:8765");
});

it("sends the imported spec and constraint to the HTTPS proxy", async () => {
  const response = { candidates: [] };
  const fetch = vi.fn(async (_url: string, _options?: RequestInit) => Response.json(response));
  vi.stubGlobal("fetch", fetch);
  const spec = { design_id: "user-page", version: 1, canvas: { width: 810, height: 1012.5 }, nodes: [] };
  expect(await fetchCandidates("Keep the CTA visible", null, {}, { spec })).toEqual(response);
  const [url, options] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("https://localhost:5241/api/v1/candidates");
  expect(JSON.parse(options.body as string).spec).toEqual(spec);
});

it("routes demo and multipart requests over the same connection", async () => {
  const fetch = vi.fn(async (_url: string, _options?: RequestInit) => Response.json({}));
  vi.stubGlobal("fetch", fetch);
  await fetchDemoDesign("alphaz");
  await analyzeStyleReferences([]);
  expect(fetch.mock.calls[0][0]).toBe("https://localhost:5241/api/v1/design/demo?demo=alphaz");
  const [url, options] = fetch.mock.calls[1] as unknown as [string, RequestInit];
  expect(url).toBe("https://localhost:5241/api/v1/style-references");
  expect(options.body).toBeInstanceOf(FormData);
  expect(options.headers).toBeUndefined();
});

it("shows actionable connection and upstream errors instead of TypeError: Load failed", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Load failed")));
  await expect(fetchCandidates("Improve spacing", null, {})).rejects.toThrow("Cannot connect to CreativeDNA at https://localhost:5241");
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ detail: "CreativeDNA backend is unavailable." }, { status: 502 })));
  await expect(fetchCandidates("Improve spacing", null, {})).rejects.toThrow("Backend request failed (502): CreativeDNA backend is unavailable.");
});
