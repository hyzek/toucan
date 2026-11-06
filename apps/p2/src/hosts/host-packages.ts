// The host packages of p2's facets: the modules a facet shares with its host as instances, by specifier. Apart from
// plugins.ts (the server's plugin component, which builds with esbuild) so the worker entry imports only these: a
// worker loads neither esbuild nor the server's API.
import * as toucanAi from "@hyzek/toucan-ai";
import * as anthropicMessages from "@hyzek/toucan-ai/api/anthropic-messages.lazy";
import * as googleGenerativeAi from "@hyzek/toucan-ai/api/google-generative-ai.lazy";
import * as openaiCompletions from "@hyzek/toucan-ai/api/openai-completions.lazy";
import * as openaiResponses from "@hyzek/toucan-ai/api/openai-responses.lazy";
import * as toucanAiModels from "@hyzek/toucan-ai/models";
import * as allProviders from "@hyzek/toucan-ai/providers/all";
import * as fauxProvider from "@hyzek/toucan-ai/providers/faux";
import * as radiusProvider from "@hyzek/toucan-ai/providers/radius";
import * as radiusConfig from "@hyzek/toucan-ai/providers/radius-config";
import * as toucanCodemode from "@hyzek/toucan-codemode";
import * as toucanDurable from "@hyzek/toucan-durable";
import * as durableCodemode from "@hyzek/toucan-durable/codemode";
import * as durableEnv from "@hyzek/toucan-durable/env";
import * as durableEnvNode from "@hyzek/toucan-durable/env/node";
import * as durableToolSearch from "@hyzek/toucan-durable/tool-search";
import * as durableTools from "@hyzek/toucan-durable/tools";
import * as toucanEnv from "@hyzek/toucan-env";
import * as toucanMcp from "@hyzek/toucan-mcp";
import * as toucanMcpOauth from "@hyzek/toucan-mcp/oauth";
import * as toucanSchema from "@hyzek/toucan-schema";
import * as schemaFormats from "@hyzek/toucan-schema/formats";
import * as toucanTui from "@hyzek/toucan-tui";
import * as ws from "ws";
import * as yaml from "yaml";
import * as api from "../api/v1/index.ts";
import * as apiNode from "../api/v1/node.ts";
import * as apiWorker from "../api/v1/worker.ts";

/** The packages a facet shares with its host as instances (never bundled into a plugin's script), by specifier. */
export const SHARED_PACKAGES = {
	"@hyzek/toucan-ai": toucanAi,
	"@hyzek/toucan-ai/api/anthropic-messages.lazy": anthropicMessages,
	"@hyzek/toucan-ai/api/google-generative-ai.lazy": googleGenerativeAi,
	"@hyzek/toucan-ai/api/openai-completions.lazy": openaiCompletions,
	"@hyzek/toucan-ai/api/openai-responses.lazy": openaiResponses,
	"@hyzek/toucan-ai/models": toucanAiModels,
	"@hyzek/toucan-ai/providers/all": allProviders,
	"@hyzek/toucan-ai/providers/faux": fauxProvider,
	"@hyzek/toucan-ai/providers/radius": radiusProvider,
	"@hyzek/toucan-ai/providers/radius-config": radiusConfig,
	"@hyzek/toucan-codemode": toucanCodemode,
	"@hyzek/toucan-durable": toucanDurable,
	"@hyzek/toucan-durable/codemode": durableCodemode,
	"@hyzek/toucan-durable/env": durableEnv,
	"@hyzek/toucan-durable/env/node": durableEnvNode,
	"@hyzek/toucan-durable/tool-search": durableToolSearch,
	"@hyzek/toucan-durable/tools": durableTools,
	"@hyzek/toucan-env": toucanEnv,
	"@hyzek/toucan-mcp": toucanMcp,
	"@hyzek/toucan-mcp/oauth": toucanMcpOauth,
	"@hyzek/toucan-schema": toucanSchema,
	"@hyzek/toucan-schema/formats": schemaFormats,
	ws,
	yaml,
};

/** The host packages of worker facets (toucan-tui too: file completion ranks as toucan-tui's autocomplete does). */
export const WORKER_PACKAGES = {
	"@p2/app/v1": api,
	"@p2/app/v1/node": apiNode,
	"@p2/app/v1/worker": apiWorker,
	"@hyzek/toucan-tui": toucanTui,
	...SHARED_PACKAGES,
};
