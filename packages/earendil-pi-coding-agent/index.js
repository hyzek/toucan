// Compile-time re-export of the Toucan package under the Pi 1.0 peer name, used when bundlers
// (bun --compile, esbuild) walk the pi-web-access dependency graph. Runtime node runs reach the
// same modules through the jiti aliases in core/extensions/loader.ts instead.
export * from "@hyzek/toucan-coding-agent";
