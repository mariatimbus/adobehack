import ee from "add-on-sdk-document-sandbox";
import { editor as a, constants as O, fonts as W } from "express-document-sdk";
const I = "creativedna.node_id", $ = "creativedna.design_id", N = "creativedna.version", q = /* @__PURE__ */ new Map();
function K(e) {
  return q.get(e);
}
function S() {
  const e = Array.from(a.context.currentPage.artboards), t = a.context.insertionParent, n = t.visualRoot, o = e.find((s) => s.id === (n == null ? void 0 : n.id) || s.id === t.id) ?? e[0];
  if (!o) throw new Error("The current page has no accessible artboard.");
  return o;
}
function G(e) {
  if (!e || ![e.red, e.green, e.blue].every(Number.isFinite)) return null;
  const t = (n) => Math.round(Math.max(0, Math.min(1, n)) * 255).toString(16).padStart(2, "0");
  return `#${t(e.red)}${t(e.green)}${t(e.blue)}`;
}
function te(e) {
  const t = O.SceneNodeType;
  return e.type === t.text ? "text" : e.type === t.mediaContainer || e.type === t.gridCell || e.type === t.imageRectangle ? "image" : "rectangle";
}
function M(e) {
  const t = [], n = (o) => {
    for (const s of o.allChildren)
      s.type === O.SceneNodeType.group || s.type === O.SceneNodeType.gridLayout ? n(s) : t.push(s);
  };
  return n(e), t;
}
function Q(e, t) {
  const n = e.boundsInNode(t);
  return [n.x, n.y, n.width, n.height];
}
function ne(e) {
  try {
    const t = e.fullContent.characterStyleRanges, n = t[0];
    return {
      font_size: n && t.every((o) => o.fontSize === n.fontSize) ? n.fontSize : null,
      color: n && t.every((o) => G(o.color) === G(n.color)) ? G(n.color) : null
    };
  } catch {
    return { font_size: null, color: null };
  }
}
function oe() {
  const e = S(), t = [], n = /* @__PURE__ */ new Set(), o = M(e).map((c) => {
    var u;
    q.set(c.id, a.context.currentPage.id);
    let p = c.addOnData.getItem(I) ?? `import_${c.id}`;
    n.has(p) && (p = `import_${c.id}`), n.add(p);
    const g = te(c);
    c.addOnData.setItem(I, p), c.addOnData.setItem("creativedna.kind", g);
    const h = {
      id: p,
      type: g,
      role: "decoration",
      bbox: Q(c, e),
      expendable: !1
    };
    if (!h.bbox.every(Number.isFinite)) throw new Error(`Cannot read bounds for element ${c.id}.`);
    if (g === "text") {
      const r = c;
      try {
        h.text = r.fullContent.text;
      } catch {
        t.push(`${p}: text content unavailable`);
      }
      Object.assign(h, ne(r)), h.font_size == null && t.push(`${p}: mixed or unreadable text styles`);
    } else {
      try {
        h.fill = G((u = c.fill) == null ? void 0 : u.color);
      } catch {
        h.fill = null;
      }
      g === "image" ? t.push(`${p}: image preview unavailable; original image retained on canvas`) : c.type !== O.SceneNodeType.rectangle && t.push(`${p}: shape represented by its bounds`);
    }
    return h;
  }), s = a.context.currentPage.width, i = a.context.currentPage.height;
  if (!(s > 0 && i > 0)) throw new Error("Cannot read the current page dimensions.");
  return {
    spec: {
      design_id: `imported-${e.id}`,
      version: Number(e.addOnData.getItem(N) ?? 1),
      canvas: { width: s, height: i },
      nodes: o
    },
    unsupported: t
  };
}
function ae(e, t, n) {
  let o = 0;
  return e.replace(/[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g, (s) => {
    const i = o++ % 2;
    return ((Number(s) - t[i]) * n[i + 2] / t[i + 2] + n[i]).toFixed(4);
  });
}
function j(e) {
  return { red: parseInt(e.slice(1, 3), 16) / 255, green: parseInt(e.slice(3, 5), 16) / 255, blue: parseInt(e.slice(5, 7), 16) / 255, alpha: 1 };
}
function U(e, t, n) {
  const o = a.createPath(ae(e.path, e.box, t));
  return o.fill = n ? a.makeColorFill(j(n)) : void 0, e.stroke && e.strokeWidth && (o.stroke = a.makeStroke({ color: j(e.stroke), width: e.strokeWidth * t[2] / e.box[2] })), O.FillRule && (o.fillRule = e.evenOdd ? O.FillRule.evenOdd : O.FillRule.nonZero), e.opacity != null && (o.opacity = e.opacity), o;
}
function J(e) {
  return { red: parseInt(e.slice(1, 3), 16) / 255, green: parseInt(e.slice(3, 5), 16) / 255, blue: parseInt(e.slice(5, 7), 16) / 255, alpha: 1 };
}
function Z(e = {}) {
  const t = (e.weight ?? 400) >= 600;
  return /Georgia/i.test(e.family ?? "") ? t ? "Georgia-Bold" : "Georgia" : /Arial Black/i.test(e.family ?? "") ? "Arial-Black" : t ? "Arial-BoldMT" : "ArialMT";
}
async function ie(e, t, n, o, s = {}, i = {}) {
  if (!e.nodes.length || e.nodes.some((d) => !d.bbox.every(Number.isFinite) || d.bbox[2] <= 0 || d.bbox[3] <= 0)) throw new Error("Invalid concept geometry.");
  const c = Object.values(s), p = new Set(c.map(K).filter((d) => !!d));
  if (c.some((d) => !K(d))) {
    const d = new Set(M(S()).map((w) => w.id));
    if (!c.every((w) => d.has(w) || K(w))) throw new Error("Select and reload the original page to reconnect its images.");
    p.add(a.context.currentPage.id);
  }
  const g = e.nodes.filter((d) => d.type === "image");
  for (const d of g)
    if (!s[d.id] && !n[d.id]) throw new Error("The photo could not be prepared. Load the original page or upload its image.");
  let h;
  await a.keepContentActiveDuringAsync(a.context.currentPage, async () => {
  }, () => {
    h = Promise.all(g.filter((d) => !s[d.id]).map((d) => a.loadBitmapImage(n[d.id]).then((w) => [d.id, w])));
  });
  const u = new Map(await h), r = [...new Set(e.nodes.filter((d) => d.type === "text").map((d) => Z(o[d.id])))], f = new Map(await Promise.all(r.map(async (d) => [d, await W.fromPostscriptName(d)]))), x = r.filter((d) => !f.get(d)).map((d) => `Font ${d} unavailable; Adobe default used. Review typography.`);
  let m;
  const l = (d, w) => {
    if (c.some((b) => !d.has(b))) throw new Error("A source image was removed. Load the original page again.");
    if (w && Array.from(w.artboards).length !== 1) throw new Error("Animated source pages need their images uploaded separately for a new layout.");
    const v = w ? M(Array.from(w.artboards)[0]) : [], _ = w ? w.cloneInPlace() : a.documentRoot.pages.addPage(e.canvas);
    try {
      _.name = `CreativeDNA · ${t}`, _.width = e.canvas.width, _.height = e.canvas.height;
      const b = Array.from(_.artboards)[0], P = w ? M(b) : [], E = new Map(v.map((y, C) => [y.id, P[C]])), R = /* @__PURE__ */ new Set();
      for (const y of c) {
        const C = E.get(y);
        if (!C) throw new Error("The original image could not be copied.");
        b.children.append(C), R.add(C);
      }
      if (w)
        for (const y of Array.from(b.children)) R.has(y) || y.removeFromParent();
      for (const y of e.nodes) {
        const [C, A, L, H] = y.bbox;
        let D;
        if (i[y.id]) D = U(i[y.id], y.bbox, y.fill);
        else if (y.type === "text") {
          const k = a.createText(y.text ?? "");
          k.layout = { type: 2, width: L }, k.textAlignment = O.TextAlignment.left, k.fullContent.applyParagraphStyles({ spaceBefore: 0, spaceAfter: 0, lineSpacing: 1 });
          const Y = f.get(Z(o[y.id]));
          k.fullContent.applyCharacterStyles({ ...Y ? { font: Y } : {}, fontSize: y.font_size ?? 24, color: J(y.color ?? "#172e2a") }), D = k;
        } else if (y.type === "image") {
          const k = E.get(s[y.id]);
          k ? (D = k, D.resize({ width: L, behavior: "proportional", avoidScalingVisualDetailsIfPossible: !1 })) : D = a.createImageContainer(u.get(y.id), { initialSize: { width: Math.max(1, Math.round(L)), height: Math.max(1, Math.round(H)) } });
        } else {
          const k = a.createRectangle();
          k.width = L, k.height = H, k.fill = a.makeColorFill(J(y.fill ?? "#ffffff")), D = k;
        }
        b.children.append(D), D.setPositionInParent({ x: C, y: A }, { x: D.boundsLocal.x, y: D.boundsLocal.y }), D.addOnData.setItem(I, y.id), D.addOnData.setItem("creativedna.kind", y.type);
      }
      b.addOnData.setItem($, e.design_id), b.addOnData.setItem(N, "1"), m = {
        design_id: e.design_id,
        version: 1,
        canvas: e.canvas,
        node_count: e.nodes.length,
        bindings: Array.from(b.children).map((y) => ({ node_id: y.addOnData.getItem(I), adobe_node_id: y.id, type: e.nodes.find((C) => C.id === y.addOnData.getItem(I)).type, editable: !0 })),
        unsupported_properties: x
      };
    } catch (b) {
      throw a.documentRoot.pages.remove(_), b;
    }
  };
  if (c.length) {
    const d = Array.from(a.documentRoot.pages).filter((v) => p.has(v.id));
    if (d.length !== 1) throw new Error("Select and reload the original page before reusing its images.");
    const w = a.documentRoot.pages;
    if (typeof w.visitPages == "function")
      await w.visitPages(d, (v) => {
        const _ = /* @__PURE__ */ new Map();
        for (const b of v.artboards) for (const P of M(b)) _.set(P.id, P);
        l(_, v);
      });
    else {
      if (a.context.currentPage.id !== d[0].id) throw new Error("Select the original page, then create this version again.");
      await a.keepContentActiveDuringAsync(a.context.currentPage, async () => {
      }, () => l(new Map(M(S()).map((v) => [v.id, v])), a.context.currentPage));
    }
  } else await a.keepContentActiveDuringAsync(a.context.currentPage, async () => {
  }, () => l(/* @__PURE__ */ new Map()));
  if (!m) throw new Error("The design page was not created.");
  return m;
}
async function re(e) {
  if (!e.length) return { insertedCount: 0, pageCount: 0 };
  const t = { width: a.context.currentPage.width, height: a.context.currentPage.height }, n = e.map((m) => {
    if (![m.width, m.height].every((l) => Number.isFinite(l) && l > 0)) throw new Error(`Missing dimensions for image '${m.name}'. Refresh the add-on and fetch the images again.`);
    if (!m.blob || !["image/png", "image/jpeg"].includes(m.blob.type)) throw new Error(`Image '${m.name}' must be prepared as PNG or JPEG in the panel. Refresh the add-on and try again.`);
    if (!m.blob.size) throw new Error(`Image '${m.name}' is empty.`);
    return m.blob;
  });
  let o;
  await a.keepContentActiveDuringAsync(a.context.currentPage, async () => {
  }, () => {
    o = Promise.all(n.map((m, l) => a.loadBitmapImage(m).catch((d) => {
      throw new Error(`Could not load image '${e[l].name}': ${d instanceof Error ? d.message : String(d)}. No reference pages were added.`);
    })));
  });
  const s = await o, i = 6, c = 2, p = 3, g = Math.min(32, t.width * 0.04, t.height * 0.04), h = g * 0.75, u = g * 2.5, r = (t.width - g * 2 - h) / c, f = (t.height - u - g - h * (p - 1)) / p, x = [];
  return await a.keepContentActiveDuringAsync(a.context.currentPage, async () => {
  }, () => {
    try {
      for (let m = 0; m < e.length; m += i) {
        const l = a.documentRoot.pages.addPage(t);
        x.push(l), l.name = `CreativeDNA · Imported references ${x.length}`;
        const d = Array.from(l.artboards)[0];
        d.addOnData.setItem($, `references-${l.id}`), d.addOnData.setItem(N, "1");
        const w = a.createText(`Imported references · ${x.length}`);
        w.fullContent.applyCharacterStyles({ fontSize: Math.max(12, g * 0.65), color: { red: 0.08, green: 0.17, blue: 0.21, alpha: 1 } }), d.children.append(w), w.setPositionInParent({ x: g, y: g }, { x: w.boundsLocal.x, y: w.boundsLocal.y });
        for (let v = m; v < Math.min(m + i, e.length); v++) {
          const _ = e[v], b = Math.min(1, r / _.width, f / _.height), P = _.width * b, E = _.height * b, R = v - m, y = g + R % c * (r + h) + (r - P) / 2, C = u + Math.floor(R / c) * (f + h) + (f - E) / 2, A = a.createImageContainer(s[v], { initialSize: { width: P, height: E } });
          d.children.append(A), A.setPositionInParent({ x: y, y: C }, { x: A.boundsLocal.x, y: A.boundsLocal.y }), A.addOnData.setItem(I, `webimg_${A.id}`), A.addOnData.setItem("creativedna.kind", "image"), A.addOnData.setItem("creativedna.source_name", _.name);
        }
      }
    } catch (m) {
      for (const l of [...x].reverse()) a.documentRoot.pages.remove(l);
      throw m;
    }
  }), { insertedCount: e.length, pageCount: x.length };
}
async function se(e, t) {
  var u;
  if (!e.length) throw new Error("Select at least one PDF element or card.");
  const n = e.flatMap((r) => r.elements);
  if (e.some((r) => !Number.isFinite(r.width) || !Number.isFinite(r.height) || r.width < 1 || r.height < 1) || n.some((r) => !r.bbox.every(Number.isFinite) || r.bbox[2] <= 0 || r.bbox[3] <= 0)) throw new Error("Invalid PDF geometry.");
  const o = n.filter((r) => r.kind === "image");
  for (const r of o) if (!((u = t[r.id]) != null && u.size)) throw new Error(`Missing image ${r.label}. No PDF pages were added.`);
  let s;
  await a.keepContentActiveDuringAsync(a.context.currentPage, async () => {
  }, () => {
    s = Promise.all(o.map((r) => a.loadBitmapImage(t[r.id]).then((f) => [r.id, f])));
  });
  const i = new Map(await s), c = await W.fromPostscriptName("ArialMT"), p = await W.fromPostscriptName("Arial-BoldMT"), g = [];
  let h = 0;
  return await a.keepContentActiveDuringAsync(a.context.currentPage, async () => {
  }, () => {
    try {
      for (const r of e) {
        const f = a.documentRoot.pages.addPage({ width: r.width, height: r.height });
        g.push(f), f.name = `CreativeDNA · ${r.title}`;
        const x = Array.from(f.artboards)[0], m = [];
        for (const l of [...r.elements].sort((d, w) => d.order - w.order)) {
          const [d, w, v, _] = l.bbox;
          let b;
          if (l.kind === "text") {
            const P = a.createText(l.text ?? "");
            P.layout = { type: 2, width: v + Math.max(2, v * 0.025) }, P.textAlignment = O.TextAlignment.left, P.fullContent.applyParagraphStyles({ spaceBefore: 0, spaceAfter: 0, lineSpacing: 1 });
            const E = l.bold ? p : c;
            P.fullContent.applyCharacterStyles({ ...E ? { font: E } : {}, fontSize: l.font_size ?? 12, color: j(l.color ?? "#000000") }), b = P;
          } else l.kind === "vector" ? b = U({ path: l.path_data, box: l.bbox, stroke: l.stroke, strokeWidth: l.stroke_width, opacity: l.opacity, evenOdd: l.even_odd }, l.bbox, l.fill) : b = a.createImageContainer(i.get(l.id), { initialSize: { width: v, height: _ } });
          x.children.append(b), b.setPositionInParent({ x: d, y: w }, { x: b.boundsLocal.x, y: b.boundsLocal.y }), b.opacity = l.opacity ?? 1, b.addOnData.setItem(I, l.id), b.addOnData.setItem("creativedna.kind", l.kind === "vector" ? "rectangle" : l.kind), b.addOnData.setItem("creativedna.pdf_kind", l.kind), b.addOnData.setItem("creativedna.source_name", l.label), m.push(b);
        }
        x.addOnData.setItem($, `pdf-${f.id}`), x.addOnData.setItem(N, "1"), a.context.selection = m, h = a.context.selection.length;
      }
    } catch (r) {
      for (const f of [...g].reverse()) a.documentRoot.pages.remove(f);
      throw r;
    }
  }), { pageCount: g.length, elementCount: n.length, selectedCount: h, warnings: ["PDF text uses Arial/Arial Bold fallbacks. Original raster cards remain raster backings with separately editable text."] };
}
function de() {
  const e = Array.from(S().children);
  return a.context.selection = e, a.context.selection.length;
}
async function ce() {
  const e = S(), t = M(e), n = [], o = [];
  return await a.keepContentActiveDuringAsync(e, async () => {
    for (const s of t) {
      const i = s.addOnData.getItem(I);
      if (i)
        try {
          const c = s.boundsInNode(e), p = await s.createRendition({ scale: Math.min(1, 900 / Math.max(1, c.width, c.height)) });
          p.blob ? n.push({ id: i, blob: p.blob }) : o.push(i);
        } catch {
          o.push(i);
        }
    }
  }, () => {
  }), { assets: n, missing: o };
}
function V(e) {
  const t = e.replace("#", "");
  return {
    red: parseInt(t.slice(0, 2), 16) / 255,
    green: parseInt(t.slice(2, 4), 16) / 255,
    blue: parseInt(t.slice(4, 6), 16) / 255,
    alpha: 1
  };
}
function B() {
  const e = /* @__PURE__ */ new Map();
  for (const t of M(S())) {
    const n = t.addOnData.getItem(I);
    if (n) {
      const o = t.addOnData.getItem("creativedna.kind") ?? "rectangle";
      e.set(n, { node: t, kind: o });
    }
  }
  return e;
}
function F(e, t) {
  e.addOnData.setItem("creativedna.kind", t);
}
function T() {
  return S();
}
async function le(e, t) {
  const n = a.context.insertionParent, o = B();
  if (o.size >= e.nodes.length && [...o.keys()].every((i) => e.nodes.some((c) => c.id === i)))
    return z();
  for (const i of e.nodes) {
    if (o.has(i.id)) continue;
    const [c, p, g, h] = i.bbox;
    if (i.type === "rectangle") {
      const u = a.createRectangle();
      u.width = g, u.height = h, i.fill && (u.fill = a.makeColorFill(V(i.fill))), n.children.append(u), u.setPositionInParent({ x: c, y: p }, { x: 0, y: 0 }), u.addOnData.setItem(I, i.id), F(u, "rectangle");
    } else if (i.type === "text") {
      const u = a.createText(i.text ?? "");
      u.layout = { type: 2, width: g }, i.font_size && u.fullContent.applyCharacterStyles({ fontSize: i.font_size }), i.color && u.fullContent.applyCharacterStyles({ color: V(i.color) }), n.children.append(u), u.setPositionInParent({ x: c, y: p }, { x: 0, y: 0 }), u.addOnData.setItem(I, i.id), F(u, "text");
    } else if (i.type === "image")
      if (t) {
        const u = await a.loadBitmapImage(t), r = a.createImageContainer(u, {
          initialSize: { width: g, height: h }
        });
        n.children.append(r), r.setPositionInParent({ x: c, y: p }, { x: 0, y: 0 }), r.addOnData.setItem(I, i.id), F(r, "image");
      } else {
        const u = a.createRectangle();
        u.width = g, u.height = h, u.fill = a.makeColorFill(V("#dfe7dd")), n.children.append(u), u.setPositionInParent({ x: c, y: p }, { x: 0, y: 0 }), u.addOnData.setItem(I, i.id), F(u, "image_placeholder");
      }
  }
  const s = T();
  return s.addOnData.setItem($, e.design_id), s.addOnData.setItem(N, String(e.version)), z();
}
function ue(e) {
  const t = {
    translation: { ...e.node.translation },
    opacity: e.node.opacity
  };
  if (e.kind === "text") {
    const o = e.node;
    t.text = o.fullContent.text;
  }
  const n = e.node;
  return typeof n.width == "number" && (t.width = n.width), typeof n.height == "number" && (t.height = n.height), t;
}
function fe(e, t) {
  t.translation && (e.node.translation = t.translation), typeof t.opacity == "number" && (e.node.opacity = t.opacity), e.kind === "text" && typeof t.text == "string" && (e.node.fullContent.text = t.text);
  const n = e.node;
  typeof t.width == "number" && typeof n.width == "number" && (n.width = t.width), typeof t.height == "number" && typeof n.height == "number" && (n.height = t.height);
}
function ge(e, t) {
  switch (t.op) {
    case "set_text":
      e.node.fullContent.text = String(t.value);
      break;
    case "set_bbox": {
      const [n, o, s, i] = t.value, c = e.node;
      typeof c.width == "number" && (c.width = s), typeof c.height == "number" && (c.height = i), e.node.translation = { x: n, y: o };
      break;
    }
    case "set_font_size":
      e.node.fullContent.applyCharacterStyles({
        fontSize: Number(t.value)
      });
      break;
    case "set_visible":
      e.node.opacity = t.value === !1 ? 0 : 1;
      break;
    case "translate": {
      const n = e.node.translation;
      e.node.translation = { x: n.x + t.value[0], y: n.y + t.value[1] };
      break;
    }
  }
}
async function pe(e) {
  const t = Date.now(), n = B(), o = z(), s = Number(T().addOnData.getItem(N) ?? o.version);
  if (e.base_version !== s)
    return {
      design_id: o.design_id,
      base_version: e.base_version,
      resulting_version: null,
      candidate_id: e.candidate_id,
      planned: [],
      observed: [],
      matched: 0,
      mismatched: [],
      unsupported_measurements: ["patch rejected before application"],
      node_count_before: o.node_count,
      node_count_after: null,
      editability_retained: null,
      constraint_violations: ["VERSION_MISMATCH"],
      apply_duration_ms: Date.now() - t,
      recovered: null,
      status: "failed"
    };
  const i = /* @__PURE__ */ new Map(), c = [], p = [];
  for (const f of e.operations) {
    const x = n.get(f.node_id);
    if (!x) {
      p.push(f.node_id);
      continue;
    }
    i.has(f.node_id) || i.set(f.node_id, ue(x)), c.push({ t: x, op: f });
  }
  let g = null;
  try {
    for (const { t: f, op: x } of c) ge(f, x);
  } catch (f) {
    g = String(f);
  }
  let h = null;
  if (g) {
    h = !0;
    for (const [f, x] of i) {
      const m = n.get(f);
      if (m)
        try {
          fe(m, x);
        } catch {
          h = !1;
        }
    }
  }
  const u = z(), r = X(e, o, u, Date.now() - t);
  return g && (r.status = h ? "partial_failure" : "failed", r.constraint_violations.push(`op failed: ${g}`)), r.recovered = g ? h : null, g || (T().addOnData.setItem(N, String(e.base_version + 1)), r.resulting_version = e.base_version + 1), r;
}
function z() {
  const e = B(), t = [];
  for (const [o, s] of e)
    t.push({
      node_id: o,
      adobe_node_id: s.node.id ?? "unreadable",
      type: s.kind === "text" ? "text" : s.kind === "image" || s.kind === "image_placeholder" ? "image" : "rectangle",
      editable: !0
      // native nodes remain independently editable
    });
  const n = T();
  return {
    design_id: n.addOnData.getItem($) ?? "unknown",
    version: Number(n.addOnData.getItem(N) ?? 0),
    canvas: { width: S().width, height: S().height },
    bindings: t,
    node_count: t.length,
    unsupported_properties: ["font_size_readback"]
  };
}
function he(e) {
  return e.resulting_spec.nodes.map((t) => ({
    node_id: t.id,
    bbox: t.bbox,
    text: t.text ?? null,
    visible: t.bbox[2] > 0 && t.bbox[3] > 0,
    observed: !0
  }));
}
function me() {
  const e = B(), t = [];
  for (const [n, o] of e) {
    let s = null;
    if (o.kind === "text")
      try {
        s = o.node.fullContent.text;
      } catch {
        s = null;
      }
    const i = Q(o.node, S());
    t.push({
      node_id: n,
      adobe_node_id: o.node.id ?? null,
      bbox: i,
      text: s,
      visible: o.node.opacity > 0,
      editable: !0,
      observed: !0
    });
  }
  return t;
}
function X(e, t, n, o) {
  const s = he(e), i = me(), c = 2, p = [];
  let g = 0;
  for (const f of s) {
    const x = i.find((l) => l.node_id === f.node_id);
    if (!x) {
      p.push(f.node_id);
      continue;
    }
    let m = !0;
    if (f.bbox && x.bbox)
      for (let l = 0; l < 4; l++)
        Math.abs(f.bbox[l] - x.bbox[l]) > c && (m = !1);
    f.text !== null && f.text !== void 0 && x.text !== f.text && (m = !1), f.visible !== null && f.visible !== void 0 && x.visible !== f.visible && (m = !1), m ? g++ : p.push(f.node_id);
  }
  const h = ["font_size_readback", "canvas_size"], u = n.bindings.length >= t.bindings.length && n.bindings.every((f) => f.editable);
  let r = "verified";
  return h.length > 0 && (r = "verified_with_gaps"), p.length > 0 && (r = "partial_failure"), g === 0 && (r = "failed"), {
    design_id: n.design_id,
    base_version: e.base_version,
    resulting_version: n.version,
    candidate_id: e.candidate_id,
    planned: s,
    observed: i,
    matched: g,
    mismatched: p,
    unsupported_measurements: h,
    node_count_before: t.node_count,
    node_count_after: n.node_count,
    editability_retained: u,
    constraint_violations: p.map((f) => `mismatch: ${f}`),
    apply_duration_ms: o,
    recovered: null,
    status: r
  };
}
async function be(e, t) {
  const o = B().get(e);
  if (!o) throw new Error(`node '${e}' not found in document`);
  if (o.kind === "image_placeholder" && (o.kind = "image"), o.kind !== "image" && o.kind !== "rectangle")
    throw new Error(`node '${e}' is not replaceable with an image (kind=${o.kind})`);
  const s = o.node, i = typeof s.width == "number" ? s.width : 420, c = typeof s.height == "number" ? s.height : 620, p = { ...o.node.translation }, g = await a.loadBitmapImage(t), h = a.createImageContainer(g, {
    initialSize: { width: i, height: c }
  });
  a.context.insertionParent.children.append(h), h.setPositionInParent(p, { x: 0, y: 0 }), h.addOnData.setItem(I, e), F(h, "image");
  const u = o.node;
  return typeof u.removeFromParent == "function" && u.removeFromParent(), z();
}
function ye() {
  const { spec: e, unsupported: t } = oe(), n = T();
  n.addOnData.setItem($, e.design_id), n.addOnData.setItem(N, String(e.version));
  const o = z();
  return o.unsupported_properties = t, { state: o, spec: e };
}
async function we(e) {
  const t = z();
  return X(e, t, t, 0);
}
ee.instance.runtime.exposeApi({
  insertPdfPages: se,
  selectAllPageElements: de,
  capturePreviewAssets: ce,
  createConceptPage: ie,
  applyDesign: le,
  applyRepairPatch: pe,
  importCurrentDesign: ye,
  insertImageNodes: re,
  readDocumentState: z,
  replaceImageNode: be,
  verifyAppliedPatch: we
});
