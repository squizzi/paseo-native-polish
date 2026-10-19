import assert from "node:assert/strict";
import test from "node:test";
import MarkdownIt from "markdown-it";
import { getMarkdownListMarker, isInlineCodeLink } from "../client/markdown-compat.ts";
import { enableStreamingMarkdown } from "../client/streaming-markdown-parser.ts";

const parser = new MarkdownIt({ linkify: true });

test("a bullet nested inside an ordered list keeps its bullet marker", () => {
  const marker = getMarkdownListMarker(
    { type: "list_item", index: 0, markup: "-" },
    [
      { type: "bullet_list" },
      { type: "list_item" },
      { type: "ordered_list", attributes: { start: 1 } },
    ],
  );
  assert.deepEqual(marker, { isOrdered: false, marker: "•" });
});

test("the nearest ordered list supplies its own start and marker", () => {
  const marker = getMarkdownListMarker(
    { type: "list_item", index: 1, markup: "." },
    [
      { type: "ordered_list", attributes: { start: "3" } },
      { type: "list_item" },
      { type: "bullet_list" },
    ],
  );
  assert.deepEqual(marker, { isOrdered: true, marker: "4." });
});

test("inline-code file paths and URLs use link color before core handoff", () => {
  assert.equal(isInlineCodeLink("src/app.ts", [], parser), true);
  assert.equal(isInlineCodeLink("client/web.ts:42", [], parser), true);
  assert.equal(isInlineCodeLink("https://paseo.sh/docs", [], parser), true);
  assert.equal(isInlineCodeLink("const value = 1", [], parser), false);
});

test("an incomplete streamed code path is classified before its closing backtick", () => {
  const streamingParser = new MarkdownIt({ linkify: true });
  enableStreamingMarkdown(streamingParser);
  const tokens = streamingParser.parse("`src/app.ts", {});
  const inlineCode = tokens.flatMap((token) => token.children ?? []).find((token) => token.type === "code_inline");
  assert.equal(inlineCode?.content, "src/app.ts");
  assert.equal(isInlineCodeLink(inlineCode.content, [], streamingParser), true);
});
