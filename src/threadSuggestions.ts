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
  const acceptedReplacements = [...thread.suggestions]
    .filter((suggestion) => suggestion.status === "accepted" && suggestion.replacement.trim())
    .reverse()
    .map((suggestion) => suggestion.replacement.trim());
  const otherReplacements = [...thread.suggestions]
    .filter((suggestion) => suggestion.status !== "accepted" && suggestion.replacement.trim())
    .reverse()
    .map((suggestion) => suggestion.replacement.trim());
  const candidates = [thread.anchor.exact, ...acceptedReplacements, ...otherReplacements]
    .map((candidate) => candidate.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  return Array.from(new Set(candidates));
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
  const currentCandidates = [
    comparableText(currentMarkdown),
    comparableText(renderedMarkdownSnippet(currentMarkdown))
  ].filter(Boolean);
  const targetCandidates = [suggestion.original, thread.anchor.exact].map(comparableText).filter(Boolean);

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
  const windowLengths = Array.from(
    new Set(
      [replacementBlockCount - 2, replacementBlockCount - 1, replacementBlockCount, replacementBlockCount + 1, replacementBlockCount + 2, 1, 2]
        .map((length) => clamp(length, 1, blocks.length))
        .filter(Boolean)
    )
  ).sort((a, b) => a - b);

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

      const startSpan = spans.find((span) => span.id === windowBlocks[0].id);
      const endSpan = spans.find((span) => span.id === windowBlocks.at(-1)?.id);
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

  for (const candidate of Array.from(new Set([suggestion.original, thread.anchor.exact].filter(Boolean)))) {
    const nextMarkdown = applySuggestion(markdown, candidate, replacement);
    if (nextMarkdown !== markdown) return nextMarkdown;
  }

  const fuzzyWindow = findFuzzySuggestionWindow(markdown, thread, suggestion);
  if (fuzzyWindow) {
    return replaceMarkdownRange(markdown, fuzzyWindow.start, fuzzyWindow.end, replacement);
  }

  return markdown;
}
