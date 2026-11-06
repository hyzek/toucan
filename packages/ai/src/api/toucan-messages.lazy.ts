import type { ProviderStreams } from "../types.ts";
import { lazyApi } from "./lazy.ts";

export const toucanMessagesApi = (): ProviderStreams => lazyApi(() => import("./toucan-messages.ts"));
