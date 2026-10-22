import { Handle, Position } from '@xyflow/react';
import type { FlowPortData } from '../canvas/projection-to-flow.ts';

export interface NodePortsProps {
  customPorts?: readonly (string | FlowPortData)[];
}

function position(side: FlowPortData['side'] | undefined): Position {
  switch (side) {
    case 'top': return Position.Top;
    case 'bottom': return Position.Bottom;
    case 'left': return Position.Left;
    case 'right': return Position.Right;
    default: return Position.Right;
  }
}

export function NodePorts({ customPorts = [] }: NodePortsProps) {
  return (
    <>
      <Handle type="target" position={Position.Left} id="left" />
      <Handle type="source" position={Position.Right} id="right" />
      <Handle type="target" position={Position.Top} id="top" />
      <Handle type="source" position={Position.Bottom} id="bottom" />
      {customPorts.map((entry) => {
        const port = typeof entry === 'string' ? { id: entry, direction: 'bidirectional' as const, side: 'auto' as const } : entry;
        const side = position(port.side);
        return (
          <span key={port.id}>
            {(port.direction === 'in' || port.direction === 'bidirectional') && <Handle type="target" position={side} id={'port:' + port.id + ':in'} />}
            {(port.direction === 'out' || port.direction === 'bidirectional') && <Handle type="source" position={side} id={'port:' + port.id + ':out'} />}
          </span>
        );
      })}
    </>
  );
}
