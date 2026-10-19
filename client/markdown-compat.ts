interface MarkdownNode {
  type?: string;
  index?: number;
  markup?: string;
  attributes?: { start?: number | string };
  children?: MarkdownNode[];
}

interface LinkifyMatch {
  index: number;
  lastIndex: number;
  url: string;
}

export interface MarkdownParserLike {
  linkify: { match(value: string): LinkifyMatch[] | null };
}

const FILE_EXTENSIONS = new Set([
  "astro", "bash", "c", "cc", "cjs", "cpp", "cs", "css", "cts", "cxx", "env", "fish",
  "go", "gql", "gradle", "graphql", "h", "hpp", "htm", "html", "ini", "java", "js", "json",
  "jsonc", "jsx", "kt", "kts", "less", "lock", "lua", "md", "mdx", "mjs", "mts", "php",
  "proto", "py", "rb", "rs", "sass", "scss", "sh", "sql", "svelte", "swift", "toml", "ts",
  "tsx", "txt", "vue", "xml", "yaml", "yml", "zsh",
]);

function nearestListParent(parents: MarkdownNode[]): MarkdownNode | undefined {
  // AstRenderer passes ancestors nearest-first. Looking at every ancestor lets
  // an outer ordered list misclassify a nested bullet as `1-`.
  return parents.find((parent) => parent.type === "ordered_list" || parent.type === "bullet_list");
}

function orderedListIndex(node: MarkdownNode, listParent: MarkdownNode): number {
  if (typeof node.index === "number" && Number.isFinite(node.index) && node.index >= 0) {
    return node.index;
  }
  const fallback = listParent.children?.indexOf(node) ?? -1;
  return fallback >= 0 ? fallback : 0;
}

function orderedListStart(node: MarkdownNode): number {
  const start = node.attributes?.start;
  if (typeof start === "number" && Number.isFinite(start)) return start;
  if (typeof start === "string") {
    const parsed = Number.parseInt(start, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 1;
}

export function getMarkdownListMarker(
  node: MarkdownNode,
  parents: MarkdownNode[],
): { isOrdered: boolean; marker: string } {
  const listParent = nearestListParent(parents);
  if (listParent?.type !== "ordered_list") {
    return { isOrdered: false, marker: "•" };
  }
  return {
    isOrdered: true,
    marker: `${orderedListStart(listParent) + orderedListIndex(node, listParent)}${node.markup || "."}`,
  };
}

function exactLinkifiedUrl(content: string, markdownParser: MarkdownParserLike): string | null {
  const trimmed = content.trim();
  if (!trimmed) return null;
  const matches = markdownParser.linkify.match(trimmed);
  if (matches?.length !== 1) return null;
  const [match] = matches;
  return match && match.index === 0 && match.lastIndex === trimmed.length ? match.url : null;
}

function isFileLookingToken(content: string): boolean {
  const normalized = content.trim().replace(/^[\"'`]/, "").replace(/[\"'`]$/, "").replace(/\\/g, "/");
  if (!normalized || /\s/.test(normalized) || normalized.includes("?") || normalized.includes("://")) {
    return false;
  }
  const hashIndex = normalized.indexOf("#");
  const pathWithLocation = hashIndex >= 0 ? normalized.slice(0, hashIndex) : normalized;
  const hash = hashIndex >= 0 ? normalized.slice(hashIndex) : "";
  if (hash && !/^#L\d+(?:C\d+)?(?:-L?\d+(?:C\d+)?)?$/i.test(hash)) return false;
  const locationMatch = pathWithLocation.match(/^(.+?):\d+(?::\d+)?(?:-\d+(?::\d+)?)?$/)
    ?? pathWithLocation.match(/^(.+?)\(\d+(?:,\d+)?(?:-\d+(?:,\d+)?)?\)$/);
  const path = locationMatch?.[1] ?? pathWithLocation;
  if (/^(?:\/|\.\.?\/|~\/|[A-Za-z]:\/)/.test(path)) return true;
  const segments = path.split("/").filter(Boolean);
  const fileName = segments.at(-1);
  if (!fileName) return false;
  if (segments.length > 1 && /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(segments[0] ?? "")) {
    return false;
  }
  if (fileName.startsWith(".") && fileName.length > 1) return true;
  const extension = fileName.slice(fileName.lastIndexOf(".") + 1).toLowerCase();
  return fileName.includes(".") && FILE_EXTENSIONS.has(extension);
}

export function isInlineCodeLink(
  content: string,
  parents: MarkdownNode[],
  markdownParser: MarkdownParserLike,
): boolean {
  return parents.some((parent) => parent.type === "link")
    || exactLinkifiedUrl(content, markdownParser) !== null
    || isFileLookingToken(content);
}
