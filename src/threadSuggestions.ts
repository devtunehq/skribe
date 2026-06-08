import { applySuggestion, parseMarkdownBlocks, serializeMarkdownBlocks } from "./document.ts";
import {
  characterIndexForLine,
  clamp,
  comparableText,
  getMarkdownBlockLineSpans,
  renderedMarkdownSnippet
} from "./markdownRanges.ts";
import type { ReviewThread, Suggestion } from "./types.ts";

export function getThreadAnchorCandidates(thread: ReviewThread) {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const addCandidate = (value: string) => {
    const normalized = value.replace(/\s+/g, " ").trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    candidates.push(normalized);
  };

  addCandidate(thread.anchor.exact);
  for (let index = thread.suggestions.length - 1; index >= 0; index -= 1) {
    const suggestion = thread.suggestions[index];
    if (suggestion.status === "accepted") addCandidate(suggestion.replacement);
  }
  for (let index = thread.suggestions.length - 1; index >= 0; index -= 1) {
    const suggestion = thread.suggestions[index];
    if (suggestion.status !== "accepted") addCandidate(suggestion.replacement);
  }

  return candidates;
}

export function findThreadAnchorInText(thread: ReviewThread, text: string) {
  for (const candidate of getThreadAnchorCandidates(thread)) {
    const index = text.indexOf(candidate);
    if (index >= 0) {
      return {
        exact: candidate,
        start: index,
        end: index + candidate.length
      };
    }
  }

  return null;
}

const fuzzyTokenStopWords = new Set([
  "the",
  "and",
  "for",
  "that",
  "this",
  "with",
  "from",
  "into",
  "here",
  "there",
  "another",
  "company",
  "worth",
  "watching",
  "trying",
  "become",
  "becomes",
  "because",
  "between",
  "without",
  "where",
  "which",
  "while"
]);

function fuzzyTokens(value: string) {
  return Array.from(
    new Set(
      renderedMarkdownSnippet(value)
        .toLowerCase()
        .match(/[a-z0-9]+(?:[._:-][a-z0-9]+)*/g)
        ?.filter((token) => token.length > 2 && !fuzzyTokenStopWords.has(token)) ?? []
    )
  );
}

function isDistinctiveToken(token: string) {
  return token.includes(".") || token.includes(":") || token.length >= 8;
}

function scoreFuzzyText(candidate: string, target: string) {
  const candidateTokens = new Set(fuzzyTokens(candidate));
  const targetTokens = new Set(fuzzyTokens(target));
  if (candidateTokens.size === 0 || targetTokens.size === 0) {
    return { score: 0, overlap: 0, sharedDistinctive: false };
  }

  const shared = Array.from(targetTokens).filter((token) => candidateTokens.has(token));
  const overlap = shared.length;
  const containment = overlap / Math.min(candidateTokens.size, targetTokens.size);
  const coverage = overlap / targetTokens.size;

  return {
    score: Math.max(containment, coverage),
    overlap,
    sharedDistinctive: shared.some(isDistinctiveToken)
  };
}

function bestSuggestionTextScore(candidate: string, thread: ReviewThread, suggestion: Suggestion) {
  return [suggestion.replacement, suggestion.original, thread.anchor.exact].reduce(
    (best, target) => {
      const score = scoreFuzzyText(candidate, target);
      return score.score > best.score ? score : best;
    },
    { score: 0, overlap: 0, sharedDistinctive: false }
  );
}

function isSafeFuzzySuggestionMatch(match: ReturnType<typeof scoreFuzzyText>) {
  if (match.overlap >= 4 && match.score >= 0.28) return true;
  return match.overlap >= 2 && match.sharedDistinctive && match.score >= 0.35;
}

function rangeMatchesThreadSuggestion(currentMarkdown: string, thread: ReviewThread, suggestion: Suggestion) {
  const currentCandidates: string[] = [];
  for (const candidate of [comparableText(currentMarkdown), comparableText(renderedMarkdownSnippet(currentMarkdown))]) {
    if (candidate) currentCandidates.push(candidate);
  }

  const targetCandidates: string[] = [];
  for (const target of [suggestion.original, thread.anchor.exact]) {
    const comparable = comparableText(target);
    if (comparable) targetCandidates.push(comparable);
  }

  return (
    targetCandidates.some((target) => currentCandidates.includes(target)) ||
    isSafeFuzzySuggestionMatch(bestSuggestionTextScore(currentMarkdown, thread, suggestion))
  );
}

function lineStartIndex(markdown: string, lineNumber: number) {
  return characterIndexForLine(markdown, lineNumber);
}

function replaceMarkdownRange(markdown: string, start: number, end: number, replacement: string) {
  const before = markdown.slice(0, start);
  const after = markdown.slice(end).replace(/^\n+/, "");
  const normalizedReplacement = replacement.trimEnd();
  const beforeBreak = before && !before.endsWith("\n") ? "\n\n" : "";
  const afterBreak = after ? "\n\n" : "";

  return `${before}${beforeBreak}${normalizedReplacement}${afterBreak}${after}`;
}

function findFuzzySuggestionWindow(markdown: string, thread: ReviewThread, suggestion: Suggestion) {
  const blocks = parseMarkdownBlocks(markdown);
  const spans = getMarkdownBlockLineSpans(markdown);
  if (blocks.length === 0 || spans.length === 0) return null;

  const replacementBlockCount = Math.max(1, parseMarkdownBlocks(suggestion.replacement).length);
  const windowLengthSet = new Set<number>();
  for (const rawLength of [replacementBlockCount - 2, replacementBlockCount - 1, replacementBlockCount, replacementBlockCount + 1, replacementBlockCount + 2, 1, 2]) {
    const length = clamp(rawLength, 1, blocks.length);
    if (length) windowLengthSet.add(length);
  }
  const windowLengths = Array.from(windowLengthSet).sort((a, b) => a - b);
  const spansById = new Map(spans.map((span) => [span.id, span]));

  let best:
    | {
        start: number;
        end: number;
        blockCount: number;
        score: ReturnType<typeof scoreFuzzyText>;
      }
    | null = null;

  for (const length of windowLengths) {
    for (let index = 0; index <= blocks.length - length; index += 1) {
      const windowBlocks = blocks.slice(index, index + length);
      const windowMarkdown = serializeMarkdownBlocks(windowBlocks).trimEnd();
      const score = bestSuggestionTextScore(windowMarkdown, thread, suggestion);
      if (!isSafeFuzzySuggestionMatch(score)) continue;

      const startSpan = spansById.get(windowBlocks[0].id);
      const endBlock = windowBlocks.at(-1);
      const endSpan = endBlock ? spansById.get(endBlock.id) : undefined;
      if (!startSpan || !endSpan) continue;

      const start = lineStartIndex(markdown, startSpan.startLine);
      const end = lineStartIndex(markdown, endSpan.endLine + 1);
      if (
        !best ||
        score.score > best.score.score + 0.02 ||
        (Math.abs(score.score - best.score.score) <= 0.02 &&
          (length < best.blockCount || (length === best.blockCount && score.overlap > best.score.overlap)))
      ) {
        best = { start, end, blockCount: length, score };
      }
    }
  }

  return best;
}

export function applyThreadSuggestionToMarkdown(markdown: string, thread: ReviewThread, suggestion: Suggestion) {
  const replacement = suggestion.replacement;
  if (!replacement.trim() || markdown.includes(replacement)) return markdown;

  if (thread.anchor.kind === "markdown-range") {
    const start = clamp(thread.anchor.start, 0, markdown.length);
    const end = clamp(thread.anchor.end, start, markdown.length);
    const currentMarkdown = markdown.slice(start, end);

    if (currentMarkdown && rangeMatchesThreadSuggestion(currentMarkdown, thread, suggestion)) {
      return `${markdown.slice(0, start)}${replacement}${markdown.slice(end)}`;
    }
  }

  const exactCandidates = new Set<string>();
  if (suggestion.original) exactCandidates.add(suggestion.original);
  if (thread.anchor.exact) exactCandidates.add(thread.anchor.exact);
  for (const candidate of exactCandidates) {
    const nextMarkdown = applySuggestion(markdown, candidate, replacement);
    if (nextMarkdown !== markdown) return nextMarkdown;
  }

  const fuzzyWindow = findFuzzySuggestionWindow(markdown, thread, suggestion);
  if (fuzzyWindow) {
    return replaceMarkdownRange(markdown, fuzzyWindow.start, fuzzyWindow.end, replacement);
  }

  return markdown;
}
