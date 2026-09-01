/**
 * siteDiff.ts — Diff View Generator for Site Modification
 *
 * Computes line-by-line diffs between old and proposed generated code.
 * Ensures confirmation-first pattern before overwriting existing files.
 */

export interface DiffLine {
  type: 'add' | 'delete' | 'normal';
  lineNumberOld?: number;
  lineNumberNew?: number;
  content: string;
}

export interface DiffResult {
  filePath: string;
  oldCode: string;
  newCode: string;
  lines: DiffLine[];
  additions: number;
  deletions: number;
}

export function computeLineDiff(filePath: string, oldCode: string, newCode: string): DiffResult {
  const oldLines = oldCode.split('\n');
  const newLines = newCode.split('\n');
  const lines: DiffLine[] = [];

  let additions = 0;
  let deletions = 0;

  let i = 0;
  let j = 0;

  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      lines.push({ type: 'normal', lineNumberOld: i + 1, lineNumberNew: j + 1, content: oldLines[i] });
      i++;
      j++;
    } else {
      if (j < newLines.length && (i >= oldLines.length || !oldLines.slice(i).includes(newLines[j]))) {
        lines.push({ type: 'add', lineNumberNew: j + 1, content: newLines[j] });
        additions++;
        j++;
      } else if (i < oldLines.length) {
        lines.push({ type: 'delete', lineNumberOld: i + 1, content: oldLines[i] });
        deletions++;
        i++;
      }
    }
  }

  return {
    filePath,
    oldCode,
    newCode,
    lines,
    additions,
    deletions,
  };
}
