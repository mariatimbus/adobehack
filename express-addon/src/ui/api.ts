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

export async function fetchDemoDesign(): Promise<{ spec: DesignSpec; intent: unknown; rules: Record<string, unknown> }> {
  const res = await fetch(`${backendBase()}/api/v1/design/demo`);
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
  currentTexts: Record<string, string>
): Promise<CandidatesResponse> {
  return post<CandidatesResponse>("/api/v1/candidates", {
    instruction,
    headline_text: headlineText,
    current_texts: currentTexts,
  });
}

export async function preflight(candidate: unknown): Promise<unknown> {
  return post("/api/v1/verify/preflight", { candidate });
}
