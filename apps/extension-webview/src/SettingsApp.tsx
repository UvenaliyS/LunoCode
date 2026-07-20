import { useEffect, useState } from "react";
import {
  Bell,
  Cpu,
  DeviceMobile,
  Flask,
  Gear,
  Globe,
  Info,
  Layout,
  ListChecks,
  Note,
  StarFour,
  TerminalWindow,
  User,
} from "@phosphor-icons/react";
import { useLunoState } from "./useLunoState";
import type { SettingsTabId } from "./contracts";
import { AgentIcon } from "./components/AgentIcon";
import { I18nProvider, LOCALES, type Lang } from "./settings/i18n";
import {
  SettingsShell,
  TabRail,
  useHostMessage,
  type RailItem,
} from "./settings/primitives";
import { GeneralTab } from "./settings/GeneralTab";
import { ProvidersTab } from "./settings/ProvidersTab";
import { ModelsTab } from "./settings/ModelsTab";
import { AgentTab } from "./settings/AgentTab";
import { SshTab } from "./settings/SshTab";
import { RemoteTab } from "./settings/RemoteTab";
import { NotificationsTab } from "./settings/NotificationsTab";
import { AccountTab } from "./settings/AccountTab";
import { LanguageTab } from "./settings/LanguageTab";
import { AboutTab } from "./settings/AboutTab";
import { AutoApproveTab } from "./settings/AutoApproveTab";
import { DisplayTab } from "./settings/DisplayTab";
import { ContextTab } from "./settings/ContextTab";
import { PlaceholderTab } from "./settings/PlaceholderTab";
import "./settings/settings2.css";

/**
 * Settings — a thin shell. All real UI lives in settings/*: one file per tab
 * plus shared primitives. State comes from useLunoState (host `state`
 * messages); one-off host messages (providerTest, sshTestResult,
 * configTransfer, sshServers, navigate deep-links) are consumed by the tabs
 * themselves via useHostMessage.
 */
/** The robot glyph adapted to the rail's phosphor-like icon contract. */
function AgentRailIcon({
  size = 15,
  weight = "regular",
}: {
  size?: number;
  weight?: "fill" | "regular";
}) {
  return <AgentIcon size={size} filled={weight === "fill"} />;
}

export function SettingsApp() {
  const { state } = useLunoState();
  // Deep-link target stashed by main.tsx: the navigate message lands before
  // this component mounts, so the tab id is parked on window for pickup.
  // Read-only here — StrictMode runs this initializer twice, so clearing the
  // stash inside it would make the second run fall back to "general".
  const [tab, setTab] = useState<SettingsTabId>(
    () => (window.__LUNO_SETTINGS_TAB__ as SettingsTabId | undefined) ?? "general",
  );
  useEffect(() => {
    window.__LUNO_SETTINGS_TAB__ = undefined;
  }, []);

  // Deep-links while already mounted (e.g. sshAdd card → ssh tab).
  useHostMessage((msg) => {
    if (msg.type === "navigate" && msg.view === "settings" && msg.settingsTab) {
      setTab(msg.settingsTab);
    }
  });

  // Language: "auto" (the default) follows the VS Code display language,
  // which the webview inherits as navigator.language.
  const pref = state.settings.language ?? "auto";
  const lang: Lang =
    pref === "auto"
      ? navigator.language?.toLowerCase().startsWith("ru")
        ? "ru"
        : "en"
      : pref;
  const t = LOCALES[lang];

  const rail: RailItem[] = [
    { id: "general", label: t.tabs.general, Icon: Gear },
    { id: "account", label: t.tabs.account, Icon: User },
    { id: "providers", label: t.tabs.providers, Icon: Cpu },
    { id: "models", label: t.tabs.models, Icon: StarFour },
    { id: "agent", label: t.tabs.agent, Icon: AgentRailIcon },
    { id: "autoApprove", label: t.tabs.autoApprove, Icon: ListChecks },
    { id: "display", label: t.tabs.display, Icon: Layout },
    { id: "notifications", label: t.tabs.notifications, Icon: Bell },
    { id: "context", label: t.tabs.context, Icon: Note },
    { id: "ssh", label: t.tabs.ssh, Icon: TerminalWindow },
    { id: "remote", label: t.tabs.remote, Icon: DeviceMobile },
    { id: "experimental", label: t.tabs.experimental, Icon: Flask },
    { id: "language", label: t.tabs.language, Icon: Globe },
    { id: "about", label: t.tabs.about, Icon: Info },
  ];

  return (
    <I18nProvider value={t}>
      <SettingsShell>
        <TabRail items={rail} active={tab} onSelect={setTab} />
        <div className="settings-content-pane">
          {tab === "general" && <GeneralTab state={state} />}
          {tab === "providers" && <ProvidersTab state={state} />}
          {tab === "models" && <ModelsTab state={state} />}
          {tab === "agent" && <AgentTab state={state} onGoTab={setTab} />}
          {tab === "autoApprove" && <AutoApproveTab state={state} onGoTab={setTab} />}
          {tab === "display" && <DisplayTab state={state} />}
          {tab === "context" && <ContextTab state={state} />}
          {tab === "experimental" && <PlaceholderTab title={t.tabs.experimental} />}
          {tab === "ssh" && <SshTab state={state} />}
          {tab === "remote" && <RemoteTab state={state} />}
          {tab === "notifications" && <NotificationsTab state={state} />}
          {tab === "account" && <AccountTab state={state} />}
          {tab === "language" && <LanguageTab state={state} resolved={lang} />}
          {tab === "about" && <AboutTab />}
        </div>
      </SettingsShell>
    </I18nProvider>
  );
}
