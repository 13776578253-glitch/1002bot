import { memo, useEffect, useState } from 'react';
import { ReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react';
import { Link, type LinkData } from '../../src/react/components/primitives/relation-edge.tsx';
import { Ports } from '../../src/react/components/primitives/ports.tsx';

const NODE_COUNT = 36;
const nodes: Node<{ title: string }>[] = Array.from({ length: NODE_COUNT }, (_, index) => ({
  id: `lab-${index}`,
  type: 'lab',
  position: { x: (index % 6) * 320, y: Math.floor(index / 6) * 160 },
  width: 220,
  height: 92,
  data: { title: `Node ${index}` },
}));

const hiddenEdge: Edge<LinkData> = {
  id: 'hidden-label',
  source: 'lab-0',
  target: 'lab-1',
  type: 'link',
  label: '隐藏标签测试',
  data: {
    active: false,
    relation: 'call',
    change: { kind: 'inherited', label: '沿用' },
    points: [{ x: 220, y: 46 }, { x: 270, y: 46 }, { x: 320, y: 46 }],
    label: { x: 270, y: 46, width: 0, height: 0 },
    labelState: 'space-exhausted',
    onSelect: (_id: string) => {},
  },
};

const LabNode = memo(function LabNode({ data, width, height }: NodeProps<Node<{ title: string }>>) {
  return <div className="flow-card" style={{ width: width ?? 220, height: height ?? 92 }}>
    <Ports width={width ?? 220} height={height ?? 92} />
    <div className="card-title"><span className="card-name">{data.title}</span></div>
  </div>;
});

const nodeTypes = { lab: LabNode };
const edgeTypes = { link: Link };

export function RoutingLab() {
  const [mountMs, setMountMs] = useState(0);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const value = performance.now();
      setMountMs(value);
      document.querySelector<HTMLElement>('.routing-lab')?.setAttribute('data-mount-ms', value.toFixed(1));
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  return <main className="canvas-app routing-lab" data-lab="routing" data-mount-ms={mountMs || undefined} data-node-count={NODE_COUNT} style={{ width: '100vw', height: '100vh' }}>
    <ReactFlow<Node<{ title: string }>, Edge<LinkData>> nodes={nodes} edges={[hiddenEdge]} nodeTypes={nodeTypes} edgeTypes={edgeTypes} fitView nodesConnectable={false} zoomOnDoubleClick={false} />
  </main>;
}
