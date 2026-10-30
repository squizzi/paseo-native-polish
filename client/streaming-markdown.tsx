import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Markdown } from "@getpaseo/plugin/client/ui";
import { View } from "react-native";
import { finalizeStreamingMarkdown } from "./tool-detail-motion";

interface StreamingAssistantData {
  text: string;
}

// Paseo requires the registered component itself to be a function.
export function StreamingAssistant({ item }: PluginTimelineItemProps<StreamingAssistantData>) {
  return (
    <View style={{ paddingTop: 12, paddingBottom: 0 }} testID="native-polish-streaming-assistant">
      <Markdown>{finalizeStreamingMarkdown(item.data.text)}</Markdown>
    </View>
  );
}
