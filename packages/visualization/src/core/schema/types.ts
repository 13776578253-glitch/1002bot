/**
 * Core schema for architecture evolution snapshots.
 * A node is what it is; how it looks on canvas is decided by the render layer.
 */

/** Stable identity across stages. Paths may change (moved/split); keys do not. */
export type NodeKey = string;

/** Slash-separated position inside one stage snapshot, e.g. "system/runtime/admission". */
export type NodePath = string;

export interface GraphPort {
  /** Local id within the owning node. */
  id: string;
  label?: string;
}

export interface GraphNode {
  /** Stable identity across stages. */
  key: NodeKey;
  /** Short duty name shown on the card. */
  title: string;
  /** One-line description. */
  desc?: string;
  /** Longer contract facts, shown in the detail panel. */
  details?: string[];
  /** Interface endpoints edges can bind to. Omit to use the node surface. */
  ports?: GraphPort[];
  /** Nested children; presence makes this node an aggregate. */
  children?: GraphNode[];
  /** Source evidence: repo file or stage report. */
  source?: string;
  /** Introduced at this stage label, e.g. "M3.0". */
  intro?: string;
  /** Marks a design goal that is not implemented yet. */
  planned?: boolean;
}

export interface GraphEdge {
  /** Endpoint: node path, optionally with a port ("path#port"). */
  from: string;
  to: string;
  label?: string;
  /** Renders arrowheads on both ends. */
  twoWay?: boolean;
}

export interface StageSnapshot {
  /** Stage id within its track, e.g. "m3", "qq41". */
  id: string;
  /** Display label, e.g. "M3.0". */
  label: string;
  /** Track this stage belongs to. */
  track: 'main' | 'qq' | 'tui' | (string & {});
  /** Ordering position for navigation. */
  order: number;
  title: string;
  subtitle?: string;
  date?: string;
  scope?: string;
  status?: string;
  changes?: string[];
  verified?: string;
  /** Stage report path. */
  doc?: string;
  /** Root node of the complete snapshot. */
  root: GraphNode;
  /** Edges between internal node paths; resolved at build time. */
  edges?: GraphEdge[];
}

export type EvolutionKind =
  | 'added'
  | 'modified'
  | 'moved'
  | 'split'
  | 'merged'
  | 'removed'
  | 'rewired';

interface EvolutionBase {
  kind: EvolutionKind;
  /** Optional human note shown in the delta panel. */
  note?: string;
}

export interface AddedEvent extends EvolutionBase {
  kind: 'added';
  keys: NodeKey[];
}

export interface ModifiedEvent extends EvolutionBase {
  kind: 'modified';
  keys: NodeKey[];
}

export interface MovedEvent extends EvolutionBase {
  kind: 'moved';
  /** Node keeps its key; its parent path changed. */
  key: NodeKey;
}

export interface SplitEvent extends EvolutionBase {
  kind: 'split';
  /** The source key disappears or becomes an aggregate of `into`. */
  from: NodeKey;
  into: NodeKey[];
}

export interface MergedEvent extends EvolutionBase {
  kind: 'merged';
  from: NodeKey[];
  into: NodeKey;
}

export interface RemovedEvent extends EvolutionBase {
  kind: 'removed';
  keys: NodeKey[];
}

export interface RewiredEvent extends EvolutionBase {
  kind: 'rewired';
  /** Old connection, identified by endpoint keys. */
  from: { from: NodeKey; to: NodeKey };
  to: { from: NodeKey; to: NodeKey };
}

export type EvolutionEvent =
  | AddedEvent
  | ModifiedEvent
  | MovedEvent
  | SplitEvent
  | MergedEvent
  | RemovedEvent
  | RewiredEvent;

/** A transition between two adjacent snapshots on one track. */
export interface EvolutionStep {
  /** Id of the stage these events lead into. */
  stage: string;
  events: EvolutionEvent[];
}

/** A full track: ordered snapshots plus the transitions between them. */
export interface TrackSeries {
  track: string;
  name: string;
  stages: StageSnapshot[];
  /** events[i] describes the transition from stages[i] to stages[i+1]. */
  events?: EvolutionStep[];
}
