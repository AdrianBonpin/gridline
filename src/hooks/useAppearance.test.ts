import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { applyTheme, applyFontSize, applyAccentColor, resolveTheme } from "./useAppearance";

const windowMocks = vi.hoisted(() => ({
    setTheme: vi.fn().mockResolvedValue(undefined),
    setBackgroundColor: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/api/window", () => ({
    getCurrentWindow: () => ({
        setTheme: windowMocks.setTheme,
        setBackgroundColor: windowMocks.setBackgroundColor,
    }),
}));

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
        getRoot().style.removeProperty("--color-accent");
        windowMocks.setTheme.mockClear();
        windowMocks.setBackgroundColor.mockClear();
    });

    afterEach(() => {
        getRoot().classList.remove("light");
        delete getRoot().dataset.fontSize;
        getRoot().style.removeProperty("--color-accent");
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

    describe("resolveTheme", () => {
        it('resolveTheme("light") is "light"', () => {
            expect(resolveTheme("light")).toBe("light");
        });

        it('resolveTheme("dark") is "dark"', () => {
            expect(resolveTheme("dark")).toBe("dark");
        });

        it('resolveTheme("system") is "dark" when the OS does not prefer light', () => {
            stubMatchMedia(false, vi.fn(), vi.fn());
            expect(resolveTheme("system")).toBe("dark");
        });

        it('resolveTheme("system") is "light" when the OS prefers light', () => {
            stubMatchMedia(true, vi.fn(), vi.fn());
            expect(resolveTheme("system")).toBe("light");
        });

        it('resolveTheme("system") falls back to "dark" without matchMedia', () => {
            delete (window as unknown as { matchMedia?: unknown }).matchMedia;
            expect(resolveTheme("system")).toBe("dark");
        });
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

    it('applyAccentColor sets the custom property for a valid hex', () => {
        applyAccentColor("#22C55E");
        expect(
            getRoot().style.getPropertyValue("--color-accent").toLowerCase()
        ).toBe("#22c55e");
    });

    it('applyAccentColor accepts lowercase hex', () => {
        applyAccentColor("#2563eb");
        expect(
            getRoot().style.getPropertyValue("--color-accent").toLowerCase()
        ).toBe("#2563eb");
    });

    it('applyAccentColor removes the custom property for an invalid value', () => {
        getRoot().style.setProperty("--color-accent", "#22C55E");
        applyAccentColor("blue");
        expect(getRoot().style.getPropertyValue("--color-accent")).toBe("");
    });

    it('applyAccentColor rejects malformed hex', () => {
        applyAccentColor("#22C5");
        expect(getRoot().style.getPropertyValue("--color-accent")).toBe("");
    });

    it("syncs the native window (theme + background) for light", async () => {
        applyTheme("light");
        // Allow the fire-and-forget dynamic import + invoke to settle.
        await new Promise((r) => setTimeout(r, 0));
        expect(windowMocks.setTheme).toHaveBeenCalledWith("light");
        expect(windowMocks.setBackgroundColor).toHaveBeenCalledWith("#FAFAFA");
    });

    it("syncs the native window (theme + background) for dark", async () => {
        applyTheme("dark");
        await new Promise((r) => setTimeout(r, 0));
        expect(windowMocks.setTheme).toHaveBeenCalledWith("dark");
        expect(windowMocks.setBackgroundColor).toHaveBeenCalledWith("#0A0A0B");
    });

    it("resets the window to follow the OS when switching to system", async () => {
        stubMatchMedia(false, vi.fn(), vi.fn());
        applyTheme("system");
        await new Promise((r) => setTimeout(r, 0));
        expect(windowMocks.setTheme).toHaveBeenCalledWith(null);
    });
});