/** Project composition root with isolated user workspace persistence. */
import { createRoot } from 'react-dom/client';
import { VisualizationCanvas, createProjectViewStorage, projectWorkspaceToCanvas } from '../../src/react/index.ts';
import { baselines, initialWorkspace, project } from './baselines.ts';
import '../../src/react/styles.css';
import './app.css';

const projectStorage = createProjectViewStorage(localStorage, project.id);
const persistence = {
  key: `visualization:project:${project.id}:workspace:v1`,
  storage: {
    load: (key: string) => projectStorage.load(key) ?? projectWorkspaceToCanvas(initialWorkspace),
    save: projectStorage.save,
  },
};
createRoot(document.getElementById('root')!).render(<VisualizationCanvas baselines={baselines} initialBaselineId="M0" persistence={persistence} />);
