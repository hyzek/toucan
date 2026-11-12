/**
 * The one-line form of a shell command, ported from pi-claude-code-ui's bash-command.ts.
 *
 * A command can be a long script; the row shows what it does, not its source. The headline skips
 * setup lines (`cd`, `set`, assignments) and keeps a middle-truncated summary of the first operative
 * line, with `· N lines` added when the command spans several source lines. Expanding the row shows
 * the source itself.
 */

const CONTROL_CHAR_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;
const ANSI_ESCAPE_RE = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/g;
const HEADLINE_SKIP_RE =
	/^(?:#|set(?:\s|$)|cd(?:\s|$)|(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=|(?:\{|\}|do|done|then|fi|esac)$)/;

export interface BashCommandPresentation {
	headline: string;
	sourceLines: string[];
	sourceLineCount: number;
}

function normalizeHeadline(line: string): string {
	return line.replace(/\s+/g, " ").trim();
}

function summarize(text: string, max = 180): string {
	if (text.length <= max) return text;
	const head = Math.max(1, Math.ceil((max - 3) * 0.65));
	const tail = Math.max(1, max - 3 - head);
	return `${text.slice(0, head)}...${text.slice(-tail)}`;
}

function sanitizeSource(command: string): string[] {
	const lines = command
		.replace(/\r\n?/g, "\n")
		.replace(ANSI_ESCAPE_RE, "")
		.replace(CONTROL_CHAR_RE, "")
		.replace(/\t/g, "   ")
		.split("\n");
	while (lines.length > 1 && lines[0].trim() === "") lines.shift();
	while (lines.length > 1 && lines[lines.length - 1].trim() === "") lines.pop();
	return lines;
}

/** The collapsed shell row: an operative first line, shortened to one row, plus its source size. */
export function buildBashCommandPresentation(command: string): BashCommandPresentation {
	const sourceLines = sanitizeSource(command);
	const nonBlank = sourceLines.map(normalizeHeadline).filter(Boolean);
	const operative = nonBlank.find((line) => !HEADLINE_SKIP_RE.test(line)) ?? nonBlank[0] ?? "command";
	let headline = summarize(operative);
	if (sourceLines.length > 1) headline += ` \u00b7 ${sourceLines.length} lines`;
	return { headline, sourceLines, sourceLineCount: sourceLines.length };
}
