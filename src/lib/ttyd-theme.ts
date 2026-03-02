export type ThemeMode = 'auto' | 'light' | 'dark';
export type TerminalTheme = Record<string, string>;

export const THEME_MODE_STORAGE_KEY = 'viba:theme-mode';
export const THEME_REFRESH_EVENT = 'viba:theme-refresh';

export const TERMINAL_THEME_MONOCHROME: TerminalTheme = {
  background: '#0b0f14',
  foreground: '#dce3ea',
  cursor: '#dce3ea',
  selectionBackground: 'rgba(148, 163, 184, 0.35)',
  black: '#dce3ea',
  red: '#dce3ea',
  green: '#dce3ea',
  yellow: '#dce3ea',
  blue: '#dce3ea',
  magenta: '#dce3ea',
  cyan: '#dce3ea',
  white: '#dce3ea',
  brightBlack: '#dce3ea',
  brightRed: '#dce3ea',
  brightGreen: '#dce3ea',
  brightYellow: '#dce3ea',
  brightBlue: '#dce3ea',
  brightMagenta: '#dce3ea',
  brightCyan: '#dce3ea',
  brightWhite: '#dce3ea',
};

export const TERMINAL_THEME_LIGHT: TerminalTheme = TERMINAL_THEME_MONOCHROME;

export const TERMINAL_THEME_DARK: TerminalTheme = TERMINAL_THEME_MONOCHROME;

type StorageLike = Pick<Storage, 'getItem'>;
type StyleTarget = {
  style?: {
    backgroundColor?: string;
    color?: string;
    [key: string]: string | undefined;
  };
};
type TerminalDocumentLike = {
  documentElement?: StyleTarget | null;
  body?: StyleTarget | null;
  activeElement?: unknown;
  hasFocus?: () => boolean;
  querySelector?: (selector: string) => unknown;
  querySelectorAll?: (selector: string) => ArrayLike<StyleTarget>;
};
type TerminalDisposable = {
  dispose?: () => void;
};
type TerminalParserLike = {
  registerCsiHandler?: (
    id: { final: string; intermediates?: string },
    callback: (params: unknown[], collect?: string) => boolean,
  ) => TerminalDisposable | void;
  registerOscHandler?: (
    ident: number,
    callback: (data: string) => boolean,
  ) => TerminalDisposable | void;
};
type TerminalWithMonochromeFilterState = {
  parser?: TerminalParserLike;
  write?: (data: string, callback?: () => void) => void;
  __vibaMonochromeFilterInstalled?: boolean;
  __vibaMonochromeFilterDisposables?: TerminalDisposable[];
};
type TtydWindow = Window & {
  document?: TerminalDocumentLike;
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  term?: {
    options?: {
      theme?: TerminalTheme;
      [key: string]: unknown;
    };
    _core?: {
      coreService?: {
        decPrivateModes?: {
          sendFocus?: boolean;
        };
        triggerDataEvent?: (data: string, wasUserInput?: boolean) => void;
      };
    };
    rows?: number;
    cols?: number;
    resize?: (cols: number, rows: number) => void;
    refresh?: (start: number, end: number) => void;
    clearTextureAtlas?: () => void;
    parser?: TerminalParserLike;
    write?: (data: string, callback?: () => void) => void;
    __vibaMonochromeFilterInstalled?: boolean;
    __vibaMonochromeFilterDisposables?: TerminalDisposable[];
  };
};

const TERMINAL_BACKGROUND_SELECTORS = [
  '.xterm',
  '.xterm-screen',
  '.xterm-viewport',
  '.xterm-rows',
];
const TERMINAL_FOCUS_GAINED_SEQUENCE = '\x1b[I';
const MONOCHROME_OSC_STYLE_IDS = [4, 10, 11, 12, 17, 19, 104, 110, 111, 112, 117, 119];

type FocusableTerminalElement = {
  blur?: () => void;
  focus?: ((options?: { preventScroll?: boolean }) => void) | (() => void);
};

function applyElementBackgroundColor(
  element: StyleTarget | null | undefined,
  theme: TerminalTheme,
): void {
  if (!element?.style) return;
  if (theme.background) {
    element.style.backgroundColor = theme.background;
  }
}

function applyElementForegroundColor(
  element: StyleTarget | null | undefined,
  theme: TerminalTheme,
): void {
  if (!element?.style) return;
  if (theme.foreground) {
    element.style.color = theme.foreground;
  }
}

function applyThemeToTerminalDocument(
  terminalDocument: TerminalDocumentLike | null | undefined,
  theme: TerminalTheme,
): void {
  if (!terminalDocument) return;

  applyElementBackgroundColor(terminalDocument.documentElement, theme);
  applyElementForegroundColor(terminalDocument.documentElement, theme);
  applyElementBackgroundColor(terminalDocument.body, theme);
  applyElementForegroundColor(terminalDocument.body, theme);

  if (typeof terminalDocument.querySelectorAll !== 'function') return;
  for (const selector of TERMINAL_BACKGROUND_SELECTORS) {
    const elements = terminalDocument.querySelectorAll(selector);
    for (const element of Array.from(elements)) {
      applyElementBackgroundColor(element, theme);
      if (selector === '.xterm' || selector === '.xterm-screen') {
        applyElementForegroundColor(element, theme);
      }
    }
  }
}

function refreshTerminalSafely(
  term: NonNullable<TtydWindow['term']>,
): boolean {
  const rowCount = typeof term.rows === 'number' ? term.rows : 0;
  if (rowCount <= 0) return false;

  try {
    term.clearTextureAtlas?.();
  } catch {
    // Ignore renderer-specific refresh failures.
  }
  try {
    term.refresh?.(0, rowCount - 1);
  } catch {
    // Ignore renderer-specific refresh failures.
  }
  return true;
}

function scheduleTerminalRefresh(
  term: NonNullable<TtydWindow['term']>,
  requestAnimationFrame: TtydWindow['requestAnimationFrame'],
  attempts = 0,
): void {
  if (refreshTerminalSafely(term)) return;
  if (attempts >= 8 || typeof requestAnimationFrame !== 'function') return;
  requestAnimationFrame(() => {
    scheduleTerminalRefresh(term, requestAnimationFrame, attempts + 1);
  });
}

function installMonochromeAnsiFilter(
  term: NonNullable<TtydWindow['term']>,
): void {
  const terminal = term as NonNullable<TtydWindow['term']> & TerminalWithMonochromeFilterState;
  if (terminal.__vibaMonochromeFilterInstalled) return;
  terminal.__vibaMonochromeFilterInstalled = true;

  // Clear any active style state so subsequent plain text starts from defaults.
  try {
    terminal.write?.('\x1b[0m');
  } catch {
    // Ignore write failures from renderer/setup races.
  }

  const parser = terminal.parser;
  if (!parser) return;

  const disposables: TerminalDisposable[] = [];

  if (typeof parser.registerCsiHandler === 'function') {
    try {
      const disposable = parser.registerCsiHandler({ final: 'm' }, () => true);
      if (disposable) {
        disposables.push(disposable);
      }
    } catch {
      // Ignore parser API differences across xterm versions.
    }
  }

  if (typeof parser.registerOscHandler === 'function') {
    for (const oscId of MONOCHROME_OSC_STYLE_IDS) {
      try {
        const disposable = parser.registerOscHandler(oscId, () => true);
        if (disposable) {
          disposables.push(disposable);
        }
      } catch {
        // Ignore parser API differences across xterm versions.
      }
    }
  }

  if (disposables.length > 0) {
    terminal.__vibaMonochromeFilterDisposables = disposables;

    // Trigger a repaint from the running TUI so existing colored blocks are redrawn as plain text.
    if (typeof terminal.resize === 'function') {
      const cols = typeof terminal.cols === 'number' ? terminal.cols : 0;
      const rows = typeof terminal.rows === 'number' ? terminal.rows : 0;
      if (cols > 0 && rows > 0) {
        const nudgedRows = rows > 2 ? rows - 1 : rows + 1;
        if (nudgedRows > 0 && nudgedRows !== rows) {
          try {
            terminal.resize(cols, nudgedRows);
            terminal.resize(cols, rows);
          } catch {
            // Ignore resize races while ttyd is still syncing dimensions.
          }
        }
      }
    }
  }
}

function notifyFocusReportingTerminalProcess(
  term: NonNullable<TtydWindow['term']>,
): void {
  const coreService = term._core?.coreService;
  if (!coreService?.decPrivateModes?.sendFocus) return;
  if (typeof coreService.triggerDataEvent !== 'function') return;

  try {
    coreService.triggerDataEvent(TERMINAL_FOCUS_GAINED_SEQUENCE, true);
  } catch {
    // Ignore xterm internal API differences.
  }
}

function nudgeFocusedTerminalInput(
  terminalDocument: TerminalDocumentLike | null | undefined,
): boolean {
  if (!terminalDocument || typeof terminalDocument.querySelector !== 'function') return false;

  const inputElement = terminalDocument.querySelector('textarea.xterm-helper-textarea') as FocusableTerminalElement | null;
  if (!inputElement || typeof inputElement.focus !== 'function') return false;

  const activeElement = terminalDocument.activeElement;
  const isInputFocused = activeElement === inputElement;
  const documentHasFocus = typeof terminalDocument.hasFocus === 'function'
    ? terminalDocument.hasFocus()
    : isInputFocused;
  if (!documentHasFocus || !isInputFocused) return false;

  try {
    inputElement.blur?.();
  } catch {
    // Ignore focus lifecycle edge-cases from embedded browsers.
  }

  try {
    inputElement.focus({ preventScroll: true });
  } catch {
    try {
      inputElement.focus();
    } catch {
      return false;
    }
  }

  return true;
}

export function normalizeThemeMode(value: string | null | undefined): ThemeMode {
  if (value === 'light' || value === 'dark' || value === 'auto') {
    return value;
  }
  return 'auto';
}

export function readThemeModeFromStorage(storage: StorageLike | null | undefined): ThemeMode {
  if (!storage) return 'auto';
  try {
    return normalizeThemeMode(storage.getItem(THEME_MODE_STORAGE_KEY));
  } catch {
    return 'auto';
  }
}

export function resolveShouldUseDarkTheme(themeMode: ThemeMode, prefersDark: boolean): boolean {
  return themeMode === 'dark' || (themeMode === 'auto' && prefersDark);
}

export function resolveTerminalTheme(themeMode: ThemeMode, prefersDark: boolean): TerminalTheme {
  return resolveShouldUseDarkTheme(themeMode, prefersDark) ? TERMINAL_THEME_DARK : TERMINAL_THEME_LIGHT;
}

export function resolveTerminalThemeFromBrowser(): TerminalTheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return TERMINAL_THEME_LIGHT;
  }
  const mode = readThemeModeFromStorage(window.localStorage);
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  return resolveTerminalTheme(mode, prefersDark);
}

export function applyThemeToTerminalWindow(
  terminalWindow: Window | null | undefined,
  theme: TerminalTheme = resolveTerminalThemeFromBrowser(),
): boolean {
  const ttydWindow = terminalWindow as TtydWindow | null | undefined;
  const term = ttydWindow?.term;
  if (!term?.options) return false;

  term.options.theme = {
    ...(term.options.theme || {}),
    ...theme,
  };
  installMonochromeAnsiFilter(term);

  applyThemeToTerminalDocument(ttydWindow.document, theme);
  scheduleTerminalRefresh(term, ttydWindow.requestAnimationFrame?.bind(ttydWindow));
  const nudgedWithRealFocusEvent = nudgeFocusedTerminalInput(ttydWindow.document);
  if (!nudgedWithRealFocusEvent) {
    notifyFocusReportingTerminalProcess(term);
  }

  return true;
}

export function applyThemeToTerminalIframe(
  iframe: HTMLIFrameElement | null | undefined,
  theme: TerminalTheme = resolveTerminalThemeFromBrowser(),
): boolean {
  if (!iframe) return false;
  try {
    return applyThemeToTerminalWindow(iframe.contentWindow, theme);
  } catch {
    return false;
  }
}
