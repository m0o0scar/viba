import assert from 'node:assert';
import { describe, it } from 'node:test';

import { defaultSpawnEnv } from './common.ts';

describe('defaultSpawnEnv', () => {
  it('merges extra env without dropping PATH handling', () => {
    const env = defaultSpawnEnv({
      GITHUB_TOKEN: 'ghu_test',
      GITLAB_HOST: 'gitlab.corp.example',
    });

    assert.strictEqual(env['GITHUB_TOKEN'], 'ghu_test');
    assert.strictEqual(env['GITLAB_HOST'], 'gitlab.corp.example');
    assert.ok(typeof env.PATH === 'string' && env.PATH.length > 0);
    assert.match(env.PATH, /\/usr\/local\/bin|\/opt\/homebrew\/bin/);
  });
});
