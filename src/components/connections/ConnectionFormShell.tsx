import { ChevronLeft } from "lucide-react";
import { Button } from "../ui/Button";
import type { NewConnectionMode } from "../../lib/types";
import type { ReactNode } from "react";

interface ConnectionFormShellProps {
    mode: NewConnectionMode;
    onBack: () => void;
    onTest: () => void;
    onSave: () => void;
    onToggleMode: () => void;
    testLoading?: boolean;
    saveLoading?: boolean;
    children: ReactNode;
}

export function ConnectionFormShell({
    mode,
    onBack,
    onTest,
    onSave,
    onToggleMode,
    testLoading,
    saveLoading,
    children,
}: ConnectionFormShellProps) {
    return (
        <div className="min-h-full bg-canvas">
            <div className="max-w-lg mx-auto p-8">
                <Button
                    variant="ghost"
                    onClick={onBack}
                    className="mb-4 -ml-3 justify-start gap-1 px-3"
                >
                    <ChevronLeft size={16} /> Back
                </Button>

                <div className="space-y-4">{children}</div>

                <div className="flex gap-3 mt-8">
                    <Button
                        variant="secondary"
                        onClick={onTest}
                        disabled={testLoading}
                        className="flex-1"
                    >
                        {testLoading ? "Testing..." : "Test Connection"}
                    </Button>
                    <Button
                        onClick={onSave}
                        disabled={saveLoading}
                        className="flex-1"
                    >
                        {saveLoading ? "Saving..." : "Save Connection"}
                    </Button>
                </div>

                <button
                    type="button"
                    onClick={onToggleMode}
                    className="w-full mt-4 text-sm text-text-muted hover:text-text transition-colors cursor-pointer"
                >
                    {mode === "simple"
                        ? "Configure manually instead →"
                        : "← Back to connection string"}
                </button>
            </div>
        </div>
    );
}
