export type ToolDetailTextFrame = Record<string, string | number>;

export interface ToolDetailTextTransition {
  stableText: string;
  enteringText: string;
  enteringStart: number;
  cover: ToolDetailTextFrame[];
}

export function toolDetailTextTransition(previous: string | undefined, current: string): ToolDetailTextTransition | null {
  if (!previous || previous === current || !current.startsWith(previous)) return null;
  return {
    stableText: previous,
    enteringText: current.slice(previous.length),
    enteringStart: previous.length,
    // A background-coloured cover fades away from only the appended glyph
    // range. The live text remains a single paint owner, avoiding both the
    // whole-panel flash and the doubled text produced by a cloned snapshot.
    cover: [{ opacity: 1 }, { opacity: 0 }],
  };
}
