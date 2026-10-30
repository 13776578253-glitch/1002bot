import type { StageSnapshot } from './types.ts';
import { assertValidSnapshot } from './validate.ts';

export type ChangeKind = 'baseline' | 'added' | 'inherited' | 'replaced';

export interface ChangeMark {
  kind: ChangeKind;
  label: string;
  note?: string;
}

/** One complete architecture version with explicit presentation changes and optional initial coordinates. */
export interface VisualizationBaseline {
  id: string;
  stage: StageSnapshot;
  positions?: Readonly<Record<string, { x: number; y: number }>>;
  nodeChanges: Readonly<Record<string, ChangeMark>>;
  edgeChanges: Readonly<Record<string, ChangeMark>>;
}

/** Validate a complete baseline set at the data-source boundary. */
export function assertValidBaselines(baselines: readonly VisualizationBaseline[]): void {
  if (!baselines.length) throw new Error('At least one visualization baseline is required');
  const ids = new Set<string>();
  const kinds = new Set<ChangeKind>(['baseline', 'added', 'inherited', 'replaced']);
  for (const baseline of baselines) {
    if (!baseline.id.trim() || ids.has(baseline.id)) throw new Error(`Duplicate or empty baseline id: ${baseline.id}`);
    ids.add(baseline.id);
    assertValidSnapshot(baseline.stage);
    const graph = baseline.stage.graph;
    for (const [entities, changes] of [
      [graph.nodes.filter((node) => node.id !== graph.rootId), baseline.nodeChanges],
      [graph.edges, baseline.edgeChanges],
    ] as const) {
      for (const entity of entities) {
        const change = changes[entity.id];
        if (!change || !kinds.has(change.kind) || !change.label.trim()) throw new Error(`Missing or invalid change mark: ${baseline.id}/${entity.id}`);
      }
    }
    for (const [id, position] of Object.entries(baseline.positions ?? {})) {
      if (!graph.nodes.some((node) => node.id === id) || !Number.isFinite(position.x) || !Number.isFinite(position.y)) throw new Error(`Invalid initial position: ${baseline.id}/${id}`);
    }
  }
}
