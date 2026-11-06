export function areExperimentalFeaturesEnabled(): boolean {
	return process.env.TOUCAN_EXPERIMENTAL === "1";
}
