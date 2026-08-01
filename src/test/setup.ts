import "@testing-library/jest-dom";

// Polyfill ResizeObserver for jsdom (required by @xyflow/react)
globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};