import { useEffect } from "react";
import type { Theme, FontSize } from "../lib/types";

const LIGHT_COLOR_SCHEME_QUERY = "(prefers-color-scheme: light)";

/**
 * Resolves a Theme setting to the concrete color scheme it maps to (pure).
 * For "system" this reads the webview's prefers-color-scheme, which correctly
 * mirrors the OS only while the native window is NOT forced to a specific
 * theme (see applyTheme's system handling).
 */
export function resolveTheme(theme: Theme): "light" | "dark" {
    if (theme === "dark") return "dark";
    if (theme === "light") return "light";
    // "system" — follow the OS preference. Guard for environments without matchMedia.
    if (typeof window.matchMedia !== "function") return "dark";
    return window.matchMedia(LIGHT_COLOR_SCHEME_QUERY).matches ? "light" : "dark";
}

/**
 * Syncs the native window chrome. Pass null to reset the window to follow the
 * OS theme — required for the "system" setting, because forcing the window
 * theme changes the webview's prefers-color-scheme (WKWebView follows the
 * window appearance), which would otherwise pollute matchMedia.
 */
async function syncWindowTheme(effective: "light" | "dark" | null): Promise<void> {
    try {
        // Dynamic import keeps the Tauri API out of the hot path for
        // non-Tauri bundles and non-Tauri test environments.
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const win = getCurrentWindow();
        if (effective === null) {
            await win.setTheme(null);
            return;
        }
        await win.setTheme(effective);
        // macOS "Overlay" title bar paints the WINDOW background color in the
        // title bar strip; keep it in sync with the theme.
        await win.setBackgroundColor(effective === "light" ? "#FAFAFA" : "#0A0A0B");
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

    if (theme === "dark") {
        root.classList.remove("light");
        void syncWindowTheme("dark");
        return () => {};
    }
    if (theme === "light") {
        root.classList.add("light");
        void syncWindowTheme("light");
        return () => {};
    }

    // "system" — follow the OS preference and keep it in sync.
    // Guard for environments without matchMedia (e.g. jsdom).
    if (typeof window.matchMedia !== "function") {
        root.classList.remove("light");
        void syncWindowTheme(null);
        return () => {};
    }
    const mq = window.matchMedia(LIGHT_COLOR_SCHEME_QUERY);
    const applySystem = () => {
        root.classList.toggle("light", mq.matches);
        void syncWindowTheme(null);
    };
    applySystem();
    // Reset the native window to follow the OS first, then re-read matchMedia
    // once it actually mirrors the OS — the immediate applySystem above may be
    // stale if the window was previously forced to the other theme.
    void syncWindowTheme(null).then(applySystem);
    mq.addEventListener("change", applySystem);
    return () => mq.removeEventListener("change", applySystem);
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

/**
 * Applies the accent color as a CSS custom property on the root. Invalid or
 * non-hex values fall back to the theme default (via removal).
 */
export function applyAccentColor(accent: string): void {
    const root = document.documentElement;
    if (/^#[0-9a-fA-F]{6}$/.test(accent)) {
        root.style.setProperty("--color-accent", accent);
    } else {
        root.style.removeProperty("--color-accent");
    }
}

/** Keeps the document appearance in sync with the theme/font-size settings. */
export function useAppearance(theme: Theme, fontSize: FontSize, accentColor: string): void {
    useEffect(() => {
        const cleanupTheme = applyTheme(theme);
        applyFontSize(fontSize);
        applyAccentColor(accentColor);
        return cleanupTheme;
    }, [theme, fontSize, accentColor]);
}