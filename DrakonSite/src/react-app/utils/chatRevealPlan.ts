export interface ChatRevealPlan {
  chunks: string[];
  totalDurationMs: number;
}

type RevealUnit = {
  text: string;
  atomic?: boolean;
};

const MIN_REVEAL_STEPS = 6;
const MAX_REVEAL_STEPS = 20;
const CHARS_PER_STEP = 54;
const MIN_DURATION_MS = 620;
const MAX_DURATION_MS = 2200;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeLineEndings(markdown: string): string {
  return markdown.replace(/\r\n?/g, "\n");
}

function splitLinesPreserveEndings(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+/g) ?? [];
}

function stripLineEnding(text: string): string {
  return text.endsWith("\n") ? text.slice(0, -1) : text;
}

function isBlankLine(line: string): boolean {
  return stripLineEnding(line).trim().length === 0;
}

function isFenceStart(trimmedLine: string): RegExpMatchArray | null {
  return trimmedLine.match(/^(`{3,}|~{3,})/);
}

function isFenceEnd(trimmedLine: string, marker: string): boolean {
  const fenceChar = marker[0];
  const minimumFenceLength = marker.length;
  return new RegExp(`^${escapeForRegExp(fenceChar)}{${minimumFenceLength},}`).test(trimmedLine);
}

function isThematicBreak(trimmedLine: string): boolean {
  return /^\s{0,3}(?:[-*_]\s*){3,}$/.test(trimmedLine);
}

function isHtmlBlock(trimmedLine: string): boolean {
  return /^<\/?[A-Za-z][\w:-]*(?:\s|>|$)/.test(trimmedLine);
}

function isTableSeparatorLine(trimmedLine: string): boolean {
  return /^\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?$/.test(trimmedLine);
}

function isTableStart(lines: string[], lineIndex: number): boolean {
  if (lineIndex + 1 >= lines.length) {
    return false;
  }

  const currentLine = stripLineEnding(lines[lineIndex]).trim();
  const nextLine = stripLineEnding(lines[lineIndex + 1]).trim();
  return currentLine.includes("|") && isTableSeparatorLine(nextLine);
}

function isTableRow(line: string): boolean {
  const trimmedLine = stripLineEnding(line).trim();
  return trimmedLine.length > 0 && trimmedLine.includes("|");
}

function tokenizeNarrativeLine(line: string): RevealUnit[] {
  const lineEnding = line.endsWith("\n") ? "\n" : "";
  const content = lineEnding ? line.slice(0, -1) : line;

  if (content.trim().length === 0) {
    return [{ text: line }];
  }

  const tokens = content.match(/\s*\S+[ \t]*/g) ?? [content];
  if (tokens.length === 0) {
    return [{ text: line }];
  }

  tokens[tokens.length - 1] += lineEnding;
  return tokens.map((token) => ({ text: token }));
}

function buildRevealUnits(markdown: string): RevealUnit[] {
  const lines = splitLinesPreserveEndings(markdown);
  const units: RevealUnit[] = [];

  for (let index = 0; index < lines.length;) {
    const currentLine = lines[index];
    const trimmedLine = stripLineEnding(currentLine).trim();

    if (isBlankLine(currentLine)) {
      units.push({ text: currentLine });
      index += 1;
      continue;
    }

    const fenceStart = isFenceStart(trimmedLine);
    if (fenceStart) {
      const marker = fenceStart[1];
      let block = currentLine;
      index += 1;

      while (index < lines.length) {
        const nextLine = lines[index];
        block += nextLine;
        index += 1;

        if (isFenceEnd(stripLineEnding(nextLine).trim(), marker)) {
          break;
        }
      }

      units.push({ text: block, atomic: true });
      continue;
    }

    if (isTableStart(lines, index)) {
      let block = currentLine;
      index += 1;

      while (index < lines.length) {
        const nextLine = lines[index];
        if (isBlankLine(nextLine) || !isTableRow(nextLine)) {
          break;
        }

        block += nextLine;
        index += 1;
      }

      units.push({ text: block, atomic: true });
      continue;
    }

    if (isThematicBreak(trimmedLine) || isHtmlBlock(trimmedLine)) {
      units.push({ text: currentLine, atomic: true });
      index += 1;
      continue;
    }

    units.push(...tokenizeNarrativeLine(currentLine));
    index += 1;
  }

  return units.filter((unit) => unit.text.length > 0);
}

function mergeRevealUnits(units: RevealUnit[], totalLength: number): string[] {
  if (units.length === 0) {
    return [];
  }

  const targetChunkCount = clamp(
    Math.round(totalLength / CHARS_PER_STEP),
    MIN_REVEAL_STEPS,
    MAX_REVEAL_STEPS,
  );
  const chunkBudget = Math.max(18, Math.ceil(totalLength / targetChunkCount));
  const chunks: string[] = [];
  let buffer = "";
  let softUnitCount = 0;

  const flush = () => {
    if (!buffer) {
      return;
    }

    chunks.push(buffer);
    buffer = "";
    softUnitCount = 0;
  };

  for (const unit of units) {
    if (unit.atomic) {
      flush();
      chunks.push(unit.text);
      continue;
    }

    buffer += unit.text;
    softUnitCount += 1;

    const reachedBudget = buffer.length >= chunkBudget;
    const endedAtLineBoundary = unit.text.endsWith("\n");
    if (reachedBudget && (endedAtLineBoundary || softUnitCount >= 2)) {
      flush();
    }
  }

  flush();

  if (chunks.length <= MAX_REVEAL_STEPS) {
    return chunks;
  }

  const condensed: string[] = [];
  for (let index = 0; index < MAX_REVEAL_STEPS; index += 1) {
    const start = Math.floor((index * chunks.length) / MAX_REVEAL_STEPS);
    const end = Math.floor(((index + 1) * chunks.length) / MAX_REVEAL_STEPS);
    const group = chunks.slice(start, Math.max(end, start + 1));

    if (group.length > 0) {
      condensed.push(group.join(""));
    }
  }

  return condensed;
}

function computeRevealDuration(totalLength: number, chunkCount: number): number {
  const duration = 340 + totalLength * 1.08 + chunkCount * 74;
  return clamp(Math.round(duration), MIN_DURATION_MS, MAX_DURATION_MS);
}

export function buildChatRevealPlan(markdown: string): ChatRevealPlan {
  const normalizedMarkdown = normalizeLineEndings(markdown);
  if (!normalizedMarkdown) {
    return {
      chunks: [""],
      totalDurationMs: 0,
    };
  }

  const units = buildRevealUnits(normalizedMarkdown);
  const chunks = mergeRevealUnits(units, normalizedMarkdown.length);

  return {
    chunks: chunks.length > 0 ? chunks : [normalizedMarkdown],
    totalDurationMs: computeRevealDuration(normalizedMarkdown.length, Math.max(chunks.length, 1)),
  };
}
