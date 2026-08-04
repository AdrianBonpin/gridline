import { useState, useEffect, useCallback } from "react";
import { useConnectionStore } from "../../stores/connectionStore";
import { useNotificationStore } from "../../stores/notificationStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { ConnectionFormShell } from "./ConnectionFormShell";
import { DetailedConnectionForm } from "./DetailedConnectionForm";
import { ProviderTabsGrid } from "./ProviderTabsGrid";
import { ProviderSetupGuide } from "./ProviderSetupGuide";
import {
    parseConnectionString,
    detectProviderFromHost,
} from "../../lib/connectionString";
import { getProviderById, type ProviderId } from "../../lib/providers";
import { validateConnectionInput } from "../../lib/utils";
import { testConnection } from "../../lib/commands";
import { INPUT_ROUNDING } from "../../lib/uiConstants";
import type { ConnectionInput, Folder, Tag } from "../../lib/types";
import type { ConnectionFormData } from "./connectionFormData";

interface NewConnectionScreenProps {
    defaultFolderId?: string | null;
    prefilledConnectionString?: string;
    folders?: Folder[];
    tags?: Tag[];
    onSaved?: () => void;
    onCancel?: () => void;
}

type Stage = "entry" | "configured";

const FALLBACK_PORTS: Record<string, number> = {
    postgresql: 5432,
    mysql: 3306,
    redis: 6379,
};

function createEmptyForm(
    defaultFolderId: string | null = null,
    defaultPorts?: Record<string, number | null>,
): ConnectionFormData {
    return {
        name: "",
        environment: null,
        folder_id: defaultFolderId,
        tag_ids: [],
        connection_string: "",
        db_type: "postgresql",
        host: "",
        port: defaultPorts?.postgresql ?? 5432,
        username: null,
        password: null,
        database: null,
        use_keychain: false,
        ssh_password: null,
    };
}

function getDefaultPort(dbType: string): number {
    return (
        useSettingsStore.getState().settings?.default_ports?.[dbType] ??
        FALLBACK_PORTS[dbType] ??
        5432
    );
}

export function NewConnectionScreen({
    defaultFolderId = null,
    prefilledConnectionString = "",
    folders: _folders,
    tags: _tags,
    onSaved,
    onCancel,
}: NewConnectionScreenProps) {
    const [stage, setStage] = useState<Stage>("entry");
    const [managedPreset, setManagedPreset] = useState<
        "supabase" | "neon" | null
    >(null);
    const [form, setForm] = useState<ConnectionFormData>(() =>
        createEmptyForm(
            defaultFolderId,
            useSettingsStore.getState().settings?.default_ports,
        ),
    );
    const [testLoading, setTestLoading] = useState(false);
    const [saveLoading, setSaveLoading] = useState(false);
    const createConnection = useConnectionStore((s) => s.createConnection);
    const notify = useNotificationStore((s) => s.notify);

    const revealConfigured = useCallback(
        (updates: Partial<ConnectionFormData>) => {
            setForm((prev) => ({ ...prev, ...updates }));
            setStage("configured");
        },
        [],
    );

    const handleConnectionStringChange = useCallback((value: string) => {
        const parsed = parseConnectionString(value);
        if (parsed) {
            const provider =
                parsed.db_type === "postgresql"
                    ? detectProviderFromHost(parsed.host)
                    : null;
            setManagedPreset(provider);
            setForm((prev) => ({
                ...prev,
                connection_string: value,
                db_type: parsed.db_type,
                host: parsed.host,
                port: parsed.port ?? getDefaultPort(parsed.db_type),
                username: parsed.username,
                password: parsed.password,
                database: parsed.database,
            }));
        } else {
            setManagedPreset(null);
            setForm((prev) => ({ ...prev, connection_string: value }));
        }
    }, []);

    useEffect(() => {
        if (
            stage === "entry" &&
            form.connection_string &&
            parseConnectionString(form.connection_string)
        ) {
            setStage("configured");
        }
    }, [form.connection_string, stage]);

    useEffect(() => {
        if (prefilledConnectionString) {
            handleConnectionStringChange(prefilledConnectionString);
        }
    }, [prefilledConnectionString, handleConnectionStringChange]);

    const handleSelectProvider = useCallback(
        (id: ProviderId) => {
            const provider = getProviderById(id)!;
            setManagedPreset(
                provider.isManagedPreset ? (id as "supabase" | "neon") : null,
            );
            revealConfigured({
                db_type: provider.dbType,
                port:
                    provider.dbType === "sqlite"
                        ? null
                        : getDefaultPort(provider.dbType),
                ...(provider.dbType === "sqlite" ? { host: "" } : {}),
            });
        },
        [revealConfigured],
    );

    const updateForm = useCallback(
        (updates: Partial<ConnectionFormData>) => {
            setForm((prev) => {
                if (
                    "connection_string" in updates &&
                    updates.connection_string !== undefined
                ) {
                    const value = updates.connection_string;
                    const parsed = parseConnectionString(value);
                    if (parsed) {
                        const provider =
                            parsed.db_type === "postgresql"
                                ? detectProviderFromHost(parsed.host)
                                : null;
                        setManagedPreset(provider);
                        return {
                            ...prev,
                            ...updates,
                            db_type: parsed.db_type,
                            host: parsed.host,
                            port:
                                parsed.port ??
                                getDefaultPort(parsed.db_type),
                            username: parsed.username,
                            password: parsed.password,
                            database: parsed.database,
                        };
                    }
                    return { ...prev, ...updates };
                }
                return { ...prev, ...updates };
            });
        },
        [],
    );

    const buildPayload = useCallback((): ConnectionInput => {
        return {
            name: form.name,
            db_type: form.db_type,
            host: form.host,
            port: form.port,
            username: form.username,
            folder_id: form.folder_id,
            tag_ids: form.tag_ids,
            connection_string: form.connection_string,
            environment: form.environment,
            password: form.password,
            database: form.database,
            use_keychain: form.use_keychain,
            ssh_host: form.ssh_host ?? null,
            ssh_port: form.ssh_port ?? null,
            ssh_user: form.ssh_user ?? null,
            ssh_auth_method: form.ssh_auth_method ?? null,
            ssh_private_key_path: form.ssh_private_key ?? null,
            ssh_password: form.ssh_password ?? null,
            ssh_passphrase: form.ssh_passphrase ?? null,
        };
    }, [form]);

    const validate = useCallback((): string | null => {
        const result = validateConnectionInput(buildPayload());
        return result.ok ? null : result.error;
    }, [buildPayload]);

    const handleSave = useCallback(async () => {
        const error = validate();
        if (error) {
            notify(error, "error");
            return;
        }
        setSaveLoading(true);
        try {
            await createConnection(buildPayload());
            notify("Connection saved", "success");
            onSaved?.();
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            notify(`Failed to save connection: ${message}`, "error");
        } finally {
            setSaveLoading(false);
        }
    }, [validate, notify, createConnection, buildPayload, onSaved]);

    const handleTest = useCallback(async () => {
        const error = validate();
        if (error) {
            notify(error, "error");
            return;
        }
        setTestLoading(true);
        try {
            const result = await testConnection(buildPayload());
            if (result.ok) {
                notify("Connection successful", "success");
            } else {
                notify(result.error ?? "Connection failed", "error");
            }
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            notify(`Connection test failed: ${message}`, "error");
        } finally {
            setTestLoading(false);
        }
    }, [validate, notify, testConnection, buildPayload]);

    const isEntry = stage === "entry";
    const showEntryUri = isEntry || form.db_type !== "sqlite";

    return (
        <ConnectionFormShell
            onBack={() => onCancel?.()}
            onTest={handleTest}
            onSave={handleSave}
            testLoading={testLoading}
            saveLoading={saveLoading}
        >
            <div>
                {isEntry && showEntryUri && (
                    <label className="block text-sm text-text mb-1.5">
                        Connection URI
                    </label>
                )}
                {isEntry && form.db_type === "sqlite" ? (
                    <div>
                        <label className="block text-sm text-text mb-1.5">
                            File Path
                        </label>
                        <input
                            value={form.host}
                            onChange={(e) =>
                                setForm((prev) => ({
                                    ...prev,
                                    host: e.target.value,
                                }))
                            }
                            placeholder="/path/to/database.sqlite"
                            aria-label="File Path"
                            className={`w-full ${INPUT_ROUNDING} bg-surface border border-border px-4 py-3 text-sm text-text font-mono placeholder-text-muted/60 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/50 transition-colors`}
                        />
                    </div>
                ) : (
                    <textarea
                        value={form.connection_string}
                        onChange={(e) =>
                            handleConnectionStringChange(e.target.value)
                        }
                        placeholder="postgresql://user:password@host:5432/database"
                        aria-label={isEntry ? "Connection URI" : undefined}
                        rows={1}
                        className={`w-full ${INPUT_ROUNDING} bg-surface border border-border px-4 py-3 text-sm text-text font-mono placeholder-text-muted/60 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/50 transition-colors resize-none overflow-x-auto whitespace-nowrap ${
                            isEntry ? "" : "sr-only"
                        }`}
                    />
                )}
                {isEntry && showEntryUri && (
                    <p className="text-xs text-text-muted mt-1.5">
                        Paste a connection string to auto-detect, or pick a
                        provider below.
                    </p>
                )}
            </div>

            {isEntry ? (
                <>
                    <div className="flex items-center gap-3 my-1">
                        <div className="flex-1 h-px bg-border" />
                        <span className="text-xs text-text-muted">OR</span>
                        <div className="flex-1 h-px bg-border" />
                    </div>
                    <ProviderTabsGrid onSelect={handleSelectProvider} />
                </>
            ) : (
                <>
                    {managedPreset && (
                        <ProviderSetupGuide provider={managedPreset} />
                    )}
                    <DetailedConnectionForm
                        form={form}
                        onChange={updateForm}
                    />
                </>
            )}
        </ConnectionFormShell>
    );
}