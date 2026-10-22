/**
 * Structural validation for snapshots. Runs at build time; failures
 * point at the node path or edge that breaks the contract.
 */

import type { GraphEdge, GraphNode, StageSnapshot, TrackSeries } from './types.ts';

export interface ValidationIssue {
  message: string;
  path?: string;
}

function walk(
  node: GraphNode,
  path: string,
  issues: ValidationIssue[],
  keys: Map<string, string>,
  nodes: Map<string, GraphNode>,
): void {
  const existing = keys.get(node.key);
  if (existing !== undefined) {
    issues.push({ message: `duplicate key "${node.key}" (also at ${existing})`, path });
  }
  keys.set(node.key, path);
  nodes.set(path, node);
  if (!node.title) issues.push({ message: 'node missing title', path });
  const portIds = new Set<string>();
  for (const port of node.ports ?? []) {
    if (portIds.has(port.id)) issues.push({ message: `duplicate port "${port.id}"`, path });
    portIds.add(port.id);
  }
  for (const child of node.children ?? []) walk(child, `${path}/${child.key}`, issues, keys, nodes);
}

function checkEdge(edge: GraphEdge, index: number, nodes: Map<string, GraphNode>, issues: ValidationIssue[]): void {
  for (const [end, value] of [['from', edge.from], ['to', edge.to]] as const) {
    const nodePath = value.split('#')[0] ?? '';
    const node = nodes.get(nodePath);
    if (!node) {
      issues.push({ message: `edge[${index}].${end} references unknown node "${nodePath}"` });
      continue;
    }
    const hash = value.indexOf('#');
    if (hash >= 0) {
      const port = value.slice(hash + 1);
      if (!port || !(node.ports ?? []).some((candidate) => candidate.id === port)) {
        issues.push({ message: `edge[${index}].${end} references unknown port "${port}"`, path: nodePath });
      }
    }
  }
}

export function validateSnapshot(snapshot: StageSnapshot): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const keys = new Map<string, string>();
  const nodes = new Map<string, GraphNode>();
  walk(snapshot.root, snapshot.root.key, issues, keys, nodes);
  (snapshot.edges ?? []).forEach((edge, i) => checkEdge(edge, i, nodes, issues));
  return issues;
}

export function assertValidSnapshot(snapshot: StageSnapshot): void {
  const issues = validateSnapshot(snapshot);
  if (issues.length) {
    const detail = issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join('\n');
    throw new Error(`invalid snapshot "${snapshot.id}":\n${detail}`);
  }
}

export function validateTrackSeries(series: TrackSeries): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const stageIds = new Set<string>();
  for (const [index, stage] of series.stages.entries()) {
    const path = `stages[${index}]`;
    if (stageIds.has(stage.id)) issues.push({ message: `duplicate stage id "${stage.id}"`, path });
    stageIds.add(stage.id);
    if (!Number.isFinite(stage.order)) issues.push({ message: 'stage order must be finite', path });
    if (stage.track !== series.track) {
      issues.push({ message: `stage track "${stage.track}" does not match series "${series.track}"`, path });
    }
    for (const issue of validateSnapshot(stage)) {
      issues.push({ message: issue.message, path: issue.path ? `${path}.${issue.path}` : path });
    }
  }
  for (const [index, step] of (series.events ?? []).entries()) {
    const path = `events[${index}]`;
    if (!stageIds.has(step.stage)) issues.push({ message: `event step references unknown stage "${step.stage}"`, path });
  }
  return issues;
}

export function assertValidTrackSeries(series: TrackSeries): void {
  const issues = validateTrackSeries(series);
  if (issues.length) {
    const detail = issues.map((issue) => (issue.path ? `${issue.path}: ${issue.message}` : issue.message)).join('\n');
    throw new Error(`invalid track series "${series.track}":\n${detail}`);
  }
}
