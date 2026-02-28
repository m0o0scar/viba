import re

with open('src/components/SessionView.tsx', 'r') as f:
    content = f.read()

# Replace the previous override code with a simpler approach:
# We will inject a script into the iframe that intercepts the MouseEvent prototype!
script_override = """            // Inject script to force xterm.js to treat mouse drag/click as shift-clicks,
            // bypassing application mouse reporting for text selection while keeping wheel scroll active.
            try {
                const script = iframe.contentDocument?.createElement('script');
                if (script) {
                    script.textContent = `
                        const originalShiftKey = Object.getOwnPropertyDescriptor(MouseEvent.prototype, 'shiftKey');
                        Object.defineProperty(MouseEvent.prototype, 'shiftKey', {
                            get: function() {
                                if (this.type === 'mousedown' || this.type === 'mousemove' || this.type === 'mouseup' || this.type === 'click') {
                                    return true;
                                }
                                return originalShiftKey ? originalShiftKey.get.call(this) : false;
                            }
                        });
                    `;
                    iframe.contentDocument?.head?.appendChild(script);
                }
            } catch (e) {
                console.error("Failed to inject shift override script", e);
            }"""

old_override = """            // Inject script to force xterm.js to treat mouse drag/click as shift-clicks,
            // bypassing application mouse reporting for text selection while keeping wheel scroll active.
            try {
                const script = iframe.contentDocument?.createElement('script');
                if (script) {
                    script.textContent = `
                        const overrideShift = (e) => {
                            try {
                                Object.defineProperty(e, 'shiftKey', { get: () => true, configurable: true });
                            } catch (err) {}
                        };
                        document.addEventListener('mousedown', overrideShift, true);
                        document.addEventListener('mousemove', overrideShift, true);
                        document.addEventListener('mouseup', overrideShift, true);
                        document.addEventListener('click', overrideShift, true);
                    `;
                    iframe.contentDocument?.head?.appendChild(script);
                }
            } catch (e) {
                console.error("Failed to inject shift override script", e);
            }"""

content = content.replace(old_override, script_override)

with open('src/components/SessionView.tsx', 'w') as f:
    f.write(content)
