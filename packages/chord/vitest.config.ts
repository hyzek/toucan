import { defineConfig } from "vitest/config";

// Workspace packages (toucan-telemetry, toucan-schema) resolve to their sources, so Chord's tests need no build.
export default defineConfig({
	test: { environment: "node" },
	resolve: { conditions: ["source"] },
	ssr: { resolve: { conditions: ["source"] } },
});
