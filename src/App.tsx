import { useEffect } from "react";
import { useConnectionStore } from "./stores/connectionStore";
import { useSettingsStore } from "./stores/settingsStore";
import { useUiStore } from "./stores/uiStore";
import { HomeScreen } from "./components/layout/HomeScreen";

export default function App() {
  const activeView = useUiStore((s) => s.activeView);
  const loadConnections = useConnectionStore((s) => s.loadAll);
  const loadSettings = useSettingsStore((s) => s.load);

  useEffect(() => {
    loadConnections();
    loadSettings();
  }, [loadConnections, loadSettings]);

  if (activeView === "settings") return <SettingsPagePlaceholder />;
  if (activeView === "new-connection") return <NewConnectionPlaceholder />;
  return <HomeScreen />;
}

function SettingsPagePlaceholder() {
  return <div data-testid="settings-page">Settings (coming in Phase 4)</div>;
}

function NewConnectionPlaceholder() {
  return <div data-testid="new-connection-page">New Connection (coming in Phase 4)</div>;
}