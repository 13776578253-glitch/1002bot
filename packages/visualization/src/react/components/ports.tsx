import { Handle, Position } from '@xyflow/react';

export function Ports() {
  return <>
    <Handle type="target" position={Position.Top} id="in" />
    <Handle type="target" position={Position.Right} id="return" />
    <Handle type="target" position={Position.Left} id="left-in" />
    <Handle type="target" position={Position.Bottom} id="bottom-in" />
    <Handle type="source" position={Position.Bottom} id="out" />
    <Handle type="source" position={Position.Right} id="return-out" />
    <Handle type="source" position={Position.Top} id="top-out" />
    <Handle type="source" position={Position.Left} id="left-out" />
  </>;
}
