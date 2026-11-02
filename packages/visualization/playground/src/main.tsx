/** Project composition root with isolated user workspace persistence. */
import { createRoot } from 'react-dom/client';
import { VisualizationCanvas, createProjectViewStorage, projectWorkspaceToCanvas } from '../../src/react/index.ts';
import { baselines, initialWorkspace, project } from './baselines.ts';
import { RoutingLab } from './routing-lab.tsx';
import '../../src/react/styles.css';
import './app.css';

const projectStorage = createProjectViewStorage(localStorage, project.id);
const persistence = {
  key: `visualization:project:${project.id}:workspace:v1`,
  storage: {
    load: (key: string) => projectStorage.load(key) ?? (initialWorkspace ? projectWorkspaceToCanvas(initialWorkspace) : undefined),
    save: projectStorage.save,
  },
};
const lab = new URLSearchParams(location.search).get('lab');
createRoot(document.getElementById('root')!).render(lab === 'routing'
  ? <RoutingLab />
  : <VisualizationCanvas baselines={baselines} initialBaselineId={baselines[0]!.id} persistence={persistence} />);
