export interface ChatRevealPlan {
  chunks: string[];
  revealAtMs: number[];
  totalDurationMs: number;
}

type RevealStepKind =
  | "paragraph"
  | "heading"
  | "list_item"
  | "blockquote"
  | "code_fence_open"
  | "code_line"
  | "code_fence_close"
  | "table"
  | "thematic_break"
  | "html_block";

type RevealStepInput = {
  text: string;
  kind: RevealStepKind;
  wordCount?: number;
  charCount?: number;
  lineCount?: number;
};

type RevealStep = {
  text: string;
  kind: RevealStepKind;
  wordCount: number;
  charCount: number;
  lineCount: number;
  leadingPauseMs: number;
};

const MAX_REVEAL_STEPS = 96;
const MIN_LEAD_IN_MS = 140;
const MAX_LEAD_IN_MS = 220;
const MIN_STEP_DURATION_MS = 68;
const MAX_STEP_DURATION_MS = 760;
const MIN_COMPLETION_HOLD_MS = 90;
const MAX_COMPLETION_HOLD_MS = 210;
const FIRST_STEP_HEAD_START_RATIO = 0.48;

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

function isHeadingLine(trimmedLine: string): boolean {
  return /^\s{0,3}#{1,6}\s+\S/.test(trimmedLine);
}

function isListItemStart(trimmedLine: string): boolean {
  return /^\s{0,3}(?:[-+*]|\d+[.)])\s+/.test(trimmedLine);
}

function isBlockquoteLine(trimmedLine: string): boolean {
  return /^\s{0,3}>\s?/.test(trimmedLine);
}

function countWords(text: string): number {
  return text.match(/\S+/g)?.length ?? 0;
}

function countLines(text: string): number {
  return splitLinesPreserveEndings(text).length || 1;
}

function getLeadingIndent(line: string): number {
  return line.match(/^\s*/)?.[0].length ?? 0;
}

function hashString(value: string): number {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function computeStepVariation(step: RevealStep, stepIndex: number): number {
  const seed = `${step.kind}:${stepIndex}:${step.text.trim()}`;
  const normalized = (hashString(seed) % 1000) / 999;
  return 0.88 + normalized * 0.30;
}

function computeBlankPauseMs(blankLineCount: number): number {
  if (blankLineCount <= 0) {
    return 0;
  }

  return 125 + Math.max(0, blankLineCount - 1) * 80;
}

function computeLeadInMs(stepCount: number): number {
  return clamp(140 + stepCount * 5, MIN_LEAD_IN_MS, MAX_LEAD_IN_MS);
}

function computeDurationBounds(totalLength: number, stepCount: number): { min: number; max: number } {
  const min = clamp(
    Math.round(1050 + totalLength * 3.4 + stepCount * 55),
    1200,
    6400,
  );
  const max = clamp(
    Math.round(1650 + totalLength * 4.8 + stepCount * 85),
    2200,
    7800,
  );

  return {
    min,
    max: Math.max(max, min + 240),
  };
}

function computeTerminalPauseMs(text: string): number {
  const trimmed = stripLineEnding(text).trimEnd();
  if (!trimmed) {
    return 0;
  }

  if (/[.!?…]["')\]]*$/.test(trimmed)) {
    return 120;
  }

  if (/[:;]["')\]]*$/.test(trimmed)) {
    return 90;
  }

  if (/[,]["')\]]*$/.test(trimmed)) {
    return 40;
  }

  if (text.endsWith("\n")) {
    return 25;
  }

  return 0;
}

function finalizeRevealStep(
  input: RevealStepInput,
  pendingPrefix: string,
  pendingBlankLineCount: number,
): RevealStep {
  return {
    text: `${pendingPrefix}${input.text}`,
    kind: input.kind,
    wordCount: input.wordCount ?? countWords(input.text),
    charCount: input.charCount ?? stripLineEnding(input.text).length,
    lineCount: input.lineCount ?? countLines(input.text),
    leadingPauseMs: computeBlankPauseMs(pendingBlankLineCount),
  };
}

function computeNarrativeWordBudget(line: string, burstIndex: number, remainingWords: number): number {
  if (remainingWords <= 3) {
    return remainingWords;
  }

  const seed = hashString(`${line}:${burstIndex}`);
  const target = 2 + (seed % 4);
  return remainingWords <= target + 1 ? remainingWords : target;
}

function computeNarrativeCharBudget(line: string, burstIndex: number): number {
  const seed = hashString(`chars:${line}:${burstIndex}`);
  return 20 + (seed % 18);
}

function buildNarrativeStepInputs(line: string): RevealStepInput[] {
  const lineEnding = line.endsWith("\n") ? "\n" : "";
  const content = lineEnding ? line.slice(0, -1) : line;
  if (content.trim().length === 0) {
    return [];
  }

  const tokens = content.match(/\s*\S+[ \t]*/g) ?? [content];
  const totalWords = tokens.reduce((count, token) => count + countWords(token), 0);
  const steps: RevealStepInput[] = [];
  let buffer = "";
  let bufferWordCount = 0;
  let bufferCharCount = 0;
  let burstIndex = 0;
  let consumedWords = 0;
  let wordBudget = computeNarrativeWordBudget(content, burstIndex, totalWords);
  let charBudget = computeNarrativeCharBudget(content, burstIndex);

  const flush = (isLastBurst: boolean) => {
    if (!buffer) {
      return;
    }

    const text = isLastBurst ? `${buffer}${lineEnding}` : buffer;
    steps.push({
      text,
      kind: "paragraph",
      wordCount: bufferWordCount,
      charCount: bufferCharCount,
      lineCount: 1,
    });

    consumedWords += bufferWordCount;
    buffer = "";
    bufferWordCount = 0;
    bufferCharCount = 0;
    burstIndex += 1;

    const remainingWords = Math.max(totalWords - consumedWords, 0);
    wordBudget = computeNarrativeWordBudget(content, burstIndex, remainingWords);
    charBudget = computeNarrativeCharBudget(content, burstIndex);
  };

  tokens.forEach((token, tokenIndex) => {
    buffer += token;
    bufferWordCount += countWords(token);
    bufferCharCount += token.trim().length;

    const trimmedToken = token.trimEnd();
    const isLastToken = tokenIndex === tokens.length - 1;
    const reachedWordBudget = bufferWordCount >= wordBudget;
    const reachedCharBudget = bufferCharCount >= charBudget;
    const hitStrongBoundary = /[.!?…]["')\]]*$/.test(trimmedToken);
    const hitSoftBoundary = /[,;:]["')\]]*$/.test(trimmedToken);

    if (isLastToken) {
      flush(true);
      return;
    }

    if (
      (hitStrongBoundary && bufferWordCount >= 1) ||
      (hitSoftBoundary && bufferWordCount >= 2) ||
      reachedWordBudget ||
      reachedCharBudget
    ) {
      flush(false);
    }
  });

  return steps;
}

function collectListItemBlock(lines: string[], startIndex: number): { text: string; nextIndex: number } {
  let block = lines[startIndex];
  let index = startIndex + 1;
  const baseIndent = getLeadingIndent(lines[startIndex]);

  while (index < lines.length) {
    const nextLine = lines[index];
    const strippedNextLine = stripLineEnding(nextLine);
    const trimmedNextLine = strippedNextLine.trim();

    if (!trimmedNextLine) {
      break;
    }

    const nextIndent = getLeadingIndent(nextLine);
    if (isListItemStart(trimmedNextLine) && nextIndent <= baseIndent) {
      break;
    }

    if (isFenceStart(trimmedNextLine) || isTableStart(lines, index) || isThematicBreak(trimmedNextLine)) {
      break;
    }

    if (nextIndent > baseIndent || isBlockquoteLine(trimmedNextLine)) {
      block += nextLine;
      index += 1;
      continue;
    }

    break;
  }

  return { text: block, nextIndex: index };
}

function collectTableBlock(lines: string[], startIndex: number): { text: string; nextIndex: number; lineCount: number } {
  let block = lines[startIndex];
  let index = startIndex + 1;

  while (index < lines.length) {
    const nextLine = lines[index];
    if (isBlankLine(nextLine) || !isTableRow(nextLine)) {
      break;
    }

    block += nextLine;
    index += 1;
  }

  return {
    text: block,
    nextIndex: index,
    lineCount: countLines(block),
  };
}

function buildCodeFenceStepInputs(lines: string[], startIndex: number): { steps: RevealStepInput[]; nextIndex: number } {
  const firstLine = lines[startIndex];
  const marker = isFenceStart(stripLineEnding(firstLine).trim())?.[1];
  const blockLines = [firstLine];
  let index = startIndex + 1;

  while (index < lines.length) {
    const nextLine = lines[index];
    blockLines.push(nextLine);
    index += 1;

    if (marker && isFenceEnd(stripLineEnding(nextLine).trim(), marker)) {
      break;
    }
  }

  const steps: RevealStepInput[] = [];
  if (blockLines.length === 0) {
    return { steps, nextIndex: index };
  }

  steps.push({
    text: blockLines[0],
    kind: "code_fence_open",
    charCount: stripLineEnding(blockLines[0]).length,
    lineCount: 1,
  });

  const lastLineIndex = blockLines.length - 1;
  const hasClosingFence =
    marker &&
    lastLineIndex > 0 &&
    isFenceEnd(stripLineEnding(blockLines[lastLineIndex]).trim(), marker);
  const contentEndIndex = hasClosingFence ? lastLineIndex : blockLines.length;

  for (let lineIndex = 1; lineIndex < contentEndIndex; lineIndex += 1) {
    const codeLine = blockLines[lineIndex];
    steps.push({
      text: codeLine,
      kind: "code_line",
      charCount: stripLineEnding(codeLine).length,
      lineCount: 1,
    });
  }

  if (hasClosingFence) {
    const closingFenceLine = blockLines[lastLineIndex];
    steps.push({
      text: closingFenceLine,
      kind: "code_fence_close",
      charCount: stripLineEnding(closingFenceLine).length,
      lineCount: 1,
    });
  }

  return { steps, nextIndex: index };
}

function buildRevealSteps(markdown: string): RevealStep[] {
  const lines = splitLinesPreserveEndings(markdown);
  const steps: RevealStep[] = [];
  let pendingPrefix = "";
  let pendingBlankLineCount = 0;

  const pushInputs = (inputs: RevealStepInput[]) => {
    inputs.forEach((input, inputIndex) => {
      steps.push(
        finalizeRevealStep(
          input,
          inputIndex === 0 ? pendingPrefix : "",
          inputIndex === 0 ? pendingBlankLineCount : 0,
        ),
      );
      pendingPrefix = "";
      pendingBlankLineCount = 0;
    });
  };

  for (let index = 0; index < lines.length;) {
    const currentLine = lines[index];
    const trimmedLine = stripLineEnding(currentLine).trim();

    if (isBlankLine(currentLine)) {
      pendingPrefix += currentLine;
      pendingBlankLineCount += 1;
      index += 1;
      continue;
    }

    const fenceStart = isFenceStart(trimmedLine);
    if (fenceStart) {
      const codeFenceBlock = buildCodeFenceStepInputs(lines, index);
      pushInputs(codeFenceBlock.steps);
      index = codeFenceBlock.nextIndex;
      continue;
    }

    if (isTableStart(lines, index)) {
      const tableBlock = collectTableBlock(lines, index);
      pushInputs([
        {
          text: tableBlock.text,
          kind: "table",
          lineCount: tableBlock.lineCount,
          charCount: stripLineEnding(tableBlock.text).length,
        },
      ]);
      index = tableBlock.nextIndex;
      continue;
    }

    if (isThematicBreak(trimmedLine)) {
      pushInputs([
        {
          text: currentLine,
          kind: "thematic_break",
          charCount: stripLineEnding(currentLine).length,
          lineCount: 1,
        },
      ]);
      index += 1;
      continue;
    }

    if (isHtmlBlock(trimmedLine)) {
      pushInputs([
        {
          text: currentLine,
          kind: "html_block",
          charCount: stripLineEnding(currentLine).length,
          lineCount: 1,
        },
      ]);
      index += 1;
      continue;
    }

    if (isHeadingLine(trimmedLine)) {
      pushInputs([
        {
          text: currentLine,
          kind: "heading",
          charCount: stripLineEnding(currentLine).length,
          wordCount: countWords(trimmedLine.replace(/^#{1,6}\s+/, "")),
          lineCount: 1,
        },
      ]);
      index += 1;
      continue;
    }

    if (isListItemStart(trimmedLine)) {
      const listItem = collectListItemBlock(lines, index);
      pushInputs([
        {
          text: listItem.text,
          kind: "list_item",
          charCount: stripLineEnding(listItem.text).length,
          wordCount: countWords(listItem.text.replace(/^\s{0,3}(?:[-+*]|\d+[.)])\s+/, "")),
          lineCount: countLines(listItem.text),
        },
      ]);
      index = listItem.nextIndex;
      continue;
    }

    if (isBlockquoteLine(trimmedLine)) {
      pushInputs([
        {
          text: currentLine,
          kind: "blockquote",
          charCount: stripLineEnding(currentLine).length,
          wordCount: countWords(currentLine.replace(/^\s{0,3}>\s?/, "")),
          lineCount: 1,
        },
      ]);
      index += 1;
      continue;
    }

    pushInputs(buildNarrativeStepInputs(currentLine));
    index += 1;
  }

  if (pendingPrefix) {
    if (steps.length > 0) {
      steps[steps.length - 1] = {
        ...steps[steps.length - 1],
        text: `${steps[steps.length - 1].text}${pendingPrefix}`,
      };
    } else {
      steps.push({
        text: pendingPrefix,
        kind: "paragraph",
        wordCount: 0,
        charCount: 0,
        lineCount: countLines(pendingPrefix),
        leadingPauseMs: 0,
      });
    }
  }

  return condenseRevealSteps(steps);
}

function canSoftMergeSteps(previousStep: RevealStep, nextStep: RevealStep): boolean {
  if (nextStep.leadingPauseMs > 0) {
    return false;
  }

  if (previousStep.kind !== nextStep.kind) {
    return false;
  }

  return (
    previousStep.kind === "paragraph" ||
    previousStep.kind === "blockquote" ||
    previousStep.kind === "code_line"
  );
}

function mergeSteps(previousStep: RevealStep, nextStep: RevealStep): RevealStep {
  return {
    text: `${previousStep.text}${nextStep.text}`,
    kind: previousStep.kind,
    wordCount: previousStep.wordCount + nextStep.wordCount,
    charCount: previousStep.charCount + nextStep.charCount,
    lineCount: previousStep.lineCount + nextStep.lineCount,
    leadingPauseMs: previousStep.leadingPauseMs,
  };
}

function condenseRevealSteps(steps: RevealStep[]): RevealStep[] {
  const condensedSteps = [...steps];
  if (condensedSteps.length <= MAX_REVEAL_STEPS) {
    return condensedSteps;
  }

  let stepIndex = 1;
  while (condensedSteps.length > MAX_REVEAL_STEPS && stepIndex < condensedSteps.length) {
    const previousStep = condensedSteps[stepIndex - 1];
    const currentStep = condensedSteps[stepIndex];

    if (!previousStep || !currentStep) {
      break;
    }

    if (!canSoftMergeSteps(previousStep, currentStep)) {
      stepIndex += 1;
      continue;
    }

    condensedSteps.splice(stepIndex - 1, 2, mergeSteps(previousStep, currentStep));
  }

  return condensedSteps;
}

function estimateStepDurationMs(step: RevealStep, stepIndex: number): number {
  const terminalPauseMs = computeTerminalPauseMs(step.text);
  let baseDurationMs = 0;

  switch (step.kind) {
    case "heading":
      baseDurationMs = 115 + step.wordCount * 22 + step.charCount * 0.70 + 60;
      break;
    case "list_item":
      baseDurationMs = 120 + step.wordCount * 22 + step.charCount * 0.55 + (step.lineCount - 1) * 35;
      break;
    case "blockquote":
      baseDurationMs = 100 + step.wordCount * 22 + step.charCount * 0.75 + 30;
      break;
    case "code_fence_open":
      baseDurationMs = 110 + step.charCount * 0.25 + 70;
      break;
    case "code_line":
      baseDurationMs = step.charCount === 0 ? 80 : 82 + Math.min(60, step.charCount) * 1.55;
      break;
    case "code_fence_close":
      baseDurationMs = 90 + step.charCount * 0.20;
      break;
    case "table":
      baseDurationMs = 240 + step.lineCount * 60 + step.charCount * 0.18;
      break;
    case "thematic_break":
      baseDurationMs = 110;
      break;
    case "html_block":
      baseDurationMs = 145 + step.charCount * 0.30;
      break;
    case "paragraph":
    default:
      baseDurationMs = 56 + step.wordCount * 24 + step.charCount * 0.85;
      break;
  }

  const variedDurationMs = step.leadingPauseMs + baseDurationMs * computeStepVariation(step, stepIndex) + terminalPauseMs;
  return clamp(Math.round(variedDurationMs), MIN_STEP_DURATION_MS, MAX_STEP_DURATION_MS);
}

function estimateCompletionHoldMs(step: RevealStep): number {
  const holdMs = 80 + step.wordCount * 9 + Math.min(90, step.charCount * 0.35);
  return clamp(Math.round(holdMs), MIN_COMPLETION_HOLD_MS, MAX_COMPLETION_HOLD_MS);
}

function buildRevealTimeline(steps: RevealStep[], totalLength: number): {
  revealAtMs: number[];
  totalDurationMs: number;
} {
  if (steps.length === 0) {
    return {
      revealAtMs: [],
      totalDurationMs: 0,
    };
  }

  const leadInMs = computeLeadInMs(steps.length);
  const stepDurations = steps.map((step, index) => estimateStepDurationMs(step, index));
  const completionHoldMs = estimateCompletionHoldMs(steps[steps.length - 1]);
  const durationBounds = computeDurationBounds(totalLength, steps.length);
  const desiredMotionMinMs = Math.max(durationBounds.min - leadInMs, 0);
  const desiredMotionMaxMs = Math.max(durationBounds.max - leadInMs, desiredMotionMinMs + 240);
  const rawMotionMs = stepDurations.reduce((total, durationMs) => total + durationMs, 0) + completionHoldMs;
  const scale =
    rawMotionMs <= 0
      ? 1
      : rawMotionMs < desiredMotionMinMs
        ? clamp(desiredMotionMinMs / rawMotionMs, 1, 1.95)
        : rawMotionMs > desiredMotionMaxMs
          ? clamp(desiredMotionMaxMs / rawMotionMs, 0.72, 1)
          : 1;

  const scaledStepDurations = stepDurations.map((durationMs) =>
    clamp(Math.round(durationMs * scale), MIN_STEP_DURATION_MS, MAX_STEP_DURATION_MS),
  );
  const scaledCompletionHoldMs = clamp(
    Math.round(completionHoldMs * scale),
    MIN_COMPLETION_HOLD_MS,
    MAX_COMPLETION_HOLD_MS,
  );

  const revealAtMs: number[] = [];
  const firstStepDurationMs = scaledStepDurations[0] ?? 0;
  let currentTimestampMs =
    leadInMs + Math.round(firstStepDurationMs * FIRST_STEP_HEAD_START_RATIO);

  revealAtMs.push(currentTimestampMs);

  if (scaledStepDurations.length > 1) {
    currentTimestampMs += firstStepDurationMs - Math.round(firstStepDurationMs * FIRST_STEP_HEAD_START_RATIO);

    for (let index = 1; index < scaledStepDurations.length; index += 1) {
      currentTimestampMs += scaledStepDurations[index];
      revealAtMs.push(currentTimestampMs);
    }
  }

  const totalDurationMs =
    leadInMs + scaledStepDurations.reduce((total, durationMs) => total + durationMs, 0) + scaledCompletionHoldMs;

  return {
    revealAtMs,
    totalDurationMs,
  };
}

export function buildChatRevealPlan(markdown: string): ChatRevealPlan {
  const normalizedMarkdown = normalizeLineEndings(markdown);
  if (!normalizedMarkdown) {
    return {
      chunks: [""],
      revealAtMs: [0],
      totalDurationMs: 0,
    };
  }

  const revealSteps = buildRevealSteps(normalizedMarkdown);
  const chunks = revealSteps.map((step) => step.text);
  const timeline = buildRevealTimeline(
    revealSteps,
    normalizedMarkdown.length,
  );

  return {
    chunks: chunks.length > 0 ? chunks : [normalizedMarkdown],
    revealAtMs: timeline.revealAtMs.length > 0 ? timeline.revealAtMs : [0],
    totalDurationMs: timeline.totalDurationMs,
  };
}
