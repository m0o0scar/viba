import { test, describe, it } from 'node:test';
import assert from 'node:assert';
import { quoteShellArg } from './shell.ts';

describe('quoteShellArg', () => {
    it('quotes a simple string', () => {
        assert.strictEqual(quoteShellArg('foo'), "'foo'");
    });

    it('quotes a string with spaces', () => {
        assert.strictEqual(quoteShellArg('foo bar'), "'foo bar'");
    });

    it('quotes a string with single quotes', () => {
        assert.strictEqual(quoteShellArg("don't"), "'don'\\''t'");
    });

    it('quotes an empty string', () => {
        assert.strictEqual(quoteShellArg(''), "''");
    });

    it('quotes a string with multiple single quotes', () => {
        assert.strictEqual(quoteShellArg("it's a 'test'"), "'it'\\''s a '\\''test'\\'''");
    });
});
