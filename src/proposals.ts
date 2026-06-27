import { parseDiffFromFile } from "@pierre/diffs";
import type { FileDiffMetadata } from "@pierre/diffs";
import { parseMarkdownBlocks } from "./document.ts";
import {
  characterIndexForLine,
  getMarkdownBlockLineSpans,
  type MarkdownBlockLineSpan
} from "./markdownRanges.ts";
import type { DocumentProposal, ProposalChangeDecision } from "./types.ts";

export interface ProposalChangeBlock {
  key: string;
  hunkIndex: number;
  changeIndex: number;
  ordinal: number;
  deletionLineStart: number;
  additionLineStart: number;
  deletions: string[];
  additions: string[];
}

export interface InlineProposalChange extends ProposalChangeBlock {
  proposalId: string;
  decision?: ProposalChangeDecision;
  anchorBlockId: string | null;
}

export interface InlineProposalReview {
  proposal: DocumentProposal;
  changes: InlineProposalChange[];
  decidedCount: number;
}

export function buildProposalDiff(proposal: DocumentProposal): FileDiffMetadata | null {
  if (proposal.originalMarkdown === proposal.replacementMarkdown) return null;

  try {
    return parseDiffFromFile(
      {
        name: "draft.md",
        contents: proposal.originalMarkdown,
        lang: "markdown",
        cacheKey: `${proposal.id}:original`
      },
      {
        name: "draft.md",
        contents: proposal.replacementMarkdown,
        lang: "markdown",
        cacheKey: `${proposal.id}:replacement`
      }
    );
  } catch (error) {
    console.error("Unable to build proposal diff", error);
    return null;
  }
}

export function getProposalChangeBlocks(fileDiff: FileDiffMetadata | null): ProposalChangeBlock[] {
  if (!fileDiff) return [];

  let ordinal = 1;
  return fileDiff.hunks.flatMap((hunk, hunkIndex) =>
    hunk.hunkContent.flatMap((content, changeIndex) => {
      if (content.type !== "change") return [];
      const block: ProposalChangeBlock = {
        key: `${hunkIndex}:${changeIndex}`,
        hunkIndex,
        changeIndex,
        ordinal,
        deletionLineStart: content.deletionLineIndex + 1,
        additionLineStart: content.additionLineIndex + 1,
        deletions: fileDiff.deletionLines.slice(content.deletionLineIndex, content.deletionLineIndex + content.deletions),
        additions: fileDiff.additionLines.slice(content.additionLineIndex, content.additionLineIndex + content.additions)
      };
      ordinal += 1;
      return [block];
    })
  );
}

function sortChangesForReverseApply(changes: ProposalChangeBlock[]) {
  return changes.toSorted(
    (a, b) => b.deletionLineStart - a.deletionLineStart || b.hunkIndex - a.hunkIndex || b.changeIndex - a.changeIndex
  );
}

export function buildMarkdownFromProposalDecisions(
  proposal: DocumentProposal,
  decisions: Record<string, ProposalChangeDecision>
) {
  const fileDiff = buildProposalDiff(proposal);
  if (!fileDiff) return proposal.replacementMarkdown;

  const lines = [...fileDiff.deletionLines];

  for (const change of sortChangesForReverseApply(getProposalChangeBlocks(fileDiff))) {
    if (decisions[change.key] !== "accepted") continue;
    lines.splice(change.deletionLineStart - 1, change.deletions.length, ...change.additions);
  }

  return lines.join("");
}

function parseMarkdownDiff(oldMarkdown: string, newMarkdown: string) {
  if (oldMarkdown === newMarkdown) return null;

  try {
    return parseDiffFromFile(
      {
        name: "draft.md",
        contents: oldMarkdown,
        lang: "markdown"
      },
      {
        name: "draft.md",
        contents: newMarkdown,
        lang: "markdown"
      }
    );
  } catch {
    return null;
  }
}

function closestIndex(indexes: number[], approximateIndex: number) {
  if (indexes.length === 0) return null;
  return indexes.reduce((best, index) =>
    Math.abs(index - approximateIndex) < Math.abs(best - approximateIndex) ? index : best
  );
}

function findExactOccurrenceNear(markdown: string, needle: string, approximateIndex: number) {
  if (!needle) return null;

  const indexes: number[] = [];
  let index = markdown.indexOf(needle);
  while (index !== -1) {
    indexes.push(index);
    index = markdown.indexOf(needle, index + Math.max(needle.length, 1));
  }

  return closestIndex(indexes, approximateIndex);
}

function findManualInsertionIndex(markdown: string, sourceLines: string[], lineIndex: number) {
  const approximateIndex = characterIndexForLine(markdown, lineIndex + 1);

  for (let size = Math.min(4, lineIndex); size >= 1; size -= 1) {
    const beforeContext = sourceLines.slice(lineIndex - size, lineIndex).join("");
    if (!beforeContext) continue;
    const beforeIndex = findExactOccurrenceNear(markdown, beforeContext, approximateIndex);
    if (beforeIndex !== null) return beforeIndex + beforeContext.length;
  }

  for (let size = 1; size <= 4; size += 1) {
    const afterContext = sourceLines.slice(lineIndex, Math.min(sourceLines.length, lineIndex + size)).join("");
    if (!afterContext) continue;
    const afterIndex = findExactOccurrenceNear(markdown, afterContext, approximateIndex);
    if (afterIndex !== null) return afterIndex;
  }

  return null;
}

function rebaseManualMarkdownEdits(previousMarkdown: string, currentMarkdown: string, nextMarkdown: string) {
  if (currentMarkdown === previousMarkdown) return nextMarkdown;

  const manualDiff = parseMarkdownDiff(previousMarkdown, currentMarkdown);
  if (!manualDiff) return null;

  const changes = getProposalChangeBlocks(manualDiff);
  const changedLineCount = changes.reduce((total, change) => total + change.deletions.length + change.additions.length, 0);
  if (changedLineCount > Math.max(40, manualDiff.deletionLines.length * 0.15)) return null;

  return sortChangesForReverseApply(changes).reduce<string | null>((markdown, change) => {
    if (markdown === null) return null;

    const source = change.deletions.join("");
    const replacement = change.additions.join("");

    if (!source) {
      const insertIndex = findManualInsertionIndex(markdown, manualDiff.deletionLines, change.deletionLineStart - 1);
      return insertIndex === null
        ? null
        : `${markdown.slice(0, insertIndex)}${replacement}${markdown.slice(insertIndex)}`;
    }

    const approximateIndex = characterIndexForLine(markdown, change.deletionLineStart);
    const exactIndex = findExactOccurrenceNear(markdown, source, approximateIndex);
    return exactIndex === null
      ? null
      : `${markdown.slice(0, exactIndex)}${replacement}${markdown.slice(exactIndex + source.length)}`;
  }, nextMarkdown);
}

export function applyProposalDecisionTransitions(
  markdown: string,
  proposal: DocumentProposal,
  nextDecisions: Record<string, ProposalChangeDecision>
) {
  const previousMarkdown = buildMarkdownFromProposalDecisions(proposal, proposal.changeDecisions ?? {});
  const nextMarkdown = buildMarkdownFromProposalDecisions(proposal, nextDecisions);

  return rebaseManualMarkdownEdits(previousMarkdown, markdown, nextMarkdown) ?? nextMarkdown;
}

export function resolveProposalStatus(
  changes: ProposalChangeBlock[],
  decisions: Record<string, ProposalChangeDecision>
): DocumentProposal["status"] {
  if (changes.length === 0) return "accepted";
  if (!changes.every((change) => decisions[change.key])) return "open";
  if (changes.every((change) => decisions[change.key] === "accepted")) return "accepted";
  if (changes.every((change) => decisions[change.key] === "rejected")) return "rejected";
  return "reviewed";
}

export function lineRangeLabel(start: number, count: number) {
  if (count === 0) return "insert";
  if (count === 1) return String(start);
  return `${start}-${start + count - 1}`;
}

export function trimBlockText(lines: string[]) {
  return lines.join("").trim() || "(empty)";
}

function findNearestBlockSpan(spans: MarkdownBlockLineSpan[], line: number) {
  if (spans.length === 0) return null;
  return (
    spans.find((span) => line >= span.startLine && line <= span.endLine) ??
    spans.find((span) => span.startLine > line) ??
    spans.at(-1) ??
    null
  );
}

export function buildInlineProposalReview(proposal: DocumentProposal, currentMarkdown: string): InlineProposalReview {
  const changes = getProposalChangeBlocks(buildProposalDiff(proposal));
  const decisions = proposal.changeDecisions ?? {};
  const originalSpans = getMarkdownBlockLineSpans(proposal.originalMarkdown);
  const replacementSpans = getMarkdownBlockLineSpans(proposal.replacementMarkdown);
  const currentSpans = getMarkdownBlockLineSpans(currentMarkdown);
  const currentBlockIds = new Set(currentSpans.map((span) => span.id));
  const originalBlocks = parseMarkdownBlocks(proposal.originalMarkdown);
  const replacementBlocks = parseMarkdownBlocks(proposal.replacementMarkdown);
  const currentBlocks = parseMarkdownBlocks(currentMarkdown);
  const normalizeText = (text: string) => text.replace(/\s+/g, " ").trim();

  return {
    proposal,
    decidedCount: changes.filter((change) => decisions[change.key]).length,
    changes: changes.map((change) => {
      const sourceSpans = change.deletions.length > 0 ? originalSpans : replacementSpans;
      const sourceBlocks = change.deletions.length > 0 ? originalBlocks : replacementBlocks;
      const sourceLine = change.deletions.length > 0 ? change.deletionLineStart : change.additionLineStart;
      const sourceSpan = findNearestBlockSpan(sourceSpans, sourceLine);
      const sourceIndex = sourceSpan ? sourceSpans.findIndex((span) => span.id === sourceSpan.id) : -1;
      const fallbackSpan = sourceIndex >= 0 ? currentSpans[Math.min(sourceIndex, currentSpans.length - 1)] : currentSpans.at(0);

      // Prefer anchoring to the current block whose CONTENT matches the proposal's
      // source block — so the change card follows its text if the document is
      // edited (blocks inserted/removed above) while the proposal is pending.
      // Fall back to positional matching when the content can't be located.
      const sourceText = sourceIndex >= 0 ? sourceBlocks[sourceIndex]?.text : undefined;
      const contentIndex =
        sourceText && normalizeText(sourceText)
          ? currentBlocks.findIndex((block) => normalizeText(block.text) === normalizeText(sourceText))
          : -1;
      const anchorBlockId =
        contentIndex >= 0
          ? currentSpans[contentIndex]?.id ?? null
          : sourceSpan && currentBlockIds.has(sourceSpan.id)
            ? sourceSpan.id
            : fallbackSpan?.id ?? null;

      return {
        ...change,
        proposalId: proposal.id,
        decision: decisions[change.key],
        anchorBlockId
      };
    })
  };
}
