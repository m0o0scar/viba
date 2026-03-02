import assert from 'node:assert';
import { describe, test } from 'node:test';
import { isEmailAllowedByPatterns } from './email-whitelist.ts';

describe('email-whitelist', () => {
  test('matches all emails with wildcard star', () => {
    assert.strictEqual(isEmailAllowedByPatterns('alice@example.com', ['*']), true);
    assert.strictEqual(isEmailAllowedByPatterns('bob@sea.com', ['*']), true);
  });

  test('matches domain wildcard pattern', () => {
    assert.strictEqual(isEmailAllowedByPatterns('alice@sea.com', ['*@sea.com']), true);
    assert.strictEqual(isEmailAllowedByPatterns('alice@foo.sea.com', ['*@sea.com']), false);
    assert.strictEqual(isEmailAllowedByPatterns('alice@foo.sea.com', ['*sea.com']), true);
  });

  test('matches exact email address pattern', () => {
    assert.strictEqual(isEmailAllowedByPatterns('alice@sea.com', ['alice@sea.com']), true);
    assert.strictEqual(isEmailAllowedByPatterns('bob@sea.com', ['alice@sea.com']), false);
  });

  test('handles multiple patterns and case-insensitive matches', () => {
    assert.strictEqual(
      isEmailAllowedByPatterns('Alice@SEA.com', ['bob@example.com', '*@sea.com']),
      true,
    );
  });
});
