/**
 * Model selection for subagents: resolving a markdown `model:` pin (exact
 * `provider/modelId` or a fuzzy name like "haiku") against the model runtime.
 */

import type { Api, Model } from "@hyzek/toucan-ai";
import type { ModelRuntime } from "../model-runtime.ts";

/**
 * Resolve a `model:` pin to a model the runtime can stream. Precedence: exact
 * `provider/modelId`, then exact id under the named provider, then a
 * case-insensitive substring of `provider/modelId` across all providers.
 * Undefined when nothing matches.
 */
export function resolveModelPin(pin: string, modelRuntime: ModelRuntime): Model<Api> | undefined {
	const wanted = pin.trim();
	if (!wanted) return undefined;

	if (wanted.includes("/")) {
		const [providerId, ...rest] = wanted.split("/");
		const modelId = rest.join("/");
		const exact = modelRuntime.getModel(providerId, modelId);
		if (exact) return exact;
		const underProvider = modelRuntime
			.getModels(providerId)
			.find((model) => model.id.toLowerCase() === wanted.slice(providerId.length + 1).toLowerCase());
		if (underProvider) return underProvider;
	}

	const lower = wanted.toLowerCase();
	const candidates = modelRuntime
		.getModels()
		.filter((model) => `${model.provider}/${model.id}`.toLowerCase().includes(lower));
	const exactId = candidates.find((model) => model.id.toLowerCase() === lower);
	return exactId ?? candidates[0];
}
