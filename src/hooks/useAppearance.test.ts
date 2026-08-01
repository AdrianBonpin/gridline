import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { applyTheme, applyFontSize } from "./useAppearance";

describe("useAppearance helpers", () => {
    const getRoot = () => document.documentElement;

    const stubMatchMedia = (
        matches: boolean,
        addEventListener: ReturnType<typeof vi.fn>,
        removeEventListener: ReturnType<typeof vi.fn>,
    ) => {
        Object.defineProperty(window, "matchMedia", {
            configurable: true,
            writable: true,
            value: vi.fn().mockReturnValue({
                matches,
                addEventListener,
                removeEventListener,
            }),
        });
    };

    beforeEach(() => {
        getRoot().classList.remove("light");
        delete getRoot().dataset.fontSize;
    });

    afterEach(() => {
        getRoot().classList.remove("light");
        delete getRoot().dataset.fontSize;
        delete (window as unknown as { matchMedia?: unknown }).matchMedia;
    });

    it('applyTheme("dark") removes the light class', () => {
        getRoot().classList.add("light");
        applyTheme("dark");
        expect(getRoot().classList.contains("light")).toBe(false);
    });

    it('applyTheme("light") adds the light class', () => {
        applyTheme("light");
        expect(getRoot().classList.contains("light")).toBe(true);
    });

    it('applyTheme("system") keeps dark when the OS does not prefer light', () => {
        const addEventListener = vi.fn();
        const removeEventListener = vi.fn();
        stubMatchMedia(false, addEventListener, removeEventListener);
        const cleanup = applyTheme("system");
        expect(getRoot().classList.contains("light")).toBe(false);
        expect(addEventListener).toHaveBeenCalled();
        cleanup();
        expect(removeEventListener).toHaveBeenCalled();
    });

    it('applyTheme("system") adds the light class when the OS prefers light', () => {
        stubMatchMedia(true, vi.fn(), vi.fn());
        applyTheme("system");
        expect(getRoot().classList.contains("light")).toBe(true);
    });

    it('applyFontSize("small") sets the data attribute', () => {
        applyFontSize("small");
        expect(getRoot().dataset.fontSize).toBe("small");
    });

    it('applyFontSize("large") sets the data attribute', () => {
        applyFontSize("large");
        expect(getRoot().dataset.fontSize).toBe("large");
    });

    it('applyFontSize("medium") removes the data attribute', () => {
        getRoot().dataset.fontSize = "large";
        applyFontSize("medium");
        expect(getRoot().dataset.fontSize).toBeUndefined();
    });
});