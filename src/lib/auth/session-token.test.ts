import assert from 'node:assert';
import { describe, test } from 'node:test';
import { createAuthSessionToken, verifyAuthSessionToken } from './session-token.ts';

describe('session-token', () => {
  test('creates and verifies a valid token', () => {
    const token = createAuthSessionToken('alice@example.com', 'secret', 60);
    const payload = verifyAuthSessionToken(token, 'secret');

    assert.ok(payload);
    assert.strictEqual(payload?.email, 'alice@example.com');
    assert.ok(typeof payload?.iat === 'number');
    assert.ok(typeof payload?.exp === 'number');
  });

  test('rejects tampered token', () => {
    const token = createAuthSessionToken('alice@example.com', 'secret', 60);
    const parts = token.split('.');
    const tamperedPayload = Buffer.from(JSON.stringify({ email: 'mallory@example.com', iat: 1, exp: 9999999999 }))
      .toString('base64url');
    const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

    const payload = verifyAuthSessionToken(tamperedToken, 'secret');
    assert.strictEqual(payload, null);
  });

  test('rejects expired token', () => {
    const token = createAuthSessionToken('alice@example.com', 'secret', -1);
    const payload = verifyAuthSessionToken(token, 'secret');
    assert.strictEqual(payload, null);
  });
});
