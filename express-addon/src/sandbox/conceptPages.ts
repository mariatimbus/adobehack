import { editor, fonts, constants } from 'express-document-sdk';
import type { AvailableFont, BitmapImage, Color, VisualNode, PageNode } from 'express-document-sdk';
import type { DesignSpec, DocumentState } from '../shared/contracts';
import type { TextStyle } from '../shared/textLayout';
import { DESIGN_ID_KEY, NODE_ID_KEY, VERSION_KEY, pageElements, currentArtboard, importedPageId } from './pageImport';
import type {VectorStyle} from '../shared/pdfElements';
import {createVector} from './vectorNode';

function color(hex: string): Color {
  return { red: parseInt(hex.slice(1, 3), 16) / 255, green: parseInt(hex.slice(3, 5), 16) / 255, blue: parseInt(hex.slice(5, 7), 16) / 255, alpha: 1 };
}
function fontName(style: TextStyle = {}): string {
  const bold = (style.weight ?? 400) >= 600;
  if (/Georgia/i.test(style.family ?? '')) return bold ? 'Georgia-Bold' : 'Georgia';
  if (/Arial Black/i.test(style.family ?? '')) return 'Arial-Black';
  return bold ? 'Arial-BoldMT' : 'ArialMT';
}

/** All resources are prepared before creating a page. Source images are read
 * inside visitPages, never through stale handles on an inactive page. */
export async function createConceptPage(spec: DesignSpec, title: string, images: Record<string, Blob>, styles: Record<string, TextStyle>, nativeSources: Record<string, string> = {}, vectors:Record<string,VectorStyle> = {}): Promise<DocumentState> {
  if (!spec.nodes.length || spec.nodes.some(n => !n.bbox.every(Number.isFinite) || n.bbox[2] <= 0 || n.bbox[3] <= 0)) throw new Error('Invalid concept geometry.');
  const nativeIds = Object.values(nativeSources);
  const sourcePageIds = new Set(nativeIds.map(importedPageId).filter((id): id is string => !!id));
  if (nativeIds.some(id => !importedPageId(id))) {
    const currentIds = new Set(pageElements(currentArtboard()).map(n => n.id));
    if (!nativeIds.every(id => currentIds.has(id) || importedPageId(id))) throw new Error('Select and reload the original page to reconnect its images.');
    sourcePageIds.add(editor.context.currentPage.id);
  }
  const photoNodes = spec.nodes.filter(n => n.type === 'image');
  for (const n of photoNodes) {
    if (!nativeSources[n.id] && !images[n.id]) throw new Error('The photo could not be prepared. Load the original page or upload its image.');
  }
  let loading: Promise<Array<[string, BitmapImage]>> | undefined;
  await editor.keepContentActiveDuringAsync(editor.context.currentPage, async () => {}, () => {
    loading = Promise.all(photoNodes.filter(n => !nativeSources[n.id]).map(n => editor.loadBitmapImage(images[n.id]).then(bitmap => [n.id, bitmap] as [string, BitmapImage])));
  });
  const bitmaps = new Map(await loading!);
  const wanted = [...new Set(spec.nodes.filter(n => n.type === 'text').map(n => fontName(styles[n.id])))];
  const available = new Map<string, AvailableFont | undefined>(await Promise.all(wanted.map(async name => [name, await fonts.fromPostscriptName(name)] as [string, AvailableFont | undefined])));
  const fontWarnings = wanted.filter(name => !available.get(name)).map(name => `Font ${name} unavailable; Adobe default used. Review typography.`);
  let output: DocumentState | undefined;

  const buildPage = (originals: Map<string, VisualNode>, template?: PageNode) => {
    if (nativeIds.some(id => !originals.has(id))) throw new Error('A source image was removed. Load the original page again.');
    if (template && Array.from(template.artboards).length !== 1) throw new Error('Animated source pages need their images uploaded separately for a new layout.');
    // Adobe disallows moving some media across page ownership boundaries.
    // Clone the page first, then reflow its own native image layers locally.
    const sourceElements = template ? pageElements(Array.from(template.artboards)[0]) : [];
    const page = template ? template.cloneInPlace() : editor.documentRoot.pages.addPage(spec.canvas);
    try {
      page.name = `CreativeDNA · ${title}`;
      page.width = spec.canvas.width; page.height = spec.canvas.height;
      const board = Array.from(page.artboards)[0];
      const copiedElements = template ? pageElements(board) : [];
      const copies = new Map(sourceElements.map((node, i) => [node.id, copiedElements[i]]));
      const retained = new Set<VisualNode>();
      for (const id of nativeIds) {
        const node = copies.get(id);
        if (!node) throw new Error('The original image could not be copied.');
        board.children.append(node); retained.add(node);
      }
      if (template) for (const node of Array.from(board.children)) if (!retained.has(node as VisualNode)) node.removeFromParent();
      for (const n of spec.nodes) {
        const [x, y, width, height] = n.bbox;
        let node: VisualNode;
        if(vectors[n.id])node=createVector(vectors[n.id],n.bbox,n.fill);
        else if (n.type === 'text') {
          const text = editor.createText(n.text ?? '');
          text.layout = { type: 2, width };
          text.textAlignment = constants.TextAlignment.left;
          text.fullContent.applyParagraphStyles({ spaceBefore: 0, spaceAfter: 0, lineSpacing: 1 });
          const font = available.get(fontName(styles[n.id]));
          text.fullContent.applyCharacterStyles({ ...(font ? { font } : {}), fontSize: n.font_size ?? 24, color: color(n.color ?? '#172e2a') });
          node = text;
        } else if (n.type === 'image') {
          const copied = copies.get(nativeSources[n.id]);
          if (copied) {
            node = copied;
            node.resize({ width, behavior: 'proportional', avoidScalingVisualDetailsIfPossible: false });
          } else node = editor.createImageContainer(bitmaps.get(n.id)!, { initialSize: { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) } });
        } else {
          const rect = editor.createRectangle(); rect.width = width; rect.height = height;
          rect.fill = editor.makeColorFill(color(n.fill ?? '#ffffff')); node = rect;
        }
        board.children.append(node); // also restores the planned stacking order
        node.setPositionInParent({ x, y }, { x: node.boundsLocal.x, y: node.boundsLocal.y });
        node.addOnData.setItem(NODE_ID_KEY, n.id);
        node.addOnData.setItem('creativedna.kind', n.type);
      }
      board.addOnData.setItem(DESIGN_ID_KEY, spec.design_id); board.addOnData.setItem(VERSION_KEY, '1');
      output = {
        design_id: spec.design_id, version: 1, canvas: spec.canvas, node_count: spec.nodes.length,
        bindings: Array.from(board.children).map(n => ({ node_id: n.addOnData.getItem(NODE_ID_KEY)!, adobe_node_id: n.id, type: spec.nodes.find(s => s.id === n.addOnData.getItem(NODE_ID_KEY))!.type, editable: true })),
        unsupported_properties: fontWarnings,
      };
    } catch (error) {
      editor.documentRoot.pages.remove(page); throw error;
    }
  };
  if (nativeIds.length) {
    const pages = Array.from(editor.documentRoot.pages).filter(page => sourcePageIds.has(page.id));
    if (pages.length !== 1) throw new Error('Select and reload the original page before reusing its images.');
    const pageList = editor.documentRoot.pages;
    if (typeof pageList.visitPages === 'function') {
      await pageList.visitPages(pages, active => {
        const originals = new Map<string, VisualNode>();
        for (const board of active.artboards) for (const node of pageElements(board)) originals.set(node.id, node);
        buildPage(originals, active);
      });
    } else {
      if (editor.context.currentPage.id !== pages[0].id) throw new Error('Select the original page, then create this version again.');
      await editor.keepContentActiveDuringAsync(editor.context.currentPage, async () => {}, () => buildPage(new Map(pageElements(currentArtboard()).map(node => [node.id, node])), editor.context.currentPage));
    }
  } else await editor.keepContentActiveDuringAsync(editor.context.currentPage, async () => {}, () => buildPage(new Map()));
  if (!output) throw new Error('The design page was not created.');
  return output;
}
