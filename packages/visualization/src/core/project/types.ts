/** Project facts and authored view definitions; working geometry is owned by the workspace. */
import type { CanonicalEdge, CanonicalEndpoint, CanonicalPort, NodeKind, StageMeta } from '../schema/types.ts';

export interface ProjectComponent {
  id: string;
  kind: Exclude<NodeKind, 'root'>;
  label: string;
  summary?: string;
  contractIds: string[];
  sourceRefs: string[];
}

export interface ProjectRelation extends CanonicalEdge {
  contractIds: string[];
  sourceRefs: string[];
}

export interface ProjectContract {
  id: string;
  label: string;
  summary?: string;
  sourceRefs: string[];
}

export interface ProjectSourceStage extends StageMeta {
  id: string;
  previousId?: string;
  label: string;
  title: string;
  upsert: {
    components: ProjectComponent[];
    relations: ProjectRelation[];
    contracts: ProjectContract[];
  };
  remove: { componentIds: string[]; relationIds: string[]; contractIds: string[] };
}

export interface AuthoredFrame { x: number; y: number; width: number; height: number }

export interface ProjectViewNode {
  id: string;
  componentId: string;
  parentId: string;
  order: number;
  label?: string;
  summary?: string;
  frame: AuthoredFrame;
  expandedSize?: { width: number; height: number };
  initiallyExpanded?: boolean;
  ports: CanonicalPort[];
}

export interface ProjectRelationVisibility {
  expanded: string[];
  collapsed: string[];
}

export interface ProjectViewRelation {
  id: string;
  source: CanonicalEndpoint;
  target: CanonicalEndpoint;
  label: string;
  relation: CanonicalEdge['relation'];
  direction: CanonicalEdge['direction'];
  order: number;
  sourceRelationIds: string[];
  /** Detail relations point to the overview relation whose meaning they refine. */
  refines?: string;
  visibility: ProjectRelationVisibility;
}

export interface ProjectViewDefinition {
  id: string;
  stageId: string;
  rootId: string;
  nodes: ProjectViewNode[];
  relations: ProjectViewRelation[];
}

export interface ArchitectureProject {
  version: 1;
  id: string;
  title: string;
  revision: string;
  source: { stages: ProjectSourceStage[] };
  views: ProjectViewDefinition[];
}

/** File references are resolved only by the application loading the project. */
export interface ProjectManifest {
  version: 1;
  id: string;
  title: string;
  revision: string;
  source: { stages: string[] };
  views: string[];
  workspace: string;
}
