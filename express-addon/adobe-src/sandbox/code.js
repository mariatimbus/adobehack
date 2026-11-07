import S from "add-on-sdk-document-sandbox";
import { editor as p } from "express-document-sdk";
const b = "creativedna.node_id", I = "creativedna.design_id", x = "creativedna.version";
function k(e) {
  const t = e.replace("#", "");
  return {
    red: parseInt(t.slice(0, 2), 16) / 255,
    green: parseInt(t.slice(2, 4), 16) / 255,
    blue: parseInt(t.slice(4, 6), 16) / 255,
    alpha: 1
  };
}
function w() {
  const e = /* @__PURE__ */ new Map(), t = p.context.insertionParent, n = (o) => {
    var d;
    for (const i of o) {
      const s = (d = i.addOnData) == null ? void 0 : d.getItem(b);
      if (s) {
        const l = i.addOnData.getItem("creativedna.kind") ?? "rectangle";
        e.set(s, { node: i, kind: l });
      }
      const c = i.children;
      c && n(c);
    }
  };
  return n(t.children), e;
}
function y(e, t) {
  e.addOnData.setItem("creativedna.kind", t);
}
function v() {
  return p.context.insertionParent;
}
async function O(e, t) {
  const n = p.context.insertionParent, o = w();
  if (o.size >= e.nodes.length && [...o.keys()].every((i) => e.nodes.some((s) => s.id === i)))
    return m();
  for (const i of e.nodes) {
    if (o.has(i.id)) continue;
    const [s, c, l, u] = i.bbox;
    if (i.type === "rectangle") {
      const a = p.createRectangle();
      a.width = l, a.height = u, i.fill && (a.fill = p.makeColorFill(k(i.fill))), n.children.append(a), a.setPositionInParent({ x: s, y: c }, { x: 0, y: 0 }), a.addOnData.setItem(b, i.id), y(a, "rectangle");
    } else if (i.type === "text") {
      const a = p.createText(i.text ?? "");
      a.layout = { type: 2, width: l }, i.font_size && a.fullContent.applyCharacterStyles({ fontSize: i.font_size }), i.color && a.fullContent.applyCharacterStyles({ color: k(i.color) }), n.children.append(a), a.setPositionInParent({ x: s, y: c }, { x: 0, y: 0 }), a.addOnData.setItem(b, i.id), y(a, "text");
    } else if (i.type === "image")
      if (t) {
        const a = await p.loadBitmapImage(t), h = p.createImageContainer(a, {
          initialSize: { width: l, height: u }
        });
        n.children.append(h), h.setPositionInParent({ x: s, y: c }, { x: 0, y: 0 }), h.addOnData.setItem(b, i.id), y(h, "image");
      } else {
        const a = p.createRectangle();
        a.width = l, a.height = u, a.fill = p.makeColorFill(k("#dfe7dd")), n.children.append(a), a.setPositionInParent({ x: s, y: c }, { x: 0, y: 0 }), a.addOnData.setItem(b, i.id), y(a, "image_placeholder");
      }
  }
  const d = v();
  return d.addOnData.setItem(I, e.design_id), d.addOnData.setItem(x, String(e.version)), m();
}
function P(e) {
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
function C(e, t) {
  t.translation && (e.node.translation = t.translation), typeof t.opacity == "number" && (e.node.opacity = t.opacity), e.kind === "text" && typeof t.text == "string" && (e.node.fullContent.text = t.text);
  const n = e.node;
  typeof t.width == "number" && typeof n.width == "number" && (n.width = t.width), typeof t.height == "number" && typeof n.height == "number" && (n.height = t.height);
}
function z(e, t) {
  switch (t.op) {
    case "set_text":
      e.node.fullContent.text = String(t.value);
      break;
    case "set_bbox": {
      const [n, o, d, i] = t.value, s = e.node;
      typeof s.width == "number" && (s.width = d), typeof s.height == "number" && (s.height = i), e.node.translation = { x: n, y: o };
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
async function N(e) {
  const t = Date.now(), n = w(), o = m(), d = Number(v().addOnData.getItem(x) ?? o.version);
  if (e.base_version !== d)
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
  const i = /* @__PURE__ */ new Map(), s = [], c = [];
  for (const r of e.operations) {
    const f = n.get(r.node_id);
    if (!f) {
      c.push(r.node_id);
      continue;
    }
    i.has(r.node_id) || i.set(r.node_id, P(f)), s.push({ t: f, op: r });
  }
  let l = null;
  try {
    for (const { t: r, op: f } of s) z(r, f);
  } catch (r) {
    l = String(r);
  }
  let u = null;
  if (l) {
    u = !0;
    for (const [r, f] of i) {
      const g = n.get(r);
      if (g)
        try {
          C(g, f);
        } catch {
          u = !1;
        }
    }
  }
  const a = m(), h = D(e, o, a, Date.now() - t);
  return l && (h.status = u ? "partial_failure" : "failed", h.constraint_violations.push(`op failed: ${l}`)), h.recovered = l ? u : null, l || (v().addOnData.setItem(x, String(e.base_version + 1)), h.resulting_version = e.base_version + 1), h;
}
function m() {
  const e = w(), t = [];
  for (const [o, d] of e)
    t.push({
      node_id: o,
      adobe_node_id: d.node.id ?? "unreadable",
      type: d.kind === "text" ? "text" : d.kind === "image" || d.kind === "image_placeholder" ? "image" : "rectangle",
      editable: !0
      // native nodes remain independently editable
    });
  const n = v();
  return {
    design_id: n.addOnData.getItem(I) ?? "unknown",
    version: Number(n.addOnData.getItem(x) ?? 0),
    canvas: { width: 0, height: 0 },
    // artboard size readback unsupported in current SDK typings
    bindings: t,
    node_count: t.length,
    unsupported_properties: ["canvas_size", "font_size_readback"]
  };
}
function $(e) {
  return e.resulting_spec.nodes.map((t) => ({
    node_id: t.id,
    bbox: t.bbox,
    text: t.text ?? null,
    visible: t.bbox[2] > 0 && t.bbox[3] > 0,
    observed: !0
  }));
}
function E() {
  const e = w(), t = [];
  for (const [n, o] of e) {
    let d = null;
    if (o.kind === "text")
      try {
        d = o.node.fullContent.text;
      } catch {
        d = null;
      }
    const i = o.node.boundsInParent;
    t.push({
      node_id: n,
      adobe_node_id: o.node.id ?? null,
      bbox: [i.x, i.y, i.width, i.height],
      text: d,
      visible: o.node.opacity > 0,
      editable: !0,
      observed: !0
    });
  }
  return t;
}
function D(e, t, n, o) {
  const d = $(e), i = E(), s = 2, c = [];
  let l = 0;
  for (const r of d) {
    const f = i.find((_) => _.node_id === r.node_id);
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
  const u = ["font_size_readback", "canvas_size"], a = n.bindings.length >= t.bindings.length && n.bindings.every((r) => r.editable);
  let h = "verified";
  return u.length > 0 && (h = "verified_with_gaps"), c.length > 0 && (h = "partial_failure"), l === 0 && (h = "failed"), {
    design_id: n.design_id,
    base_version: e.base_version,
    resulting_version: n.version,
    candidate_id: e.candidate_id,
    planned: d,
    observed: i,
    matched: l,
    mismatched: c,
    unsupported_measurements: u,
    node_count_before: t.node_count,
    node_count_after: n.node_count,
    editability_retained: a,
    constraint_violations: c.map((r) => `mismatch: ${r}`),
    apply_duration_ms: o,
    recovered: null,
    status: h
  };
}
async function M(e, t) {
  const o = w().get(e);
  if (!o) throw new Error(`node '${e}' not found in document`);
  if (o.kind === "image_placeholder" && (o.kind = "image"), o.kind !== "image" && o.kind !== "rectangle")
    throw new Error(`node '${e}' is not replaceable with an image (kind=${o.kind})`);
  const d = o.node, i = typeof d.width == "number" ? d.width : 420, s = typeof d.height == "number" ? d.height : 620, c = { ...o.node.translation }, l = await p.loadBitmapImage(t), u = p.createImageContainer(l, {
    initialSize: { width: i, height: s }
  });
  p.context.insertionParent.children.append(u), u.setPositionInParent(c, { x: 0, y: 0 }), u.addOnData.setItem(b, e), y(u, "image");
  const a = o.node;
  return typeof a.removeFromParent == "function" && a.removeFromParent(), m();
}
function R(e) {
  if (!e) return null;
  const t = (n) => Math.round(Math.max(0, Math.min(1, n)) * 255).toString(16).padStart(2, "0");
  return `#${t(e.red)}${t(e.green)}${t(e.blue)}`;
}
function K(e) {
  const t = e;
  return t.fullContent !== void 0 ? "text" : t.mediaRectangle !== void 0 ? "image" : "rectangle";
}
async function T() {
  var i;
  const e = p.context.insertionParent, t = [];
  let n = 0;
  for (const s of e.children) {
    n += 1;
    let c = s.addOnData.getItem(b);
    c || (c = `node_${n}`, s.addOnData.setItem(b, c));
    const l = K(s);
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
        const f = s.fullContent, g = ((i = f.getCharacterStyles) == null ? void 0 : i.call(f)) ?? [];
        h = g.length && g[0].fontSize ? g[0].fontSize : null;
      } catch {
        h = null;
      }
    }
    let r = null;
    try {
      const f = s.fill;
      r = R(f == null ? void 0 : f.color);
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
  const o = {
    design_id: `imported-${Date.now()}`,
    version: 1,
    canvas: { width: e.width ?? 1080, height: e.height ?? 1080 },
    nodes: t
  }, d = v();
  return d.addOnData.setItem(I, o.design_id), d.addOnData.setItem(x, String(o.version)), { state: m(), spec: o };
}
async function A(e) {
  const t = m();
  return D(e, t, t, 0);
}
S.instance.runtime.exposeApi({
  applyDesign: O,
  applyRepairPatch: N,
  importCurrentDesign: T,
  readDocumentState: m,
  replaceImageNode: M,
  verifyAppliedPatch: A
});
