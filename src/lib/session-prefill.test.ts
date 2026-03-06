import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { doesSessionPrefillMatchProject } from './session-prefill.ts';

describe('doesSessionPrefillMatchProject', () => {
  it('matches when the selected project equals the saved project path', () => {
    assert.equal(
      doesSessionPrefillMatchProject(
        {
          projectPath: '/workspace/project',
          repoPath: '/workspace/project/packages/app',
        },
        '/workspace/project',
      ),
      true,
    );
  });

  it('falls back to repoPath for older session records without projectPath', () => {
    assert.equal(
      doesSessionPrefillMatchProject(
        {
          repoPath: '/workspace/project',
        },
        '/workspace/project',
      ),
      true,
    );
  });

  it('does not match a different project path', () => {
    assert.equal(
      doesSessionPrefillMatchProject(
        {
          projectPath: '/workspace/project-a',
          repoPath: '/workspace/project-a/packages/app',
        },
        '/workspace/project-b',
      ),
      false,
    );
  });

  it('normalizes path separators and trailing slashes before matching', () => {
    assert.equal(
      doesSessionPrefillMatchProject(
        {
          projectPath: 'C:\\workspace\\project\\',
        },
        'C:/workspace/project',
      ),
      true,
    );
  });
});
