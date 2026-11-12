/**
 * Design sketch: one activity language for working, thinking, auto-compaction,
 * manual compaction, and branch summarization, plus the interrupt hint row.
 *
 * From the repo root: npm run build
 * From packages/coding-agent: node test/ui-demos/01-activity-and-hints.ts
 *
 * Keys: 1-6 switch activity state, a toggles the agents hint, t theme, q quit.
 */

import type { TUI } from "@hyzek/toucan-tui";
import type { AgentSession } from "../../src/core/agent-session.ts";
import type { ReadonlyFooterDataProvider } from "../../src/core/footer-data-provider.ts";
import { KeybindingsManager } from "../../src/core/keybindings.ts";
import { CustomEditor, inputBandOptions } from "../../src/modes/interactive/components/custom-editor.ts";
import { FooterComponent } from "../../src/modes/interactive/components/footer.ts";
import { footerHint, HotkeyHints } from "../../src/modes/interactive/components/hotkey-hints.ts";
import { keyText } from "../../src/modes/interactive/components/keybinding-hints.ts";
import {
	BranchSummaryStatusIndicator,
	CompactionStatusIndicator,
	type StatusIndicator,
	WorkingStatusIndicator,
} from "../../src/modes/interactive/components/status-indicator.ts";
import { getEditorTheme, theme } from "../../src/modes/interactive/theme/theme.ts";
import { type Demo, runDemo } from "./demo-kit.ts";

type ActivityState = "idle" | "working" | "thinking" | "autoCompaction" | "manualCompaction" | "branchSummary";

const ACTIVITY_KEYS: Record<string, ActivityState> = {
	1: "idle",
	2: "working",
	3: "thinking",
	4: "autoCompaction",
	5: "manualCompaction",
	6: "branchSummary",
};

const WORKING_LINES: Record<"working" | "thinking", { label: string; status: string }> = {
	working: { label: "Working", status: "1.024 tokens · 3s" },
	thinking: { label: "Thinking", status: "1.024 tokens · 3s" },
};

function createSession(): AgentSession {
	const session = {
		state: {
			model: {
				id: "gpt-6.1-sol",
				provider: "openai",
				contextWindow: 200_000,
				reasoning: true,
			},
			thinkingLevel: "high",
		},
		sessionManager: {
			getSessionName: () => "design sketch",
			getCwd: () => process.cwd(),
		},
		routedModel: undefined,
	};
	return session as unknown as AgentSession;
}

function createFooterData(): ReadonlyFooterDataProvider {
	return {
		getGitBranch: () => "main",
		getExtensionStatuses: () => new Map<string, string>(),
		getAvailableProviderCount: () => 1,
		onBranchChange: () => () => {},
	};
}

class ActivityDemo implements Demo {
	readonly title = "Activity + hotkey hints";
	readonly help =
		"1 idle · 2 working · 3 thinking · 4 auto-compact · 5 manual compact · 6 branch · a agents · i input text";

	private readonly tui: TUI;
	private readonly editor: CustomEditor;
	private readonly footer: FooterComponent;
	private readonly hints: HotkeyHints;
	private activeIndicator: StatusIndicator | undefined;
	private state: ActivityState = "idle";
	private agentsEnabled = true;
	private inputHasText = false;

	constructor(tui: TUI) {
		this.tui = tui;
		this.editor = new CustomEditor(tui, getEditorTheme(), KeybindingsManager.create(), {
			...inputBandOptions(),
			embedWorkingStatus: true,
		});
		this.footer = new FooterComponent(createSession(), createFooterData());
		this.hints = new HotkeyHints(() => this.inputHasText);
		this.hints.add("shortcuts", () => footerHint(keyText("app.shortcuts.open"), "for shortcuts"), 2);
		this.updateAgentHint();
	}

	handleInput(data: string): boolean {
		const next = ACTIVITY_KEYS[data];
		if (next) {
			this.setState(next);
			return true;
		}
		if (data === "a") {
			this.agentsEnabled = !this.agentsEnabled;
			this.updateAgentHint();
			return true;
		}
		if (data === "i") {
			this.inputHasText = !this.inputHasText;
			return true;
		}
		return false;
	}

	render(width: number): string[] {
		const lines: string[] = [];
		lines.push(theme.fg("dim", "  transcript"));
		lines.push(theme.fg("muted", "  user:  find the auth callback and run the focused tests"));
		lines.push(theme.fg("muted", "  tool:  read src/server/auth.ts"));
		lines.push("");

		lines.push(theme.fg("dim", "  shipped activity"));
		lines.push(...this.editor.render(width));
		lines.push(...this.footer.render(width));
		lines.push(...this.hints.render(width));
		lines.push("");
		lines.push(
			theme.fg(
				"dim",
				`  ${this.state}  ·  agent hints ${this.agentsEnabled ? "on" : "off"}  ·  input ${this.inputHasText ? "has text" : "empty"}`,
			),
		);
		return lines;
	}

	dispose(): void {
		this.activeIndicator?.dispose();
	}

	private setState(state: ActivityState): void {
		this.state = state;
		this.activeIndicator?.dispose();
		this.activeIndicator = undefined;

		if (state === "idle") {
			this.editor.setWorkingStatusIndicator(undefined);
			this.updateInterruptHint(false);
			return;
		}

		let indicator: StatusIndicator;
		if (state === "autoCompaction") {
			indicator = new CompactionStatusIndicator(this.tui, "threshold");
		} else if (state === "manualCompaction") {
			indicator = new CompactionStatusIndicator(this.tui, "manual");
		} else if (state === "branchSummary") {
			indicator = new BranchSummaryStatusIndicator(this.tui);
		} else {
			const line = WORKING_LINES[state];
			const working = new WorkingStatusIndicator(this.tui, line.label);
			working.setLine(line);
			indicator = working;
		}
		this.activeIndicator = indicator;
		this.editor.setWorkingStatusIndicator(indicator);
		this.updateInterruptHint(true);
	}

	private updateInterruptHint(visible: boolean): void {
		if (visible) {
			this.hints.add("interrupt", () => footerHint(keyText("app.interrupt", { compact: true }), "to interrupt"), 0);
		} else {
			this.hints.remove("interrupt");
		}
	}

	private updateAgentHint(): void {
		if (this.agentsEnabled) {
			this.hints.add("agents", () => footerHint("\u2190", "for agents"), 1);
		} else {
			this.hints.remove("agents");
		}
	}
}

runDemo((tui) => new ActivityDemo(tui));
