/** Load project files as external assets; adapters own no transport or storage keys. */
import { adaptProject, resolveSourceStages, type ArchitectureProject, type ProjectManifest, type ProjectRegistry, type ProjectSourceCatalog, type ProjectStageSelection, type ProjectViewDefinition } from '../../src/adapters/project/index.ts';
import { normalizeProjectWorkspace, type ProjectWorkspace } from '../../src/react/index.ts';

const datasets = '../../datasets/';
const assets = import.meta.glob('../../datasets/{projects.json,projects/**/*.json}', { eager: true, query: '?url', import: 'default' });
async function read<T>(path: string): Promise<T> {
  const url = assets[`${datasets}${path}`];
  if (typeof url !== 'string') throw new Error(`Unknown dataset resource: ${path}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load dataset resource: ${path} (${response.status})`);
  return response.json() as Promise<T>;
}

const registry = await read<ProjectRegistry>('projects.json');
const entry = registry.projects.find((item) => item.id === registry.defaultProjectId);
if (!entry) throw new Error(`Unknown default project: ${registry.defaultProjectId}`);
const manifest = await read<ProjectManifest>(entry.manifest);
const directory = entry.manifest.slice(0, entry.manifest.lastIndexOf('/'));
const projectFile = (path: string) => `${directory}/${path}`;
const [catalogs, stages, views, workspace] = await Promise.all([
  Promise.all(manifest.source.map((path) => read<ProjectSourceCatalog>(projectFile(path)))),
  Promise.all(manifest.stages.map((path) => read<ProjectStageSelection>(projectFile(path)))),
  Promise.all(manifest.views.map((path) => read<ProjectViewDefinition>(projectFile(path)))),
  manifest.workspace ? read<ProjectWorkspace>(projectFile(manifest.workspace)) : Promise.resolve(undefined),
]);

export const project: ArchitectureProject = {
  version: 1,
  id: manifest.id,
  title: manifest.title,
  revision: manifest.revision,
  source: { stages: resolveSourceStages(catalogs, stages) },
  views,
};
export const baselines = adaptProject(project);
export const initialWorkspace = workspace ? normalizeProjectWorkspace(workspace, project.id) : undefined;
