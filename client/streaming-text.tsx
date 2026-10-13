import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { useRevealedText } from "@getpaseo/plugin/client/react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { Platform, Text } from "react-native";
import { z } from "zod";
import { StreamingMarkdown } from "./streaming-markdown";
import {
  GENTLE_STREAM_FADE_DURATION_MS,
  GENTLE_STREAM_REVEAL_HORIZON_MS,
  QUICK_STREAM_FADE_DURATION_MS,
  QUICK_STREAM_REVEAL_HORIZON_MS,
  usePreferences,
} from "./preferences";

declare const window: {
  requestAnimationFrame(callback: () => void): number;
  cancelAnimationFrame(id: number): void;
};

export const streamingAssistantSchema = z.object({
  text: z.string(),
  phase: z.enum(["streaming", "complete"]),
});

type StreamingAssistantData = z.output<typeof streamingAssistantSchema>;

interface StreamFadeChunk {
  start: number;
  text: string;
  startedAtMs: number;
}

export interface StreamFadeState {
  committed: string;
  chunks: StreamFadeChunk[];
}

const noChunks: StreamFadeChunk[] = [];

/**
 * Provider deltas are coalesced and arrive in uneven bursts. Releasing the
 * whole suffix (even under a fade) makes those bursts visible. Hold the target
 * text separately and drain its backlog every frame, proportionally, so a
 * faster stream catches up faster without ever becoming a series of pops.
 */
interface PacedRevealState {
  target: string;
  revealed: number;
  committed: number;
  chunks: StreamFadeChunk[];
}

function useWebPacedReveal(
  text: string,
  enabled: boolean,
  horizonMs: number,
  fadeDurationMs: number,
  maxCharsPerFrame: number,
): { text: string; fade: StreamFadeState } {
  const stateRef = useRef<PacedRevealState>({ target: text, revealed: text.length, committed: text.length, chunks: noChunks });
  const [, rerender] = useState(0);
  if (stateRef.current.target !== text) {
    const current = stateRef.current;
    // A provider rewrite cannot safely preserve source offsets. Keep already
    // visible text stable, but do not replay the old tail's fades.
    if (!text.startsWith(current.target)) {
      const revealed = Math.min(current.revealed, text.length);
      stateRef.current = { target: text, revealed, committed: revealed, chunks: noChunks };
    } else {
      stateRef.current = { ...current, target: text };
    }
  }
  useEffect(() => {
    if (!enabled) {
      stateRef.current = { target: text, revealed: text.length, committed: text.length, chunks: noChunks };
      rerender((revision) => revision + 1);
      return;
    }
    let cancelled = false;
    let frame: number | null = null;
    let lastFrameAt = Date.now();
    const settle = (now: number) => {
      const current = stateRef.current;
      let settled = 0;
      let committed = current.committed;
      for (const chunk of current.chunks) {
        if (now - chunk.startedAtMs < fadeDurationMs) break;
        committed = chunk.start + chunk.text.length;
        settled += 1;
      }
      if (settled) stateRef.current = { ...current, committed, chunks: current.chunks.slice(settled) };
    };
    const tick = () => {
      if (cancelled) return;
      const now = Date.now();
      settle(now);
      const current = stateRef.current;
      const backlog = current.target.length - current.revealed;
      const elapsedMs = Math.min(Math.max(now - lastFrameAt, 0), 100);
      lastFrameAt = now;
      if (backlog > 0) {
        // A provider can hand us a paragraph in one delta. The horizon defines
        // the normal catch-up rate, while this cap keeps one browser frame from
        // adding enough glyphs to wrap multiple lines at once. That cap is what
        // lets the chat's bottom-follow rise read as continuous movement.
        const desiredStep = Math.max(1, Math.ceil((backlog * elapsedMs) / horizonMs));
        const step = Math.min(backlog, maxCharsPerFrame, desiredStep);
        const start = current.revealed;
        const revealed = start + step;
        stateRef.current = {
          ...stateRef.current,
          revealed,
          chunks: [...stateRef.current.chunks, { start, text: current.target.slice(start, revealed), startedAtMs: now }],
        };
      }
      rerender((revision) => revision + 1);
      const next = stateRef.current;
      if (next.revealed < next.target.length || next.chunks.length > 0) frame = window.requestAnimationFrame(tick);
    };
    // Keep the first live text visible. Only subsequent growth is paced, so
    // a hydrated/re-mounted row never replays from an empty bubble.
    if (stateRef.current.revealed < text.length || stateRef.current.chunks.length > 0) frame = window.requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [enabled, fadeDurationMs, horizonMs, maxCharsPerFrame, text]);

  const current = stateRef.current;
  if (!enabled) return { text, fade: { committed: text, chunks: noChunks } };
  const visible = current.target.slice(0, current.revealed);
  return {
    text: visible,
    fade: {
      committed: current.target.slice(0, Math.min(current.committed, current.revealed)),
      chunks: current.chunks,
    },
  };
}

/**
 * Keeps a live assistant row mounted while Paseo delivers accumulated text.
 * Native uses the host's backlog-aware reveal hook; web keeps its own paced
 * queue so provider batch size cannot dictate visible text cadence. The
 * host renderer resumes when the turn completes, restoring Paseo's native
 * selection, copy, duration, and fork controls.
 */
export function StreamingAssistantText({
  item,
  theme,
}: PluginTimelineItemProps<StreamingAssistantData>) {
  const preferences = usePreferences();
  const motionEnabled = preferences.enabled && preferences.messages && item.data.phase === "streaming";
  const webPacingEnabled = Platform.OS === "web" && preferences.enabled && preferences.messages;
  const nativeText = useRevealedText(item.data.text, motionEnabled ? item.data.phase : "complete");
  const webReveal = useWebPacedReveal(
    item.data.text,
    webPacingEnabled,
    preferences.pace === "quick"
      ? QUICK_STREAM_REVEAL_HORIZON_MS
      : GENTLE_STREAM_REVEAL_HORIZON_MS,
    preferences.pace === "quick"
      ? QUICK_STREAM_FADE_DURATION_MS
      : GENTLE_STREAM_FADE_DURATION_MS,
    preferences.pace === "quick" ? 8 : 4,
  );
  const style = useMemo(
    () => ({ color: theme.colors.foreground, lineHeight: 22 }),
    [theme.colors.foreground],
  );
  if (Platform.OS !== "web") return <Text style={style}>{nativeText}</Text>;

  return <StreamingMarkdown text={webReveal.text} fade={webReveal.fade} theme={theme} pace={preferences.pace} streaming />;
}
