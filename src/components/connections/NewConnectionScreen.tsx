import { useState, useEffect, useCallback } from "react";
import { useConnectionStore } from "../../stores/connectionStore";
import { useNotificationStore } from "../../stores/notificationStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { ConnectionFormShell } from "./ConnectionFormShell";
import { SimpleConnectionForm } from "./SimpleConnectionForm";
import { DetailedConnectionForm } from "./DetailedConnectionForm";
import { parseConnectionString } from "../../lib/connectionString";
import { validateConnectionInput } from "../../lib/utils";
import { testConnection } from "../../lib/commands";
import type {
    Folder,
    Tag,
    NewConnectionMode,
    ConnectionInput,
} from "../../lib/types";
import type { ConnectionFormData } from "./connectionFormData";

interface NewConnectionScreenProps {
    defaultFolderId?: string | null;
    prefilledConnectionString?: string;
    folders: Folder[];
    tags: Tag[];
    onSaved?: () => void;
    onCancel?: () => void;
}

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
        useSettingsStore.getState().settings?.default_ports?.[dbType] ?? 5432
    );
}

export function NewConnectionScreen({
    defaultFolderId = null,
    prefilledConnectionString = "",
    folders,
    tags,
    onSaved,
    onCancel,
}: NewConnectionScreenProps) {
    const [mode, setMode] = useState<NewConnectionMode>("simple");
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

    const handleConnectionStringChange = useCallback((value: string) => {
        setForm((prev) => {
            const parsed = parseConnectionString(value);
            if (!parsed) return { ...prev, connection_string: value };
            return {
                ...prev,
                connection_string: value,
                db_type: parsed.db_type,
                host: parsed.host,
                port: parsed.port ?? getDefaultPort(parsed.db_type),
                username: parsed.username,
                password: parsed.password,
                database: parsed.database,
            };
        });
    }, []);

    useEffect(() => {
        if (prefilledConnectionString) {
            handleConnectionStringChange(prefilledConnectionString);
        }
    }, [prefilledConnectionString, handleConnectionStringChange]);

    const updateForm = useCallback((updates: Partial<ConnectionFormData>) => {
        setForm((prev) => ({ ...prev, ...updates }));
    }, []);

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

    const onSimpleChange = useCallback(
        (updates: Partial<ConnectionFormData>) => {
            if (
                "connection_string" in updates &&
                updates.connection_string !== undefined
            ) {
                handleConnectionStringChange(updates.connection_string);
            } else {
                updateForm(updates);
            }
        },
        [handleConnectionStringChange, updateForm],
    );

    const onToggleMode = useCallback(() => {
        setMode((m) => (m === "simple" ? "detailed" : "simple"));
    }, []);

    return (
        <ConnectionFormShell
            mode={mode}
            onBack={() => onCancel?.()}
            onTest={handleTest}
            onSave={handleSave}
            onToggleMode={onToggleMode}
            testLoading={testLoading}
            saveLoading={saveLoading}
        >
            {mode === "simple" ? (
                <SimpleConnectionForm
                    form={form}
                    folders={folders}
                    tags={tags}
                    onChange={onSimpleChange}
                />
            ) : (
                <DetailedConnectionForm form={form} onChange={updateForm} />
            )}
        </ConnectionFormShell>
    );
}
