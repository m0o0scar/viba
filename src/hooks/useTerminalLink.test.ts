import assert from 'node:assert';
import { describe, it } from 'node:test';
import { createTerminalWindowOpenModifierTracker } from '../lib/terminal-link-open-intent.ts';

describe('createTerminalWindowOpenModifierTracker', () => {
    it('consumes modifier-open intent only once', () => {
        const tracker = createTerminalWindowOpenModifierTracker();

        tracker.recordPointerOpenIntent({ metaKey: true, ctrlKey: false });

        assert.strictEqual(tracker.consumeModifierOpenIntent(), true);
        assert.strictEqual(tracker.consumeModifierOpenIntent(), false);
    });

    it('uses the latest pointer-down state instead of leaking an older modifier click', () => {
        const tracker = createTerminalWindowOpenModifierTracker();

        tracker.recordPointerOpenIntent({ metaKey: true, ctrlKey: false });
        tracker.recordPointerOpenIntent({ metaKey: false, ctrlKey: false });

        assert.strictEqual(tracker.consumeModifierOpenIntent(), false);
    });

    it('clears pending modifier-open intent when focus is lost', () => {
        const tracker = createTerminalWindowOpenModifierTracker();

        tracker.recordPointerOpenIntent({ metaKey: false, ctrlKey: true });
        tracker.clear();

        assert.strictEqual(tracker.consumeModifierOpenIntent(), false);
    });
});
