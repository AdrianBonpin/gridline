import { useEffect } from "react";
import { useConnectionStore } from "./stores/connectionStore";
import { useSettingsStore } from "./stores/settingsStore";
import { useUiStore } from "./stores/uiStore";
import { HomeScreen } from "./components/layout/HomeScreen";
import { SettingsPage } from "./components/settings/SettingsPage";
import { NewConnectionForm } from "./components/connections/NewConnectionForm";
import { ErrorBanner } from "./components/ui/ErrorBanner";

export default function App() {
  const activeView = useUiStore((s) => s.activeView);
  const setActiveView = useUiStore((s) => s.setActiveView);
  const loadConnections = useConnectionStore((s) => s.loadAll);
  const loadSettings = useSettingsStore((s) => s.load);
  const connectionError = useConnectionStore((s) => s.error);
  const createConnection = useConnectionStore((s) => s.createConnection);

  useEffect(() => {
    loadConnections();
    loadSettings();
  }, [loadConnections, loadSettings]);

  return (
    <div className="min-h-screen">
      <div className="px-6 pt-4">
        <ErrorBanner error={connectionError} onRetry={loadConnections} />
      </div>
      {activeView === "settings" && <SettingsPage />}
      {activeView === "new-connection" && (
        <NewConnectionForm
          onCreate={async (input) => { await createConnection(input); setActiveView("home"); }}
          onCancel={() => setActiveView("home")}
        />
      )}
      {activeView === "home" && <HomeScreen />}
    </div>
  );
}