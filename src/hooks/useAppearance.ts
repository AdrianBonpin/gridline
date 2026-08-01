import { useEffect } from "react";
import type { Theme, FontSize } from "../lib/types";

const LIGHT_COLOR_SCHEME_QUERY = "(prefers-color-scheme: light)";

/** Resolves a Theme setting to the concrete color scheme it maps to. */
export function resolveTheme(theme: Theme): "light" | "dark" {
    if (theme === "dark") return "dark";
    if (theme === "light") return "light";
    // "system" — follow the OS preference. Guard for environments without matchMedia.
    if (typeof window.matchMedia !== "function") return "dark";
    return window.matchMedia(LIGHT_COLOR_SCHEME_QUERY).matches ? "light" : "dark";
}

/**
 * Best-effort: sync the native window chrome (title bar, traffic lights) to the
 * effective theme. Noop outside a Tauri runtime — any failure is swallowed.
 */
async function syncWindowTheme(theme: Theme): Promise<void> {
    try {
        // Dynamic import keeps the Tauri API out of the hot path for
        // non-Tauri bundles and non-Tauri test environments.
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().setTheme(resolveTheme(theme));
    } catch {
        // Outside Tauri — nothing to sync.
    }
}

/**
 * Applies the theme to the document root and returns a cleanup that
 * stops tracking the system preference while the theme is "system".
 * Also syncs the native window chrome (fire-and-forget; noop outside Tauri).
 */
export function applyTheme(theme: Theme): () => void {
    const root = document.documentElement;

    // Fire-and-forget: keep the native window chrome in sync with the theme.
    void syncWindowTheme(theme);

    if (theme === "dark") {
        root.classList.remove("light");
        return () => {};
    }
    if (theme === "light") {
        root.classList.add("light");
        return () => {};
    }

    // "system" — follow the OS preference and keep it in sync.
    // Guard for environments without matchMedia (e.g. jsdom).
    if (typeof window.matchMedia !== "function") {
        return () => {};
    }
    const mq = window.matchMedia(LIGHT_COLOR_SCHEME_QUERY);
    const apply = () => {
        root.classList.toggle("light", mq.matches);
        // OS preference changed — keep the native window chrome in sync too.
        void syncWindowTheme("system");
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
}

/** Applies the font-size scale by toggling a data attribute on the root. */
export function applyFontSize(fontSize: FontSize): void {
    const root = document.documentElement;
    if (fontSize === "medium") {
        delete root.dataset.fontSize;
    } else {
        root.dataset.fontSize = fontSize;
    }
}

/** Keeps the document appearance in sync with the theme/font-size settings. */
export function useAppearance(theme: Theme, fontSize: FontSize): void {
    useEffect(() => {
        const cleanupTheme = applyTheme(theme);
        applyFontSize(fontSize);
        return cleanupTheme;
    }, [theme, fontSize]);
}