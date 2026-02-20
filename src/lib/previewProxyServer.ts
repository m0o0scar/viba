import http, { IncomingMessage, ServerResponse } from 'http';
import type { Socket } from 'net';
import { createProxyMiddleware, responseInterceptor } from 'http-proxy-middleware';

const PROXY_HOST = '127.0.0.1';
const PICKER_SCRIPT_PATH = '/__viba_preview_picker.js';
const PICKER_SCRIPT_VERSION = '2';

const PICKER_CLIENT_SCRIPT = String.raw`(() => {
  if (window.__vibaPreviewPickerInstalled) {
    return;
  }

  window.__vibaPreviewPickerInstalled = true;

  const OVERLAY_ID = '__viba_preview_picker_overlay__';
  let pickerActive = false;

  const cssEscape = (value) => {
    if (window.CSS && typeof window.CSS.escape === 'function') {
      return window.CSS.escape(value);
    }

    return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  };

  const getOverlay = () => {
    let overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = OVERLAY_ID;
      overlay.style.position = 'fixed';
      overlay.style.zIndex = '2147483647';
      overlay.style.pointerEvents = 'none';
      overlay.style.border = '2px solid #22c55e';
      overlay.style.background = 'rgba(34, 197, 94, 0.12)';
      overlay.style.boxSizing = 'border-box';
      overlay.style.display = 'none';
      document.documentElement.appendChild(overlay);
    }

    return overlay;
  };

  const clearOverlay = () => {
    const overlay = document.getElementById(OVERLAY_ID);
    if (overlay) {
      overlay.style.display = 'none';
    }
  };

  const getElementFromTarget = (target) => {
    if (target instanceof Element) {
      return target;
    }

    if (target && target.parentElement instanceof Element) {
      return target.parentElement;
    }

    return null;
  };

  const buildSelector = (element) => {
    const parts = [];
    let node = element;

    for (let depth = 0; node && depth < 7; depth += 1) {
      let segment = node.tagName.toLowerCase();

      if (node.id) {
        segment += '#' + cssEscape(node.id);
        parts.unshift(segment);
        break;
      }

      const classNames = Array.from(node.classList || []).slice(0, 3);
      if (classNames.length > 0) {
        segment += '.' + classNames.map((name) => cssEscape(name)).join('.');
      }

      const parent = node.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((child) => child.tagName === node.tagName);
        if (siblings.length > 1) {
          segment += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
        }
      }

      parts.unshift(segment);
      node = parent;
    }

    return parts.join(' > ');
  };

  const getReactFiberNode = (element) => {
    let current = element;
    while (current) {
      const keys = Object.getOwnPropertyNames(current);
      for (const key of keys) {
        if (key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$')) {
          const node = current[key];
          if (node) {
            return node;
          }
        }
      }
      current = current.parentElement;
    }

    return null;
  };

  const readComponentName = (candidate) => {
    if (!candidate) {
      return null;
    }

    if (typeof candidate === 'function') {
      return candidate.displayName || candidate.name || null;
    }

    if (typeof candidate !== 'object') {
      return null;
    }

    if (typeof candidate.displayName === 'string' && candidate.displayName) {
      return candidate.displayName;
    }

    if (typeof candidate.render === 'function') {
      return candidate.render.displayName || candidate.render.name || null;
    }

    if (typeof candidate.type === 'function') {
      return candidate.type.displayName || candidate.type.name || null;
    }

    return null;
  };

  const normalizeComponentName = (name) => {
    if (!name) {
      return name;
    }

    const memoMatch = name.match(/^Memo\((.+)\)$/);
    if (memoMatch && memoMatch[1]) {
      return memoMatch[1];
    }

    const forwardRefMatch = name.match(/^ForwardRef\((.+)\)$/);
    if (forwardRefMatch && forwardRefMatch[1]) {
      return forwardRefMatch[1];
    }

    return name;
  };

  const getUserComponentStack = (element) => {
    let fiberNode = getReactFiberNode(element);
    if (!fiberNode) {
      return [];
    }

    const userStack = [];

    const internalNames = new Set([
      'Suspense', 'ErrorBoundary', 'Router', 'AppRouter', 'LayoutRouter',
      'RenderFromTemplateContext', 'ScrollAndFocusHandler', 'InnerLayoutRouter',
      'RedirectErrorBoundary', 'NotFoundBoundary', 'LoadingBoundary',
      'ReactDevOverlay', 'HotReload', 'AppContainer', 'Route', 'Link', 'Image',
      'OuterLayoutRouter', 'Head', 'StringRefs',
    ]);

    while (fiberNode) {
      if (typeof fiberNode.elementType === 'string' || typeof fiberNode.type === 'string') {
        fiberNode = fiberNode.return;
        continue;
      }

      let componentName = readComponentName(fiberNode.elementType) || readComponentName(fiberNode.type);
      componentName = normalizeComponentName(componentName);

      if (!componentName) {
        fiberNode = fiberNode.return;
        continue;
      }

      if (
        internalNames.has(componentName) ||
        componentName.includes('Context') ||
        componentName.includes('Provider') ||
        componentName.startsWith('ForwardRef') ||
        componentName.startsWith('Memo')
      ) {
        fiberNode = fiberNode.return;
        continue;
      }

      let sourceData = null;
      let isThirdParty = false;

      if (fiberNode._debugSource) {
        sourceData = {
          fileName: fiberNode._debugSource.fileName,
          lineNumber: fiberNode._debugSource.lineNumber,
          columnNumber: fiberNode._debugSource.columnNumber,
        };

        if (sourceData.fileName.includes('node_modules')) {
          isThirdParty = true;
        }
      }

      if (isThirdParty) {
        fiberNode = fiberNode.return;
        continue;
      }

      userStack.push({
        name: componentName,
        source: sourceData,
      });

      fiberNode = fiberNode.return;
    }

    return userStack;
  };

  const postPickerState = () => {
    window.parent.postMessage({
      type: 'viba:preview-picker-state',
      active: pickerActive,
    }, '*');
  };

  const highlight = (element) => {
    const overlay = getOverlay();
    const rect = element.getBoundingClientRect();

    if (rect.width === 0 && rect.height === 0) {
      overlay.style.display = 'none';
      return;
    }

    overlay.style.display = 'block';
    overlay.style.left = rect.left + 'px';
    overlay.style.top = rect.top + 'px';
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';
  };

  const selectElement = (element) => {
    const rect = element.getBoundingClientRect();
    const text = (element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    const reactComponentStack = getUserComponentStack(element);

    window.parent.postMessage({
      type: 'viba:preview-element-selected',
      element: {
        selector: buildSelector(element),
        tagName: element.tagName.toLowerCase(),
        id: element.id || null,
        className: element.className || null,
        text,
        rect: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        },
        reactComponentStack,
      },
    }, '*');
  };

  const setPickerActive = (active) => {
    pickerActive = active;
    document.documentElement.style.cursor = active ? 'crosshair' : '';

    if (!active) {
      clearOverlay();
    }

    postPickerState();
  };

  const handleMouseMove = (event) => {
    if (!pickerActive) {
      return;
    }

    const element = getElementFromTarget(event.target);
    if (!element) {
      clearOverlay();
      return;
    }

    const overlay = document.getElementById(OVERLAY_ID);
    if (overlay && (element === overlay || overlay.contains(element))) {
      return;
    }

    highlight(element);
  };

  const handleClick = (event) => {
    if (!pickerActive) {
      return;
    }

    const element = getElementFromTarget(event.target);
    if (!element) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === 'function') {
      event.stopImmediatePropagation();
    }

    selectElement(element);
    setPickerActive(false);
  };

  const handleKeyDown = (event) => {
    if (!pickerActive) {
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      setPickerActive(false);
    }
  };

  const handleMessage = (event) => {
    const payload = event.data;
    if (!payload || typeof payload !== 'object') {
      return;
    }

    if (payload.type !== 'viba:preview-picker-toggle') {
      return;
    }

    setPickerActive(Boolean(payload.active));
  };

  document.addEventListener('mousemove', handleMouseMove, true);
  document.addEventListener('click', handleClick, true);
  document.addEventListener('keydown', handleKeyDown, true);
  window.addEventListener('message', handleMessage);

  window.parent.postMessage({ type: 'viba:preview-picker-ready' }, '*');
})();`;

type PreviewProxyState = {
  middleware: ReturnType<typeof createProxyMiddleware<IncomingMessage, ServerResponse>>;
  port: number;
  server: http.Server;
  targetOrigin: string;
};

declare global {
  var __vibaPreviewProxyState: PreviewProxyState | undefined;
}

const injectPickerScript = (html: string): string => {
  if (html.includes(PICKER_SCRIPT_PATH)) {
    return html;
  }

  const scriptTag = `<script src="${PICKER_SCRIPT_PATH}?v=${PICKER_SCRIPT_VERSION}"></script>`;
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${scriptTag}</body>`);
  }

  return `${html}${scriptTag}`;
};

const normalizeTargetUrl = (target: string): URL => {
  const parsed = new URL(target);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http and https preview URLs are supported');
  }

  return parsed;
};

const createPreviewProxyServer = async (targetOrigin: string): Promise<PreviewProxyState> => {
  const middleware = createProxyMiddleware<IncomingMessage, ServerResponse>({
    changeOrigin: true,
    // Preserve original client-facing host/proto metadata for frameworks
    // (e.g. Next.js Server Actions CSRF checks) running behind this proxy.
    xfwd: true,
    selfHandleResponse: true,
    secure: false,
    target: targetOrigin,
    ws: true,
    on: {
      proxyRes: responseInterceptor(async (responseBuffer, proxyRes) => {
        const rawContentType = proxyRes.headers['content-type'];
        const contentType = Array.isArray(rawContentType)
          ? rawContentType.join(';')
          : rawContentType || '';

        if (!contentType.toLowerCase().includes('text/html')) {
          return responseBuffer;
        }

        return injectPickerScript(responseBuffer.toString('utf8'));
      }),
      error: (error, _request, response) => {
        if (response instanceof ServerResponse) {
          if (!response.headersSent) {
            response.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
          }
          response.end(`Preview proxy error: ${error.message}`);
        }
      },
    },
  });

  const server = http.createServer((request, response) => {
    if (request.url === PICKER_SCRIPT_PATH || request.url?.startsWith(`${PICKER_SCRIPT_PATH}?`)) {
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-type': 'application/javascript; charset=utf-8',
      });
      response.end(PICKER_CLIENT_SCRIPT);
      return;
    }

    middleware(request, response, (error) => {
      if (error) {
        if (!response.headersSent) {
          response.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
        }
        response.end(`Preview proxy error: ${String(error)}`);
        return;
      }

      if (!response.headersSent) {
        response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      }
      response.end('Preview route not found');
    });
  });

  server.on('upgrade', (request: IncomingMessage, socket: Socket, head: Buffer) => {
    const upgrade = (middleware as { upgrade?: (req: IncomingMessage, socket: Socket, head: Buffer) => void }).upgrade;

    if (!upgrade) {
      socket.destroy();
      return;
    }

    upgrade(request, socket, head);
  });

  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, PROXY_HOST, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Preview proxy failed to bind to a TCP port'));
        return;
      }

      resolve(address.port);
    });
  });

  return {
    middleware,
    port,
    server,
    targetOrigin,
  };
};

const closePreviewProxyServer = async (state: PreviewProxyState): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    state.server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
};

export const ensurePreviewProxyServer = async (target: string): Promise<{ proxyBaseUrl: string }> => {
  const normalizedTarget = normalizeTargetUrl(target);
  const targetOrigin = normalizedTarget.origin;

  const activeState = globalThis.__vibaPreviewProxyState;
  if (activeState && activeState.targetOrigin === targetOrigin) {
    return { proxyBaseUrl: `http://${PROXY_HOST}:${activeState.port}` };
  }

  if (activeState) {
    await closePreviewProxyServer(activeState);
    globalThis.__vibaPreviewProxyState = undefined;
  }

  const nextState = await createPreviewProxyServer(targetOrigin);
  globalThis.__vibaPreviewProxyState = nextState;

  return { proxyBaseUrl: `http://${PROXY_HOST}:${nextState.port}` };
};

export const buildPreviewProxyUrl = (proxyBaseUrl: string, target: string): string => {
  const targetUrl = normalizeTargetUrl(target);
  const proxyUrl = new URL(proxyBaseUrl);

  proxyUrl.pathname = targetUrl.pathname || '/';
  proxyUrl.search = targetUrl.search;
  proxyUrl.hash = targetUrl.hash;

  return proxyUrl.toString();
};
