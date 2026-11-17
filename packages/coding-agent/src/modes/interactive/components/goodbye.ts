/**
 * The farewell frame: block-shaded toucan art over a bye line, appended to the
 * document when an interactive session exits, so the scrollback ends on the art
 * instead of the idle input area.
 */

import { type Component, truncateToWidth } from "@hyzek/toucan-tui";
import { theme } from "../theme/theme.ts";

const ART = [
	"░░░░░░░░▄▄▄▀▀▀▄▄███▄░░░░░░░░░░░░░░",
	"░░░░░▄▀▀░░░░░░░▐░▀██▌░░░░░░░░░░░░░",
	"░░░▄▀░░░░▄▄███░▌▀▀░▀█░░░░░░░░░░░░░",
	"░░▄█░░▄▀▀▒▒▒▒▒▄▐░░░░█▌░░░░░░░░░░░░",
	"░▐█▀▄▀▄▄▄▄▀▀▀▀▌░░░░░▐█▄░░░░░░░░░░░",
	"░▌▄▄▀▀░░░░░░░░▌░░░░▄███████▄░░░░░░",
	"░░░░░░░░░░░░░▐░░░░▐███████████▄░░░",
	"░░░░░░░░░░░░░▐░░░░▐█████████████▄",
	"░░░░░░░░░░░░░░░▀▄░░░▐█████████████▄",
	"░░░░░░░░░░░░░░░░░▀▄▄███████████████",
	"░░░░░░░░░░░░░░░░░░░░░░█▀██████░",
];

export class GoodbyeComponent implements Component {
	invalidate(): void {}

	render(width: number): string[] {
		const lines = ART.map((row) => theme.fg("dim", truncateToWidth(row, Math.max(1, width), "")));
		lines.push("", theme.bold(theme.fg("accent", "Bye!")));
		return lines;
	}
}
