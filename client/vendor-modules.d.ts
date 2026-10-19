declare module "markdown-it" {
  const MarkdownIt: any;
  export default MarkdownIt;
}

declare module "react-native-markdown-display/src/lib/AstRenderer" {
  const AstRenderer: any;
  export default AstRenderer;
}

declare module "react-native-markdown-display/src/lib/util/cleanupTokens" {
  export const cleanupTokens: (tokens: unknown[]) => unknown[];
}

declare module "react-native-markdown-display/src/lib/util/getTokenTypeByToken" {
  const getTokenTypeByToken: (token: { type?: string; tag?: string }) => string;
  export default getTokenTypeByToken;
}

declare module "react-native-markdown-display/src/lib/util/groupTextTokens" {
  const groupTextTokens: (tokens: unknown[]) => unknown[];
  export default groupTextTokens;
}

declare module "react-native-markdown-display/src/lib/util/omitListItemParagraph" {
  const omitListItemParagraph: (tokens: unknown[]) => unknown[];
  export default omitListItemParagraph;
}

declare module "react-native-markdown-display/src/lib/util/stringToTokens" {
  export const stringToTokens: (source: string, markdownIt: unknown) => unknown[];
}

declare module "react-native-markdown-display/src/lib/util/removeTextStyleProps" {
  const removeTextStyleProps: (style: Record<string, unknown>) => Record<string, unknown>;
  export default removeTextStyleProps;
}
