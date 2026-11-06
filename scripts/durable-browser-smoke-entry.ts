import * as durable from "@hyzek/toucan-durable";
import * as environment from "@hyzek/toucan-durable/env";
import * as jsonl from "@hyzek/toucan-durable/storage/jsonl";
import * as sqlite from "@hyzek/toucan-durable/storage/sqlite";

// Keep runtime-neutral public entry points live so the browser smoke build
// catches accidental imports of Node-only adapters or built-ins.
console.log(Object.keys(durable), Object.keys(environment), Object.keys(jsonl), Object.keys(sqlite));
