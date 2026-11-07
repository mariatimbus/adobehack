import type {
  CandidatesResponse,
  DesignSpec,
  InterpretResponse,
} from "../shared/contracts";
import type { BrandProfile } from "../shared/studio";
import type { PdfImport } from "../shared/pdfElements";

export async function importPinterestPdf(file?: File): Promise<PdfImport> {
  if (!file) return request('/api/v1/import/pinterest-pdf');
  const form = new FormData(); form.append('file', file);
  return request('/api/v1/import/pdf', {method:'POST',body:form});
}

const LEGACY_LOCAL_BASE = "http://localhost:8765";

function defaultBase(): string {
  // Safari blocks the HTTPS Adobe panel's direct HTTP backend requests.
  // The Adobe dev server proxies /api/v1 to the local FastAPI service.
  if (typeof window !== "undefined" && window.location.protocol === "https:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname)) {
    return window.location.origin;
  }
  return LEGACY_LOCAL_BASE;
}

export function backendBase(): string {
  try {
    const configured = localStorage.getItem("creativedna.backend")?.trim().replace(/\/+$/, "");
    return !configured || configured === LEGACY_LOCAL_BASE ? defaultBase() : configured;
  } catch {
    return defaultBase();
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const base = backendBase();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 65_000);
  try {
    const res = await fetch(`${base}${path}`, { ...init, signal: controller.signal });
    if (!res.ok) {
      const body = await res.text();
      let detail = body;
      try {
        const json = JSON.parse(body);
        detail = typeof json.detail === "string" ? json.detail : JSON.stringify(json.detail ?? json);
      } catch { /* Keep the server's text error if it isn't JSON. */ }
      throw new Error(`Backend request failed (${res.status}): ${detail}`);
    }
    return await res.json() as T;
  } catch (error) {
    if (controller.signal.aborted) throw new Error("The backend took too long to respond. Try again.");
    if (error instanceof TypeError) {
      throw new Error(`Cannot connect to CreativeDNA at ${base}. Start the backend and the add-on with npm run adobe:start, then retry.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function fetchDemoDesign(demo: "luma" | "alphaz" = "alphaz"): Promise<{ spec: DesignSpec; intent: unknown; rules: Record<string, unknown> }> {
  return request(`/api/v1/design/demo?demo=${demo}`);
}

export async function interpretInstruction(
  instruction: string,
  headlineText: string | null,
  currentTexts: Record<string, string>
): Promise<InterpretResponse> {
  return post<InterpretResponse>("/api/v1/interpret", {
    instruction,
    headline_text: headlineText,
    current_texts: currentTexts,
  });
}

export async function fetchCandidates(
  instruction: string,
  headlineText: string | null,
  currentTexts: Record<string, string>,
  extras: {
    forbiddenPhrases?: string[];
    minFontSize?: Record<string, number>;
    referenceSummary?: string;
    spec?: DesignSpec;
    intent?: unknown;
  } = {}
): Promise<CandidatesResponse> {
  return post<CandidatesResponse>("/api/v1/candidates", {
    instruction,
    headline_text: headlineText,
    current_texts: currentTexts,
    forbidden_phrases: extras.forbiddenPhrases,
    min_font_size: extras.minFontSize,
    reference_summary: extras.referenceSummary,
    spec: extras.spec,
    intent: extras.intent,
  });
}

export async function inferRoles(spec: DesignSpec): Promise<{
  spec: DesignSpec;
  intent: unknown;
  provenance: string;
}> {
  return post("/api/v1/design/infer-roles", { spec });
}

export interface WebImage {
  id: string;
  source_url: string;
  width: number;
  height: number;
  content_type: string;
  data_b64: string;
  bytes: number;
  background_removed: boolean;
  model: string | null;
  note: string;
}

export async function importFromUrl(url: string, removeBg: boolean): Promise<{
  final_url: string;
  kind: string;
  images: WebImage[];
  errors: Array<{ url: string; error: string }>;
  provenance: string;
  remove_bg_note: string;
}> {
  return post("/api/v1/import/url", { url, remove_bg: removeBg, model: "u2net" });
}

export async function preflight(candidate: unknown): Promise<unknown> {
  return post("/api/v1/verify/preflight", { candidate });
}

export interface BrandGuidelinesResult extends BrandProfile { fonts: string[]; }

export async function parseBrandGuidelines(text: string, filename?: string): Promise<BrandGuidelinesResult> {
  return post<BrandGuidelinesResult>("/api/v1/brand-guidelines", { text, filename });
}

export interface StyleAnalysis {
  width: number;
  height: number;
  orientation: string;
  dominant_colors: Array<{ hex: string; share: number }>;
  mean_luminance: number;
  mean_saturation: number;
  warm_pixel_share: number;
  edge_density: number;
  mood: string;
  provenance: string;
}

export async function analyzeStyleReferences(files: File[]): Promise<{
  analyses: StyleAnalysis[];
  summary: string;
  errors: Array<{ filename: string; error: string }>;
}> {
  const form = new FormData();
  files.forEach((f) => form.append("files", f));
  return request("/api/v1/style-references", { method: "POST", body: form });
}
