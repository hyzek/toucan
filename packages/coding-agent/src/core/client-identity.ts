import { type ClientIdentity, TOUCAN_ATTRIBUTION } from "@hyzek/toucan-ai";
import { VERSION } from "../config.ts";
import type { SettingsManager } from "./settings-manager.ts";
import { isInstallTelemetryEnabled } from "./telemetry.ts";

/**
 * How toucan's requests identify it to providers: a detailed `User-Agent` with toucan's version, and attribution to toucan as a
 * CLI agent while install telemetry is enabled.
 */
export function getClientIdentity(settingsManager: SettingsManager): ClientIdentity {
	return {
		userAgent: "detailed",
		version: VERSION,
		attribution: isInstallTelemetryEnabled(settingsManager) ? TOUCAN_ATTRIBUTION : null,
	};
}
