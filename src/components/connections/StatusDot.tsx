import { useCallback, useRef, useState } from "react";
import type { ConnectionInput, ConnectionTestResult } from "../../lib/types";
import * as cmd from "../../lib/commands";

export interface StatusDotProps {
    connectionId: string;
    buildConfig: (password: string | null) => ConnectionInput;
}

type DotState = "idle" | "checking" | "online" | "offline";

export function StatusDot({ connectionId, buildConfig }: StatusDotProps) {
    const [state, setState] = useState<DotState>("idle");
    const [info, setInfo] = useState<string>("");
    const timeoutRef = useRef<number | null>(null);
    const lastCheckRef = useRef<number>(0);

    const handleClick = useCallback(async () => {
        const now = Date.now();
        if (state === "checking") return;
        if (now - lastCheckRef.current < 2000) return;
        lastCheckRef.current = now;
        setState("checking");
        setInfo("");

        try {
            const password = await cmd.getConnectionPassword(connectionId);
            const input = buildConfig(password);
            const result: ConnectionTestResult = await cmd.testConnection(input);
            if (result.ok) {
                const latency = result.latency_ms ?? 0;
                const version = result.server_version ?? "unknown";
                const text = `${version} · ${latency}ms`;
                setInfo(text);
                setState("online");
            } else {
                setInfo(result.error ?? "offline");
                setState("offline");
            }
        } catch (e) {
            setInfo(e instanceof Error ? e.message : "offline");
            setState("offline");
        }

        if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
        timeoutRef.current = window.setTimeout(() => {
            setState("idle");
            setInfo("");
        }, 5000);
    }, [connectionId, buildConfig, state]);

    const colorClasses = {
        idle: "bg-text-muted/30",
        checking: "bg-amber-400 animate-pulse",
        online: "bg-green-500",
        offline: "bg-red-500",
    };

    const title = info || "Click to check connection";

    return (
        <button
            type="button"
            onClick={handleClick}
            disabled={state === "checking"}
            aria-label={state === "checking" ? "Checking connection" : "Check connection"}
            title={title}
            data-state={state}
            className={`flex items-center gap-1.5 px-1.5 py-0.5 rounded-full hover:ring-1 hover:ring-accent transition-all ${state === "checking" ? "cursor-wait" : "cursor-pointer"}`}
        >
            <span className={`w-2.5 h-2.5 rounded-full ${colorClasses[state]}`} />
            {info && <span className="text-[10px] leading-none text-text-muted">{info}</span>}
        </button>
    );
}