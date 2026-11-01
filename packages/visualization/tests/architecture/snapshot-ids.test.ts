import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { snapshotId, stageFiles } from '../../tools/snapshot-id.ts';

test('every project snapshot file is named and identified by its selection hash', async () => {
  const files = await stageFiles(fileURLToPath(new URL('../../datasets/', import.meta.url)));
  assert.ok(files.length > 0, 'datasets contain at least one snapshot');
  for (const file of files) {
    const stage = JSON.parse(await readFile(file, 'utf8'));
    const id = snapshotId(stage);
    assert.equal(stage.id, id, `${file} id`);
    assert.equal(basename(file), `${id}.json`, `${file} file name`);
  }
});
