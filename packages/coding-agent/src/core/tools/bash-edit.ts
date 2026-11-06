/**
 * Shell commands whose only effect is changing one file.
 *
 * A model that runs `sed -i s/a/b/ src/app.ts` means the same thing as an edit call, and the transcript
 * should say which file changed and how instead of showing a command and its empty output. This decides,
 * from the command text alone, whether the command has that shape: one command, one known target file,
 * and no part of it that could do something else. Anything unclear - a pipe, a variable, a glob, a
 * second file - stays a plain shell row, because a wrong diff next to an `edit` label is worse than no
 * diff.
 */

/** The shell tools that can rewrite one file. */
export type ShellEditTool = "sed" | "perl" | "echo" | "printf" | "cat" | "tee";

/** A shell command that edits one file, and which file. */
export interface ShellFileEdit {
	tool: ShellEditTool;
	/** The operand as written; the caller resolves it against the shell's working directory. */
	path: string;
}

/** Characters a path operand must not carry: substitution, globbing, or an unquoted expansion. */
const UNSAFE_PATH = /[$`*?{}()|<>&;'"]/;

/**
 * Names the file a shell command edits, or `undefined` when the command is not a single known edit.
 */
export function detectShellFileEdit(command: string): ShellFileEdit | undefined {
	// Command substitution can change anything, so a command that contains it is never just an edit.
	if (command.includes("$(") || command.includes("`")) {
		return undefined;
	}
	const withoutHeredocs = stripHeredocBodies(command);
	if (withoutHeredocs === undefined) {
		return undefined;
	}
	const tokens = tokenize(withoutHeredocs);
	if (tokens === undefined || tokens.length === 0) {
		return undefined;
	}
	if (
		tokens.some(
			(token) =>
				!token.quoted && (token.text === "|" || token.text === "||" || token.text === "&&" || token.text === ";"),
		)
	) {
		return undefined;
	}
	const [head, ...rest] = tokens;
	if (head.quoted) {
		return undefined;
	}
	if (head.text === "sed" || head.text === "perl") {
		return inPlaceEdit(head.text, rest);
	}
	if (head.text === "echo" || head.text === "printf" || head.text === "cat") {
		return redirectWrite(head.text, rest);
	}
	if (head.text === "tee") {
		return teeWrite(rest, withoutHeredocs !== command);
	}
	return undefined;
}

/** `sed -i s/a/b/ file` and `perl -pi -e s/a/b/ file`: one script, exactly one file operand. */
function inPlaceEdit(tool: "sed" | "perl", args: readonly Token[]): ShellFileEdit | undefined {
	let inPlace = false;
	let scriptFlag = false;
	const operands: string[] = [];
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (!arg.quoted && arg.text.startsWith("-")) {
			// Only a bare `-i`: `sed -i.bak` leaves a backup file, so that command is not only an edit.
			if (arg.text === "-e" || arg.text === "--expression") {
				scriptFlag = true;
				i++;
			} else if (
				arg.text === "-i" ||
				arg.text === "--in-place" ||
				(/^-[a-zA-Z]+$/.test(arg.text) && arg.text.includes("i"))
			) {
				inPlace = true;
			} else if (arg.text.startsWith("--in-place=")) {
				return undefined;
			}
			continue;
		}
		if (isUnsafeOperand(arg)) {
			return undefined;
		}
		operands.push(arg.text);
	}
	if (!inPlace || operands.length === 0) {
		return undefined;
	}
	// `perl -pi script.pl` runs a program in place mode, which is not an edit of script.pl.
	if (tool === "perl" && !scriptFlag) {
		return undefined;
	}
	// Without `-e` the first operand is the script; with it, every operand is a file.
	const files = scriptFlag ? operands : operands.slice(1);
	if (files.length !== 1) {
		return undefined;
	}
	return { tool, path: files[0] };
}

/** `echo text > file`, `printf ... > file`, `cat > file <<EOF`: one output redirect, one target. */
function redirectWrite(tool: "echo" | "printf" | "cat", args: readonly Token[]): ShellFileEdit | undefined {
	let target: string | undefined;
	const setTarget = (path: string | undefined): boolean => {
		if (target !== undefined || path === undefined) {
			return false;
		}
		target = path;
		return true;
	};
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg.quoted) {
			continue;
		}
		if (arg.text === ">" || arg.text === ">>") {
			const file = args[i + 1];
			if (!setTarget(file && !file.quoted && !isUnsafeOperand(file) ? file.text : undefined)) {
				return undefined;
			}
			i++;
			continue;
		}
		if (arg.text.startsWith(">>") || arg.text.startsWith(">")) {
			const attached = arg.text.replace(/^>>?/, "");
			if (!setTarget(attached && !isUnsafeOperand({ text: attached, quoted: false }) ? attached : undefined)) {
				return undefined;
			}
			continue;
		}
		if (arg.text.startsWith("<") || arg.text.startsWith("&") || arg.text.startsWith("|")) {
			return undefined;
		}
	}
	if (target === undefined) {
		return undefined;
	}
	return { tool, path: target };
}

/**
 * `tee file`, with input from a heredoc. A command piped into `tee` stays a plain shell row, and
 * `tee file` with no input at all would wait on the shell's stdin, so neither counts as an edit.
 */
function teeWrite(args: readonly Token[], hasHeredoc: boolean): ShellFileEdit | undefined {
	if (!hasHeredoc) {
		return undefined;
	}
	const operands: string[] = [];
	for (const arg of args) {
		if (!arg.quoted && arg.text.startsWith("-")) {
			if (arg.text !== "-a") {
				return undefined;
			}
			continue;
		}
		if (isUnsafeOperand(arg)) {
			return undefined;
		}
		operands.push(arg.text);
	}
	if (operands.length !== 1) {
		return undefined;
	}
	return { tool: "tee", path: operands[0] };
}

function isUnsafeOperand(token: Token): boolean {
	return !token.quoted && (UNSAFE_PATH.test(token.text) || token.text.length === 0);
}

interface Token {
	text: string;
	quoted: boolean;
}

/**
 * Splits a command line into words, keeping quoted runs together. An unterminated quote is not a
 * single edit worth trusting, so it returns `undefined`.
 */
function tokenize(command: string): Token[] | undefined {
	const tokens: Token[] = [];
	let current = "";
	let quote: string | undefined;
	let quoted = false;

	const push = () => {
		if (current) {
			tokens.push({ text: current, quoted });
			current = "";
			quoted = false;
		}
	};

	for (let i = 0; i < command.length; i++) {
		const char = command[i];
		if (quote) {
			if (char === quote) {
				quote = undefined;
			} else {
				current += char;
			}
			continue;
		}
		if (char === "'" || char === '"') {
			quote = char;
			quoted = true;
			continue;
		}
		if (char === "\\") {
			current += command[i + 1] ?? "";
			i++;
			continue;
		}
		if (/\s/.test(char)) {
			push();
			continue;
		}
		if (char === "|" || char === ";" || char === "&") {
			push();
			const operator = command.slice(i, i + 2);
			if (operator === "||" || operator === "&&") {
				tokens.push({ text: operator, quoted: false });
				i++;
			} else {
				tokens.push({ text: char, quoted: false });
			}
			continue;
		}
		current += char;
	}
	if (quote) {
		return undefined;
	}
	push();
	return tokens;
}

/**
 * Replaces each heredoc with its redirection, keeping the markers the parser still needs. The body is
 * text the command carries, so its contents never take part in deciding what the command edits.
 */
function stripHeredocBodies(command: string): string | undefined {
	if (!command.includes("<<")) {
		return command;
	}
	const lines = command.split("\n");
	const kept: string[] = [];
	for (let i = 0; i < lines.length; i++) {
		const marker = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1\s*$/.exec(lines[i]);
		if (!marker) {
			kept.push(lines[i]);
			continue;
		}
		const tag = marker[2];
		let end = -1;
		for (let j = i + 1; j < lines.length; j++) {
			if (lines[j].trim() === tag) {
				end = j;
				break;
			}
		}
		if (end === -1) {
			return undefined;
		}
		kept.push(lines[i].slice(0, marker.index));
		i = end;
	}
	return kept.join(" ");
}
