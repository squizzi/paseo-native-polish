import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { useState, type ReactNode } from "react";
import { Image, Linking, Platform, Pressable, Text, View } from "react-native";
import type { StreamFadeState } from "./streaming-text";

// Temporary compatibility renderer. Keep it self-contained until Paseo exposes
// the host Markdown renderer and its streaming lifecycle to plugins upstream.
type Theme = PluginTimelineItemProps<unknown>["theme"];

// These are Paseo's chat Markdown tokens from styles/theme.ts. The plugin
// theme contract deliberately exposes colours only, so keep the host's fixed
// layout tokens here instead of inventing a second set of metrics. Matching
// these is important: the native renderer takes over after completion.
const host = {
  contentSize: 15,
  contentLineHeight: 21,
  codeSize: 12,
  spacing: { 1: 4, 2: 8, 3: 12, 4: 16, 6: 24 },
  radius: { md: 6 },
} as const;

// These are Paseo's default font-family tokens. The plugin theme API exposes
// colours but not typography, so use the same platform defaults as the host
// rather than letting the plugin renderer fall back to RN's unrelated stack.
const uiFont = Platform.select({
  ios: "system-ui",
  default: "normal",
  web: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
});
const monoFont = Platform.select({
  ios: "ui-monospace",
  default: "monospace",
  web: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
});

type SyntaxRole = "keyword" | "comment" | "string" | "number" | "function" | "definition" | "class" | "type" | "property" | "operator" | "punctuation" | "variable";

interface SyntaxToken {
  text: string;
  role: SyntaxRole | null;
}

const codeKeywords = new Set([
  "as", "async", "await", "break", "case", "catch", "class", "const", "continue", "def", "default", "do", "else", "export", "extends", "finally", "for", "from", "function", "if", "import", "in", "interface", "let", "new", "return", "switch", "throw", "try", "type", "var", "while", "with", "yield",
]);
const codeTypes = new Set(["any", "boolean", "float", "int", "never", "null", "number", "object", "string", "undefined", "unknown", "void"]);

function syntaxPalette(theme: Theme): Record<SyntaxRole, string> {
  // Paseo's default GitHub syntax palette. The public plugin theme has no
  // syntax-theme token, so select its light/dark variant from the supplied
  // surface colour; completed rows still use the user's exact host palette.
  const hex = theme.colors.surface0.replace("#", "");
  const red = Number.parseInt(hex.slice(0, 2), 16) || 0;
  const green = Number.parseInt(hex.slice(2, 4), 16) || 0;
  const blue = Number.parseInt(hex.slice(4, 6), 16) || 0;
  const dark = red * 0.2126 + green * 0.7152 + blue * 0.0722 < 128;
  return dark
    ? { keyword: "#ff7b72", comment: "#8b949e", string: "#a5d6ff", number: "#79c0ff", function: "#d2a8ff", definition: "#d2a8ff", class: "#ffa657", type: "#ff7b72", property: "#79c0ff", operator: "#79c0ff", punctuation: theme.colors.foreground, variable: theme.colors.foreground }
    : { keyword: "#cf222e", comment: "#6e7781", string: "#0a3069", number: "#0550ae", function: "#8250df", definition: "#8250df", class: "#953800", type: "#cf222e", property: "#0550ae", operator: "#0550ae", punctuation: theme.colors.foreground, variable: theme.colors.foreground };
}

function tokenizeCode(line: string): SyntaxToken[] {
  const parts = line.match(/\/\/.*|#.*|"(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?|`(?:\\.|[^`\\])*`?|\d+(?:\.\d+)?|[A-Za-z_$][\w$-]*|\s+|=>|===|!==|==|!=|<=|>=|&&|\|\||\?\.|[^\s]/g) ?? [];
  return parts.map((text, index) => {
    if (/^\s+$/.test(text)) return { text, role: null };
    if (/^(?:\/\/|#)/.test(text)) return { text, role: "comment" };
    if (/^["'`]/.test(text)) return { text, role: "string" };
    if (/^\d/.test(text)) return { text, role: "number" };
    if (codeKeywords.has(text)) return { text, role: "keyword" };
    if (codeTypes.has(text)) return { text, role: "type" };
    if (!/^[A-Za-z_$]/.test(text)) return { text, role: /^(?:=>|===|!==|==|!=|<=|>=|&&|\|\||\?\.|=|\.)$/.test(text) ? "operator" : "punctuation" };
    const previous = [...parts.slice(0, index)].reverse().find((part) => !/^\s+$/.test(part));
    const next = parts.slice(index + 1).find((part) => !/^\s+$/.test(part));
    if (previous === ".") return { text, role: next === "(" ? "function" : "property" };
    if (["class", "const", "def", "function", "interface", "let", "type", "var"].includes(previous ?? "")) return { text, role: "definition" };
    if (next === ":") return { text, role: "definition" };
    if (previous === ":" || previous === "as") return { text, role: "type" };
    if (next === "(") return { text, role: "function" };
    if (/^[A-Z]/.test(text)) return { text, role: "type" };
    return { text, role: "variable" };
  });
}

interface StreamingMarkdownProps {
  text: string;
  fade: StreamFadeState;
  theme: Theme;
  pace: "gentle" | "quick";
  streaming: boolean;
  /** Absolute source offset used to keep fade spans stable across host blocks. */
  sourceOffset?: number;
}

interface Line {
  text: string;
  start: number;
  end: number;
}

interface TextPiece {
  start: number;
  text: string;
  fades: boolean;
}

const inlineToken = /\[([^\]]+)\]\(([^\s)]+)\)|`([^`]+)`|\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|~~([\s\S]+?)~~|\*([^*\n]+)\*|_([^_\n]+)_/g;
const imageLine = /^!\[([^\]]*)\]\(([^\s)]+)(?:\s+["']([^"']*)["'])?\)\s*$/;
const detailsStart = /^<details(?:\s+open)?>\s*$/i;
const detailsEnd = /^<\/details>\s*$/i;
const detailsSummary = /^<summary>(.*)<\/summary>\s*$/i;
const horizontalRule = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;

// The host turns these inline-code forms into workspace/file links after the
// turn completes. Plugins cannot call its private resolver, but preserving the
// same link color while text streams avoids a conspicuous visual swap at
// handoff. Activation remains host-owned once the native row returns.
function isLinkableInlineCode(value: string): boolean {
  const text = value.trim();
  return /^file:\/\//i.test(text)
    || /^(?:\/|~\/|[A-Za-z]:[\\/]).+?(?::\d+(?::\d+)?|\(\d+(?:,\d+)?\)|\s+lines?\s+\d+)/.test(text);
}

function linesOf(text: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  while (start <= text.length) {
    const newline = text.indexOf("\n", start);
    const end = newline === -1 ? text.length : newline;
    lines.push({ text: text.slice(start, end), start, end });
    if (newline === -1) break;
    start = newline + 1;
  }
  return lines;
}

/**
 * Port of Paseo's splitMarkdownBlocks shape, with a small fence-aware scanner
 * in place of MarkdownIt (which plugins cannot import). It gives the live
 * renderer the same independently-spaced top-level blocks as the native row.
 */
function splitMarkdownBlocks(text: string): { text: string; start: number }[] {
  if (!text) return [];
  const lines = linesOf(text);
  const blocks: { text: string; start: number }[] = [];
  let start = 0;
  let index = 0;
  let fence: "`" | "~" | null = null;
  while (index < lines.length) {
    const line = lines[index];
    const opening = /^ {0,3}(`{3,}|~{3,})/.exec(line.text);
    if (opening) {
      const marker = opening[1][0] as "`" | "~";
      if (fence === null) fence = marker;
      else if (marker === fence && new RegExp(`^ {0,3}${marker}{3,}\\s*$`).test(line.text)) fence = null;
    }
    if (fence === null && line.text.trim().length === 0) {
      let next = index + 1;
      while (next < lines.length && lines[next].text.trim().length === 0) next += 1;
      if (next < lines.length && start < line.start) {
        blocks.push({ text: text.slice(start, line.start), start });
        start = lines[next].start;
      }
      index = next;
      continue;
    }
    index += 1;
  }
  if (start < text.length) blocks.push({ text: text.slice(start), start });
  return blocks.filter((block) => block.text.length > 0);
}

function tableCells(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function isTableDivider(line: string): boolean {
  const cells = tableCells(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function isTableStart(lines: Line[], index: number): boolean {
  return index + 1 < lines.length && lines[index].text.includes("|") && isTableDivider(lines[index + 1].text);
}

function splitFadingText(text: string, sourceStart: number, fade: StreamFadeState): TextPiece[] {
  if (!text) return [];
  const sourceEnd = sourceStart + text.length;
  const pieces: TextPiece[] = [];
  let cursor = sourceStart;
  const push = (end: number, fades: boolean) => {
    if (end <= cursor) return;
    pieces.push({ start: cursor, text: text.slice(cursor - sourceStart, end - sourceStart), fades });
    cursor = end;
  };

  if (fade.committed.length > cursor) push(Math.min(fade.committed.length, sourceEnd), false);
  for (const chunk of fade.chunks) {
    if (cursor >= sourceEnd) break;
    const chunkEnd = chunk.start + chunk.text.length;
    if (chunkEnd <= cursor) continue;
    if (chunk.start > cursor) push(Math.min(chunk.start, sourceEnd), false);
    push(Math.min(chunkEnd, sourceEnd), true);
  }
  push(sourceEnd, false);
  return pieces;
}

function FadingText({
  text,
  sourceStart,
  fade,
  pace,
}: {
  text: string;
  sourceStart: number;
  fade: StreamFadeState;
  pace: "gentle" | "quick";
}) {
  return splitFadingText(text, sourceStart, fade).map((piece) =>
    piece.fades ? (
      <Text key={`fade:${piece.start}`} testID="native-polish-stream-token">
        {piece.text}
      </Text>
    ) : (
      <Text key={`text:${piece.start}`}>{piece.text}</Text>
    ),
  );
}

/** Plugin-safe counterpart to Paseo's HighlightedCodeBlock token spans. */
function StreamingCode({
  code,
  sourceStart,
  fade,
  pace,
  theme,
}: {
  code: string;
  sourceStart: number;
  fade: StreamFadeState;
  pace: "gentle" | "quick";
  theme: Theme;
}) {
  const palette = syntaxPalette(theme);
  let offset = 0;
  return code.split("\n").flatMap((line, lineIndex) => {
    const lineStart = sourceStart + offset;
    offset += line.length + 1;
    const tokens = tokenizeCode(line);
    const content: ReactNode[] = [];
    let tokenOffset = 0;
    for (const [tokenIndex, token] of tokens.entries()) {
      content.push(
        <Text
          key={`token:${lineIndex}:${tokenIndex}`}
          testID={token.role ? `native-polish-syntax-${token.role}` : undefined}
          style={token.role ? { color: palette[token.role] } : undefined}
        >
          <FadingText text={token.text} sourceStart={lineStart + tokenOffset} fade={fade} pace={pace} />
        </Text>,
      );
      tokenOffset += token.text.length;
    }
    if (lineIndex > 0) content.unshift(<Text key={`newline:${lineIndex}`}>{"\n"}</Text>);
    return content;
  });
}

function InlineMarkdown({
  text,
  sourceStart,
  fade,
  pace,
  theme,
}: {
  text: string;
  sourceStart: number;
  fade: StreamFadeState;
  pace: "gentle" | "quick";
  theme: Theme;
}) {
  const output: ReactNode[] = [];
  let cursor = 0;
  inlineToken.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = inlineToken.exec(text))) {
    if (match.index > cursor) {
      output.push(
        <FadingText
          key={`plain:${sourceStart + cursor}`}
          text={text.slice(cursor, match.index)}
          sourceStart={sourceStart + cursor}
          fade={fade}
          pace={pace}
        />,
      );
    }

    const tokenStart = sourceStart + match.index;
    if (match[1] !== undefined) {
      const label = match[1];
      const url = match[2];
      output.push(
        <Text
          key={`link:${tokenStart}`}
          accessibilityRole="link"
          onPress={() => void Linking.openURL(url)}
          style={{ color: theme.colors.accent, textDecorationLine: "none", flexShrink: 1, minWidth: 0 }}
        >
          <InlineMarkdown text={label} sourceStart={tokenStart + 1} fade={fade} pace={pace} theme={theme} />
        </Text>,
      );
    } else if (match[3] !== undefined) {
      output.push(
      <Text
        key={`code:${tokenStart}`}
        testID="native-polish-stream-inline-code"
        style={{
          backgroundColor: theme.colors.surface2,
          color: isLinkableInlineCode(match[3]) ? theme.colors.accent : theme.colors.foreground,
          paddingHorizontal: host.spacing[1],
          paddingVertical: 2,
          borderRadius: host.radius.md,
          fontFamily: monoFont,
          fontSize: host.codeSize,
        }}
      >
        <FadingText text={match[3]} sourceStart={tokenStart + 1} fade={fade} pace={pace} />
      </Text>,
      );
    } else {
      const [content, prefixLength, style] = match[4] !== undefined
        ? [match[4], 2, { fontWeight: "500" as const }]
        : match[5] !== undefined
          ? [match[5], 2, { fontWeight: "500" as const }]
          : match[6] !== undefined
            ? [match[6], 2, { textDecorationLine: "line-through" as const, color: theme.colors.foregroundMuted }]
            : [match[7] ?? match[8] ?? "", 1, { fontStyle: "italic" as const }];
      output.push(
        <Text key={`style:${tokenStart}`} style={style}>
          <InlineMarkdown
            text={content}
            sourceStart={tokenStart + prefixLength}
            fade={fade}
            pace={pace}
            theme={theme}
          />
        </Text>,
      );
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) {
    output.push(
      <FadingText
        key={`plain:${sourceStart + cursor}`}
        text={text.slice(cursor)}
        sourceStart={sourceStart + cursor}
        fade={fade}
        pace={pace}
      />,
    );
  }
  return output;
}

function MarkdownLine({
  text,
  sourceStart,
  fade,
  pace,
  theme,
}: {
  text: string;
  sourceStart: number;
  fade: StreamFadeState;
  pace: "gentle" | "quick";
  theme: Theme;
}) {
  return <InlineMarkdown text={text} sourceStart={sourceStart} fade={fade} pace={pace} theme={theme} />;
}

function MarkdownDetails({
  summary,
  body,
  bodyOffset,
  fade,
  theme,
  pace,
  streaming,
}: {
  summary: string;
  body: string;
  bodyOffset: number;
  fade: StreamFadeState;
  theme: Theme;
  pace: "gentle" | "quick";
  streaming: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View testID="native-polish-stream-block" style={{ borderWidth: 1, borderColor: theme.colors.border, borderRadius: host.radius.md, marginVertical: host.spacing[3], overflow: "hidden" }}>
      <Pressable accessibilityRole="button" onPress={() => setOpen((current) => !current)} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: host.spacing[3], paddingVertical: host.spacing[2], backgroundColor: theme.colors.surface2 }}>
        <Text style={{ color: theme.colors.foregroundMuted, fontFamily: uiFont }}>{open ? "⌄" : "›"}</Text>
        <Text style={{ color: theme.colors.foreground, fontFamily: uiFont, flex: 1 }}>{summary}</Text>
      </Pressable>
      {open ? <View style={{ paddingHorizontal: host.spacing[3], paddingTop: host.spacing[3] }}><StreamingMarkdown text={body} sourceOffset={bodyOffset} fade={fade} theme={theme} pace={pace} streaming={streaming} /></View> : null}
    </View>
  );
}

function StreamingMarkdownFragment({
  text,
  fade,
  theme,
  pace,
  streaming,
  sourceOffset,
}: Required<StreamingMarkdownProps>) {
  const lines = linesOf(text);
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.text.trim()) {
      index += 1;
      continue;
    }

    if (detailsStart.test(line.text)) {
      let end = index + 1;
      let summary = "Details";
      if (end < lines.length) {
        const parsedSummary = detailsSummary.exec(lines[end].text);
        if (parsedSummary) {
          summary = parsedSummary[1] || summary;
          end += 1;
        }
      }
      const bodyStart = end < lines.length ? lines[end].start : line.end;
      while (end < lines.length && !detailsEnd.test(lines[end].text)) end += 1;
      const bodyEnd = end < lines.length ? lines[end].start - 1 : text.length;
      blocks.push(
        <MarkdownDetails
          key={`details:${line.start}`}
          summary={summary}
          body={text.slice(bodyStart, bodyEnd)}
          bodyOffset={sourceOffset + bodyStart}
          fade={fade}
          theme={theme}
          pace={pace}
          streaming={streaming}
        />,
      );
      index = end < lines.length ? end + 1 : end;
      continue;
    }

    const fence = /^```([^`]*)$/.exec(line.text);
    if (fence) {
      const codeStart = line.end + 1;
      let end = index + 1;
      while (end < lines.length && !/^```\s*$/.test(lines[end].text)) end += 1;
      const codeEnd = end < lines.length ? lines[end].start - 1 : text.length;
      blocks.push(
        <View key={`fence:${line.start}`} testID="native-polish-stream-code-block" style={{ backgroundColor: theme.colors.surface2, borderColor: theme.colors.border, borderWidth: 1, borderRadius: host.radius.md, padding: host.spacing[3], marginVertical: host.spacing[3] }}>
          {fence[1].trim() ? <Text style={{ color: theme.colors.foregroundMuted, fontFamily: monoFont, fontSize: host.codeSize }}>{fence[1].trim()}</Text> : null}
          <Text testID="native-polish-stream-code" style={{ color: theme.colors.foreground, fontFamily: monoFont, fontSize: host.codeSize, lineHeight: 17 }}>
            <StreamingCode code={text.slice(codeStart, codeEnd)} sourceStart={sourceOffset + codeStart} fade={fade} pace={pace} theme={theme} />
          </Text>
        </View>,
      );
      index = end < lines.length ? end + 1 : end;
      continue;
    }

    if (horizontalRule.test(line.text)) {
      blocks.push(
        <View
          key={`rule:${line.start}`}
          testID="native-polish-stream-block"
          style={{ backgroundColor: theme.colors.border, height: 1, marginVertical: 10 }}
        />,
      );
      index += 1;
      continue;
    }

    const image = imageLine.exec(line.text);
    if (image) {
      blocks.push(
        <View key={`image:${line.start}`} testID="native-polish-stream-block" style={{ marginVertical: host.spacing[2] }}>
          <Image
            source={{ uri: image[2] }}
            accessibilityLabel={image[1] || image[3] || undefined}
            resizeMode="contain"
            style={{ width: "100%", height: 260, borderRadius: host.radius.md, backgroundColor: theme.colors.surface2 }}
          />
          {image[1] ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, marginTop: 4 }}>{image[1]}</Text> : null}
        </View>,
      );
      index += 1;
      continue;
    }

    if (isTableStart(lines, index)) {
      const header = tableCells(line.text);
      let end = index + 2;
      while (end < lines.length && lines[end].text.trim() && lines[end].text.includes("|")) end += 1;
      const rows = lines.slice(index + 2, end).map((row) => ({ line: row, cells: tableCells(row.text) }));
      const renderRow = (cells: string[], row: Line, headerRow: boolean) => (
        <View key={`${headerRow ? "head" : "row"}:${row.start}`} style={{ flexDirection: "row", borderBottomWidth: 1, borderColor: theme.colors.border, backgroundColor: headerRow ? theme.colors.surface2 : undefined }}>
          {header.map((_, cellIndex) => {
            const cell = cells[cellIndex] ?? "";
            const cellStart = row.text.indexOf(cell);
            return (
              <Text
                key={`cell:${cellIndex}`}
                style={{ color: theme.colors.foreground, fontFamily: uiFont, flex: 1, minWidth: 0, padding: host.spacing[2], borderRightWidth: cellIndex < header.length - 1 ? 1 : 0, borderColor: theme.colors.border, fontWeight: headerRow ? "600" : "normal", fontSize: host.contentSize, lineHeight: host.contentLineHeight }}
              >
                <MarkdownLine text={cell} sourceStart={sourceOffset + row.start + Math.max(0, cellStart)} fade={fade} pace={pace} theme={theme} />
              </Text>
            );
          })}
        </View>
      );
      blocks.push(
        <View key={`table:${line.start}`} testID="native-polish-stream-block" style={{ borderWidth: 1, borderColor: theme.colors.border, borderRadius: host.radius.md, overflow: "hidden", marginVertical: host.spacing[3] }}>
          {renderRow(header, line, true)}
          {rows.map(({ line: row, cells }) => renderRow(cells, row, false))}
        </View>,
      );
      index = end;
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(line.text);
    if (heading) {
      const level = heading[1].length;
      const content = heading[2];
      const headingStyle = level === 1
        ? { fontSize: 28, fontWeight: "bold" as const, lineHeight: 36, marginTop: host.spacing[6], marginBottom: host.spacing[3], paddingBottom: host.spacing[2], borderBottomWidth: 1 }
        : level === 2
          ? { fontSize: 24, fontWeight: "bold" as const, lineHeight: 31, marginTop: host.spacing[6], marginBottom: host.spacing[3], paddingBottom: host.spacing[2], borderBottomWidth: 1 }
          : level === 3
            ? { fontSize: 21, fontWeight: "600" as const, lineHeight: 27, marginTop: host.spacing[4], marginBottom: host.spacing[2] }
            : level === 4
              ? { fontSize: 19, fontWeight: "600" as const, lineHeight: 25, marginTop: host.spacing[4], marginBottom: host.spacing[2] }
              : { fontSize: 17, fontWeight: "600" as const, lineHeight: 22, marginTop: host.spacing[3], marginBottom: host.spacing[1] };
      blocks.push(
        <Text
          key={`heading:${line.start}`}
          testID={`native-polish-stream-heading-${level}`}
          style={{ color: level === 6 ? theme.colors.foregroundMuted : theme.colors.foreground, fontFamily: uiFont, borderBottomColor: theme.colors.border, textTransform: level === 6 ? "uppercase" : undefined, letterSpacing: level === 6 ? .5 : undefined, ...headingStyle }}
        >
          <MarkdownLine text={content} sourceStart={sourceOffset + line.start + level + 1} fade={fade} pace={pace} theme={theme} />
        </Text>,
      );
      index += 1;
      continue;
    }

    const quote = /^>\s?(.*)$/.exec(line.text);
    if (quote) {
      const quoteLines: Line[] = [];
      while (index < lines.length) {
        const quoted = /^>\s?(.*)$/.exec(lines[index].text);
        if (!quoted) break;
        quoteLines.push(lines[index]);
        index += 1;
      }
      blocks.push(
        <View key={`quote:${line.start}`} testID="native-polish-stream-block" style={{ backgroundColor: theme.colors.surface1, borderLeftWidth: 4, borderLeftColor: theme.colors.surface2, paddingHorizontal: host.spacing[4], paddingTop: host.spacing[3], paddingBottom: 0, marginVertical: host.spacing[3], borderRadius: host.radius.md, borderTopLeftRadius: 0, borderBottomLeftRadius: 0 }}>
          <Text style={{ color: `${theme.colors.foreground}cc`, fontFamily: uiFont, fontSize: host.contentSize, lineHeight: host.contentLineHeight, marginBottom: host.spacing[3] }}>
            {quoteLines.map((quoted, quoteIndex) => {
              const content = /^>\s?(.*)$/.exec(quoted.text)?.[1] ?? "";
              return (
                <MarkdownLine key={quoted.start} text={`${quoteIndex ? "\n" : ""}${content}`} sourceStart={sourceOffset + quoted.start + quoted.text.indexOf(content)} fade={fade} pace={pace} theme={theme} />
              );
            })}
          </Text>
        </View>,
      );
      continue;
    }

    const list = /^(\s*)([-*+]|\d+[.)])\s+(.+)$/.exec(line.text);
    if (list) {
      const items: ReactNode[] = [];
      const ordered = /^\d+[.)]$/.test(list[2]);
      // MarkdownIt carries the list's start and delimiter on the parent node,
      // then derives each visible marker from that start plus its item index.
      // Keep the same rule for a partially streamed list rather than trusting
      // whatever number the model happened to place on every following line.
      const orderedMatch = ordered ? /^(\d+)([.)])$/.exec(list[2]) : null;
      const orderedStart = Number.parseInt(orderedMatch?.[1] ?? "1", 10);
      const orderedDelimiter = orderedMatch?.[2] ?? ".";
      while (index < lines.length) {
        const item = /^(\s*)([-*+]|\d+[.)])\s+(.+)$/.exec(lines[index].text);
        if (!item || /^\d+[.)]$/.test(item[2]) !== ordered) break;
        // The host's parser does not register a task-list plugin: `- [ ]`/
        // `- [x]` is not special-cased and renders as a plain bullet item
        // with the literal bracket text. A custom checkbox here would be
        // exactly the content/style mismatch that pops at handoff.
        const content = item[3];
        const contentStart = lines[index].start + lines[index].text.indexOf(content);
        const marker = ordered ? `${orderedStart + items.length}${orderedDelimiter}` : "•";
        items.push(
          <View key={`item:${lines[index].start}`} style={{ flexDirection: "row", marginBottom: host.spacing[1], alignItems: "flex-start", flexShrink: 1 }}>
            <Text testID="native-polish-stream-list-marker" style={{ color: theme.colors.foregroundMuted, fontFamily: uiFont, minWidth: ordered ? 12 : undefined, marginRight: 4, fontSize: host.contentSize, fontWeight: ordered ? "normal" : undefined, lineHeight: host.contentLineHeight }}>{marker}</Text>
            <Text testID="native-polish-stream-list-content" style={{ color: theme.colors.foreground, fontFamily: uiFont, flex: 1, flexShrink: 1, minWidth: 0, fontSize: host.contentSize, lineHeight: host.contentLineHeight }}>
              <MarkdownLine text={content} sourceStart={sourceOffset + contentStart} fade={fade} pace={pace} theme={theme} />
            </Text>
          </View>,
        );
        index += 1;
      }
      const nextLine = lines[index];
      const nextIsList = Boolean(nextLine && /^(\s*)([-*+]|\d+[.)])\s+/.test(nextLine.text));
      blocks.push(<View key={`list:${line.start}`} testID="native-polish-stream-list" style={{ width: "100%", marginTop: host.spacing[1], marginBottom: nextLine ? (nextIsList ? host.spacing[2] : host.spacing[4]) : 0 }}>{items}</View>);
      continue;
    }

    const start = line.start;
    let end = index + 1;
    while (end < lines.length && lines[end].text.trim() && !horizontalRule.test(lines[end].text) && !imageLine.test(lines[end].text) && !isTableStart(lines, end) && !/^(#{1,6})\s+|^```|^>\s?|^(\s*)([-*+]|\d+[.)])\s+/.test(lines[end].text)) end += 1;
    const paragraphEnd = lines[end - 1].end;
    blocks.push(
      <Text key={`paragraph:${start}`} testID="native-polish-stream-prose" style={{ color: theme.colors.foreground, fontFamily: uiFont, fontSize: host.contentSize, lineHeight: host.contentLineHeight, marginTop: 0, marginBottom: host.spacing[3], flexShrink: 1, minWidth: 0, width: "100%" }}>
        <MarkdownLine text={text.slice(start, paragraphEnd)} sourceStart={sourceOffset + start} fade={fade} pace={pace} theme={theme} />
      </Text>,
    );
    index = end;
  }

  return <>{blocks}</>;
}

export function StreamingMarkdown({ text, fade, theme, pace, streaming, sourceOffset = 0 }: StreamingMarkdownProps) {
  const blocks = splitMarkdownBlocks(text);
  return (
    <View testID={streaming ? `native-polish-stream-pace-${pace}` : "native-polish-markdown"} style={{ paddingVertical: host.spacing[3] }}>
      {blocks.map((block, index) => (
        <View key={`block:${sourceOffset + block.start}`} style={index < blocks.length - 1 ? { marginBottom: host.spacing[3] } : undefined}>
          <StreamingMarkdownFragment
            text={block.text}
            sourceOffset={sourceOffset + block.start}
            fade={fade}
            theme={theme}
            pace={pace}
            streaming={streaming}
          />
        </View>
      ))}
    </View>
  );
}
