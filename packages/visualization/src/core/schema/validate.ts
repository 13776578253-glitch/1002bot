/**
 * Structural validation for the canonical graph schema.
 *
 * This module checks object shape and local field contracts. Graph identity,
 * parent cycles and endpoint semantics belong to core/graph/validate.ts.
 */

import type { CanonicalGraph, CanonicalNode, StageSnapshot } from './types.ts';

export interface ValidationIssue {
  message: string;
  path?: string;
}

const NODE_KINDS = new Set(['root', 'group', 'component', 'actor', 'store', 'adapter', 'planned']);
const PORT_DIRECTIONS = new Set(['in', 'out', 'bidirectional']);
const PORT_SIDES = new Set(['top', 'right', 'bottom', 'left', 'auto']);
const RELATIONS = new Set(['data', 'control', 'call', 'event', 'storage', 'unknown']);
const DIRECTIONS = new Set(['directed', 'bidirectional']);

function requiredString(value: unknown, field: string, path: string, issues: ValidationIssue[]): void {
  if (typeof value !== 'string' || value.length === 0) issues.push({ message: field + ' must be a non-empty string', path });
}

function checkNodeShape(node: CanonicalNode, index: number, issues: ValidationIssue[]): void {
  const path = 'graph.nodes[' + index + ']';
  requiredString(node.id, 'node id', path, issues);
  requiredString(node.label, 'node label', path, issues);
  if (node.parentId !== null && typeof node.parentId !== 'string') issues.push({ message: 'node parentId must be string or null', path });
  if (!NODE_KINDS.has(node.kind)) issues.push({ message: 'unknown node kind "' + String(node.kind) + '"', path });
  if (!Number.isFinite(node.order)) issues.push({ message: 'node order must be finite', path });
  if (node.details !== undefined && (!Array.isArray(node.details) || node.details.some((value) => typeof value !== 'string'))) {
    issues.push({ message: 'node details must be an array of strings', path });
  }
  if (!Array.isArray(node.ports)) {
    issues.push({ message: 'node ports must be an array', path });
    return;
  }
  for (const [portIndex, port] of node.ports.entries()) {
    const portPath = path + '.ports[' + portIndex + ']';
    requiredString(port.id, 'port id', portPath, issues);
    if (!PORT_DIRECTIONS.has(port.direction)) issues.push({ message: 'unknown port direction "' + String(port.direction) + '"', path: portPath });
    if (!PORT_SIDES.has(port.side)) issues.push({ message: 'unknown port side "' + String(port.side) + '"', path: portPath });
    if (!Number.isFinite(port.order)) issues.push({ message: 'port order must be finite', path: portPath });
    if (port.label !== undefined && typeof port.label !== 'string') issues.push({ message: 'port label must be a string', path: portPath });
    if (port.role !== undefined && typeof port.role !== 'string') issues.push({ message: 'port role must be a string', path: portPath });
  }
}

function checkGraphShape(graph: CanonicalGraph, issues: ValidationIssue[]): void {
  requiredString(graph.rootId, 'graph rootId', 'graph', issues);
  if (!Array.isArray(graph.nodes)) {
    issues.push({ message: 'graph nodes must be an array', path: 'graph' });
  } else {
    graph.nodes.forEach((node, index) => checkNodeShape(node, index, issues));
  }
  if (!Array.isArray(graph.edges)) {
    issues.push({ message: 'graph edges must be an array', path: 'graph' });
  } else {
    for (const [index, edge] of graph.edges.entries()) {
      const path = 'graph.edges[' + index + ']';
      requiredString(edge.id, 'edge id', path, issues);
      if (!edge.source || typeof edge.source.nodeId !== 'string') issues.push({ message: 'edge source must reference a node id', path });
      if (!edge.target || typeof edge.target.nodeId !== 'string') issues.push({ message: 'edge target must reference a node id', path });
      if (!RELATIONS.has(edge.relation)) issues.push({ message: 'unknown edge relation "' + String(edge.relation) + '"', path });
      if (!DIRECTIONS.has(edge.direction)) issues.push({ message: 'unknown edge direction "' + String(edge.direction) + '"', path });
      if (!Number.isFinite(edge.order)) issues.push({ message: 'edge order must be finite', path });
      if (edge.label !== undefined && typeof edge.label !== 'string') issues.push({ message: 'edge label must be a string', path });
    }
  }
  if (graph.revision !== undefined) requiredString(graph.revision, 'graph revision', 'graph', issues);
}

/** 校验阶段快照的基础类型与字段形状，返回非致命的结构问题列表。 */
export function validateSnapshot(snapshot: StageSnapshot): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  requiredString(snapshot.id, 'stage id', 'stage', issues);
  requiredString(snapshot.label, 'stage label', 'stage', issues);
  requiredString(snapshot.title, 'stage title', 'stage', issues);
  requiredString(snapshot.track, 'stage track', 'stage', issues);
  if (!Number.isFinite(snapshot.order)) issues.push({ message: 'stage order must be finite', path: 'stage' });
  if (!snapshot.graph || typeof snapshot.graph !== 'object') issues.push({ message: 'stage graph is required', path: 'stage' });
  else checkGraphShape(snapshot.graph, issues);
  return issues;
}

/** 断言阶段快照结构合法；遇到缺失字段或非法类型直接抛出格式化异常。 */
export function assertValidSnapshot(snapshot: StageSnapshot): void {
  const issues = validateSnapshot(snapshot);
  if (issues.length) {
    const detail = issues.map((issue) => (issue.path ? issue.path + ': ' + issue.message : issue.message)).join('\n');
    throw new Error('invalid snapshot "' + snapshot.id + '":\n' + detail);
  }
}
