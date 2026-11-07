/**
 * Pure operation applier — TypeScript mirror of backend layout.apply_operations.
 * Also powers post-apply verification diffs. No Adobe SDK imports: unit-testable.
 */

import type { DesignSpec, Operation, BBox } from "./contracts";

export function cloneSpec(spec: DesignSpec): DesignSpec {
  return JSON.parse(JSON.stringify(spec)) as DesignSpec;
}

export function applyOperations(spec: DesignSpec, operations: Operation[]): DesignSpec {
  const out = cloneSpec(spec);
  for (const op of operations) {
    const node = out.nodes.find((n) => n.id === op.node_id);
    if (!node) throw new Error(`operation targets unknown node '${op.node_id}'`);
    switch (op.op) {
      case "set_text":
        node.text = String(op.value);
        break;
      case "set_bbox": {
        const [x, y, w, h] = op.value as number[];
        if (w < 0 || h < 0) throw new Error("negative bbox");
        node.bbox = [x, y, w, h];
        break;
      }
      case "set_font_size":
        node.font_size = Number(op.value);
        break;
      case "set_visible":
        // hidden == zero-size geometry at the original origin (SDK-portable)
        if (op.value === false) node.bbox = [node.bbox[0], node.bbox[1], 0, 0];
        break;
      case "translate": {
        const [dx, dy] = op.value as number[];
        node.bbox = [node.bbox[0] + dx, node.bbox[1] + dy, node.bbox[2], node.bbox[3]];
        break;
      }
    }
  }
  return out;
}

export const LOCK_TOLERANCE_PX = 0.5;

export interface PlannedObservedDiff {
  node_id: string;
  field: string;
  planned: unknown;
  observed: unknown;
  delta?: number;
}

/** Compare planned vs observed values with the documented lock tolerance. */
export function diffPlannedObserved(
  planned: Array<{ node_id: string } & Record<string, unknown>>,
  observed: Array<{ node_id: string; observed: boolean } & Record<string, unknown>>,
  tolerancePx = LOCK_TOLERANCE_PX
): PlannedObservedDiff[] {
  const diffs: PlannedObservedDiff[] = [];
  for (const p of planned) {
    const o = observed.find((x) => x.node_id === p.node_id);
    if (!o) {
      diffs.push({ node_id: p.node_id, field: "presence", planned: "node", observed: "missing" });
      continue;
    }
    if (!o.observed) {
      diffs.push({ node_id: p.node_id, field: "readback", planned: "value", observed: "unreadable" });
      continue;
    }
    for (const [field, pv] of Object.entries(p)) {
      if (field === "node_id" || pv === undefined || pv === null) continue;
      const ov = o[field];
      if (ov === undefined || ov === null) continue;
      if (field === "bbox") {
        const pb = pv as BBox;
        const ob = ov as BBox;
        for (let i = 0; i < 4; i++) {
          const delta = Math.abs(pb[i] - ob[i]);
          if (delta > tolerancePx) {
            diffs.push({ node_id: p.node_id, field: `bbox[${i}]`, planned: pb[i], observed: ob[i], delta });
          }
        }
      } else if (pv !== ov) {
        diffs.push({ node_id: p.node_id, field, planned: pv, observed: ov });
      }
    }
  }
  return diffs;
}
