import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { SettingsApp } from "./SettingsApp";
import { HistoryPanel } from "./components/HistoryPanel";
import type { ExtensionToWebview, ViewKind } from "./contracts";
import "./fira-code.css";
import "./styles.css";

declare global {
  interface Window {
    __LUNO_VIEW__?: ViewKind;
    /** Deep-linked settings tab, stashed here because the navigate message
     *  arrives BEFORE SettingsApp mounts and would otherwise be lost. */
    __LUNO_SETTINGS_TAB__?: string;
    /** Locked view: the "Luno Settings" editor tab pins its view — a navigate
     *  message can deep-link a settings TAB, but never switch away from
     *  settings to chat/history. */
    __LUNO_LOCKED__?: boolean;
  }
}

/** Holds the active screen and switches it in-place on `navigate` messages,
 * so Settings/Link open inside the same sidebar webview rather than a new tab. */
function Root() {
  const [view, setView] = useState<ViewKind>(window.__LUNO_VIEW__ ?? "chat");
  const locked = !!window.__LUNO_LOCKED__;

  useEffect(() => {
    function onMessage(event: MessageEvent<ExtensionToWebview>) {
      const msg = event.data;
      if (msg.type === "navigate") {
        // A locked (settings-only) webview accepts a deep-linked settings TAB
        // but never switches its view — it must always show settings.
        if (locked) {
          if (msg.view === "settings" && msg.settingsTab) {
            window.__LUNO_SETTINGS_TAB__ = msg.settingsTab;
          }
          // still forward to SettingsApp's own useHostMessage for the tab jump
        } else {
          if (msg.view === "settings" && msg.settingsTab) {
            window.__LUNO_SETTINGS_TAB__ = msg.settingsTab;
          }
          setView(msg.view);
        }
      }
      // Display: apply the whole-webview zoom + chat font scale from settings
      // globally, so every screen scales together. Chromium (the webview
      // runtime) supports the non-standard `zoom` property; the font scale is a
      // CSS var the chat/markdown styles multiply into their font sizes.
      if (msg.type === "state") {
        const d = msg.state?.settings?.display;
        const scale = d?.uiScale;
        if (typeof scale === "number" && scale > 0) {
          document.documentElement.style.setProperty("zoom", String(scale));
        }
        const font = d?.fontScale;
        if (typeof font === "number" && font > 0) {
          document.documentElement.style.setProperty(
            "--chat-font-scale",
            String(font),
          );
        }
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  if (view === "settings") return <SettingsApp />;
  if (view === "history") return <HistoryPanel />;
  return <App />;
}

const root = document.getElementById("root");

if (root) {
  createRoot(root).render(
    <React.StrictMode>
      <Root />
    </React.StrictMode>,
  );
}
