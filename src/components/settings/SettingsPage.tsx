import { Button } from "../ui/Button";
import { useUiStore } from "../../stores/uiStore";

export function SettingsPage() {
  const setActiveView = useUiStore((s) => s.setActiveView);

  return (
    <div className="max-w-3xl mx-auto p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-heading text-xl">Settings</h1>
        <Button variant="ghost" onClick={() => setActiveView("home")}>Back</Button>
      </div>
      <nav className="space-y-2">
        <section><h2 className="font-heading">General</h2></section>
        <section><h2 className="font-heading">Appearance</h2></section>
        <section><h2 className="font-heading">Connections</h2></section>
        <section><h2 className="font-heading">Keyboard Shortcuts</h2></section>
        <section><h2 className="font-heading">Tags</h2></section>
        <section><h2 className="font-heading">About</h2></section>
      </nav>
    </div>
  );
}