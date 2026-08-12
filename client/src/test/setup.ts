/**
 * @module test/setup
 * @description Vitest setup file for React Testing Library configuration.
 * Adds the jsdom polyfills (matchMedia / ResizeObserver / IntersectionObserver /
 * scrollIntoView) that some `@universityrt/ui-kit` components expect but jsdom
 * does not provide, so DS-based components can be rendered in unit tests. The
 * DOM polyfills are guarded by a `window` check so this file stays safe in the
 * node-environment test files that also load it.
 */

import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
}
if (!(globalThis as any).ResizeObserver) (globalThis as any).ResizeObserver = NoopObserver;
if (!(globalThis as any).IntersectionObserver) (globalThis as any).IntersectionObserver = NoopObserver;

if (typeof window !== "undefined") {
  if (!window.matchMedia) {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  }
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = vi.fn();
}
