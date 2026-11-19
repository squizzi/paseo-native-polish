import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

// Exercise the adapter against host layout fixtures without mounting React.
const source = readFileSync(new URL("../client/web.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source + "\nexport { panels, panelOwner };", {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
});
let handle;
let list;
const exports = {};
runInNewContext(outputText, {
  exports,
  require: () => ({}),
  document: { body: {
    querySelector: selector => selector.includes("left-sidebar-resize-handle") ? handle : list,
    querySelectorAll: () => [],
  } },
  window: { getComputedStyle: element => ({
    getPropertyValue: property => element[property] ?? "",
  }) },
});

function element(parentElement = null, styles = {}) {
  return {
    parentElement, display: "flex", position: "relative", ...styles,
    getAttribute: key => key === "data-testid" ? styles.testid ?? null : null,
    closest(selector) {
      for (let at = this; at; at = at.parentElement) {
        if (selector === '[id^="agent-list-gesture-host-"]' && at.id?.startsWith("agent-list-gesture-host-")) return at;
      }
      return null;
    },
    querySelector: () => null,
    getBoundingClientRect: () => ({ width: 320, height: 800 }),
  };
}

const dock = element(null, { id: "agent-list-gesture-host-test" });
const retained = element(dock);
const translated = element(retained);
const content = element(translated);
const border = element(content);
handle = element(element(border, { display: "contents" }), { position: "absolute" });
assert.equal(exports.panels().get("left"), dock, "the outer dock owns the sidebar width");
dock.display = "none";
assert.equal(exports.panels().get("left"), dock, "a hidden retained dock remains discoverable for reopening");

// The same host is an absolute overlay on compact layouts, animated by Paseo.
dock.position = "absolute";
list = element(content);
assert.equal(exports.panels().has("left"), false, "overlay content never becomes a second width owner");
list = null;

const legacyDock = element();
const legacyBorder = element(legacyDock);
handle = element(element(legacyBorder, { display: "contents" }));
assert.equal(exports.panels().get("left"), legacyDock, "legacy desktop docks keep their width owner");
handle = element(element(element(legacyBorder, { position: "absolute" }), { display: "contents" }));
assert.equal(exports.panels().get("left"), legacyDock, "legacy touch resize handles skip the absolute handle layer");

const legacyExplorerDock = element();
const legacyRetained = element(legacyExplorerDock);
const legacyExplorer = element(legacyRetained, { testid: "workspace-explorer-sidebar" });
assert.equal(exports.panelOwner(legacyExplorer), legacyExplorerDock, "legacy Explorer layouts retain their outer width owner");
const wrappedExplorer = element(element(legacyRetained, { display: "contents" }), { testid: "workspace-explorer-sidebar" });
assert.equal(exports.panelOwner(wrappedExplorer), legacyExplorerDock, "legacy Explorer owners skip gesture contents wrappers");

handle = null;
assert.equal(exports.panels().size, 0, "missing sidebar structure skips motion");
console.log("sidebar panel tests passed");
