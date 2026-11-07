import { constants, editor } from "express-document-sdk";
import type { ArtboardNode, Color, StandaloneTextNode, VisualNode } from "express-document-sdk";
import type { BBox, DesignNode, DesignSpec, NodeType } from "../shared/contracts";

export const NODE_ID_KEY = "creativedna.node_id";
export const DESIGN_ID_KEY = "creativedna.design_id";
export const VERSION_KEY = "creativedna.version";
// Store only IDs across calls: inactive pages can invalidate live node handles.
const importedPageIds = new Map<string, string>();
export function importedPageId(nativeId: string): string | undefined { return importedPageIds.get(nativeId); }

/** insertionParent can be a selected group. Always resolve its artboard. */
export function currentArtboard(): ArtboardNode {
  const boards = Array.from(editor.context.currentPage.artboards);
  const insertion = editor.context.insertionParent as unknown as VisualNode;
  const root = insertion.visualRoot;
  const active = boards.find((board) => board.id === root?.id || board.id === insertion.id) ?? boards[0];
  if (!active) throw new Error("The current page has no accessible artboard.");
  return active;
}

export function colorToHex(c: Color | undefined): string | null {
  if (!c || ![c.red, c.green, c.blue].every(Number.isFinite)) return null;
  const hex = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0");
  return `#${hex(c.red)}${hex(c.green)}${hex(c.blue)}`;
}

export function detectKind(node: VisualNode): NodeType {
  const types = constants.SceneNodeType;
  if (node.type === types.text) return "text";
  if (node.type === types.mediaContainer || node.type === types.gridCell || node.type === types.imageRectangle) return "image";
  return "rectangle";
}

/** Groups are structural. Media containers are single images, not their mask
 * and bitmap internals. allChildren also includes the artboard background. */
export function pageElements(root: VisualNode): VisualNode[] {
  const result: VisualNode[] = [];
  const walk = (parent: VisualNode) => {
    for (const child of parent.allChildren) {
      if (child.type === constants.SceneNodeType.group || child.type === constants.SceneNodeType.gridLayout) {
        walk(child);
      } else {
        result.push(child);
      }
    }
  };
  walk(root);
  return result;
}

export function pageBounds(node: VisualNode, root: VisualNode): BBox {
  const b = node.boundsInNode(root);
  return [b.x, b.y, b.width, b.height];
}

export function readTextStyle(node: StandaloneTextNode): { font_size: number | null; color: string | null } {
  try {
    const ranges = node.fullContent.characterStyleRanges;
    const first = ranges[0];
    // Mixed sizes/colors cannot be faithfully represented by the single-style contract.
    return {
      font_size: first && ranges.every((r) => r.fontSize === first.fontSize) ? first.fontSize : null,
      color: first && ranges.every((r) => colorToHex(r.color) === colorToHex(first.color)) ? colorToHex(first.color) : null,
    };
  } catch {
    return { font_size: null, color: null };
  }
}

export function extractCurrentPage(): { spec: DesignSpec; unsupported: string[] } {
  const root = currentArtboard();
  const unsupported: string[] = [];
  const used = new Set<string>();
  const nodes = pageElements(root).map((child): DesignNode => {
    importedPageIds.set(child.id, editor.context.currentPage.id);
    // Native ids survive re-imports. Copied add-on metadata can contain duplicate ids.
    let id = child.addOnData.getItem(NODE_ID_KEY) ?? `import_${child.id}`;
    if (used.has(id)) id = `import_${child.id}`;
    used.add(id);
    const kind = detectKind(child);
    child.addOnData.setItem(NODE_ID_KEY, id);
    child.addOnData.setItem("creativedna.kind", kind);
    const node: DesignNode = {
      id, type: kind, role: "decoration", bbox: pageBounds(child, root), expendable: false,
    };
    if (!node.bbox.every(Number.isFinite)) throw new Error(`Cannot read bounds for element ${child.id}.`);
    if (kind === "text") {
      const text = child as StandaloneTextNode;
      try { node.text = text.fullContent.text; }
      catch { unsupported.push(`${id}: text content unavailable`); }
      Object.assign(node, readTextStyle(text));
      if (node.font_size == null) unsupported.push(`${id}: mixed or unreadable text styles`);
    } else {
      try { node.fill = colorToHex((child as unknown as { fill?: { color?: Color } }).fill?.color); }
      catch { node.fill = null; }
      if (kind === "image") unsupported.push(`${id}: image preview unavailable; original image retained on canvas`);
      else if (child.type !== constants.SceneNodeType.rectangle) unsupported.push(`${id}: shape represented by its bounds`);
    }
    return node;
  });
  const width = editor.context.currentPage.width;
  const height = editor.context.currentPage.height;
  if (!(width > 0 && height > 0)) throw new Error("Cannot read the current page dimensions.");
  return {
    spec: {
      design_id: `imported-${root.id}`,
      version: Number(root.addOnData.getItem(VERSION_KEY) ?? 1),
      canvas: { width, height }, nodes,
    },
    unsupported,
  };
}
