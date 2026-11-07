/**
 * CreativeDNA frozen contracts — TypeScript mirror of backend/schemas.py.
 * Keep in sync; do not change silently (see PROJECT_BRIEF §Contracts).
 */

export type BBox = [number, number, number, number];

export type NodeType = "rectangle" | "text" | "image";
export type NodeRole =
  | "background"
  | "decoration"
  | "brand"
  | "headline"
  | "subhead"
  | "product"
  | "cta_background"
  | "cta_text";

export interface Canvas {
  width: number;
  height: number;
}

export interface DesignNode {
  id: string;
  type: NodeType;
  role: NodeRole;
  bbox: BBox;
  fill?: string | null;
  text?: string | null;
  font_size?: number | null;
  color?: string | null;
  asset_id?: string | null;
  expendable?: boolean;
}

export interface DesignSpec {
  design_id: string;
  version: number;
  canvas: Canvas;
  nodes: DesignNode[];
}

export interface DesignIntentGraph {
  design_id: string;
  focal_element: string;
  hierarchy: string[];
  relationships: Array<{
    type: string;
    nodes: string[];
    locks?: string[];
    min_gap_px?: number | null;
    note?: string | null;
  }>;
  provenance: { mode: string; reference_ids: string[]; model?: string | null };
}

export interface NodeLock {
  node_id: string;
  position: boolean;
  size: boolean;
}

export interface RepairConstraints {
  instruction: string;
  changes: Record<string, string>;
  top_reserved_px: number;
  top_zone_exempt_node_ids: string[];
  bottom_reserved_px: number;
  keep_visible: string[];
  locks: NodeLock[];
  min_font_size: Record<string, number>;
  critical_pairs: Array<[string, string]>;
  forbidden_phrases: string[];
  format_target?: { name: string; width: number; height: number } | null;
  translation?: Record<string, string> | null;
  ambiguities: string[];
  unsupported: string[];
}

export type OperationType =
  | "set_text"
  | "set_bbox"
  | "set_font_size"
  | "set_visible"
  | "translate";

export interface Operation {
  op: OperationType;
  node_id: string;
  value: unknown;
}

export type RuleStatus = "pass" | "fail" | "unknown";

export interface RuleResult {
  rule: string;
  status: RuleStatus;
  node_ids: string[];
  method: string;
  detail: string;
}

export interface CandidateValidation {
  passed: number;
  failed: number;
  unknown: number;
  results: RuleResult[];
}

export type Feasibility = "feasible" | "infeasible" | "unverified";

export interface SoftMetrics {
  hierarchy: number;
  grouping: number;
  balance: number;
  displacement: number;
  J: number;
}

export interface CandidateResult {
  candidate_id: string;
  strategy: string;
  generator: "ai_strategies" | "heuristic_zones" | "uniform_scale";
  operations: Operation[];
  validation: CandidateValidation;
  feasibility: Feasibility;
  soft_score: SoftMetrics | null;
  base_version: number;
  resulting_spec: DesignSpec;
  provider_mode: "live" | "cached" | "fixture" | "heuristic";
  rejected_reasons: string[];
}

export interface TelemetryEvent {
  event: string;
  provider_mode: string;
  ai_duration_ms?: number | null;
  geometry_duration_ms?: number | null;
  adobe_apply_duration_ms?: number | null;
  total_duration_ms: number;
  token_usage?: number | null;
  estimated_cost_usd?: number | null;
  cost_basis?: string | null;
  editable_node_count?: number | null;
  hard_pass?: number | null;
  hard_fail?: number | null;
  hard_unknown?: number | null;
}

export interface CandidatesResponse {
  design_id: string;
  base_version: number;
  candidates: CandidateResult[];
  selected: CandidateResult | null;
  telemetry: TelemetryEvent;
  infeasibility_explanation: string | null;
  relaxation_suggestion: RepairConstraints | null;
}

export interface InterpretResponse {
  constraints: RepairConstraints;
  provider_mode: string;
  issues: string[];
}

export interface NodeBinding {
  node_id: string;
  adobe_node_id: string;
  type: NodeType;
  editable: boolean;
}

export interface DocumentState {
  design_id: string;
  version: number;
  canvas: Canvas;
  bindings: NodeBinding[];
  node_count: number;
  unsupported_properties: string[];
}

export interface ObservedNode {
  node_id: string;
  adobe_node_id?: string | null;
  bbox?: BBox | null;
  text?: string | null;
  font_size?: number | null;
  visible?: boolean | null;
  editable?: boolean | null;
  observed: boolean;
}

export interface PostApplyReport {
  design_id: string;
  base_version: number;
  resulting_version: number | null;
  candidate_id: string;
  planned: ObservedNode[];
  observed: ObservedNode[];
  matched: number;
  mismatched: string[];
  unsupported_measurements: string[];
  node_count_before: number;
  node_count_after: number | null;
  editability_retained: boolean | null;
  constraint_violations: string[];
  apply_duration_ms: number;
  recovered: boolean | null;
  status: "verified" | "verified_with_gaps" | "partial_failure" | "failed";
}
