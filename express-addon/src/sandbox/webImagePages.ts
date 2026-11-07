import { editor } from "express-document-sdk";
import type { BitmapImage, PageNode } from "express-document-sdk";
import type { WebImageInput, WebImageInsertResult } from "../shared/webImages";
import { DESIGN_ID_KEY, NODE_ID_KEY, VERSION_KEY } from "./pageImport";

/** Put references on their own pages rather than outside the poster's bounds.
 * The UI prepares real browser Blobs and transfers them through Adobe's bridge;
 * load everything first, then perform visible edits in Adobe's callback. */
export async function insertImageNodes(items: WebImageInput[]): Promise<WebImageInsertResult> {
  if (!items.length) return { insertedCount: 0, pageCount: 0 };
  const canvas = { width: editor.context.currentPage.width, height: editor.context.currentPage.height };
  const blobs = items.map((item) => {
    if (![item.width, item.height].every((n) => Number.isFinite(n) && n > 0)) throw new Error(`Missing dimensions for image '${item.name}'. Refresh the add-on and fetch the images again.`);
    if (!item.blob || !["image/png", "image/jpeg"].includes(item.blob.type)) throw new Error(`Image '${item.name}' must be prepared as PNG or JPEG in the panel. Refresh the add-on and try again.`);
    if (!item.blob.size) throw new Error(`Image '${item.name}' is empty.`);
    return item.blob;
  });
  // Loading a bitmap also needs Adobe's active editing context. Start every
  // load synchronously in that callback; awaiting one before starting the next
  // loses the context and makes the second image fail.
  let loading: Promise<BitmapImage[]> | undefined;
  await editor.keepContentActiveDuringAsync(editor.context.currentPage, async () => {}, () => {
    loading = Promise.all(blobs.map((blob, i) => editor.loadBitmapImage(blob).catch((error: unknown) => {
      throw new Error(`Could not load image '${items[i].name}': ${error instanceof Error ? error.message : String(error)}. No reference pages were added.`);
    })));
  });
  const bitmaps = await loading!;
  const perPage = 6, cols = 2, rows = 3;
  const margin = Math.min(32, canvas.width * 0.04, canvas.height * 0.04);
  const gap = margin * 0.75;
  const top = margin * 2.5;
  const cellWidth = (canvas.width - margin * 2 - gap) / cols;
  const cellHeight = (canvas.height - top - margin - gap * (rows - 1)) / rows;
  const pages: PageNode[] = [];
  await editor.keepContentActiveDuringAsync(editor.context.currentPage, async () => {}, () => {
    try {
      for (let offset = 0; offset < items.length; offset += perPage) {
        const page = editor.documentRoot.pages.addPage(canvas);
        pages.push(page);
        page.name = `CreativeDNA · Imported references ${pages.length}`;
        const board = Array.from(page.artboards)[0];
        board.addOnData.setItem(DESIGN_ID_KEY, `references-${page.id}`);
        board.addOnData.setItem(VERSION_KEY, "1");
        const heading = editor.createText(`Imported references · ${pages.length}`);
        heading.fullContent.applyCharacterStyles({ fontSize: Math.max(12, margin * 0.65), color: { red: 0.08, green: 0.17, blue: 0.21, alpha: 1 } });
        board.children.append(heading);
        heading.setPositionInParent({ x: margin, y: margin }, { x: heading.boundsLocal.x, y: heading.boundsLocal.y });
        for (let index = offset; index < Math.min(offset + perPage, items.length); index++) {
          const item = items[index];
          const scale = Math.min(1, cellWidth / item.width, cellHeight / item.height);
          const width = item.width * scale, height = item.height * scale;
          const position = index - offset;
          const x = margin + (position % cols) * (cellWidth + gap) + (cellWidth - width) / 2;
          const y = top + Math.floor(position / cols) * (cellHeight + gap) + (cellHeight - height) / 2;
          const image = editor.createImageContainer(bitmaps[index], { initialSize: { width, height } });
          board.children.append(image);
          image.setPositionInParent({ x, y }, { x: image.boundsLocal.x, y: image.boundsLocal.y });
          image.addOnData.setItem(NODE_ID_KEY, `webimg_${image.id}`);
          image.addOnData.setItem("creativedna.kind", "image");
          image.addOnData.setItem("creativedna.source_name", item.name);
        }
      }
    } catch (error) {
      for (const page of [...pages].reverse()) editor.documentRoot.pages.remove(page);
      throw error;
    }
  });
  return { insertedCount: items.length, pageCount: pages.length };
}
