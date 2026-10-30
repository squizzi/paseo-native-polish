import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { SettingsCard, SettingsSection, SettingsSwitch, SettingsSelect } from "@getpaseo/plugin/client/ui";
import { Platform, Text, View } from "react-native";
import { setPreferences, usePreferences } from "./preferences";
export function MotionSettings({ theme, layout }: PluginSurfaceProps) {
  const values = usePreferences();
  return (
    <View style={{ gap: 20, paddingVertical: layout.compact ? 12 : 20 }}>
      <Text style={{ color: theme.colors.foregroundMuted, lineHeight: 21 }}>
        {Platform.OS === "web"
          ? "Responsive motion and smooth streaming text for Paseo. Changes apply immediately in this client. System Reduce Motion is always respected."
          : "Native Polish is designed for Paseo's desktop and web app. Mobile keeps its existing core rendering and native transitions."}
      </Text>
      <SettingsSection title="Motion">
        <SettingsCard>
          <SettingsSwitch label="Enable motion" value={values.enabled} onValueChange={(enabled) => setPreferences({ ...values, enabled })} />
          <SettingsSwitch label="Sidebars, sections and workspace rows" value={values.sidebars} onValueChange={(sidebars) => setPreferences({ ...values, sidebars })} />
          <SettingsSwitch label="Peek at hidden sidebars from screen edges" value={values.edgePeek} onValueChange={(edgePeek) => setPreferences({ ...values, edgePeek })} />
          <SettingsSwitch label="Explorer file trees" value={values.trees} onValueChange={(trees) => setPreferences({ ...values, trees })} />
          <SettingsSwitch label="Tool calls and thinking" value={values.timeline} onValueChange={(timeline) => setPreferences({ ...values, timeline })} />
          <SettingsSwitch label="Split, close, maximize and restore panes" value={values.panes} onValueChange={(panes) => setPreferences({ ...values, panes })} />
          <SettingsSwitch label="Tabs" value={values.tabs} onValueChange={(tabs) => setPreferences({ ...values, tabs })} />
          <SettingsSwitch label="Menus, popovers and dialogs" value={values.overlays} onValueChange={(overlays) => setPreferences({ ...values, overlays })} />
          <SettingsSwitch label="Buttons, hover and focus" value={values.controls} onValueChange={(controls) => setPreferences({ ...values, controls })} />
          <SettingsSwitch label="Loading and agent status changes" value={values.states} onValueChange={(states) => setPreferences({ ...values, states })} />
          <SettingsSwitch label="New messages" value={values.messages} onValueChange={(messages) => setPreferences({ ...values, messages })} />
          <SettingsSwitch label="Elastic scrolling" value={values.elasticScroll} onValueChange={(elasticScroll) => setPreferences({ ...values, elasticScroll })} />
          <SettingsSelect label="Pace" value={values.pace} options={[{ label: "Gentle · 220 ms", value: "gentle" }, { label: "Quick · 150 ms", value: "quick" }]} onValueChange={(pace) => setPreferences({ ...values, pace: pace === "quick" ? "quick" : "gentle" })} />
        </SettingsCard>
      </SettingsSection>
    </View>
  );
}
