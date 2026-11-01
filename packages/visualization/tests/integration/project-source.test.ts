import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSourceStages, type ProjectSourceCatalog, type ProjectStageSelection } from '../../src/adapters/project/index.ts';

const component = (id: string) => ({ id, kind: 'component' as const, label: id, contractIds: [], sourceRefs: ['doc#facts'] });
const catalog: ProjectSourceCatalog = {
  version: 1,
  projectId: 'sample',
  components: [component('alpha'), component('beta')],
  relations: [],
  contracts: [],
};
const stage = (id: string, previousId?: string, select: string[] = [], remove: string[] = []): ProjectStageSelection => ({
  version: 1,
  id,
  label: id,
  title: id,
  ...(previousId === undefined ? {} : { previousId }),
  select: { componentIds: select, relationIds: [], contractIds: [] },
  remove: { componentIds: remove, relationIds: [], contractIds: [] },
});

test('stage selections resolve catalog ids in declaration order', () => {
  const [resolved] = resolveSourceStages([catalog], [stage('M0', undefined, ['beta', 'alpha'])]);
  assert.deepEqual(resolved!.upsert.components.map((item) => item.id), ['beta', 'alpha']);
});

test('unknown catalog ids are rejected with the stage and entity', () => {
  assert.throws(() => resolveSourceStages([catalog], [stage('M0', undefined, ['missing'])]), /stage M0: unknown component "missing"/);
});

test('duplicate and contradictory selections are rejected', () => {
  assert.throws(() => resolveSourceStages([catalog], [stage('M0', undefined, ['alpha', 'alpha'])]), /component "alpha" is selected twice/);
  assert.throws(() => resolveSourceStages([catalog], [stage('M0', undefined, ['alpha'], ['alpha'])]), /component "alpha" is both selected and removed/);
});

test('stage chains require an explicit matching previousId after the first stage', () => {
  assert.throws(() => resolveSourceStages([catalog], [stage('M0', 'M0')]), /first stage M0 must not declare previousId/);
  assert.throws(() => resolveSourceStages([catalog], [stage('M0'), stage('M1')]), /stage M1 must declare previousId "M0"/);
  assert.throws(() => resolveSourceStages([catalog], [stage('M0'), stage('M1', 'other')]), /stage M1 must declare previousId "M0"/);
  const stages = resolveSourceStages([catalog], [stage('M0'), stage('M1', 'M0')]);
  assert.deepEqual(stages.map((item) => item.previousId), [undefined, 'M0']);
});
