export interface AssistantMessageForStreaming {
  text: string;
  messageId?: string;
}

export interface StreamingAssistantTimelineItem {
  type: "plugin";
  id?: string;
  kind: "streaming-assistant-text";
  version: 1;
  data: { text: string; phase: "streaming" };
}

/**
 * The host owns the replacement's identity from its source message. Do not
 * assign a plugin item id here: an explicit duplicate id makes the virtualizer
 * retain the plugin row's height when native Markdown takes over at completion.
 *
 * `enabled` is the plugin's own messages-motion preference: the whole point
 * of this plugin renderer is the smoother streaming presentation it enables,
 * so turning that off should hand streaming assistant messages back to the
 * host's own renderer for their entire lifecycle, not just skip the pacing
 * animation inside a renderer that still took over.
 */
export function transformStreamingAssistantMessage(
  item: AssistantMessageForStreaming,
  phase: "streaming" | "complete",
  enabled: boolean,
): { items: [StreamingAssistantTimelineItem] } | undefined {
  if (!enabled || phase === "complete") return undefined;
  return {
    items: [{
      type: "plugin",
      kind: "streaming-assistant-text",
      version: 1,
      data: { text: item.text, phase },
    }],
  };
}
