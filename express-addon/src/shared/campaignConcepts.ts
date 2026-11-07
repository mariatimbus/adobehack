import type { BBox, DesignNode, DesignSpec } from "./contracts";

import { fitText } from "./textLayout";
import type { TextStyle } from "./textLayout";
export type { TextStyle } from "./textLayout";
export interface CampaignConcept {
  id: string; title: string; description: string; spec: DesignSpec;
  styles: Record<string, TextStyle>; photoSourceId?: string; photoUrl?: string;
}

/** Editorial layout proposals, intentionally separate from constraint-verified
 * in-place repairs. Every preview is rendered from the same editable spec
 * that is sent to Adobe when the user creates a new page. */
export function campaignConcepts(source: DesignSpec, replacementHeadline?: string): CampaignConcept[] {
  const copy = source.nodes.filter((n) => n.type === "text" && n.text?.trim());
  if (!copy.length) return [];
  const allText = copy.map((n) => n.text).join(" ");
  const expo = /ai expo/i.test(allText) && /alphaz/i.test(allText);
  const head = copy.find((n) => n.role === "headline") ?? [...copy].sort((a, b) => (b.font_size ?? 0) - (a.font_size ?? 0))[0];
  const originalHeadline = head.text!.trim();
  const requested = replacementHeadline?.trim();
  const changedHeadline = requested && requested !== originalHeadline ? requested : null;
  const brand = expo ? "AlphaZ" : copy.find((n) => n.role === "brand")?.text?.trim() ?? "";
  const locationNode = copy.find((n) => /hotel|bucharest|venue|location|bucure/i.test(n.text!));
  const location = expo ? allText.match(/Radisson Blu Hotel,?\s*Bucharest/i)?.[0] ?? locationNode?.text?.trim() ?? "" : locationNode?.text?.trim() ?? "";
  const dateNode = copy.find((n) => /\b(?:20\d{2}|november|october|december|january|february|march|april|may|june|july|august|september)\b/i.test(n.text!) && n.id !== head.id);
  const date = allText.match(/\b\d{1,2}\s*[–−-]\s*\d{1,2}\s+\w+\s+20\d{2}\b/)?.[0] ?? (dateNode && dateNode !== locationNode ? dateNode.text!.trim() : "");
  const year = date.match(/\b20\d{2}\b/)?.[0];
  const cta = copy.find((n) => n.role === "cta_text" || /ticket|register|sign up|discover|buy now|join us/i.test(n.text!))?.text?.trim() ?? "";
  const bodyNode = copy.filter((n) => n.id !== head.id && n.text?.trim() !== location && n.text?.trim() !== date && n.text?.trim() !== cta && n.role !== "brand")
    .sort((a, b) => (b.text?.length ?? 0) - (a.text?.length ?? 0))[0];
  const body = (bodyNode?.text?.trim() ?? "").replace(location, "").replace(date, "").replace(/[·\s]+$/, "").trim();
  const photo = source.nodes.filter((n) => n.type === "image").sort((a, b) => b.bbox[2] * b.bbox[3] - a.bbox[2] * a.bbox[3])[0];
  const photoUrl = expo ? "./alphaz-hero.png" : photo?.asset_id === "serum-packshot" ? "./serum-packshot.png" : undefined;
  const navy = "#081b26", cyan = "#54eee5", white = "#f7faf9", muted = "#b9cbd3";
  const concepts: CampaignConcept[] = [];

  const make = (id: string, title: string, description: string, build: (add: {
    rect: (id: string, box: BBox, fill: string) => void;
    text: (id: string, box: BBox, text: string, size: number, color: string, weight?: number) => void;
    photo: (box: BBox) => void;
  }) => void) => {
    const nodes: DesignNode[] = [];
    const styles: Record<string, TextStyle> = {};
    build({
      rect(nid, box, fill) { nodes.push({ id: nid, type: "rectangle", role: nid === "bg" ? "background" : "decoration", bbox: box, fill }); },
      text(nid, box, text, size, color, weight = 400) {
        if (!text) return;
        const fitted = fitText(text, box[2], box[3], size, { weight, lineHeight: 1.12 });
        nodes.push({ id: nid, type: "text", role: nid === "headline" ? "headline" : nid === "cta" ? "cta_text" : nid === "brand" ? "brand" : "subhead", bbox: box, text: fitted.lines.join("\n"), font_size: fitted.size, color });
        styles[nid] = { weight, family: "Arial, Helvetica, sans-serif", lineHeight: 1.12 };
      },
      photo(box) {
        if (photo || photoUrl) nodes.push({ id: "photo", type: "image", role: "product", bbox: box, asset_id: "concept-photo" });
      },
    });
    concepts.push({ id, title, description,
      spec: { design_id: `concept-${source.design_id}-${id}`, version: 1, canvas: { width: 1080, height: 1350 }, nodes },
      styles, photoSourceId: photo?.id, photoUrl });
  };

  make("editorial", "The editorial", "A clear reading order, generous space and a bold event headline.", ({ rect, text, photo }) => {
    rect("bg", [0, 0, 1080, 1350], navy);
    photo([675, 0, 405, 1350]);
    rect("copy-panel", [0, 0, 675, 1350], navy);
    rect("accent", [72, 148, 72, 5], cyan);
    text("brand", [72, 68, 500, 48], brand, 35, white, 700);
    text("eyebrow", [72, 185, 500, 40], expo ? "BACK TO WHAT'S NEXT" : "DISCOVER SOMETHING NEW", 20, cyan, 700);
    text("headline", [72, 258, 558, 355], changedHeadline ?? (expo ? "We're back at\nAI Expo\nEurope." : originalHeadline), 76, white, 700);
    text("body", [72, 662, 514, 238], body, 28, muted);
    rect("divider", [72, 952, 508, 2], "#27414d");
    text("date", [72, 982, 514, 50], date, 30, cyan, 700);
    text("location", [72, 1042, 514, 90], location, 25, white);
    if (cta) rect("cta-bg", [72, 1172, 508, 82], cyan);
    text("cta", [100, 1195, 452, 45], cta, 27, navy, 700);
  });

  make("spotlight", "The spotlight", "A photo-led invitation with a compact headline and a strong call to action.", ({ rect, text, photo }) => {
    rect("bg", [0, 0, 1080, 1350], white);
    rect("top", [0, 0, 1080, 450], navy);
    text("brand", [72, 58, 650, 45], brand, 32, white, 700);
    text("eyebrow", [72, 140, 900, 36], expo ? "AI EXPO EUROPE" : "THE NEXT CHAPTER", 20, cyan, 700);
    text("headline", [72, 206, 936, 195], changedHeadline ?? (expo ? "Meet us at\nAI Expo Europe." : originalHeadline), 74, white, 700);
    photo([72, 486, 370, 540]);
    rect("photo-edge", [72, 486, 8, 540], cyan);
    text("body", [492, 500, 500, 250], body, 30, navy);
    text("date", [492, 824, 500, 74], date, 32, navy, 700);
    text("location", [492, 912, 500, 106], location, 26, "#49606c");
    rect("footer-line", [72, 1090, 936, 2], "#dbe6e6");
    if (cta) rect("cta-bg", [72, 1156, 936, 92], navy);
    text("cta", [112, 1184, 856, 45], cta, 30, white, 700);
  });

  make("statement", "The statement", "A confident typographic poster with a restrained palette and prominent event details.", ({ rect, text, photo }) => {
    rect("bg", [0, 0, 1080, 1350], cyan);
    text("brand", [72, 64, 680, 48], brand, 36, navy, 700);
    rect("top-rule", [72, 145, 936, 3], navy);
    text("eyebrow", [72, 184, 936, 35], expo ? `AI EXPO EUROPE${year ? ` / ${year}` : ""}` : "A NEW PERSPECTIVE", 20, navy, 700);
    text("headline", [72, 265, 936, 310], changedHeadline ?? (expo ? "Come for AI.\nMeet AlphaZ." : originalHeadline), 100, navy, 700);
    photo([704, 660, 304, 466]);
    rect("text-panel", [0, 615, 655, 575], navy);
    text("body", [72, 670, 515, 220], body, 29, white);
    text("date", [72, 948, 515, 54], date, 32, cyan, 700);
    text("location", [72, 1016, 515, 100], location, 26, white);
    rect("bottom-rule", [72, 1214, 936, 3], navy);
    text("cta", [72, 1250, 936, 48], cta, 30, navy, 700);
  });
  return concepts;
}
