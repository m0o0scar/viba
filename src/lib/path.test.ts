import { describe, it } from 'node:test';
import assert from 'node:assert';
import { getBaseName } from './path.ts';
import { getDirName } from './path.ts';

describe('getBaseName', () => {
  it('should return the filename from a path with POSIX separators', () => {
    assert.strictEqual(getBaseName('/path/to/file.txt'), 'file.txt');
  });

  it('should return the filename from a path with Windows separators', () => {
    assert.strictEqual(getBaseName('C:\\path\\to\\file.txt'), 'file.txt');
  });

  it('should return the last directory name if path ends with a separator', () => {
    assert.strictEqual(getBaseName('/path/to/dir/'), 'dir');
    assert.strictEqual(getBaseName('C:\\path\\to\\dir\\'), 'dir');
  });

  it('should return the filename if it is already just a filename', () => {
    assert.strictEqual(getBaseName('file.txt'), 'file.txt');
  });

  it('should handle mixed separators', () => {
    assert.strictEqual(getBaseName('path/to\\file.txt'), 'file.txt');
  });

  it('should return empty string for empty input', () => {
    assert.strictEqual(getBaseName(''), '');
  });

  it('should handle root paths (POSIX)', () => {
    assert.strictEqual(getBaseName('/'), '');
  });

  it('should handle root paths (Windows)', () => {
     // Current behavior returns 'C:' for 'C:\' or 'C:/'
     // This is because split returns ['C:', ''] and 'C:' is truthy
     assert.strictEqual(getBaseName('C:\\'), 'C:');
     assert.strictEqual(getBaseName('C:/'), 'C:');
  });

  it('should return "." or ".." if they are the path', () => {
    assert.strictEqual(getBaseName('.'), '.');
    assert.strictEqual(getBaseName('..'), '..');
  });

  it('should return empty string for null/undefined (runtime check)', () => {
    // @ts-expect-error Testing runtime behavior
    assert.strictEqual(getBaseName(null), '');
    // @ts-expect-error Testing runtime behavior
    assert.strictEqual(getBaseName(undefined), '');
  });
});

describe('getDirName', () => {
  it('should return the directory name of a file path', () => {
    assert.equal(getDirName('/a/b/c.txt'), '/a/b');
  });

  it('should return the parent directory of a directory path', () => {
    assert.equal(getDirName('/a/b/c'), '/a/b');
  });

  it('should handle trailing slashes correctly', () => {
    assert.equal(getDirName('/a/b/c/'), '/a/b');
  });

  it('should handle Windows separators', () => {
    assert.equal(getDirName('C:\\a\\b\\c.txt'), 'C:/a/b');
  });

  it('should handle mixed separators', () => {
    assert.equal(getDirName('C:\\a/b\\c.txt'), 'C:/a/b');
  });

  it('should return root for files in root', () => {
    assert.equal(getDirName('/file.txt'), '/');
  });

  it('should return . for files in current directory', () => {
    assert.equal(getDirName('file.txt'), '.');
  });

  it('should return . for relative paths without separators', () => {
    assert.equal(getDirName('dir'), '.');
  });

  it('should handle . and ..', () => {
    assert.equal(getDirName('.'), '.');
    assert.equal(getDirName('..'), '.');
  });

  it('should handle root path /', () => {
    assert.equal(getDirName('/'), '/');
  });

  it('should handle Windows root C:\\', () => {
    assert.equal(getDirName('C:\\'), 'C:/');
  });

  it('should handle Windows drive C:', () => {
    assert.equal(getDirName('C:'), 'C:');
  });

  it('should return empty string for empty input', () => {
    assert.equal(getDirName(''), '');
  });
});
