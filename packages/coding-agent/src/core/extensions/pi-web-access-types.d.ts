/**
 * Ambient types for the pi-web-access extension entry point. The package ships no declaration
 * file for `dist/index.js`; the factory takes Toucan's extension API and registers its tools.
 */
declare module "pi-web-access/dist/index.js" {
	const extension: import("../types.ts").ExtensionFactory;
	export default extension;
}
