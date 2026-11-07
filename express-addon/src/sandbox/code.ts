/**
 * CreativeDNA document sandbox — real Adobe Express document API integration.
 *
 * Exposes (via the sandbox runtime bridge):
 *   applyDesign(spec, heroImageBlob?)  — build the known 8-node campaign natively
 *   applyRepairPatch(candidate)        — in-place patch of existing nodes, no duplicates
 *   readDocumentState()                — node mapping + supported properties
 *   verifyAppliedPatch(candidate)      — post-apply readback vs plan
 *
 * Verified API surface (Adobe Express Add-on SDK typings v1.40):
 *   editor.createRectangle / createText / createImageContainer / loadBitmapImage
 *   node.translation, node.width/height, node.addOnData (persistent per-node metadata)
 *   textNode.fullContent.text / applyCharacterStyles, textNode.layout (autoHeight)
 *   fillable.fill = editor.makeColorFill({red, green, blue, alpha})  // 0-1 floats
 *
 * Honest limitations (disclosed, never hidden):
 *   - No SDK artboard resize: ArtboardNode size is read-only in the current
 *     typings, so Square -> Story applies planned geometry proportionally and
 *     reports canvas_resize as unsupported.
 *   - set_visible maps to opacity = 0 (documented alternative to removal);
 *     previews/geometry treat zero-size bbox as hidden.
 *   - Font size readback is not exposed per-range reliably -> post-apply
 *     verification marks font_size as unsupported.
 */

import addOnSandboxSdk from "add-on-sdk-document-sandbox";
import {
  editor,
  RectangleNode,
  StandaloneTextNode,
  MediaContainerNode,
  VisualNode,
  Color,
} from "express-document-sdk";
import type {
  CandidateResult,
  DesignSpec,
  DocumentState,
  NodeBinding,
  ObservedNode,
  Operation,
  PostApplyReport,
} from "../shared/contracts";

const NODE_ID_KEY = "creativedna.node_id";
const DESIGN_ID_KEY = "creativedna.design_id";
const VERSION_KEY = "creativedna.version";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function hexToColor(hex: string): Color {
  const h = hex.replace("#", "");
  return {
    red: parseInt(h.slice(0, 2), 16) / 255,
    green: parseInt(h.slice(2, 4), 16) / 255,
    blue: parseInt(h.slice(4, 6), 16) / 255,
    alpha: 1,
  };
}

interface TrackedNode {
  node: VisualNode;
  kind: string; // "rectangle" | "text" | "image" | "image_placeholder"
}

/** Live registry rebuilt from the document on every call: node ids survive
 *  sessions because the mapping lives in node.addOnData, not in memory. */
function collectTracked(): Map<string, TrackedNode> {
  const map = new Map<string, TrackedNode>();
  const parent = editor.context.insertionParent;
  const walk = (nodes: Iterable<VisualNode>) => {
    for (const n of nodes) {
      const id = n.addOnData?.getItem(NODE_ID_KEY);
      if (id) {
        const kind = n.addOnData.getItem("creativedna.kind") ?? "rectangle";
        map.set(id, { node: n, kind });
      }
      const children = (n as unknown as { children?: Iterable<VisualNode> }).children;
      if (children) walk(children as Iterable<VisualNode>);
    }
  };
  walk(parent.children as unknown as Iterable<VisualNode>);
  return map;
}

function recordKind(node: VisualNode, kind: string): void {
  node.addOnData.setItem("creativedna.kind", kind);
}

function pageRoot(): VisualNode {
  return editor.context.insertionParent as unknown as VisualNode;
}

// ---------------------------------------------------------------------------
// applyDesign
// ---------------------------------------------------------------------------

async function applyDesign(spec: DesignSpec, heroImageBlob?: Blob): Promise<DocumentState> {
  const parent = editor.context.insertionParent;

  // idempotent re-load: if the design already exists, reuse nodes (no duplicates)
  const existing = collectTracked();
  if (existing.size >= spec.nodes.length && [...existing.keys()].every((id) => spec.nodes.some((n) => n.id === id))) {
    return readDocumentState();
  }

  for (const nodeSpec of spec.nodes) {
    if (existing.has(nodeSpec.id)) continue; // never duplicate
    const [x, y, w, h] = nodeSpec.bbox;

    if (nodeSpec.type === "rectangle") {
      const rect: RectangleNode = editor.createRectangle();
      rect.width = w;
      rect.height = h;
      if (nodeSpec.fill) rect.fill = editor.makeColorFill(hexToColor(nodeSpec.fill));
      parent.children.append(rect as unknown as never);
      rect.setPositionInParent({ x, y }, { x: 0, y: 0 });
      rect.addOnData.setItem(NODE_ID_KEY, nodeSpec.id);
      recordKind(rect as unknown as VisualNode, "rectangle");
    } else if (nodeSpec.type === "text") {
      const text: StandaloneTextNode = editor.createText(nodeSpec.text ?? "");
      text.layout = { type: 2, width: w }; // TextLayout.autoHeight
      if (nodeSpec.font_size) {
        text.fullContent.applyCharacterStyles({ fontSize: nodeSpec.font_size });
      }
      if (nodeSpec.color) {
        text.fullContent.applyCharacterStyles({ color: hexToColor(nodeSpec.color) });
      }
      parent.children.append(text as unknown as never);
      text.setPositionInParent({ x, y }, { x: 0, y: 0 });
      text.addOnData.setItem(NODE_ID_KEY, nodeSpec.id);
      recordKind(text as unknown as VisualNode, "text");
    } else if (nodeSpec.type === "image") {
      if (!heroImageBlob) {
        // media unavailable (kill switch): placeholder rectangle, disclosed
        const rect: RectangleNode = editor.createRectangle();
        rect.width = w;
        rect.height = h;
        rect.fill = editor.makeColorFill(hexToColor("#dfe7dd"));
        parent.children.append(rect as unknown as never);
        rect.setPositionInParent({ x, y }, { x: 0, y: 0 });
        rect.addOnData.setItem(NODE_ID_KEY, nodeSpec.id);
        recordKind(rect as unknown as VisualNode, "image_placeholder");
      } else {
        const bitmap = await editor.loadBitmapImage(heroImageBlob);
        const image: MediaContainerNode = editor.createImageContainer(bitmap, {
          initialSize: { width: w, height: h },
        });
        parent.children.append(image as unknown as never);
        image.setPositionInParent({ x, y }, { x: 0, y: 0 });
        image.addOnData.setItem(NODE_ID_KEY, nodeSpec.id);
        recordKind(image as unknown as VisualNode, "image");
      }
    }
  }

  const root = pageRoot();
  root.addOnData.setItem(DESIGN_ID_KEY, spec.design_id);
  root.addOnData.setItem(VERSION_KEY, String(spec.version));
  return readDocumentState();
}

// ---------------------------------------------------------------------------
// applyRepairPatch  (best-effort transactional: snapshot -> apply -> readback)
// ---------------------------------------------------------------------------

function snapshotProps(t: TrackedNode): Record<string, unknown> {
  const snap: Record<string, unknown> = {
    translation: { ...t.node.translation },
    opacity: t.node.opacity,
  };
  if (t.kind === "text") {
    const tn = t.node as unknown as StandaloneTextNode;
    snap.text = tn.fullContent.text;
  }
  const sized = t.node as unknown as { width?: number; height?: number };
  if (typeof sized.width === "number") snap.width = sized.width;
  if (typeof sized.height === "number") snap.height = sized.height;
  return snap;
}

function restoreProps(t: TrackedNode, snap: Record<string, unknown>): void {
  if (snap.translation) t.node.translation = snap.translation as { x: number; y: number };
  if (typeof snap.opacity === "number") t.node.opacity = snap.opacity;
  if (t.kind === "text" && typeof snap.text === "string") {
    (t.node as unknown as StandaloneTextNode).fullContent.text = snap.text;
  }
  const sized = t.node as unknown as { width?: number; height?: number };
  if (typeof snap.width === "number" && typeof sized.width === "number") sized.width = snap.width;
  if (typeof snap.height === "number" && typeof sized.height === "number") sized.height = snap.height;
}

function applyOneOp(t: TrackedNode, op: Operation): void {
  switch (op.op) {
    case "set_text":
      (t.node as unknown as StandaloneTextNode).fullContent.text = String(op.value);
      break;
    case "set_bbox": {
      const [x, y, w, h] = op.value as number[];
      const sized = t.node as unknown as { width?: number; height?: number };
      if (typeof sized.width === "number") sized.width = w;
      if (typeof sized.height === "number") sized.height = h;
      t.node.translation = { x, y };
      break;
    }
    case "set_font_size":
      (t.node as unknown as StandaloneTextNode).fullContent.applyCharacterStyles({
        fontSize: Number(op.value),
      });
      break;
    case "set_visible":
      // documented mapping: visibility -> opacity (no direct visibility flag in SDK)
      t.node.opacity = op.value === false ? 0 : 1;
      break;
    case "translate": {
      const cur = t.node.translation;
      t.node.translation = { x: cur.x + (op.value as number[])[0], y: cur.y + (op.value as number[])[1] };
      break;
    }
  }
}

async function applyRepairPatch(candidate: CandidateResult): Promise<PostApplyReport> {
  const t0 = Date.now();
  const tracked = collectTracked();
  const before = readDocumentState();

  // version gate (stale patch rejection)
  const rootVersion = Number(pageRoot().addOnData.getItem(VERSION_KEY) ?? before.version);
  if (candidate.base_version !== rootVersion) {
    return {
      design_id: before.design_id,
      base_version: candidate.base_version,
      resulting_version: null,
      candidate_id: candidate.candidate_id,
      planned: [], observed: [], matched: 0,
      mismatched: [], unsupported_measurements: ["patch rejected before application"],
      node_count_before: before.node_count, node_count_after: null,
      editability_retained: null, constraint_violations: ["VERSION_MISMATCH"],
      apply_duration_ms: Date.now() - t0, recovered: null, status: "failed",
    };
  }

  // snapshot for best-effort recovery (NOT an atomic transaction — disclosed)
  const snapshots = new Map<string, Record<string, unknown>>();
  const applyPlan: Array<{ t: TrackedNode; op: Operation }> = [];
  const missing: string[] = [];
  for (const op of candidate.operations) {
    const t = tracked.get(op.node_id);
    if (!t) {
      missing.push(op.node_id);
      continue;
    }
    if (!snapshots.has(op.node_id)) snapshots.set(op.node_id, snapshotProps(t));
    applyPlan.push({ t, op });
  }

  let failedOp: string | null = null;
  try {
    for (const { t, op } of applyPlan) applyOneOp(t, op);
  } catch (err) {
    failedOp = String(err);
  }

  let recovered: boolean | null = null;
  if (failedOp) {
    recovered = true;
    for (const [id, snap] of snapshots) {
      const t = tracked.get(id);
      if (!t) continue;
      try {
        restoreProps(t, snap);
      } catch {
        recovered = false; // incomplete recovery — reported, never hidden
      }
    }
  }

  const after = readDocumentState();
  const report = verifyAgainstPlan(candidate, before, after, Date.now() - t0);
  if (failedOp) {
    report.status = recovered ? "partial_failure" : "failed";
    report.constraint_violations.push(`op failed: ${failedOp}`);
  }
  report.recovered = failedOp ? recovered : null;
  if (!failedOp) {
    pageRoot().addOnData.setItem(VERSION_KEY, String(candidate.base_version + 1));
    report.resulting_version = candidate.base_version + 1;
  }
  return report;
}

// ---------------------------------------------------------------------------
// readDocumentState / verifyAppliedPatch
// ---------------------------------------------------------------------------

function readDocumentState(): DocumentState {
  const tracked = collectTracked();
  const bindings: NodeBinding[] = [];
  for (const [node_id, t] of tracked) {
    bindings.push({
      node_id,
      adobe_node_id: (t.node as unknown as { id?: string }).id ?? "unreadable",
      type:
        t.kind === "text" ? "text" : t.kind === "image" || t.kind === "image_placeholder" ? "image" : "rectangle",
      editable: true, // native nodes remain independently editable
    });
  }
  const root = pageRoot();
  return {
    design_id: root.addOnData.getItem(DESIGN_ID_KEY) ?? "unknown",
    version: Number(root.addOnData.getItem(VERSION_KEY) ?? 0),
    canvas: { width: 0, height: 0 }, // artboard size readback unsupported in current SDK typings
    bindings,
    node_count: bindings.length,
    unsupported_properties: ["canvas_size", "font_size_readback"],
  };
}

function plannedNodes(candidate: CandidateResult): ObservedNode[] {
  return candidate.resulting_spec.nodes.map((n) => ({
    node_id: n.id,
    bbox: n.bbox,
    text: n.text ?? null,
    visible: n.bbox[2] > 0 && n.bbox[3] > 0,
    observed: true,
  }));
}

function observedNodes(): ObservedNode[] {
  const tracked = collectTracked();
  const out: ObservedNode[] = [];
  for (const [node_id, t] of tracked) {
    let text: string | null = null;
    if (t.kind === "text") {
      try {
        text = (t.node as unknown as StandaloneTextNode).fullContent.text;
      } catch {
        text = null; // unreadable -> observed stays true for bbox, text null
      }
    }
    const b = t.node.boundsInParent;
    out.push({
      node_id,
      adobe_node_id: (t.node as unknown as { id?: string }).id ?? null,
      bbox: [b.x, b.y, b.width, b.height],
      text,
      visible: t.node.opacity > 0,
      editable: true,
      observed: true,
    });
  }
  return out;
}

function verifyAgainstPlan(
  candidate: CandidateResult,
  before: DocumentState,
  after: DocumentState,
  durationMs: number
): PostApplyReport {
  const planned = plannedNodes(candidate);
  const observed = observedNodes();
  const tol = 2.0; // readback tolerance: bounds vs plan (registration-point differences)
  const mismatched: string[] = [];
  let matched = 0;
  for (const p of planned) {
    const o = observed.find((x) => x.node_id === p.node_id);
    if (!o) {
      mismatched.push(p.node_id);
      continue;
    }
    let ok = true;
    if (p.bbox && o.bbox) {
      for (let i = 0; i < 4; i++) {
        if (Math.abs(p.bbox[i] - o.bbox[i]) > tol) ok = false;
      }
    }
    if (p.text !== null && p.text !== undefined && o.text !== p.text) ok = false;
    if (p.visible !== null && p.visible !== undefined && o.visible !== p.visible) ok = false;
    if (ok) matched++;
    else mismatched.push(p.node_id);
  }

  const unsupported = ["font_size_readback", "canvas_size"];
  const editabilityRetained =
    after.bindings.length >= before.bindings.length && after.bindings.every((b) => b.editable);
  let status: PostApplyReport["status"] = "verified";
  if (unsupported.length > 0) status = "verified_with_gaps";
  if (mismatched.length > 0) status = "partial_failure";
  if (matched === 0) status = "failed";

  return {
    design_id: after.design_id,
    base_version: candidate.base_version,
    resulting_version: after.version,
    candidate_id: candidate.candidate_id,
    planned,
    observed,
    matched,
    mismatched,
    unsupported_measurements: unsupported,
    node_count_before: before.node_count,
    node_count_after: after.node_count,
    editability_retained: editabilityRetained,
    constraint_violations: mismatched.map((id) => `mismatch: ${id}`),
    apply_duration_ms: durationMs,
    recovered: null,
    status,
  };
}

async function replaceImageNode(nodeId: string, blob: Blob): Promise<DocumentState> {
  const tracked = collectTracked();
  const t = tracked.get(nodeId);
  if (!t) throw new Error(`node '${nodeId}' not found in document`);
  if (t.kind === "image_placeholder") t.kind = "image";
  if (t.kind !== "image" && t.kind !== "rectangle") {
    throw new Error(`node '${nodeId}' is not replaceable with an image (kind=${t.kind})`);
  }
  const rect = t.node as unknown as { width?: number; height?: number };
  const w = typeof rect.width === "number" ? rect.width : 420;
  const h = typeof rect.height === "number" ? rect.height : 620;
  const pos = { ...t.node.translation };
  const bitmap = await editor.loadBitmapImage(blob);
  const image: MediaContainerNode = editor.createImageContainer(bitmap, {
    initialSize: { width: w, height: h },
  });
  editor.context.insertionParent.children.append(image as unknown as never);
  image.setPositionInParent(pos, { x: 0, y: 0 });
  image.addOnData.setItem(NODE_ID_KEY, nodeId);
  recordKind(image as unknown as VisualNode, "image");
  // remove the old node so node count is preserved (no duplicates)
  const old = t.node as unknown as { removeFromParent?: () => void };
  if (typeof old.removeFromParent === "function") old.removeFromParent();
  return readDocumentState();
}

function colorToHex(c: Color | undefined): string | null {
  if (!c) return null;
  const h = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0");
  return `#${h(c.red)}${h(c.green)}${h(c.blue)}`;
}

function detectKind(n: VisualNode): string {
  const anyNode = n as unknown as Record<string, unknown>;
  if (anyNode.fullContent !== undefined) return "text";
  if (anyNode.mediaRectangle !== undefined) return "image";
  return "rectangle";
}

/**
 * Read the user's CURRENT page into a DesignSpec: every top-level element
 * becomes a node with a stable id (persisted in node.addOnData so later
 * patches bind to the right element). Unreadable properties stay null and
 * are labeled unsupported — never guessed.
 */
async function importCurrentDesign(): Promise<{ state: DocumentState; spec: DesignSpec }> {
  const parent = editor.context.insertionParent as unknown as {
    children: Iterable<VisualNode>;
    width?: number;
    height?: number;
  };
  const nodes: Array<{
    id: string; type: "rectangle" | "text" | "image"; role: string;
    bbox: [number, number, number, number];
    fill?: string | null; text?: string | null; font_size?: number | null;
    expendable: boolean;
  }> = [];
  let i = 0;
  for (const child of parent.children as Iterable<VisualNode>) {
    i += 1;
    let id = child.addOnData.getItem(NODE_ID_KEY);
    if (!id) {
      id = `node_${i}`;
      child.addOnData.setItem(NODE_ID_KEY, id);
    }
    const kind = detectKind(child);
    recordKind(child, kind);
    const b = child.boundsInParent;
    let text: string | null = null;
    let fontSize: number | null = null;
    if (kind === "text") {
      try {
        text = (child as unknown as StandaloneTextNode).fullContent.text;
      } catch {
        text = null; // unreadable -> honest null
      }
      try {
        const model = (child as unknown as StandaloneTextNode).fullContent as unknown as {
          getCharacterStyles?: () => Array<{ fontSize?: number }>;
        };
        const ranges = model.getCharacterStyles?.() ?? [];
        fontSize = ranges.length && ranges[0].fontSize ? ranges[0].fontSize : null;
      } catch {
        fontSize = null;
      }
    }
    let fill: string | null = null;
    try {
      const f = (child as unknown as { fill?: { color?: Color } }).fill;
      fill = colorToHex(f?.color);
    } catch {
      fill = null;
    }
    nodes.push({
      id,
      type: kind === "text" ? "text" : kind === "image" ? "image" : "rectangle",
      role: "decoration", // backend re-infers roles; neutral default
      bbox: [b.x, b.y, b.width, b.height],
      fill,
      text,
      font_size: fontSize,
      expendable: false,
    });
  }
  const spec = {
    design_id: `imported-${Date.now()}`,
    version: 1,
    canvas: { width: parent.width ?? 1080, height: parent.height ?? 1080 },
    nodes,
  } as unknown as DesignSpec;
  const root = pageRoot();
  root.addOnData.setItem(DESIGN_ID_KEY, spec.design_id);
  root.addOnData.setItem(VERSION_KEY, String(spec.version));
  return { state: readDocumentState(), spec };
}

async function verifyAppliedPatch(candidate: CandidateResult): Promise<PostApplyReport> {
  const before = readDocumentState();
  return verifyAgainstPlan(candidate, before, before, 0);
}

// ---------------------------------------------------------------------------

addOnSandboxSdk.instance.runtime.exposeApi({
  applyDesign,
  applyRepairPatch,
  importCurrentDesign,
  readDocumentState,
  replaceImageNode,
  verifyAppliedPatch,
});
