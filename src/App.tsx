import { useEffect } from "react";
import { useConnectionStore } from "./stores/connectionStore";
import { useSettingsStore } from "./stores/settingsStore";
import { useUiStore } from "./stores/uiStore";
import { HomeScreen } from "./components/layout/HomeScreen";
import { SettingsPage } from "./components/settings/SettingsPage";
import { NewConnectionScreen } from "./components/connections/NewConnectionScreen";
import { ErrorBanner } from "./components/ui/ErrorBanner";
import { ToastContainer } from "./components/ui/Toast";
import { getCurrentWindow } from "@tauri-apps/api/window";

const VIEW_TITLES: Record<string, string> = {
  home: "Gridline",
  settings: "Settings",
  "new-connection": "New Connection",
  "db-viewer": "",
};

export default function App() {
    const activeView = useUiStore((s) => s.activeView);
    const setActiveView = useUiStore((s) => s.setActiveView);
    const loadConnections = useConnectionStore((s) => s.loadAll);
    const loadSettings = useSettingsStore((s) => s.load);
    const connectionError = useConnectionStore((s) => s.error);
    const activeFolderId = useUiStore((s) => s.activeFolderId);
    const folders = useConnectionStore((s) => s.folders);
    const tags = useConnectionStore((s) => s.tags);
    const prefilledConnectionString = useUiStore((s) => s.prefilledConnectionString);
    const clearPrefilledConnectionString = useUiStore((s) => s.clearPrefilledConnectionString);

    useEffect(() => {
        loadConnections();
        loadSettings();
    }, [loadConnections, loadSettings]);

    useEffect(() => {
        let title = VIEW_TITLES[activeView] ?? "Gridline";
        if (activeView === "db-viewer") {
            const conn = useConnectionStore.getState().connections.find(
                (c) => c.id === useUiStore.getState().activeConnectionId
            );
            if (conn) title = conn.name;
        }
        document.title = title;
        try {
            getCurrentWindow().setTitle(title).catch(() => {
                // Ignore environments where the Tauri API is unavailable (tests, browser)
            });
        } catch {
            // getCurrentWindow can throw outside of a Tauri runtime
        }
    }, [activeView]);

    return (
        <div className="min-h-svh select-none">
            {connectionError && (
                <div className="px-6 pt-4">
                    <ErrorBanner
                        error={connectionError}
                        onRetry={loadConnections}
                    />
                </div>
            )}
            {activeView === "settings" && <SettingsPage />}
            {activeView === "new-connection" && (
                <NewConnectionScreen
                    defaultFolderId={activeFolderId}
                    prefilledConnectionString={prefilledConnectionString ?? ""}
                    folders={folders}
                    tags={tags}
                    onSaved={() => {
                        clearPrefilledConnectionString();
                        setActiveView("home");
                    }}
                    onCancel={() => {
                        clearPrefilledConnectionString();
                        setActiveView("home");
                    }}
                />
            )}
            {activeView === "home" && <HomeScreen />}
            {activeView === "db-viewer" && (
                // TODO: Import and render DbViewerScreen once created in Phase 4
                // import { DbViewerScreen } from "./components/db-viewer/DbViewerScreen";
                <div className="flex items-center justify-center min-h-screen text-text-muted">
                    DB Viewer (coming in Phase 4)
                </div>
            )}
            <ToastContainer />
        </div>
    );
}
