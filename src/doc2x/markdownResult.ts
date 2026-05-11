interface MarkdownPageNode {
  pageIndex: number;
  markdown: string;
  sortIndex: number;
  originalIndex: number;
}

export interface Doc2xMarkdownPage {
  pageIndex: number;
  markdown: string;
}

export type Doc2xMarkdownExtractionResult =
  | {
      ok: true;
      markdown: string;
      pages: Doc2xMarkdownPage[];
      pageCount: number;
      warnings: string[];
    }
  | {
      ok: false;
      reason: string;
      warnings: string[];
    };

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function pageMarker(pageIndex: number): string {
  if (pageIndex < 0) {
    return "<!-- page: unknown -->";
  }

  return `<!-- page: ${pageIndex + 1} -->`;
}

function uniqueWarnings(warnings: string[]): string[] {
  return [...new Set(warnings)];
}

function toMarkdownPageNode(value: unknown, originalIndex: number, warnings: string[]): MarkdownPageNode {
  const record = asRecord(value) ?? {};
  const rawPageIndex = record.page_idx ?? record.pageIndex;
  const markdownValue = record.md ?? record.markdown;
  const pageIndex = typeof rawPageIndex === "number" ? rawPageIndex : -1;

  if (pageIndex < 0) {
    warnings.push(`missing page_idx detected at parse result entry ${originalIndex}`);
  }

  return {
    pageIndex,
    markdown: typeof markdownValue === "string" ? markdownValue : "",
    sortIndex: pageIndex >= 0 ? pageIndex : Number.POSITIVE_INFINITY,
    originalIndex
  };
}

export function extractMarkdownFromParseResultData(
  parseResultData: Record<string, unknown>
): Doc2xMarkdownExtractionResult {
  const layoutResponse = asRecord(parseResultData.layout_response ?? parseResultData.layoutResponse);
  const rawPages = asArray(layoutResponse?.pages);
  if (!rawPages) {
    return {
      ok: false,
      reason: "Parse result does not contain layout_response.pages",
      warnings: []
    };
  }

  if (rawPages.length === 0) {
    return {
      ok: true,
      markdown: "",
      pages: [],
      pageCount: 0,
      warnings: ["parse result contains no pages"]
    };
  }

  const warnings: string[] = [];
  const duplicatePageIndexes = new Set<number>();
  const pageNodes = rawPages.map((page, index) => toMarkdownPageNode(page, index, warnings));

  const seenPageIndexes = new Set<number>();
  for (const pageNode of pageNodes) {
    if (pageNode.pageIndex < 0) {
      continue;
    }

    if (seenPageIndexes.has(pageNode.pageIndex)) {
      duplicatePageIndexes.add(pageNode.pageIndex);
      continue;
    }

    seenPageIndexes.add(pageNode.pageIndex);
  }

  for (const duplicatePageIndex of duplicatePageIndexes) {
    warnings.push(`duplicate page_idx detected: ${duplicatePageIndex}`);
  }

  const orderedPages = [...pageNodes].sort((left, right) => {
    if (left.sortIndex !== right.sortIndex) {
      return left.sortIndex - right.sortIndex;
    }

    return left.originalIndex - right.originalIndex;
  });

  const pages = orderedPages.map((pageNode) => ({
    pageIndex: pageNode.pageIndex,
    markdown: pageNode.markdown
  }));

  const markdown = orderedPages
    .map((pageNode) => {
      const marker = pageMarker(pageNode.pageIndex);
      return pageNode.markdown.length > 0 ? `${marker}\n\n${pageNode.markdown}` : marker;
    })
    .join("\n\n");

  return {
    ok: true,
    markdown,
    pages,
    pageCount: rawPages.length,
    warnings: uniqueWarnings(warnings)
  };
}
