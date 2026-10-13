import type { PluginClientContext } from "@getpaseo/plugin/client";
import { getPreferences } from "./client/preferences";
import { MotionSettings } from "./client/settings";
import { StreamingAssistantText, streamingAssistantSchema } from "./client/streaming-text";
import { transformStreamingAssistantMessage } from "./client/streaming-transform";
import { installMotion } from "./client/web";
export default function contribute(client: PluginClientContext) {
  client.addSettingsScreen({ id: "motion", title: "Native Polish", icon: "Sparkles", Component: MotionSettings });
  client.addCommandCenterItem({ id: "motion-settings", title: "Native Polish: motion settings", icon: "Sparkles", context: "global", onSelect({ openSettings }) { openSettings("motion"); } });
  client.addTimelineTransformer({
    id: "streaming-assistant-text",
    query: { itemType: "assistant_message" },
    transform: ({ item, phase }) => {
      // The native completed row owns selection plus its full turn footer.
      // Claim only the live phase, then hand back with the same source row id
      // so chat-entry motion does not replay the message on completion.
      const preferences = getPreferences();
      return transformStreamingAssistantMessage(item, phase, preferences.enabled && preferences.messages);
    },
  });
  client.addTimelineRenderer({
    kind: "streaming-assistant-text",
    version: 1,
    schema: streamingAssistantSchema,
    Component: StreamingAssistantText,
  });
  return installMotion();
}
