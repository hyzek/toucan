import { visibleWidth } from "@hyzek/toucan-tui";
import { beforeAll, describe, expect, it } from "vitest";
import type { AgentSession } from "../src/core/agent-session.ts";
import type { ReadonlyFooterDataProvider } from "../src/core/footer-data-provider.ts";
import { FooterComponent, formatCwdForFooter } from "../src/modes/interactive/components/footer.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

function createSession(options: {
	sessionName: string;
	modelId?: string;
	reasoning?: boolean;
	thinkingLevel?: string;
	routedModel?: { model: { id: string }; thinkingLevel?: string };
	cwd?: string;
}): AgentSession {
	const session = {
		state: {
			model: {
				id: options.modelId ?? "test-model",
				provider: "test",
				contextWindow: 200_000,
				reasoning: options.reasoning ?? false,
			},
			thinkingLevel: options.thinkingLevel ?? "off",
		},
		sessionManager: {
			getSessionName: () => options.sessionName,
			getCwd: () => options.cwd ?? "/tmp/project",
		},
		routedModel: options.routedModel,
	};

	return session as unknown as AgentSession;
}

function createFooterData(): ReadonlyFooterDataProvider {
	const provider = {
		getGitBranch: () => "main",
		getExtensionStatuses: () => new Map<string, string>(),
		getAvailableProviderCount: () => 1,
		onBranchChange: (callback: () => void) => {
			void callback;
			return () => {};
		},
	};

	return provider;
}

function renderFooter(session: AgentSession, width: number): string {
	return stripAnsi(new FooterComponent(session, createFooterData()).render(width)[0]!);
}

describe("formatCwdForFooter", () => {
	it("does not abbreviate sibling paths that share the home prefix", () => {
		expect(formatCwdForFooter("/home/user2", "/home/user")).toBe("/home/user2");
	});

	it("abbreviates the home directory and descendants", () => {
		expect(formatCwdForFooter("/home/user", "/home/user")).toBe("~");
		expect(formatCwdForFooter("/home/user/project", "/home/user")).toBe("~/project");
	});
});

describe("FooterComponent width handling", () => {
	beforeAll(() => {
		initTheme(undefined, false);
	});

	it("keeps all lines within width for wide session names", () => {
		const width = 93;
		const session = createSession({ sessionName: "한글".repeat(30) });

		for (const line of new FooterComponent(session, createFooterData()).render(width)) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}
	});

	it("keeps the bar within width for wide model and provider names", () => {
		const width = 60;
		const session = createSession({
			sessionName: "",
			modelId: "模".repeat(30),
			reasoning: true,
			thinkingLevel: "high",
		});

		for (const line of new FooterComponent(session, createFooterData()).render(width)) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}
	});

	it("shows the physical model a virtual model routed to", () => {
		const session = createSession({
			sessionName: "",
			modelId: "auto",
			reasoning: true,
			thinkingLevel: "high",
			routedModel: { model: { id: "gpt-5.6-luna" }, thinkingLevel: "medium" },
		});

		expect(renderFooter(session, 120)).toContain("auto \u00b7 high \u2192 gpt-5.6-luna \u00b7 medium");
	});

	it("ends the bar with the working directory", () => {
		const session = createSession({ sessionName: "", reasoning: true, thinkingLevel: "high" });

		expect(renderFooter(session, 120)).toBe("  test-model \u00b7 high  \u00b7  /tmp/project");
	});

	it("shows no token, cost, or context stats in the bar", () => {
		const session = createSession({ sessionName: "layout test" });
		const bar = renderFooter(session, 120);

		expect(bar).not.toContain("$");
		expect(bar).not.toContain("%");
		expect(bar).not.toContain("(auto)");
	});
});
