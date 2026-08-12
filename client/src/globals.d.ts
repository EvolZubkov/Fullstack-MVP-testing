/// <reference types="vite/client" />

// Build-time constants injected by Vite's `define` (see vite.config.ts). The app
// version (semver) and the short git SHA of the build, surfaced in the author
// sidebar footer so a deployed instance advertises exactly what it is running.
declare const __APP_VERSION__: string;
declare const __GIT_SHA__: string;
