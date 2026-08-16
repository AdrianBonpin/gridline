// Bun test runner DOM setup: `bun test` uses Bun's native runner, which does
// not read vite.config.ts and provides no DOM. Register jsdom globals (plus the
// ResizeObserver polyfill used by @xyflow/react) so the vitest-authored suite
// runs under `bun test` too. This MUST load before any module that imports
// @testing-library/react, because bun caches modules process-wide and
// testing-library's `screen` binds `document.body` at module-evaluation time.
import { JSDOM } from "jsdom";

if (typeof globalThis.document === "undefined") {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
    url: "http://localhost/",
    pretendToBeVisual: true,
  });

  const { window } = dom;
  for (const key of Object.getOwnPropertyNames(window)) {
    if (
      key !== "window" &&
      key !== "self" &&
      key !== "top" &&
      !(key in globalThis)
    ) {
      (globalThis as Record<string, unknown>)[key] = (
        window as unknown as Record<string, unknown>
      )[key];
    }
  }
  globalThis.window = window as unknown as Window & typeof globalThis;
  globalThis.document = window.document;
  globalThis.navigator = window.navigator;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Element = window.Element;
  globalThis.Node = window.Node;
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) =>
    setTimeout(() => cb(Date.now()), 0) as unknown as number;
  globalThis.cancelAnimationFrame = (id: number) => clearTimeout(id);
  globalThis.matchMedia =
    globalThis.matchMedia ||
    ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }));
}

// Polyfill ResizeObserver for jsdom (required by @xyflow/react)
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// jsdom does not implement the execCommand family; monaco-editor probes
// document.queryCommandSupported at import time and crashes without it.
if (typeof globalThis.document.queryCommandSupported !== "function") {
  globalThis.document.queryCommandSupported = () => false;
  globalThis.document.queryCommandEnabled = () => false;
  globalThis.document.execCommand = () => false;
}