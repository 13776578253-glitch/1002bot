/** Portable report catalog and cumulative stage declarations. */
import type { CanonicalEdge, CanonicalNode } from '../../core/schema/types.ts';

export interface ReportNode extends Omit<CanonicalNode, 'ports'> {
  position?: { x: number; y: number };
}

export interface ReportLink {
  id: string;
  source: string;
  target: string;
  relation: CanonicalEdge['relation'];
  label: string;
  order: number;
  direction?: CanonicalEdge['direction'];
}

export interface ReportReplacement {
  id: string;
  previousId: string;
  note: string;
}

export interface ReportStage {
  id: string;
  label: string;
  title: string;
  subtitle: string;
  date: string;
  source: string;
  status: string;
  /** Catalog keys to upsert; records with the same stable ID replace metadata. */
  nodes: readonly string[];
  links: readonly string[];
  removeNodes?: readonly string[];
  removeLinks?: readonly string[];
  /** Replacement provenance is independent of explicit removals. */
  replacements?: {
    nodes?: readonly ReportReplacement[];
    links?: readonly ReportReplacement[];
  };
}

export interface ReportDataset {
  rootId: string;
  revision: string;
  nodes: Readonly<Record<string, ReportNode>>;
  links: Readonly<Record<string, ReportLink>>;
  stages: readonly ReportStage[];
}
