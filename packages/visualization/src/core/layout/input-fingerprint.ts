/** Canonical routing inputs; automatic solutions are intentionally absent. */
import type { Point, Rect } from './geometry.ts';
import type { SlotRules } from './node-port-allocator.ts';

export interface FingerprintEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  direction: string;
  relation: string;
}

export interface FingerprintNode {
  id: string;
  parentId: string | null;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  visible: boolean;
  expanded: boolean;
}

export interface FingerprintLabel {
  edgeId: string;
  text: string;
  width: number;
  height: number;
}

export interface ProtectedRoute {
  edgeId: string;
  points: readonly Point[];
  handles: readonly [string, string];
}

export interface FingerprintProtected {
  locked: readonly ProtectedRoute[];
  pinned: readonly ProtectedRoute[];
  frozen: readonly { groupId: string; frame: Rect; boundaries: readonly unknown[] }[];
  barriers: readonly { edgeId: string; rect: Rect }[];
}

export interface FingerprintParts {
  algorithm: { name: string; version: number };
  policy: unknown;
  topology: readonly FingerprintEdge[];
  geometry: readonly FingerprintNode[];
  portRules: SlotRules;
  labels: readonly FingerprintLabel[];
  protected: FingerprintProtected;
}

export interface NeighborToken {
  nodeId: string;
  slotAllocation: string;
  labelOccupancy: string;
  protectedSignature: string;
}

export interface GroupFingerprintParts {
  base: FingerprintParts;
  group: { id: string; ownerNodeId: string; edges: readonly string[] };
  neighbors: readonly NeighborToken[];
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => canonical(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, canonical((value as Record<string, unknown>)[key])]));
  }
  return value;
}

function hash(text: string): string {
  let value = 0xcbf29ce484222325n;
  for (let index = 0; index < text.length; index += 1) {
    value ^= BigInt(text.charCodeAt(index));
    value = BigInt.asUintN(64, value * 0x100000001b3n);
  }
  return value.toString(16).padStart(16, '0');
}

function parts(parts: FingerprintParts): unknown {
  return {
    algorithm: parts.algorithm,
    policy: parts.policy,
    topology: [...parts.topology].sort((a, b) => a.id.localeCompare(b.id)),
    geometry: [...parts.geometry].sort((a, b) => a.id.localeCompare(b.id)),
    portRules: parts.portRules,
    labels: [...parts.labels].sort((a, b) => a.edgeId.localeCompare(b.edgeId)),
    protected: {
      locked: [...parts.protected.locked].sort((a, b) => a.edgeId.localeCompare(b.edgeId)),
      pinned: [...parts.protected.pinned].sort((a, b) => a.edgeId.localeCompare(b.edgeId)),
      frozen: [...parts.protected.frozen].sort((a, b) => a.groupId.localeCompare(b.groupId)),
      barriers: [...parts.protected.barriers].sort((a, b) => a.edgeId.localeCompare(b.edgeId)),
    },
  };
}

export function buildInputFingerprint(value: FingerprintParts): string {
  return `f${value.algorithm.version}:${hash(JSON.stringify(canonical(parts(value))))}`;
}

export function buildGroupFingerprint(value: GroupFingerprintParts): string {
  return `g${value.base.algorithm.version}:${hash(JSON.stringify(canonical({
    base: parts(value.base),
    group: value.group,
    neighbors: [...value.neighbors].sort((a, b) => a.nodeId.localeCompare(b.nodeId)),
  })))}`;
}
