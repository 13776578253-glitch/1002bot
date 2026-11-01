/** Load project files as external assets; adapters own no transport or storage keys. */
import { adaptProject, type ArchitectureProject, type ProjectManifest, type ProjectSourceStage, type ProjectViewDefinition } from '../../src/adapters/project/index.ts';
import { normalizeProjectWorkspace, type ProjectWorkspace } from '../../src/react/index.ts';

const assets = import.meta.glob('../../datasets/progress-reports/{project.json,source/**/*.json,views/**/*.json,workspace/*.json}', { eager: true, query: '?url', import: 'default' });
async function read<T>(path: string): Promise<T> {
  const url = assets[`../../datasets/progress-reports/${path}`];
  if (typeof url !== 'string') throw new Error(`Unknown project resource: ${path}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load project resource: ${path} (${response.status})`);
  return response.json() as Promise<T>;
}

const manifest = await read<ProjectManifest>('project.json');
const [stages, views, workspace] = await Promise.all([
  Promise.all(manifest.source.stages.map((path) => read<ProjectSourceStage>(path))),
  Promise.all(manifest.views.map((path) => read<ProjectViewDefinition>(path))),
  read<ProjectWorkspace>(manifest.workspace),
]);
export const project: ArchitectureProject = { version: manifest.version, id: manifest.id, title: manifest.title, revision: manifest.revision, source: { stages }, views };
export const baselines = adaptProject(project);
export const initialWorkspace = normalizeProjectWorkspace(workspace, project.id);
