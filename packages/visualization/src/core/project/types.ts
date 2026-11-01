/** Project facts and authored view definitions; working geometry is owned by the workspace. */
import type { CanonicalEdge, CanonicalEndpoint, CanonicalPort, NodeKind, StageMeta } from '../schema/types.ts';
import type { PortPolicy } from '../layout/port-policy.ts';

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
  portPolicy?: PortPolicy;
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
  version: 2;
  id: string;
  title: string;
  revision: string;
  source: string[];
  stages: string[];
  views: string[];
  workspace?: string;
}

export interface ProjectRegistry {
  version: 1;
  defaultProjectId: string;
  projects: ProjectEntry[];
}

export interface ProjectEntry {
  id: string;
  title: string;
  manifest: string;
}

/** Cumulative entity facts; stage files select ids from this catalog. */
export interface ProjectSourceCatalog {
  version: 1;
  projectId: string;
  components: ProjectComponent[];
  relations: ProjectRelation[];
  contracts: ProjectContract[];
}

export interface ProjectStageSelection {
  version: 1;
  id: string;
  label: string;
  title: string;
  subtitle?: string;
  date?: string;
  status?: string;
  doc?: string;
  previousId?: string;
  select: {
    componentIds: string[];
    relationIds: string[];
    contractIds: string[];
  };
  remove: {
    componentIds: string[];
    relationIds: string[];
    contractIds: string[];
  };
}
