import P from "add-on-sdk-document-sandbox";
import { editor as h } from "express-document-sdk";
const m = "creativedna.node_id", I = "creativedna.design_id", x = "creativedna.version";
function k(t) {
  const e = t.replace("#", "");
  return {
    red: parseInt(e.slice(0, 2), 16) / 255,
    green: parseInt(e.slice(2, 4), 16) / 255,
    blue: parseInt(e.slice(4, 6), 16) / 255,
    alpha: 1
  };
}
function v() {
  const t = /* @__PURE__ */ new Map(), e = h.context.insertionParent, i = (o) => {
    var s;
    for (const n of o) {
      const d = (s = n.addOnData) == null ? void 0 : s.getItem(m);
      if (d) {
        const c = n.addOnData.getItem("creativedna.kind") ?? "rectangle";
        t.set(d, { node: n, kind: c });
      }
      const l = n.children;
      l && i(l);
    }
  };
  return i(e.children), t;
}
function y(t, e) {
  t.addOnData.setItem("creativedna.kind", e);
}
function w() {
  return h.context.insertionParent;
}
async function O(t, e) {
  const i = h.context.insertionParent, o = v();
  if (o.size >= t.nodes.length && [...o.keys()].every((n) => t.nodes.some((d) => d.id === n)))
    return b();
  for (const n of t.nodes) {
    if (o.has(n.id)) continue;
    const [d, l, c, f] = n.bbox;
    if (n.type === "rectangle") {
      const a = h.createRectangle();
      a.width = c, a.height = f, n.fill && (a.fill = h.makeColorFill(k(n.fill))), i.children.append(a), a.setPositionInParent({ x: d, y: l }, { x: 0, y: 0 }), a.addOnData.setItem(m, n.id), y(a, "rectangle");
    } else if (n.type === "text") {
      const a = h.createText(n.text ?? "");
      a.layout = { type: 2, width: c }, n.font_size && a.fullContent.applyCharacterStyles({ fontSize: n.font_size }), n.color && a.fullContent.applyCharacterStyles({ color: k(n.color) }), i.children.append(a), a.setPositionInParent({ x: d, y: l }, { x: 0, y: 0 }), a.addOnData.setItem(m, n.id), y(a, "text");
    } else if (n.type === "image")
      if (e) {
        const a = await h.loadBitmapImage(e), u = h.createImageContainer(a, {
          initialSize: { width: c, height: f }
        });
        i.children.append(u), u.setPositionInParent({ x: d, y: l }, { x: 0, y: 0 }), u.addOnData.setItem(m, n.id), y(u, "image");
      } else {
        const a = h.createRectangle();
        a.width = c, a.height = f, a.fill = h.makeColorFill(k("#dfe7dd")), i.children.append(a), a.setPositionInParent({ x: d, y: l }, { x: 0, y: 0 }), a.addOnData.setItem(m, n.id), y(a, "image_placeholder");
      }
  }
  const s = w();
  return s.addOnData.setItem(I, t.design_id), s.addOnData.setItem(x, String(t.version)), b();
}
function S(t) {
  const e = {
    translation: { ...t.node.translation },
    opacity: t.node.opacity
  };
  if (t.kind === "text") {
    const o = t.node;
    e.text = o.fullContent.text;
  }
  const i = t.node;
  return typeof i.width == "number" && (e.width = i.width), typeof i.height == "number" && (e.height = i.height), e;
}
function C(t, e) {
  e.translation && (t.node.translation = e.translation), typeof e.opacity == "number" && (t.node.opacity = e.opacity), t.kind === "text" && typeof e.text == "string" && (t.node.fullContent.text = e.text);
  const i = t.node;
  typeof e.width == "number" && typeof i.width == "number" && (i.width = e.width), typeof e.height == "number" && typeof i.height == "number" && (i.height = e.height);
}
function z(t, e) {
  switch (e.op) {
    case "set_text":
      t.node.fullContent.text = String(e.value);
      break;
    case "set_bbox": {
      const [i, o, s, n] = e.value, d = t.node;
      typeof d.width == "number" && (d.width = s), typeof d.height == "number" && (d.height = n), t.node.translation = { x: i, y: o };
      break;
    }
    case "set_font_size":
      t.node.fullContent.applyCharacterStyles({
        fontSize: Number(e.value)
      });
      break;
    case "set_visible":
      t.node.opacity = e.value === !1 ? 0 : 1;
      break;
    case "translate": {
      const i = t.node.translation;
      t.node.translation = { x: i.x + e.value[0], y: i.y + e.value[1] };
      break;
    }
  }
}
async function N(t) {
  const e = Date.now(), i = v(), o = b(), s = Number(w().addOnData.getItem(x) ?? o.version);
  if (t.base_version !== s)
    return {
      design_id: o.design_id,
      base_version: t.base_version,
      resulting_version: null,
      candidate_id: t.candidate_id,
      planned: [],
      observed: [],
      matched: 0,
      mismatched: [],
      unsupported_measurements: ["patch rejected before application"],
      node_count_before: o.node_count,
      node_count_after: null,
      editability_retained: null,
      constraint_violations: ["VERSION_MISMATCH"],
      apply_duration_ms: Date.now() - e,
      recovered: null,
      status: "failed"
    };
  const n = /* @__PURE__ */ new Map(), d = [], l = [];
  for (const r of t.operations) {
    const p = i.get(r.node_id);
    if (!p) {
      l.push(r.node_id);
      continue;
    }
    n.has(r.node_id) || n.set(r.node_id, S(p)), d.push({ t: p, op: r });
  }
  let c = null;
  try {
    for (const { t: r, op: p } of d) z(r, p);
  } catch (r) {
    c = String(r);
  }
  let f = null;
  if (c) {
    f = !0;
    for (const [r, p] of n) {
      const _ = i.get(r);
      if (_)
        try {
          C(_, p);
        } catch {
          f = !1;
        }
    }
  }
  const a = b(), u = D(t, o, a, Date.now() - e);
  return c && (u.status = f ? "partial_failure" : "failed", u.constraint_violations.push(`op failed: ${c}`)), u.recovered = c ? f : null, c || (w().addOnData.setItem(x, String(t.base_version + 1)), u.resulting_version = t.base_version + 1), u;
}
function b() {
  const t = v(), e = [];
  for (const [o, s] of t)
    e.push({
      node_id: o,
      adobe_node_id: s.node.id ?? "unreadable",
      type: s.kind === "text" ? "text" : s.kind === "image" || s.kind === "image_placeholder" ? "image" : "rectangle",
      editable: !0
      // native nodes remain independently editable
    });
  const i = w();
  return {
    design_id: i.addOnData.getItem(I) ?? "unknown",
    version: Number(i.addOnData.getItem(x) ?? 0),
    canvas: { width: 0, height: 0 },
    // artboard size readback unsupported in current SDK typings
    bindings: e,
    node_count: e.length,
    unsupported_properties: ["canvas_size", "font_size_readback"]
  };
}
function E(t) {
  return t.resulting_spec.nodes.map((e) => ({
    node_id: e.id,
    bbox: e.bbox,
    text: e.text ?? null,
    visible: e.bbox[2] > 0 && e.bbox[3] > 0,
    observed: !0
  }));
}
function R() {
  const t = v(), e = [];
  for (const [i, o] of t) {
    let s = null;
    if (o.kind === "text")
      try {
        s = o.node.fullContent.text;
      } catch {
        s = null;
      }
    const n = o.node.boundsInParent;
    e.push({
      node_id: i,
      adobe_node_id: o.node.id ?? null,
      bbox: [n.x, n.y, n.width, n.height],
      text: s,
      visible: o.node.opacity > 0,
      editable: !0,
      observed: !0
    });
  }
  return e;
}
function D(t, e, i, o) {
  const s = E(t), n = R(), d = 2, l = [];
  let c = 0;
  for (const r of s) {
    const p = n.find((g) => g.node_id === r.node_id);
    if (!p) {
      l.push(r.node_id);
      continue;
    }
    let _ = !0;
    if (r.bbox && p.bbox)
      for (let g = 0; g < 4; g++)
        Math.abs(r.bbox[g] - p.bbox[g]) > d && (_ = !1);
    r.text !== null && r.text !== void 0 && p.text !== r.text && (_ = !1), r.visible !== null && r.visible !== void 0 && p.visible !== r.visible && (_ = !1), _ ? c++ : l.push(r.node_id);
  }
  const f = ["font_size_readback", "canvas_size"], a = i.bindings.length >= e.bindings.length && i.bindings.every((r) => r.editable);
  let u = "verified";
  return f.length > 0 && (u = "verified_with_gaps"), l.length > 0 && (u = "partial_failure"), c === 0 && (u = "failed"), {
    design_id: i.design_id,
    base_version: t.base_version,
    resulting_version: i.version,
    candidate_id: t.candidate_id,
    planned: s,
    observed: n,
    matched: c,
    mismatched: l,
    unsupported_measurements: f,
    node_count_before: e.node_count,
    node_count_after: i.node_count,
    editability_retained: a,
    constraint_violations: l.map((r) => `mismatch: ${r}`),
    apply_duration_ms: o,
    recovered: null,
    status: u
  };
}
async function M(t, e) {
  const o = v().get(t);
  if (!o) throw new Error(`node '${t}' not found in document`);
  if (o.kind === "image_placeholder" && (o.kind = "image"), o.kind !== "image" && o.kind !== "rectangle")
    throw new Error(`node '${t}' is not replaceable with an image (kind=${o.kind})`);
  const s = o.node, n = typeof s.width == "number" ? s.width : 420, d = typeof s.height == "number" ? s.height : 620, l = { ...o.node.translation }, c = await h.loadBitmapImage(e), f = h.createImageContainer(c, {
    initialSize: { width: n, height: d }
  });
  h.context.insertionParent.children.append(f), f.setPositionInParent(l, { x: 0, y: 0 }), f.addOnData.setItem(m, t), y(f, "image");
  const a = o.node;
  return typeof a.removeFromParent == "function" && a.removeFromParent(), b();
}
async function $(t) {
  const e = b();
  return D(t, e, e, 0);
}
P.instance.runtime.exposeApi({
  applyDesign: O,
  applyRepairPatch: N,
  readDocumentState: b,
  replaceImageNode: M,
  verifyAppliedPatch: $
});
