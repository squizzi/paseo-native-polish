import type { PluginClientContext } from "@getpaseo/plugin/client";
import { Platform } from "react-native";
import { z } from "zod";
import { MotionSettings } from "./client/settings";
import { StreamingAssistant } from "./client/streaming-markdown";
import { installMotion } from "./client/web";
export default function contribute(client: PluginClientContext) {
  const cleanups = [
    client.addSettingsScreen({ id: "motion", title: "Native Polish", icon: "Sparkles", Component: MotionSettings }),
    client.addCommandCenterItem({ id: "motion-settings", title: "Native Polish: motion settings", icon: "Sparkles", context: "global", onSelect({ openSettings }) { openSettings("motion"); } }),
  ];
  if (Platform.OS === "web") {
    cleanups.push(client.addTimelineTransformer({
      id: "smooth-streaming-assistant",
      query: { itemType: "assistant_message" },
      transform: ({ item, phase }) => phase === "streaming" ? {
        items: [{
          type: "plugin",
          kind: "smooth-streaming-assistant",
          version: 1,
          data: { text: item.text },
        }],
      } : undefined,
    }));
    cleanups.push(client.addTimelineRenderer({
      kind: "smooth-streaming-assistant",
      version: 1,
      schema: z.object({ text: z.string() }),
      Component: StreamingAssistant,
    }));
  }
  cleanups.push(installMotion());
  return () => {
    for (let index = cleanups.length - 1; index >= 0; index -= 1) cleanups[index]();
  };
}
