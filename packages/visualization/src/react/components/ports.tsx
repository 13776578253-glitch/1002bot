/** Standard directional handles plus physical slot handles for group routing. */
import { Handle, Position } from '@xyflow/react';
import { DEFAULT_SLOT_RULES, slotFractions, slotHandleId } from '../../core/layout/node-port-allocator.ts';
import type { PortSide } from '../../core/layout/geometry.ts';

const SIDE_POSITION: Record<PortSide, Position> = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left,
  auto: Position.Right,
};

function slotStyle(side: PortSide, fraction: number) {
  const percent = `${fraction * 100}%`;
  if (side === 'top' || side === 'bottom') {
    return { left: percent, right: 'auto', top: side === 'top' ? 0 : '100%', bottom: 'auto', transform: 'translate(-50%, -50%)' };
  }
  return { top: percent, bottom: 'auto', left: side === 'left' ? 0 : '100%', right: 'auto', transform: 'translate(-50%, -50%)' };
}

function slotLength(width: number, height: number, side: PortSide): number {
  return side === 'top' || side === 'bottom' ? width : height;
}

/** 节点连接桩；提供上下左右四侧的正交出入连接手柄。 */
export function Ports({ width = 0, height = 0 }: { width?: number; height?: number }) {
  const slots = width > 0 && height > 0
    ? (['top', 'right', 'bottom', 'left'] as const).flatMap((side) =>
      slotFractions(slotLength(width, height, side), DEFAULT_SLOT_RULES).flatMap((fraction, index) =>
        (['source', 'target'] as const).map((role) => (
          <Handle
            key={slotHandleId(side, role, index)}
            type={role}
            position={SIDE_POSITION[side]}
            id={slotHandleId(side, role, index)}
            style={slotStyle(side, fraction)}
          />
        )),
      ))
    : null;
  return <>
    <Handle type="target" position={Position.Top} id="in" />
    <Handle type="target" position={Position.Right} id="return" />
    <Handle type="target" position={Position.Left} id="left-in" />
    <Handle type="target" position={Position.Bottom} id="bottom-in" />
    <Handle type="source" position={Position.Bottom} id="out" />
    <Handle type="source" position={Position.Right} id="return-out" />
    <Handle type="source" position={Position.Top} id="top-out" />
    <Handle type="source" position={Position.Left} id="left-out" />
    {slots}
  </>;
}
