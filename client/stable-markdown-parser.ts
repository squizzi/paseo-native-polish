import { cleanupTokens } from "react-native-markdown-display/src/lib/util/cleanupTokens";
import getTokenTypeByToken from "react-native-markdown-display/src/lib/util/getTokenTypeByToken";
import groupTextTokens from "react-native-markdown-display/src/lib/util/groupTextTokens";
import omitListItemParagraph from "react-native-markdown-display/src/lib/util/omitListItemParagraph";
import { stringToTokens } from "react-native-markdown-display/src/lib/util/stringToTokens";

interface MarkdownToken {
  type: string;
  tag: string;
  content: string;
  children?: MarkdownToken[] | null;
  attrs?: [string, unknown][] | null;
  info?: unknown;
  meta?: unknown;
  block?: boolean;
  markup?: string;
  nesting: number;
}

interface StableAstNode {
  type: string;
  sourceType: string;
  sourceInfo: unknown;
  sourceMeta: unknown;
  block: boolean | undefined;
  markup: string | undefined;
  key: string;
  content: string;
  tokenIndex: number;
  index: number;
  attributes: Record<string, unknown>;
  children: StableAstNode[];
}

function createNode(token: MarkdownToken, tokenIndex: number, parentKey: string): StableAstNode {
  const type = getTokenTypeByToken(token);
  const keyPath = parentKey ? `${parentKey}.${tokenIndex}` : String(tokenIndex);
  return {
    type,
    sourceType: token.type,
    sourceInfo: token.info,
    sourceMeta: token.meta,
    block: token.block,
    markup: token.markup,
    key: `rnmr_${keyPath}_${type}`,
    content: token.content,
    tokenIndex,
    index: 0,
    attributes: Object.fromEntries(token.attrs ?? []),
    children: tokensToStableAst(token.children, keyPath),
  };
}

function tokensToStableAst(
  tokens: MarkdownToken[] | null | undefined,
  parentKey = "",
): StableAstNode[] {
  if (!tokens?.length) return [];
  const stack: StableAstNode[][] = [];
  let children: StableAstNode[] = [];
  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
    const token = tokens[tokenIndex];
    const node = createNode(token, tokenIndex, parentKey);
    if (node.type === "text" && node.children.length === 0 && node.content === "") continue;
    node.index = children.length;
    if (token.nesting === 1) {
      children.push(node);
      stack.push(children);
      children = node.children;
    } else if (token.nesting === -1) {
      children = stack.pop() ?? children;
    } else {
      children.push(node);
    }
  }
  return children;
}

/** Render through RNMD while retaining Paseo core's deterministic AST keys. */
export function renderStableMarkdown(source: string, renderer: any, markdownIt: any) {
  let tokens = stringToTokens(source, markdownIt) as MarkdownToken[];
  tokens = cleanupTokens(tokens) as MarkdownToken[];
  tokens = groupTextTokens(tokens) as MarkdownToken[];
  tokens = omitListItemParagraph(tokens) as MarkdownToken[];
  const root = { type: "body", key: "rnmr_root", children: tokensToStableAst(tokens) };
  return renderer.renderNode(root, [], true);
}
