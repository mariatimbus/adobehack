/** Previews render the actual spec. Source-node renditions preserve photos,
 * logos, effects and unchanged text; edited text is laid out at its real size. */
import type { DesignSpec, CandidateResult } from "./contracts";
import { wrapText } from "./textLayout";
import type { TextStyle } from "./textLayout";
import {mapPath,type VectorStyle} from './pdfElements';

export interface PreviewOptions {
  width?: number;
  showLabels?: boolean;
  highlightNodeIds?: string[];
  assets?: Record<string, string>;
  styles?: Record<string, TextStyle>;
  originalSpec?: DesignSpec;
  vectors?: Record<string,VectorStyle>;
}
let previewSequence = 0;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function specToSvg(spec: DesignSpec, opts: PreviewOptions = {}): string {
  const prefix = `preview-${++previewSequence}`;
  const width = opts.width ?? 360;
  const height = Math.round(spec.canvas.height * width / spec.canvas.width);
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${spec.canvas.width} ${spec.canvas.height}" width="${width}" height="${height}" role="img" aria-label="Campaign design preview" overflow="hidden">`];
  parts.push(`<rect width="${spec.canvas.width}" height="${spec.canvas.height}" fill="#ffffff"/>`);
  spec.nodes.forEach((node, index) => {
    const [x, y, w, h] = node.bbox;
    if (w <= 0 || h <= 0) return;
    const original = opts.originalSpec?.nodes.find((n) => n.id === node.id);
    const exactText = node.type !== "text" || (original?.text === node.text && original?.font_size === node.font_size && original?.bbox[2] === w && original?.bbox[3] === h);
    const rendition = exactText ? opts.assets?.[node.id] : undefined;
    const asset = rendition ?? (node.type === "image" ? opts.assets?.[node.asset_id ?? ""] : undefined);
    const vector=opts.vectors?.[node.id];
    if(vector){
      parts.push(`<path d="${esc(mapPath(vector.path,vector.box,node.bbox))}" fill="${node.fill??'none'}" stroke="${vector.stroke??'none'}" stroke-width="${(vector.strokeWidth??0)*w/vector.box[2]}" opacity="${vector.opacity??1}" fill-rule="${vector.evenOdd?'evenodd':'nonzero'}"/>`);
    } else if (asset && /^(data:image\/|blob:|\.\.?\/|https?:\/\/)/.test(asset)) {
      parts.push(`<image x="${x}" y="${y}" width="${w}" height="${h}" href="${esc(asset)}" preserveAspectRatio="${rendition ? "none" : "xMidYMid slice"}"/>`);
    } else if (node.type === "text") {
      const style = opts.styles?.[node.id] ?? {};
      const size = node.font_size ?? 24;
      const lines = wrapText(node.text ?? "", size, w, style);
      const clip = `${prefix}-text-${index}`;
      parts.push(`<defs><clipPath id="${clip}"><rect x="${x}" y="${y}" width="${w}" height="${h}"/></clipPath></defs>`);
      parts.push(`<text clip-path="url(#${clip})" font-family="${esc(style.family ?? "Arial, Helvetica, sans-serif")}" font-weight="${style.weight ?? 400}" font-size="${size}" fill="${node.color ?? "#242424"}">`);
      lines.forEach((line, i) => parts.push(`<tspan x="${x}" y="${y + size * 0.88 + i * size * (style.lineHeight ?? 1.15)}">${esc(line)}</tspan>`));
      parts.push(`</text>`);
    } else if (node.type === "rectangle") {
      // Unreadable fills are transparent, never an invented gray rectangle.
      parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${node.fill ?? "none"}"/>`);
    } else {
      parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#8c9ca5" stroke-width="1" stroke-dasharray="6 6"/>`);
    }
    if (opts.highlightNodeIds?.includes(node.id)) parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#1473e6" stroke-width="3"/>`);
    if (opts.showLabels) parts.push(`<text x="${x + 4}" y="${Math.max(y - 8, 20)}" font-size="18" fill="#667781">${esc(node.id)}</text>`);
  });
  parts.push("</svg>");
  return parts.join("\n");
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
  selectedId: string | null,
  options: PreviewOptions = {}
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
      svg: specToSvg(c.resulting_spec, { width: 360, ...options }),
      feasibility: c.feasibility,
      failures,
      unknowns,
      softJ: c.soft_score ? c.soft_score.J : null,
      selected: c.candidate_id === selectedId,
    };
  });
}
