'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { getHomeDirectory, listPathEntries, saveAttachments } from '@/app/actions/git';
import { ArrowLeft, Check, FileText, Folder, House, Clipboard } from 'lucide-react';
import { getDirName } from '@/lib/path';

type FileSystemItem = {
  name: string;
  path: string;
  isDirectory: boolean;
  isGitRepo: boolean;
};

interface SessionFileBrowserProps {
  initialPath?: string;
  worktreePath?: string;
  onConfirm: (paths: string[]) => void | Promise<void>;
  onCancel: () => void;
}

export default function SessionFileBrowser({
  initialPath,
  worktreePath,
  onConfirm,
  onCancel,
}: SessionFileBrowserProps) {
  const [currentPath, setCurrentPath] = useState('');
  const [items, setItems] = useState<FileSystemItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [homePath, setHomePath] = useState('');
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [anchorIndex, setAnchorIndex] = useState<number | null>(null);

  useEffect(() => {
    let isMounted = true;

    const init = async () => {
      try {
        const home = await getHomeDirectory();
        if (!isMounted) return;
        setHomePath(home);
        if (!initialPath) {
          setCurrentPath(home);
        }
      } catch (err) {
        console.error('Failed to resolve home directory:', err);
      }

      if (initialPath && isMounted) {
        setCurrentPath(initialPath);
      }
    };

    void init();

    return () => {
      isMounted = false;
    };
  }, [initialPath]);

  useEffect(() => {
    if (!currentPath) return;

    const fetchItems = async () => {
      setLoading(true);
      setError(null);
      try {
        const entries = await listPathEntries(currentPath);
        setItems(entries);
      } catch (err) {
        console.error('Failed to list files:', err);
        setError('Failed to load directory contents');
      } finally {
        setLoading(false);
      }
    };

    void fetchItems();
  }, [currentPath]);

  useEffect(() => {
    setSelectedPaths([]);
    setAnchorIndex(null);
  }, [currentPath]);

  const selectedSet = useMemo(() => new Set(selectedPaths), [selectedPaths]);

  const handleGoUp = () => {
    const parent = getDirName(currentPath);
    if (parent && parent !== currentPath) {
      setCurrentPath(parent);
    }
  };

  const handleGoHome = () => {
    if (!homePath || currentPath === homePath) return;
    setCurrentPath(homePath);
  };

  const handleItemClick = (item: FileSystemItem, index: number, e: React.MouseEvent<HTMLDivElement>) => {
    if (item.isDirectory) {
      setCurrentPath(item.path);
      return;
    }

    const isMetaMulti = e.metaKey || e.ctrlKey;

    if (e.shiftKey && anchorIndex !== null) {
      const start = Math.min(anchorIndex, index);
      const end = Math.max(anchorIndex, index);
      const range = items
        .slice(start, end + 1)
        .filter((entry) => !entry.isDirectory)
        .map((entry) => entry.path);
      setSelectedPaths(range);
      return;
    }

    if (isMetaMulti) {
      setSelectedPaths((prev) =>
        prev.includes(item.path)
          ? prev.filter((path) => path !== item.path)
          : [...prev, item.path]
      );
      setAnchorIndex(index);
      return;
    }

    setSelectedPaths([item.path]);
    setAnchorIndex(index);
  };

  const handlePaste = async () => {
    setError(null);
    if (!worktreePath) {
      setError("Cannot paste: Session worktree path is missing.");
      return;
    }

    try {
      setLoading(true);
      
      // Request clipboard access
      const clipboardItems = await navigator.clipboard.read();
      const formData = new FormData();
      let hasFiles = false;

      for (const item of clipboardItems) {
        // Look for image types or other file types
        // We iterate through available types in the item
        for (const type of item.types) {
          // Prioritize images
          if (type.startsWith('image/')) {
            const blob = await item.getType(type);
            const ext = type.split('/')[1] || 'png';
            const filename = `pasted-image-${Date.now()}.${ext}`;
            formData.append('files', blob, filename); // 'files' is the field name used in the hypothetical server action logic?
            // Actually in saveAttachments we iterate all entries, so key name doesn't matter much but let's use filename as key
            // Wait, saveAttachments iterates entries: const [name, entry] of files. 
            // It relies on entry.name. Blob doesn't have name prop?
            // File constructor does.
            const file = new File([blob], filename, { type });
            formData.append(filename, file);
            hasFiles = true;
            break; // Found an image representation, stop checking other types for this item
          } else if (type === 'text/plain') {
             // For now, ignore plain text unless we want to save it as a text file.
             // If user copies text, they can paste directly into terminal. 
             // This feature is "pasting file".
          }
        }
      }

      if (hasFiles) {
        const savedPaths = await saveAttachments(worktreePath, formData);
        if (savedPaths && savedPaths.length > 0) {
          // Determine what to do with saved paths.
          // Option 1: auto-insert them (call onConfirm).
          // Option 2: select them in the browser (might be hard if they are in a different dir).
          // Option 3: just call onConfirm because the user clicked "Paste" to insert.
          await onConfirm(savedPaths);
          return;
        } else {
            setError("Failed to save pasted files.");
        }
      } else {
        // No files found, maybe check for text path?
        try {
            const text = await navigator.clipboard.readText();
            if (text && text.trim().startsWith('/')) {
                 // Check if it's a valid path? 
                 // Maybe just suggest it?
                 // For now, let's just error if no files found.
                 setError("No file content found in clipboard. Copy an image or file first.");
            } else {
                 setError("No file content found in clipboard.");
            }
        } catch {
             setError("No file content found in clipboard.");
        }
      }

    } catch (err) {
      console.error('Paste error:', err);
      setError("Failed to read from clipboard. permission denied or invalid content.");
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (selectedPaths.length === 0) return;
    await onConfirm(selectedPaths);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-base-200 rounded-lg shadow-xl w-full max-w-5xl h-[82vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-base-300">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Folder className="w-5 h-5" />
            Browse Files
          </h2>
          <button onClick={onCancel} className="btn btn-sm btn-ghost btn-circle" title="Close file browser">
            ✕
          </button>
        </div>

        <div className="flex items-center gap-2 p-3 bg-base-300">
          <button
            onClick={handleGoUp}
            className="btn btn-sm btn-square btn-ghost"
            title="Go Up"
            disabled={currentPath === '/' || !currentPath}
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <button
            onClick={handleGoHome}
            className="btn btn-sm btn-ghost gap-1"
            title={homePath ? `Go to Home Folder (${homePath})` : 'Go to Home Folder'}
            disabled={!homePath || currentPath === homePath}
          >
            <House className="w-4 h-4" />
            Home
          </button>
          <div className="flex-1 overflow-x-auto whitespace-nowrap px-2 font-mono text-sm">
            {currentPath}
          </div>
          <button
            onClick={handleConfirm}
            className="btn btn-sm btn-primary gap-2"
            disabled={selectedPaths.length === 0}
            title="Insert selected absolute paths"
          >
            Insert ({selectedPaths.length})
          </button>
          
          <div className="w-[1px] h-6 bg-base-content/10 mx-1"></div>

          <button
            onClick={handlePaste}
            className="btn btn-sm btn-ghost gap-2"
            title="Paste file/image from clipboard"
            disabled={!worktreePath}
          >
            <Clipboard className="w-4 h-4" />
            Paste
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {loading ? (
            <div className="flex justify-center items-center h-full">
              <span className="loading loading-spinner loading-lg"></span>
            </div>
          ) : error ? (
            <div className="alert alert-error">{error}</div>
          ) : items.length === 0 ? (
            <div className="text-center text-base-content/50 mt-10">Empty directory</div>
          ) : (
            <div className="grid grid-cols-1 gap-1">
              {items.map((item, index) => {
                const isSelected = selectedSet.has(item.path);
                return (
                  <div
                    key={item.path}
                    className={`flex items-center justify-between p-2 rounded-md cursor-pointer transition-colors border ${isSelected
                      ? 'bg-primary text-primary-content border-primary'
                      : 'hover:bg-base-100 border-transparent'
                      }`}
                    onClick={(e) => handleItemClick(item, index, e)}
                    title={item.path}
                  >
                    <div className="flex items-center gap-3 overflow-hidden">
                      {item.isDirectory ? (
                        <Folder className="w-5 h-5 shrink-0" />
                      ) : (
                        <FileText className="w-5 h-5 shrink-0" />
                      )}
                      <span className="truncate">{item.name}</span>
                    </div>
                    <span className="text-[10px] opacity-70 shrink-0">
                      {item.isDirectory ? 'folder' : 'file'}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="p-3 border-t border-base-300 text-xs text-base-content/60 text-center">
          Click: single select. Cmd/Ctrl+Click: multi-select. Shift+Click: range select.
          Click a folder to open it.
        </div>
      </div>
    </div>
  );
}
