import * as bundledToucanAgentCore from "@hyzek/toucan-agent-core";
import * as bundledToucanAiModels from "@hyzek/toucan-ai/models";
import * as bundledToucanAiOauth from "@hyzek/toucan-ai/oauth";
import * as bundledToucanAiProviders from "@hyzek/toucan-ai/providers/all";
import * as bundledToucanTui from "@hyzek/toucan-tui";
import * as bundledTypebox from "typebox";
import * as bundledTypeboxCompile from "typebox/compile";
import * as bundledTypeboxValue from "typebox/value";
// This import is safe because loader.ts exports are not re-exported from index.ts.
// Extensions can therefore import from @hyzek/toucan-coding-agent.
import * as bundledToucanCodingAgent from "../../index.ts";
import * as bundledToucanAiExtensionView from "./toucan-ai-extension-view.ts";

/** Modules available to extensions in source and compiled binary runtimes. */
export const VIRTUAL_MODULES: Record<string, unknown> = {
	typebox: bundledTypebox,
	"typebox/compile": bundledTypeboxCompile,
	"typebox/value": bundledTypeboxValue,
	"@sinclair/typebox": bundledTypebox,
	"@sinclair/typebox/compile": bundledTypeboxCompile,
	"@sinclair/typebox/value": bundledTypeboxValue,
	"@hyzek/toucan-agent-core": bundledToucanAgentCore,
	"@hyzek/toucan-tui": bundledToucanTui,
	// Extensions resolve the toucan-ai root to the compat entrypoint (a strict
	// superset of the core entrypoint) plus TypeBox's Type, Static and TSchema:
	// existing extensions using the old global API and toucan-ai's former TypeBox
	// re-exports keep working.
	"@hyzek/toucan-ai": bundledToucanAiExtensionView,
	"@hyzek/toucan-ai/compat": bundledToucanAiExtensionView,
	"@hyzek/toucan-ai/models": bundledToucanAiModels,
	"@hyzek/toucan-ai/oauth": bundledToucanAiOauth,
	"@hyzek/toucan-ai/providers/all": bundledToucanAiProviders,
	"@hyzek/toucan-coding-agent": bundledToucanCodingAgent,
	"@mariozechner/toucan-agent-core": bundledToucanAgentCore,
	"@mariozechner/toucan-tui": bundledToucanTui,
	"@mariozechner/toucan-ai": bundledToucanAiExtensionView,
	"@mariozechner/toucan-ai/compat": bundledToucanAiExtensionView,
	"@mariozechner/toucan-ai/models": bundledToucanAiModels,
	"@mariozechner/toucan-ai/oauth": bundledToucanAiOauth,
	"@mariozechner/toucan-ai/providers/all": bundledToucanAiProviders,
	"@mariozechner/toucan-coding-agent": bundledToucanCodingAgent,
	// Pi 1.0 packages use these peer names. Map them to Toucan so the built-in
	// web-access extension can load pi-web-access without separate peer installs.
	"@earendil-works/pi-coding-agent": bundledToucanCodingAgent,
	"@earendil-works/pi-tui": bundledToucanTui,
	"@earendil-works/pi-ai": bundledToucanAiExtensionView,
	"@earendil-works/pi-ai/compat": bundledToucanAiExtensionView,
};
