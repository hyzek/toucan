/**
 * Titlebar Spinner Extension
 *
 * Shows a braille spinner animation in the terminal title while the agent is working.
 * Uses `ctx.ui.setTitle()` to update the terminal title via the extension API.
 *
 * Usage:
 *   toucan --extension examples/extensions/titlebar-spinner.ts
 */

import path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@hyzek/toucan-coding-agent";

const BRAILLE_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function getBaseTitle(toucan: ExtensionAPI): string {
	const cwd = path.basename(process.cwd());
	const session = toucan.getSessionName();
	return session ? `TC - ${session} - ${cwd}` : `TC - ${cwd}`;
}

export default function (toucan: ExtensionAPI) {
	let timer: ReturnType<typeof setInterval> | null = null;
	let frameIndex = 0;

	function stopAnimation(ctx: ExtensionContext) {
		if (timer) {
			clearInterval(timer);
			timer = null;
		}
		frameIndex = 0;
		ctx.ui.setTitle(getBaseTitle(toucan));
	}

	function startAnimation(ctx: ExtensionContext) {
		stopAnimation(ctx);
		timer = setInterval(() => {
			const frame = BRAILLE_FRAMES[frameIndex % BRAILLE_FRAMES.length];
			const cwd = path.basename(process.cwd());
			const session = toucan.getSessionName();
			const title = session ? `${frame} TC - ${session} - ${cwd}` : `${frame} TC - ${cwd}`;
			ctx.ui.setTitle(title);
			frameIndex++;
		}, 80);
	}

	toucan.on("agent_start", async (_event, ctx) => {
		startAnimation(ctx);
	});

	toucan.on("agent_settled", async (_event, ctx) => {
		stopAnimation(ctx);
	});

	toucan.on("session_shutdown", async (_event, ctx) => {
		stopAnimation(ctx);
	});
}
