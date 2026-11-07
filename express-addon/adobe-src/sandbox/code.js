import z from "add-on-sdk-document-sandbox";
import { editor as p } from "express-document-sdk";
const m = "creativedna.node_id", C = "creativedna.design_id", v = "creativedna.version";
function P(e) {
  const t = e.replace("#", "");
  return {
    red: parseInt(t.slice(0, 2), 16) / 255,
    green: parseInt(t.slice(2, 4), 16) / 255,
    blue: parseInt(t.slice(4, 6), 16) / 255,
    alpha: 1
  };
}
function x() {
  const e = /* @__PURE__ */ new Map(), t = p.context.insertionParent, o = (i) => {
    var d;
    for (const n of i) {
      const s = (d = n.addOnData) == null ? void 0 : d.getItem(m);
      if (s) {
        const l = n.addOnData.getItem("creativedna.kind") ?? "rectangle";
        e.set(s, { node: n, kind: l });
      }
      const c = n.children;
      c && o(c);
    }
  };
  return o(t.children), e;
}
function y(e, t) {
  e.addOnData.setItem("creativedna.kind", t);
}
function w() {
  return p.context.insertionParent;
}
async function E(e, t) {
  const o = p.context.insertionParent, i = x();
  if (i.size >= e.nodes.length && [...i.keys()].every((n) => e.nodes.some((s) => s.id === n)))
    return b();
  for (const n of e.nodes) {
    if (i.has(n.id)) continue;
    const [s, c, l, u] = n.bbox;
    if (n.type === "rectangle") {
      const a = p.createRectangle();
      a.width = l, a.height = u, n.fill && (a.fill = p.makeColorFill(P(n.fill))), o.children.append(a), a.setPositionInParent({ x: s, y: c }, { x: 0, y: 0 }), a.addOnData.setItem(m, n.id), y(a, "rectangle");
    } else if (n.type === "text") {
      const a = p.createText(n.text ?? "");
      a.layout = { type: 2, width: l }, n.font_size && a.fullContent.applyCharacterStyles({ fontSize: n.font_size }), n.color && a.fullContent.applyCharacterStyles({ color: P(n.color) }), o.children.append(a), a.setPositionInParent({ x: s, y: c }, { x: 0, y: 0 }), a.addOnData.setItem(m, n.id), y(a, "text");
    } else if (n.type === "image")
      if (t) {
        const a = await p.loadBitmapImage(t), h = p.createImageContainer(a, {
          initialSize: { width: l, height: u }
        });
        o.children.append(h), h.setPositionInParent({ x: s, y: c }, { x: 0, y: 0 }), h.addOnData.setItem(m, n.id), y(h, "image");
      } else {
        const a = p.createRectangle();
        a.width = l, a.height = u, a.fill = p.makeColorFill(P("#dfe7dd")), o.children.append(a), a.setPositionInParent({ x: s, y: c }, { x: 0, y: 0 }), a.addOnData.setItem(m, n.id), y(a, "image_placeholder");
      }
  }
  const d = w();
  return d.addOnData.setItem(C, e.design_id), d.addOnData.setItem(v, String(e.version)), b();
}
function L(e) {
  const t = {
    translation: { ...e.node.translation },
    opacity: e.node.opacity
  };
  if (e.kind === "text") {
    const i = e.node;
    t.text = i.fullContent.text;
  }
  const o = e.node;
  return typeof o.width == "number" && (t.width = o.width), typeof o.height == "number" && (t.height = o.height), t;
}
function N(e, t) {
  t.translation && (e.node.translation = t.translation), typeof t.opacity == "number" && (e.node.opacity = t.opacity), e.kind === "text" && typeof t.text == "string" && (e.node.fullContent.text = t.text);
  const o = e.node;
  typeof t.width == "number" && typeof o.width == "number" && (o.width = t.width), typeof t.height == "number" && typeof o.height == "number" && (o.height = t.height);
}
function $(e, t) {
  switch (t.op) {
    case "set_text":
      e.node.fullContent.text = String(t.value);
      break;
    case "set_bbox": {
      const [o, i, d, n] = t.value, s = e.node;
      typeof s.width == "number" && (s.width = d), typeof s.height == "number" && (s.height = n), e.node.translation = { x: o, y: i };
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
      const o = e.node.translation;
      e.node.translation = { x: o.x + t.value[0], y: o.y + t.value[1] };
      break;
    }
  }
}
async function M(e) {
  const t = Date.now(), o = x(), i = b(), d = Number(w().addOnData.getItem(v) ?? i.version);
  if (e.base_version !== d)
    return {
      design_id: i.design_id,
      base_version: e.base_version,
      resulting_version: null,
      candidate_id: e.candidate_id,
      planned: [],
      observed: [],
      matched: 0,
      mismatched: [],
      unsupported_measurements: ["patch rejected before application"],
      node_count_before: i.node_count,
      node_count_after: null,
      editability_retained: null,
      constraint_violations: ["VERSION_MISMATCH"],
      apply_duration_ms: Date.now() - t,
      recovered: null,
      status: "failed"
    };
  const n = /* @__PURE__ */ new Map(), s = [], c = [];
  for (const r of e.operations) {
    const f = o.get(r.node_id);
    if (!f) {
      c.push(r.node_id);
      continue;
    }
    n.has(r.node_id) || n.set(r.node_id, L(f)), s.push({ t: f, op: r });
  }
  let l = null;
  try {
    for (const { t: r, op: f } of s) $(r, f);
  } catch (r) {
    l = String(r);
  }
  let u = null;
  if (l) {
    u = !0;
    for (const [r, f] of n) {
      const g = o.get(r);
      if (g)
        try {
          N(g, f);
        } catch {
          u = !1;
        }
    }
  }
  const a = b(), h = D(e, i, a, Date.now() - t);
  return l && (h.status = u ? "partial_failure" : "failed", h.constraint_violations.push(`op failed: ${l}`)), h.recovered = l ? u : null, l || (w().addOnData.setItem(v, String(e.base_version + 1)), h.resulting_version = e.base_version + 1), h;
}
function b() {
  const e = x(), t = [];
  for (const [i, d] of e)
    t.push({
      node_id: i,
      adobe_node_id: d.node.id ?? "unreadable",
      type: d.kind === "text" ? "text" : d.kind === "image" || d.kind === "image_placeholder" ? "image" : "rectangle",
      editable: !0
      // native nodes remain independently editable
    });
  const o = w();
  return {
    design_id: o.addOnData.getItem(C) ?? "unknown",
    version: Number(o.addOnData.getItem(v) ?? 0),
    canvas: { width: 0, height: 0 },
    // artboard size readback unsupported in current SDK typings
    bindings: t,
    node_count: t.length,
    unsupported_properties: ["canvas_size", "font_size_readback"]
  };
}
function A(e) {
  return e.resulting_spec.nodes.map((t) => ({
    node_id: t.id,
    bbox: t.bbox,
    text: t.text ?? null,
    visible: t.bbox[2] > 0 && t.bbox[3] > 0,
    observed: !0
  }));
}
function R() {
  const e = x(), t = [];
  for (const [o, i] of e) {
    let d = null;
    if (i.kind === "text")
      try {
        d = i.node.fullContent.text;
      } catch {
        d = null;
      }
    const n = i.node.boundsInParent;
    t.push({
      node_id: o,
      adobe_node_id: i.node.id ?? null,
      bbox: [n.x, n.y, n.width, n.height],
      text: d,
      visible: i.node.opacity > 0,
      editable: !0,
      observed: !0
    });
  }
  return t;
}
function D(e, t, o, i) {
  const d = A(e), n = R(), s = 2, c = [];
  let l = 0;
  for (const r of d) {
    const f = n.find((_) => _.node_id === r.node_id);
    if (!f) {
      c.push(r.node_id);
      continue;
    }
    let g = !0;
    if (r.bbox && f.bbox)
      for (let _ = 0; _ < 4; _++)
        Math.abs(r.bbox[_] - f.bbox[_]) > s && (g = !1);
    r.text !== null && r.text !== void 0 && f.text !== r.text && (g = !1), r.visible !== null && r.visible !== void 0 && f.visible !== r.visible && (g = !1), g ? l++ : c.push(r.node_id);
  }
  const u = ["font_size_readback", "canvas_size"], a = o.bindings.length >= t.bindings.length && o.bindings.every((r) => r.editable);
  let h = "verified";
  return u.length > 0 && (h = "verified_with_gaps"), c.length > 0 && (h = "partial_failure"), l === 0 && (h = "failed"), {
    design_id: o.design_id,
    base_version: e.base_version,
    resulting_version: o.version,
    candidate_id: e.candidate_id,
    planned: d,
    observed: n,
    matched: l,
    mismatched: c,
    unsupported_measurements: u,
    node_count_before: t.node_count,
    node_count_after: o.node_count,
    editability_retained: a,
    constraint_violations: c.map((r) => `mismatch: ${r}`),
    apply_duration_ms: i,
    recovered: null,
    status: h
  };
}
async function K(e, t) {
  const i = x().get(e);
  if (!i) throw new Error(`node '${e}' not found in document`);
  if (i.kind === "image_placeholder" && (i.kind = "image"), i.kind !== "image" && i.kind !== "rectangle")
    throw new Error(`node '${e}' is not replaceable with an image (kind=${i.kind})`);
  const d = i.node, n = typeof d.width == "number" ? d.width : 420, s = typeof d.height == "number" ? d.height : 620, c = { ...i.node.translation }, l = await p.loadBitmapImage(t), u = p.createImageContainer(l, {
    initialSize: { width: n, height: s }
  });
  p.context.insertionParent.children.append(u), u.setPositionInParent(c, { x: 0, y: 0 }), u.addOnData.setItem(m, e), y(u, "image");
  const a = i.node;
  return typeof a.removeFromParent == "function" && a.removeFromParent(), b();
}
function T(e) {
  if (!e) return null;
  const t = (o) => Math.round(Math.max(0, Math.min(1, o)) * 255).toString(16).padStart(2, "0");
  return `#${t(e.red)}${t(e.green)}${t(e.blue)}`;
}
function Y(e) {
  const t = e;
  return t.fullContent !== void 0 ? "text" : t.mediaRectangle !== void 0 ? "image" : "rectangle";
}
async function B() {
  var n;
  const e = p.context.insertionParent, t = [];
  let o = 0;
  for (const s of e.children) {
    o += 1;
    let c = s.addOnData.getItem(m);
    c || (c = `node_${o}`, s.addOnData.setItem(m, c));
    const l = Y(s);
    y(s, l);
    const u = s.boundsInParent;
    let a = null, h = null;
    if (l === "text") {
      try {
        a = s.fullContent.text;
      } catch {
        a = null;
      }
      try {
        const f = s.fullContent, g = ((n = f.getCharacterStyles) == null ? void 0 : n.call(f)) ?? [];
        h = g.length && g[0].fontSize ? g[0].fontSize : null;
      } catch {
        h = null;
      }
    }
    let r = null;
    try {
      const f = s.fill;
      r = T(f == null ? void 0 : f.color);
    } catch {
      r = null;
    }
    t.push({
      id: c,
      type: l === "text" ? "text" : l === "image" ? "image" : "rectangle",
      role: "decoration",
      // backend re-infers roles; neutral default
      bbox: [u.x, u.y, u.width, u.height],
      fill: r,
      text: a,
      font_size: h,
      expendable: !1
    });
  }
  const i = {
    design_id: `imported-${Date.now()}`,
    version: 1,
    canvas: { width: e.width ?? 1080, height: e.height ?? 1080 },
    nodes: t
  }, d = w();
  return d.addOnData.setItem(C, i.design_id), d.addOnData.setItem(v, String(i.version)), { state: b(), spec: i };
}
async function F(e) {
  const d = p.context.insertionParent;
  let n = 64;
  const s = x();
  for (const c of s.values()) {
    const l = c.node.boundsInParent;
    n = Math.max(n, l.y + l.height + 40);
  }
  for (let c = 0; c < e.length; c++) {
    const l = e[c], u = atob(l.dataB64), a = new Uint8Array(u.length);
    for (let k = 0; k < u.length; k++) a[k] = u.charCodeAt(k);
    const h = new Blob([a], { type: "image/png" }), r = await p.loadBitmapImage(h), f = c % 3, g = Math.floor(c / 3), _ = 64 + f * 304, S = n + g * 304, O = `webimg_${Date.now() % 1e5}_${c + 1}`, I = p.createImageContainer(r, {
      initialSize: { width: 280, height: 280 }
    });
    d.children.append(I), I.setPositionInParent({ x: _, y: S }, { x: 0, y: 0 }), I.addOnData.setItem(m, O), y(I, "image");
  }
  return b();
}
async function G(e) {
  const t = b();
  return D(e, t, t, 0);
}
z.instance.runtime.exposeApi({
  applyDesign: E,
  applyRepairPatch: M,
  importCurrentDesign: B,
  insertImageNodes: F,
  readDocumentState: b,
  replaceImageNode: K,
  verifyAppliedPatch: G
});
