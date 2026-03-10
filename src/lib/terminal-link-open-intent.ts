type TerminalLinkModifierEvent = Pick<MouseEvent, 'metaKey' | 'ctrlKey'>;

export function createTerminalWindowOpenModifierTracker() {
    let pendingModifierOpen = false;

    return {
        recordPointerOpenIntent(event: TerminalLinkModifierEvent) {
            pendingModifierOpen = Boolean(event.metaKey || event.ctrlKey);
        },
        consumeModifierOpenIntent(): boolean {
            const shouldTreatAsModifierOpen = pendingModifierOpen;
            pendingModifierOpen = false;
            return shouldTreatAsModifierOpen;
        },
        clear() {
            pendingModifierOpen = false;
        },
    };
}
