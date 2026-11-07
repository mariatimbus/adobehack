import React, { useEffect, useMemo, useState } from "react";
import type {
  CandidateResult,
  CandidatesResponse,
  DesignIntentGraph,
  DesignSpec,
  DocumentState,
  PostApplyReport,
} from "../shared/contracts";
import { candidateCards } from "../shared/svgPreview";
import { applyOperations, diffPlannedObserved } from "../shared/opApplier";
import {
  analyzeStyleReferences,
  backendBase,
  fetchCandidates,
  fetchDemoDesign,
  parseBrandGuidelines,
  type BrandGuidelinesResult,
  type StyleAnalysis,
} from "./api";

type Stage = "load" | "intent" | "constraint" | "compare" | "apply" | "verify";

interface SandboxApi {
  applyDesign: (spec: DesignSpec, heroBlob?: Blob) => Promise<DocumentState>;
  applyRepairPatch: (candidate: CandidateResult) => Promise<PostApplyReport>;
  readDocumentState: () => Promise<DocumentState>;
  replaceImageNode: (nodeId: string, blob: Blob) => Promise<DocumentState>;
  verifyAppliedPatch: (candidate: CandidateResult) => Promise<PostApplyReport>;
}

/**
 * DEV HARNESS ONLY (?harness=1): an in-memory stand-in for the Adobe document
 * sandbox so the panel can be developed/screenshotted outside Adobe Express.
 * It is NOT the Adobe integration — the real bridge is src/sandbox/code.ts.
 */
function makeHarnessSandbox(getSpec: () => DesignSpec | null, setSpec: (s: DesignSpec) => void): SandboxApi {
  const stateOf = (spec: DesignSpec): DocumentState => ({
    design_id: spec.design_id,
    version: spec.version,
    canvas: spec.canvas,
    bindings: spec.nodes.map((n) => ({
      node_id: n.id,
      adobe_node_id: `harness-${n.id}`,
      type: n.type,
      editable: true,
    })),
    node_count: spec.nodes.length,
    unsupported_properties: ["canvas_size", "font_size_readback"],
  });
  return {
    async applyDesign(spec) {
      setSpec(JSON.parse(JSON.stringify(spec)));
      return stateOf(spec);
    },
    async applyRepairPatch(candidate) {
      const t0 = performance.now();
      const current = getSpec();
      if (!current) throw new Error("no design loaded");
      const patched = applyOperations(current, candidate.operations);
      patched.version = candidate.base_version + 1;
      setSpec(patched);
      const planned = candidate.resulting_spec.nodes.map((n) => ({
        node_id: n.id,
        bbox: n.bbox,
        text: n.text ?? null,
        visible: n.bbox[2] > 0 && n.bbox[3] > 0,
      }));
      const observed = patched.nodes.map((n) => ({
        node_id: n.id,
        bbox: n.bbox,
        text: n.text ?? null,
        visible: n.bbox[2] > 0 && n.bbox[3] > 0,
        observed: true,
      }));
      const diffs = diffPlannedObserved(
        planned as Array<{ node_id: string } & Record<string, unknown>>,
        observed as Array<{ node_id: string; observed: boolean } & Record<string, unknown>>
      );
      return {
        design_id: patched.design_id,
        base_version: candidate.base_version,
        resulting_version: patched.version,
        candidate_id: candidate.candidate_id,
        planned: planned.map((p) => ({ ...p, observed: true })),
        observed,
        matched: planned.length - diffs.length,
        mismatched: [...new Set(diffs.map((d) => d.node_id))],
        unsupported_measurements: ["font_size_readback", "canvas_size"],
        node_count_before: current.nodes.length,
        node_count_after: patched.nodes.length,
        editability_retained: true,
        constraint_violations: diffs.map((d) => `${d.node_id}.${d.field}`),
        apply_duration_ms: performance.now() - t0,
        recovered: null,
        status: diffs.length ? "partial_failure" : "verified_with_gaps",
      };
    },
    async readDocumentState() {
      const spec = getSpec();
      if (!spec) throw new Error("no design loaded");
      return stateOf(spec);
    },
    async replaceImageNode(nodeId) {
      const spec = getSpec();
      if (!spec) throw new Error("no design loaded");
      if (!spec.nodes.some((n) => n.id === nodeId)) throw new Error(`node '${nodeId}' not found`);
      const patched = JSON.parse(JSON.stringify(spec));
      const node = patched.nodes.find((n: { id: string }) => n.id === nodeId);
      node.type = "image";
      node.asset_id = "user-uploaded";
      setSpec(patched);
      return stateOf(patched);
    },
    async verifyAppliedPatch(candidate) {
      return this.applyRepairPatch(candidate);
    },
  };
}

const STAGES: Array<{ id: Stage; label: string }> = [
  { id: "load", label: "Load" },
  { id: "intent", label: "Inspect Intent" },
  { id: "constraint", label: "Change Constraints" },
  { id: "compare", label: "Compare Repairs" },
  { id: "apply", label: "Apply" },
  { id: "verify", label: "Verify" },
];

const FLAGSHIP_INSTRUCTION =
  "Use a longer headline, preserve hero size and brand position, reserve a 180px top promo zone";
const FLAGSHIP_HEADLINE = "Hydration that adapts to your skin barrier all day";

export default function App() {
  const [stage, setStage] = useState<Stage>("load");
  const [error, setError] = useState<string | null>(null);
  const [sandbox, setSandbox] = useState<SandboxApi | null>(null);
  const [spec, setSpec] = useState<DesignSpec | null>(null);
  const [intent, setIntent] = useState<DesignIntentGraph | null>(null);
  const [docState, setDocState] = useState<DocumentState | null>(null);
  const [instruction, setInstruction] = useState(FLAGSHIP_INSTRUCTION);
  const [headlineText, setHeadlineText] = useState(FLAGSHIP_HEADLINE);
  const [response, setResponse] = useState<CandidatesResponse | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [report, setReport] = useState<PostApplyReport | null>(null);
  const [busy, setBusy] = useState(false);
  const specRef = React.useRef<DesignSpec | null>(null);

  // bring-your-own state
  const [heroCustom, setHeroCustom] = useState(false);
  const [brandGuide, setBrandGuide] = useState<BrandGuidelinesResult | null>(null);
  const [styleRefs, setStyleRefs] = useState<StyleAnalysis[]>([]);
  const [refSummary, setRefSummary] = useState("");
  const [assetError, setAssetError] = useState<string | null>(null);

  const urlParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const harness = urlParams.get("harness") === "1";

  useEffect(() => {
    if (harness) {
      setSandbox(() =>
        makeHarnessSandbox(
          () => specRef.current,
          (s) => {
            specRef.current = s;
            setSpec(s);
          }
        )
      );
      return;
    }
    (async () => {
      try {
        await window.addOnUISdk!.ready;
        const { runtime } = window.addOnUISdk!.instance;
        const proxy = await runtime.apiProxy<SandboxApi>("documentSandbox");
        setSandbox(() => proxy);
      } catch (e) {
        setError(`Adobe SDK init failed: ${e}. Panel must run inside Adobe Express (or use ?harness=1 for UI development).`);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [harness]);

  const currentTexts = useMemo(() => {
    const out: Record<string, string> = {};
    spec?.nodes.forEach((n) => n.text && (out[n.id] = n.text));
    return out;
  }, [spec]);

  async function loadDesign() {
    setBusy(true);
    setError(null);
    try {
      const demo = await fetchDemoDesign();
      let heroBlob: Blob | undefined;
      try {
        const asset = await fetch("./serum-packshot.png");
        if (asset.ok) heroBlob = await asset.blob();
      } catch {
        heroBlob = undefined; // asset unavailable -> disclosed placeholder path
      }
      const state = await sandbox!.applyDesign(demo.spec as DesignSpec, heroBlob);
      specRef.current = demo.spec as DesignSpec;
      setSpec(demo.spec as DesignSpec);
      setIntent(demo.intent as DesignIntentGraph);
      setDocState(state);
      setStage("intent");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function runCandidates() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetchCandidates(instruction, headlineText || null, currentTexts, {
        forbiddenPhrases: brandGuide?.forbidden_phrases,
        minFontSize: brandGuide?.min_font_size,
        referenceSummary: refSummary || undefined,
      });
      setResponse(res);
      setPicked(res.selected ? res.selected.candidate_id : null);
      setStage("compare");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function applyPicked() {
    const candidate = response?.candidates.find((c) => c.candidate_id === picked);
    if (!candidate || !sandbox) return;
    setBusy(true);
    setError(null);
    try {
      const t0 = performance.now();
      const rep = await sandbox.applyRepairPatch(candidate);
      rep.apply_duration_ms = rep.apply_duration_ms || performance.now() - t0;
      setReport(rep);
      const state = await sandbox.readDocumentState();
      setDocState(state);
      setStage("verify");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onHeroFile(file: File) {
    setAssetError(null);
    try {
      await sandbox!.replaceImageNode("hero", file);
      setHeroCustom(true);
    } catch (e) {
      setAssetError(String(e));
    }
  }

  async function onGuidelinesFile(file: File) {
    setAssetError(null);
    try {
      const text = await file.text();
      setBrandGuide(await parseBrandGuidelines(text, file.name));
    } catch (e) {
      setAssetError(String(e));
    }
  }

  async function onReferenceFiles(files: FileList) {
    setAssetError(null);
    try {
      const res = await analyzeStyleReferences(Array.from(files));
      setStyleRefs(res.analyses);
      setRefSummary(res.summary);
    } catch (e) {
      setAssetError(String(e));
    }
  }

  const stageIndex = STAGES.findIndex((s) => s.id === stage);
  const cards = response ? candidateCards(response.candidates, picked) : [];

  return (
    <div className="app">
      <h1>
        CreativeDNA <span className="mode">AI: fixture mode</span>
      </h1>

      <div className="statebar">
        {STAGES.map((s, i) => (
          <span key={s.id} className={`step ${i === stageIndex ? "active" : i < stageIndex ? "done" : ""}`}>
            {s.label}
          </span>
        ))}
      </div>

      <div className="hint">
        Backend: {backendBase()} · AI provider labels are truthful; geometry + Adobe updates are live.
      </div>

      {error && <div className="banner">{error}</div>}
      {harness && (
        <div className="banner">
          DEV HARNESS — in-memory stand-in for the Adobe sandbox, for UI development outside
          Adobe Express. This is not the Adobe integration.
        </div>
      )}

      {stage === "load" && (
        <section>
          <h2>1 · Load the LUMA SKIN campaign</h2>
          <p className="hint">
            Creates the known 8-node design as native, independently editable Express elements
            (background, decoration, brand, headline, subhead, hero image, CTA pill, CTA text).
          </p>
          <button onClick={loadDesign} disabled={!sandbox || busy}>
            {busy ? "Loading…" : "Load campaign into Express"}
          </button>
          {docState && (
            <p className="telemetry">
              Loaded: {docState.node_count} native nodes · version {docState.version} · unsupported readback:{" "}
              {docState.unsupported_properties.join(", ")}
            </p>
          )}
        </section>
      )}

      {stage === "intent" && intent && spec && (
        <section className="intent">
          <h2>2 · Semantic design intent</h2>
          <p>
            Focal element: <b>{intent.focal_element}</b>
            <span className="badge focal">focal</span>
          </p>
          <ul>
            {intent.relationships.map((r, i) => (
              <li key={i}>
                <b>{r.type}</b>: {r.nodes.join(", ")}
                {r.locks && r.locks.length > 0 && <span className="badge protected">locked: {r.locks.join("+")}</span>}
                {r.type === "expendable" && <span className="badge expendable">expendable</span>}
                {r.min_gap_px != null && <span className="badge">≥{r.min_gap_px}px</span>}
              </li>
            ))}
          </ul>
          <p className="telemetry">provenance: {intent.provenance.mode} — graph drives strategy generation.</p>

          <div className="bringyourown">
            <h2>Bring your own</h2>
            <label className="fileline">
              <span>1 · Your poster / packshot (replaces the hero image node, stays native):</span>
              <input
                type="file"
                accept="image/png,image/jpeg"
                onChange={(e) => e.target.files?.[0] && onHeroFile(e.target.files[0])}
              />
              {heroCustom && <span className="badge focal">hero replaced with your image</span>}
            </label>
            <label className="fileline">
              <span>2 · Brand guidelines (.txt/.md — palette, fonts, locks, forbidden phrases):</span>
              <input
                type="file"
                accept=".txt,.md"
                onChange={(e) => e.target.files?.[0] && onGuidelinesFile(e.target.files[0])}
              />
            </label>
            {brandGuide && (
              <div className="analysis">
                <div>
                  palette:{" "}
                  {brandGuide.palette.map((c) => (
                    <span key={c} className="swatch" style={{ background: c }} title={c} />
                  ))}
                  {brandGuide.palette.length === 0 && <em>none found</em>}
                </div>
                <div>fonts: {brandGuide.fonts.join(", ") || "none found"}</div>
                <div>min font: {JSON.stringify(brandGuide.min_font_size) || "none"}</div>
                <div>locked roles: {brandGuide.locked_roles.join(", ") || "none"}</div>
                <div>forbidden: {brandGuide.forbidden_phrases.join(" | ") || "none"}</div>
                {brandGuide.warnings.map((w, i) => (
                  <div key={i} className="issue">⚠ {w}</div>
                ))}
                <div className="telemetry">{brandGuide.notes[0]} · provenance: {brandGuide.provenance}</div>
              </div>
            )}
            <label className="fileline">
              <span>3 · Inspiration images (e.g. a Pinterest board export, multi-select):</span>
              <input
                type="file"
                accept="image/png,image/jpeg"
                multiple
                onChange={(e) => e.target.files?.length && onReferenceFiles(e.target.files)}
              />
            </label>
            {styleRefs.length > 0 && (
              <div className="analysis">
                {styleRefs.map((a, i) => (
                  <div key={i} className="refrow">
                    ref {i + 1}: {a.orientation} · mood: {a.mood}
                    <div>
                      {a.dominant_colors.map((c) => (
                        <span key={c.hex} className="swatch" style={{ background: c.hex }} title={`${c.hex} ${(c.share * 100).toFixed(0)}%`} />
                      ))}
                    </div>
                  </div>
                ))}
                <div className="telemetry">{refSummary}</div>
                <div className="telemetry">{styleRefs[0].provenance}</div>
              </div>
            )}
            {assetError && <div className="issue blocking">{assetError}</div>}
          </div>

          <button onClick={() => setStage("constraint")}>Enter modification request</button>
        </section>
      )}

      {stage === "constraint" && (
        <section>
          <h2>3 · Compound constraint (natural language)</h2>
          <textarea value={instruction} onChange={(e) => setInstruction(e.target.value)} />
          <div style={{ marginTop: 6 }}>
            <input
              style={{ width: "100%", padding: 6, border: "1px solid #ddd", borderRadius: 6 }}
              value={headlineText}
              onChange={(e) => setHeadlineText(e.target.value)}
              placeholder="Replacement headline copy (the instruction says 'longer' but fixtures need the exact copy)"
            />
          </div>
          <p className="hint">Try: “Adapt this campaign for Instagram Stories, keep the CTA visible”.</p>
          <button onClick={runCandidates} disabled={busy} style={{ marginTop: 6 }}>
            {busy ? "Interpreting + planning…" : "Interpret & generate repair strategies"}
          </button>
        </section>
      )}

      {stage === "compare" && response && (
        <section>
          <h2>4 · Counterfactual repairs (simulated, verified)</h2>
          {response.infeasibility_explanation && (
            <div className="banner">{response.infeasibility_explanation}</div>
          )}
          {response.relaxation_suggestion && (
            <div className="banner">
              Suggested minimal relaxation: top zone {response.relaxation_suggestion.top_reserved_px}px
              {response.relaxation_suggestion.top_zone_exempt_node_ids.length > 0 &&
                ` (exempt: ${response.relaxation_suggestion.top_zone_exempt_node_ids.join(", ")})`}
            </div>
          )}
          <div className="candidates">
            {cards.map((card) => (
              <div
                key={card.candidateId}
                className={`candidate ${card.selected ? "selected" : ""} ${card.feasibility}`}
                onClick={() => card.feasibility === "feasible" && setPicked(card.candidateId)}
              >
                <div className="head">
                  <span className="strategy">
                    {card.candidateId} · {card.strategy.replace(/_/g, " ")}
                  </span>
                  <span className={`feas ${card.feasibility}`}>{card.feasibility}</span>
                </div>
                <div className="svgwrap">
                  <span dangerouslySetInnerHTML={{ __html: card.svg }} />
                  <div className="rules">
                    {card.failures.length === 0 && card.unknowns.length === 0 && (
                      <div className="rule pass">all hard rules pass</div>
                    )}
                    {card.failures.map((f, i) => (
                      <div key={i} className="rule fail">✗ {f}</div>
                    ))}
                    {card.unknowns.map((u, i) => (
                      <div key={i} className="rule unknown">? {u}</div>
                    ))}
                    {card.softJ !== null && (
                      <div className="metrics">
                        J=<b>{card.softJ.toFixed(3)}</b> (hierarchy/grouping/balance/displacement)
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <button onClick={applyPicked} disabled={!picked || busy} style={{ marginTop: 8 }}>
            {busy ? "Applying to native nodes…" : "Apply selected repair in place"}
          </button>
          <p className="telemetry">
            telemetry: {response.telemetry.total_duration_ms}ms · provider: {response.telemetry.provider_mode} ·{" "}
            {response.telemetry.cost_basis}
          </p>
        </section>
      )}

      {stage === "verify" && report && (
        <section className="report">
          <h2>5 · Post-apply verification (from the real document)</h2>
          <table>
            <tbody>
              <tr>
                <td>status</td>
                <td className={report.status === "verified" ? "ok" : report.status === "verified_with_gaps" ? "warn" : "bad"}>
                  {report.status}
                </td>
              </tr>
              <tr><td>candidate</td><td>{report.candidate_id}</td></tr>
              <tr>
                <td>nodes</td>
                <td>{report.node_count_before} → {report.node_count_after} (duplicates: {report.node_count_after !== null && report.node_count_after > report.node_count_before ? "YES" : "none"})</td>
              </tr>
              <tr><td>matched plan</td><td className="ok">{report.matched}/{report.planned.length}</td></tr>
              <tr>
                <td>mismatches</td>
                <td className={report.mismatched.length ? "bad" : "ok"}>{report.mismatched.join(", ") || "none"}</td>
              </tr>
              <tr>
                <td>editability retained</td>
                <td className={report.editability_retained ? "ok" : "bad"}>{String(report.editability_retained)}</td>
              </tr>
              <tr>
                <td>unsupported measurements</td>
                <td className="warn">{report.unsupported_measurements.join(", ")}</td>
              </tr>
              <tr><td>Adobe apply time</td><td>{report.apply_duration_ms.toFixed(1)} ms</td></tr>
              <tr><td>best-effort recovery</td><td>{report.recovered === null ? "not needed" : String(report.recovered)}</td></tr>
            </tbody>
          </table>
          <p className="hint" style={{ marginTop: 6 }}>
            Now click the headline in the canvas and edit it — it stays a native text element.
          </p>
          <button className="secondary" onClick={() => { setStage("constraint"); setResponse(null); setReport(null); }}>
            Run another constraint
          </button>
        </section>
      )}
    </div>
  );
}
