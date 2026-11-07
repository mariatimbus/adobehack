import type { CampaignConcept } from "../shared/campaignConcepts";
import type { WebImage } from "./api";
import { decodeBase64, type WebImageInput } from "../shared/webImages";

export function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read the artwork preview."));
    reader.readAsDataURL(blob);
  });
}

/** WebP/GIF and other browser formats are converted in the UI. Adobe's
 * loadBitmapImage accepts PNG/JPEG; the sandbox only receives those formats. */
export async function prepareWebImages(images: WebImage[]): Promise<WebImageInput[]> {
  return Promise.all(images.map(async (image) => {
    const contentType = image.content_type === "image/jpg" ? "image/jpeg" : image.content_type;
    const bytes = decodeBase64(image.data_b64);
    const item: WebImageInput = {
      name: image.source_url.split("/").pop() || image.id,
      blob: new Blob([bytes as unknown as BlobPart], { type: contentType }), width: image.width, height: image.height,
      backgroundRemoved: image.background_removed,
    };
    if (["image/png", "image/jpeg"].includes(contentType)) return item;
    const bitmap = await createImageBitmap(item.blob);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Image conversion is unavailable in this browser.");
      ctx.drawImage(bitmap, 0, 0);
      const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error(`Could not convert '${item.name}' to PNG.`)), "image/png"));
      return { ...item, blob: png, width: bitmap.width, height: bitmap.height };
    } finally { bitmap.close(); }
  }));
}

/** Match the SVG's centre crop before insertion. Adobe requires initialSize
 * to have the bitmap's aspect ratio; stretching a photo is never a fallback. */
export async function conceptImages(concept: CampaignConcept, assets: Record<string, string>): Promise<Record<string, Blob>> {
  const result: Record<string, Blob> = {};
  for (const node of concept.spec.nodes.filter((n) => n.type === "image")) {
    const url = concept.photoUrl ?? assets[concept.photoSourceId ?? ""];
    if (!url) throw new Error("The original photo is unavailable. Re-import the page to load its artwork.");
    const response = await fetch(url);
    if (!response.ok) throw new Error("Could not load the campaign photo.");
    const bitmap = await createImageBitmap(await response.blob());
    try {
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(node.bbox[2]); canvas.height = Math.round(node.bbox[3]);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Image preparation is unavailable.");
      const scale = Math.max(canvas.width / bitmap.width, canvas.height / bitmap.height);
      const sw = canvas.width / scale, sh = canvas.height / scale;
      ctx.drawImage(bitmap, (bitmap.width - sw) / 2, (bitmap.height - sh) / 2, sw, sh, 0, 0, canvas.width, canvas.height);
      result[node.id] = await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not prepare the photo.")), "image/png"));
    } finally { bitmap.close(); }
  }
  return result;
}
