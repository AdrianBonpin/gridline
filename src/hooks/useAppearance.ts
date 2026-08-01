import { useEffect } from "react";
import type { Theme, FontSize } from "../lib/types";

const LIGHT_COLOR_SCHEME_QUERY = "(prefers-color-scheme: light)";

/**
 * Applies the theme to the document root and returns a cleanup that
 * stops tracking the system preference while the theme is "system".
 */
export function applyTheme(theme: Theme): () => void {
    const root = document.documentElement;

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
    const apply = () => root.classList.toggle("light", mq.matches);
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