import type {
  CandidatesResponse,
  DesignSpec,
  InterpretResponse,
} from "../shared/contracts";

const DEFAULT_BASE = "http://localhost:8765";

export function backendBase(): string {
  try {
    return localStorage.getItem("creativedna.backend") ?? DEFAULT_BASE;
  } catch {
    return DEFAULT_BASE;
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${backendBase()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${path} failed: ${res.status} ${text}`);
  }
  return (await res.json()) as T;
}

export async function fetchDemoDesign(demo: "luma" | "alphaz" = "alphaz"): Promise<{ spec: DesignSpec; intent: unknown; rules: Record<string, unknown> }> {
  const res = await fetch(`${backendBase()}/api/v1/design/demo?demo=${demo}`);
  if (!res.ok) throw new Error(`design demo failed: ${res.status}`);
  return await res.json();
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

export async function preflight(candidate: unknown): Promise<unknown> {
  return post("/api/v1/verify/preflight", { candidate });
}

export interface BrandGuidelinesResult {
  palette: string[];
  fonts: string[];
  min_font_size: Record<string, number>;
  locked_roles: string[];
  forbidden_phrases: string[];
  notes: string[];
  warnings: string[];
  provenance: string;
}

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
  const res = await fetch(`${backendBase()}/api/v1/style-references`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`style-references failed: ${res.status}`);
  return await res.json();
}
