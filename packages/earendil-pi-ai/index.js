// Compile-time re-export of the Toucan extension view under the Pi 1.0 peer name, matching the
// "@earendil-works/pi-ai" alias in core/extensions/loader.ts. Bundlers walk pi-web-access's
// dependency graph through this package; node runs use the runtime aliases instead. The relative
// path reaches the view directly because coding-agent does not export it as a subpath.
export * from "../coding-agent/dist/core/extensions/toucan-ai-extension-view.js";
