/**
 * SVG candidate previews — rendered from the ACTUAL simulated resulting_spec,
 * never fabricated illustrations (spec §8).
 */

import type { DesignSpec, CandidateResult, BBox } from "./contracts";

const PALETTE_FALLBACK = "#999999";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function specToSvg(
  spec: DesignSpec,
  opts: { width?: number; showLabels?: boolean; highlightNodeIds?: string[] } = {}
): string {
  const { width = 216, showLabels = false, highlightNodeIds = [] } = opts;
  const scale = width / spec.canvas.width;
  const height = Math.round(spec.canvas.height * scale);
  const highlight = new Set(highlightNodeIds);

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${spec.canvas.width} ${spec.canvas.height}" width="${width}" height="${height}" role="img">`
  );
  parts.push(
    `<rect x="0" y="0" width="${spec.canvas.width}" height="${spec.canvas.height}" fill="#ffffff" stroke="#d0d0d0" stroke-width="2"/>`
  );

  for (const node of spec.nodes) {
    const [x, y, w, h] = node.bbox;
    if (w <= 0 || h <= 0) {
      // hidden node: draw a faint dashed marker so pruning is visible in previews
      parts.push(
        `<rect x="${x}" y="${y}" width="${Math.max(spec.canvas.width * 0.18, 60)}" height="12" fill="none" stroke="#c0c0c0" stroke-width="2" stroke-dasharray="10 8"/>`
      );
      continue;
    }
    const stroke = highlight.has(node.id) ? ` stroke="#1473e6" stroke-width="6"` : "";
    if (node.type === "text") {
      const fill = node.color ?? "#242424";
      const fs = (node.font_size ?? 24) * 1.35; // display bump for legibility
      const lines = wrapLabel(node.text ?? "", Math.max(8, Math.floor(w / (fs * 0.52))));
      parts.push(`<g${stroke ? stroke.replace("stroke-width=\"6\"", 'stroke="none" data-hl="1"') : ""}>`);
      lines.forEach((line, i) => {
        parts.push(
          `<text x="${x}" y="${y + fs * (i + 1)}" font-family="Helvetica, Arial, sans-serif" font-size="${fs}" fill="${fill}">${esc(line)}</text>`
        );
      });
      parts.push(`</g>`);
      if (highlight.has(node.id)) {
        parts.push(`<rect x="${x - 4}" y="${y - 4}" width="${w + 8}" height="${h + 8}" fill="none" stroke="#1473e6" stroke-width="5"/>`);
      }
    } else if (node.type === "image") {
      parts.push(
        `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#dfe7dd"${stroke}/>`,
        `<text x="${x + w / 2}" y="${y + h / 2}" font-family="Helvetica, Arial, sans-serif" font-size="${Math.max(18, w / 10)}" fill="#5f6f5c" text-anchor="middle">🧴 hero</text>`
      );
    } else {
      parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${node.fill ?? PALETTE_FALLBACK}"${stroke}/>`);
    }
    if (showLabels) {
      parts.push(
        `<text x="${x + 4}" y="${Math.max(y - 8, 20)}" font-family="monospace" font-size="22" fill="#666666">${esc(node.id)}</text>`
      );
    }
  }
  parts.push(`</svg>`);
  return parts.join("\n");
}

function wrapLabel(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur && (cur + " " + w).length > maxChars) {
      lines.push(cur);
      cur = w;
    } else {
      cur = cur ? cur + " " + w : w;
    }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 4);
}

export interface CandidateCard {
  candidateId: string;
  strategy: string;
  svg: string;
  feasibility: CandidateResult["feasibility"];
  failures: string[];
  unknowns: string[];
  softJ: number | null;
  selected: boolean;
}

export function candidateCards(
  candidates: CandidateResult[],
  selectedId: string | null
): CandidateCard[] {
  return candidates.map((c) => {
    const failures = c.validation.results
      .filter((r) => r.status === "fail")
      .map((r) => `${r.rule}: ${r.detail}`);
    const unknowns = c.validation.results
      .filter((r) => r.status === "unknown")
      .map((r) => `${r.rule}: ${r.detail}`);
    return {
      candidateId: c.candidate_id,
      strategy: c.strategy,
      svg: specToSvg(c.resulting_spec, { width: 216 }),
      feasibility: c.feasibility,
      failures,
      unknowns,
      softJ: c.soft_score ? c.soft_score.J : null,
      selected: c.candidate_id === selectedId,
    };
  });
}
