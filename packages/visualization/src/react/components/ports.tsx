/** Standard directional handles for top, bottom, left and right node edges. */
import { Handle, Position } from '@xyflow/react';

/** 节点连接桩；提供上下左右四侧的正交出入连接手柄。 */
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
