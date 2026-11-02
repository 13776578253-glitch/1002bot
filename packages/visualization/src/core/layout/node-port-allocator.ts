/** Deterministic physical port slots shared by routing and React Flow handles. */
import { portAnchor, type Point, type PortSide } from './geometry.ts';

export type EndpointRole = 'source' | 'target';
export type PortPriority = 'frozen' | 'locked' | 'pinned' | 'auto';
export type PortMode = 'single' | 'trunk' | 'packed';

export interface SlotRules {
  margin: number;
  minStep: number;
  maxPerSide: number;
  slotCapacity: number;
  trunkCapacity: number;
  handleLayout: string;
}

export const DEFAULT_SLOT_RULES: SlotRules = {
  margin: 16,
  minStep: 24,
  maxPerSide: 6,
  slotCapacity: 2,
  trunkCapacity: 2,
  handleLayout: 'slots-v1',
};

export interface NodePortGeometry {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PhysicalSlot {
  nodeId: string;
  side: PortSide;
  index: number;
  physicalId: string;
  fraction: number;
  capacity: number;
}

export interface PortSlot extends PhysicalSlot {
  role: EndpointRole;
  handleId: string;
}

export interface Occupant {
  edgeId: string;
  role: EndpointRole;
  mode: PortMode;
  trunkId?: string;
}

export interface SlotGrant {
  slot: PortSlot;
  anchor: Point;
  mode: PortMode;
  priority: PortPriority;
  trunkId?: string;
}

export interface PortRequest {
  edgeId: string;
  nodeId: string;
  role: EndpointRole;
  priority: PortPriority;
  preferredSides?: readonly PortSide[];
  requiredSide?: PortSide;
  storedHandle?: string;
  idealFraction?: number;
  trunk?: { id: string };
  allowPacked?: boolean;
  reserveExisting?: boolean;
}

export interface PortFailure {
  edgeId: string;
  nodeId: string;
  reason: 'capacity-exhausted' | 'handle-missing';
  detail: string;
}

export interface PortAllocationSnapshot {
  slots: ReadonlyMap<string, readonly PortSlot[]>;
  grants: ReadonlyMap<string, readonly SlotGrant[]>;
  failures: readonly PortFailure[];
}

export interface NodePortAllocator {
  slots(nodeId: string): readonly PortSlot[];
  begin(): void;
  request(request: PortRequest): SlotGrant | undefined;
  requestMany(requests: readonly PortRequest[]): readonly SlotGrant[];
  release(edgeId: string): void;
  failure(edgeId: string): PortFailure | undefined;
  snapshot(): PortAllocationSnapshot;
  commit(): PortAllocationSnapshot;
  rollback(): void;
  granted(edgeId: string): readonly SlotGrant[];
  reconcile(snapshot: PortAllocationSnapshot, geometry: readonly NodePortGeometry[]): PortAllocationSnapshot;
}

const SIDES: readonly PortSide[] = ['top', 'right', 'bottom', 'left'];
const PRIORITY: Record<PortPriority, number> = { frozen: 0, locked: 1, pinned: 2, auto: 3 };

interface SlotState {
  slot: PhysicalSlot;
  occupants: Occupant[];
}

interface NodeState {
  geometry: NodePortGeometry;
  slots: SlotState[];
  byKey: Map<string, SlotState>;
}

interface AllocatorState {
  nodes: Map<string, NodeState>;
  grants: Map<string, SlotGrant[]>;
  failures: PortFailure[];
}

interface Choice {
  slot: SlotState;
  mode: PortMode;
}

export function slotFractions(length: number, rules: SlotRules = DEFAULT_SLOT_RULES): number[] {
  if (!(length > 0)) return [];
  const margin = Math.min(rules.margin, length / 2);
  const usable = Math.max(0, length - margin * 2);
  const count = Math.max(1, Math.min(rules.maxPerSide, Math.floor(usable / rules.minStep) + 1));
  if (count === 1) return [0.5];
  const first = margin / length;
  const last = 1 - margin / length;
  return Array.from({ length: count }, (_, index) => Number((first + (last - first) * index / (count - 1)).toFixed(6)));
}

export function slotHandleId(side: PortSide, role: EndpointRole, index: number): string {
  return `${side}:${role}:${index}`;
}

export function slotAnchor(geometry: NodePortGeometry, slot: PhysicalSlot): Point {
  return portAnchor({ x: geometry.x, y: geometry.y, w: geometry.width, h: geometry.height }, slot.side, slot.fraction);
}

function sideLength(geometry: NodePortGeometry, side: PortSide): number {
  return side === 'top' || side === 'bottom' ? geometry.width : geometry.height;
}

function parseHandle(handle: string | undefined): { side: PortSide; role: EndpointRole; index: number } | undefined {
  if (!handle) return undefined;
  const [side, role, index] = handle.split(':');
  if (!SIDES.includes(side as PortSide) || (role !== 'source' && role !== 'target') || !/^\d+$/.test(index ?? '')) return undefined;
  return { side: side as PortSide, role, index: Number(index) };
}

function buildNode(geometry: NodePortGeometry, rules: SlotRules): NodeState {
  const slots: SlotState[] = [];
  const byKey = new Map<string, SlotState>();
  for (const side of SIDES) {
    slotFractions(sideLength(geometry, side), rules).forEach((fraction, index) => {
      const slot: PhysicalSlot = { nodeId: geometry.id, side, index, physicalId: `${side}:${index}`, fraction, capacity: Math.max(1, rules.slotCapacity) };
      const value: SlotState = { slot, occupants: [] };
      slots.push(value);
      byKey.set(`${side}:${index}`, value);
    });
  }
  return { geometry, slots, byKey };
}

function buildState(nodes: readonly NodePortGeometry[], rules: SlotRules): AllocatorState {
  return { nodes: new Map(nodes.map((node) => [node.id, buildNode(node, rules)])), grants: new Map(), failures: [] };
}

function cloneState(state: AllocatorState): AllocatorState {
  const nodes = new Map<string, NodeState>();
  for (const [id, node] of state.nodes) {
    const slots = node.slots.map((item) => ({ slot: item.slot, occupants: item.occupants.map((occupant) => ({ ...occupant })) }));
    nodes.set(id, { geometry: node.geometry, slots, byKey: new Map(slots.map((item) => [`${item.slot.side}:${item.slot.index}`, item])) });
  }
  return {
    nodes,
    grants: new Map([...state.grants].map(([id, grants]) => [id, grants.map((item) => ({ ...item }))])),
    failures: state.failures.map((item) => ({ ...item })),
  };
}

function portSlot(item: SlotState, role: EndpointRole): PortSlot {
  return { ...item.slot, role, handleId: slotHandleId(item.slot.side, role, item.slot.index) };
}

function trunkCount(item: SlotState, trunkId: string): number {
  return item.occupants.filter((occupant) => occupant.trunkId === trunkId).length;
}

function sidesFor(request: PortRequest): PortSide[] {
  if (request.requiredSide) return [request.requiredSide];
  const preferred = [...new Set(request.preferredSides ?? [])];
  return [...preferred, ...SIDES.filter((side) => !preferred.includes(side))];
}

function toSnapshot(state: AllocatorState): PortAllocationSnapshot {
  return {
    slots: new Map([...state.nodes].map(([id, node]) => [id, node.slots.flatMap((item) => [portSlot(item, 'source'), portSlot(item, 'target')])])),
    grants: new Map([...state.grants].map(([id, grants]) => [id, grants.map((item) => ({ ...item }))])),
    failures: state.failures.map((item) => ({ ...item })),
  };
}

export function createNodePortAllocator(input: {
  nodes: readonly NodePortGeometry[];
  rules?: Partial<SlotRules>;
  reserved?: readonly PortRequest[];
}): NodePortAllocator {
  const rules: SlotRules = { ...DEFAULT_SLOT_RULES, ...input.rules };
  let state = buildState(input.nodes, rules);
  let staged: AllocatorState | undefined;

  const current = (): AllocatorState => staged ?? state;

  const fail = (request: PortRequest, reason: PortFailure['reason'], detail: string): undefined => {
    current().failures.push({ edgeId: request.edgeId, nodeId: request.nodeId, reason, detail });
    return undefined;
  };

  const choose = (request: PortRequest, mode: 'single' | 'trunk' | 'packed'): Choice | undefined => {
    const node = current().nodes.get(request.nodeId);
    if (!node) return undefined;
    const parsed = parseHandle(request.storedHandle);
    if (parsed && parsed.role === request.role) {
      const stored = node.byKey.get(`${parsed.side}:${parsed.index}`);
      if (stored) {
        const trunkRoom = request.trunk ? trunkCount(stored, request.trunk.id) < Math.min(stored.slot.capacity, Math.max(1, rules.trunkCapacity)) : false;
        if (mode === 'trunk' ? trunkRoom : stored.occupants.length < stored.slot.capacity) return { slot: stored, mode };
        if (request.priority === 'locked' || request.priority === 'frozen') return undefined;
      } else if (request.priority === 'locked' || request.priority === 'frozen') return undefined;
    }
    const ordered = sidesFor(request);
    const sides = parsed ? [parsed.side, ...ordered.filter((side) => side !== parsed.side)] : ordered;
    const candidates = sides.flatMap((side) => node.slots.filter((item) => item.slot.side === side));
    const fits = (item: SlotState): boolean => mode === 'trunk'
      ? Boolean(request.trunk) && trunkCount(item, request.trunk!.id) < Math.min(item.slot.capacity, Math.max(1, rules.trunkCapacity))
      : mode === 'packed' ? item.occupants.length < item.slot.capacity
      : item.occupants.length === 0 || (item.occupants.length < item.slot.capacity && item.occupants.every((occupant) => occupant.role !== request.role));
    const ideal = request.idealFraction ?? 0.5;
    const sideRank = (item: SlotState): number => sides.indexOf(item.slot.side);
    const scored = candidates.filter(fits).sort((a, b) =>
      sideRank(a) - sideRank(b)
      || a.occupants.length - b.occupants.length
      || Math.abs(a.slot.fraction - ideal) - Math.abs(b.slot.fraction - ideal)
      || a.slot.index - b.slot.index);
    return scored[0] ? { slot: scored[0], mode } : undefined;
  };

  const grantChoice = (node: NodeState, chosen: Choice, value: PortRequest): SlotGrant => {
    chosen.slot.occupants.push({ edgeId: value.edgeId, role: value.role, mode: chosen.mode, ...(value.trunk ? { trunkId: value.trunk.id } : {}) });
    const result: SlotGrant = {
      slot: portSlot(chosen.slot, value.role),
      anchor: slotAnchor(node.geometry, chosen.slot.slot),
      mode: chosen.mode,
      priority: value.priority,
      ...(value.trunk ? { trunkId: value.trunk.id } : {}),
    };
    current().grants.set(value.edgeId, [...(current().grants.get(value.edgeId) ?? []), result]);
    return result;
  };

  const request = (value: PortRequest): SlotGrant | undefined => {
    const node = current().nodes.get(value.nodeId);
    if (!node) return fail(value, 'capacity-exhausted', `unknown node ${value.nodeId}`);
    const parsed = parseHandle(value.storedHandle);
    if (parsed && (value.priority === 'locked' || value.priority === 'frozen' || value.reserveExisting)) {
      if (parsed.role !== value.role) return fail(value, 'handle-missing', `slot ${value.storedHandle} belongs to another role`);
      const stored = node.byKey.get(`${parsed.side}:${parsed.index}`);
      if (!stored) return fail(value, 'handle-missing', `slot ${value.storedHandle} is no longer available`);
      if (!value.reserveExisting && stored.occupants.length >= stored.slot.capacity) return fail(value, 'capacity-exhausted', `slot ${value.storedHandle} has no capacity`);
      return grantChoice(node, { slot: stored, mode: 'single' }, value);
    }
    const trunk = value.trunk ? choose(value, 'trunk') : undefined;
    let chosen = trunk;
    if (!chosen && value.trunk) {
      const empty = choose(value, 'single');
      if (empty) chosen = { slot: empty.slot, mode: 'trunk' };
    }
    if (!chosen) chosen = choose(value, 'single') ?? (value.allowPacked ? choose(value, 'packed') : undefined);
    if (!chosen) return fail(value, 'capacity-exhausted', `node ${value.nodeId} has no free ${value.role} slot`);
    return grantChoice(node, chosen, value);
  };

  const allocator: NodePortAllocator = {
    slots(nodeId) {
      const node = current().nodes.get(nodeId);
      return node ? node.slots.flatMap((item) => [portSlot(item, 'source'), portSlot(item, 'target')]) : [];
    },
    begin() {
      if (staged) return;
      staged = cloneState(state);
    },
    request,
    requestMany(requests) {
      return [...requests]
        .sort((a, b) => PRIORITY[a.priority] - PRIORITY[b.priority] || a.edgeId.localeCompare(b.edgeId))
        .flatMap((item) => request(item) ?? []);
    },
    release(edgeId) {
      for (const node of current().nodes.values()) for (const item of node.slots) item.occupants = item.occupants.filter((occupant) => occupant.edgeId !== edgeId);
      current().grants.delete(edgeId);
    },
    failure(edgeId) {
      return current().failures.find((item) => item.edgeId === edgeId);
    },
    snapshot() {
      return toSnapshot(current());
    },
    commit() {
      if (staged) {
        state = staged;
        staged = undefined;
      }
      return toSnapshot(state);
    },
    rollback() {
      staged = undefined;
    },
    granted(edgeId) {
      return current().grants.get(edgeId) ?? [];
    },
    reconcile(snapshot, geometry) {
      const next = createNodePortAllocator({ nodes: geometry, rules });
      next.begin();
      for (const [edgeId, grants] of snapshot.grants) for (const item of grants) {
        if (next.request({ edgeId, nodeId: item.slot.nodeId, role: item.slot.role, priority: item.priority, storedHandle: item.slot.handleId })) continue;
        if (item.priority === 'pinned') next.request({ edgeId, nodeId: item.slot.nodeId, role: item.slot.role, priority: 'pinned', requiredSide: item.slot.side });
      }
      return next.commit();
    },
  };

  if (input.reserved?.length) {
    allocator.begin();
    allocator.requestMany(input.reserved);
    allocator.commit();
  }
  return allocator;
}
