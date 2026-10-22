/**
 * Node Ports Component:
 * Renders stable React Flow handles with explicit IDs on card and aggregate nodes.
 */

import { Handle, Position } from '@xyflow/react';

export interface NodePortsProps {
  customPorts?: readonly string[] | undefined;
}

export function NodePorts({ customPorts = [] }: NodePortsProps) {
  return (
    <>
      {/* Standard directional handles with fixed IDs */}
      <Handle type="target" position={Position.Left} id="left" />
      <Handle type="source" position={Position.Right} id="right" />
      <Handle type="target" position={Position.Top} id="top" />
      <Handle type="source" position={Position.Bottom} id="bottom" />

      {/* Explicit named ports declared by schema */}
      {customPorts.map((port) => (
        <span key={port}>
          <Handle
            type="target"
            position={Position.Left}
            id={port}
            style={{ top: '50%' }}
          />
          <Handle
            type="source"
            position={Position.Right}
            id={port}
            style={{ top: '50%' }}
          />
        </span>
      ))}
    </>
  );
}
