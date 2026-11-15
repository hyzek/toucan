/**
 * The pi-web-access package as an embedded module. The static import makes bundlers include the
 * package (and its Pi 1.0 peer names, resolved by the private @earendil-works shim packages) in
 * the compiled binary and the bundled Node distribution; the loader registers it as a jiti
 * virtual module there. Plain Node runs load the installed files through the runtime aliases
 * instead and never import this module.
 */
import * as piWebAccess from "pi-web-access/dist/index.js";

/** The pi-web-access namespace, keyed by its package specifier in jiti's virtual module registry. */
export const PI_WEB_ACCESS_MODULE = piWebAccess;
