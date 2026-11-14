import { delimiter, join } from "node:path";
import { Markdown, type MarkdownTheme } from "@hyzek/toucan-tui";
import chalk from "chalk";
import { selectConfig } from "./cli/config-selector.ts";
import { createProjectTrustContext } from "./cli/project-trust.ts";
import {
	APP_NAME,
	buildName,
	CONFIG_DIR_NAME,
	detectInstallChange,
	detectInstallMethod,
	getAgentDir,
	getBuildName,
	getConfiguredSelfUpdateArgv,
	getPackageDir,
	getSelfUpdateCommand,
	getSelfUpdateUnavailableInstruction,
	makeConfiguredSelfUpdateCommand,
	numericVersion,
	PACKAGE_NAME,
	type SelfUpdateCommand,
	type SelfUpdatePackageTarget,
	VERSION,
} from "./config.ts";
import {
	detectChannelInstall,
	ensureLauncher,
	getChannelBuildDir,
	getChannelLauncherDir,
	installChannel,
	isChannelName,
	isChannelSource,
	listChannelBuilds,
	parseChannelSource,
	readActiveChannel,
	removeChannel,
	switchChannel,
	updateChannel,
} from "./core/channel-manager.ts";
import type { InlineExtension } from "./core/extensions/types.ts";
import { ModelRuntime } from "./core/model-runtime.ts";
import { DefaultPackageManager, isOfflineModeEnabled } from "./core/package-manager.ts";
import { type AppMode, resolveProjectTrusted } from "./core/project-trust.ts";
import { DefaultResourceLoader, formatPackageInstallWarning, isBuiltinExtension } from "./core/resource-loader.ts";
import { SettingsManager } from "./core/settings-manager.ts";
import { hasTrustRequiringProjectResources, ProjectTrustStore } from "./core/trust-manager.ts";
import { spawnProcess, spawnProcessSync } from "./utils/child-process.ts";
import { formatVersionCheckError, getLatestToucanRelease, isNewerPackageVersion } from "./utils/version-check.ts";
import {
	cleanupWindowsSelfUpdateQuarantine,
	quarantineWindowsNativeDependencies,
} from "./utils/windows-self-update.ts";

export type PackageCommand = "install" | "remove" | "update" | "list" | "channel" | "launcher";

type UpdateTarget = { type: "all" } | { type: "self" } | { type: "extensions"; source?: string } | { type: "models" };

const SELF_UPDATE_NOTE_MARKDOWN_THEME: MarkdownTheme = {
	heading: (text) => chalk.bold(chalk.yellow(text)),
	link: (text) => chalk.cyan(text),
	linkUrl: (text) => chalk.dim(text),
	code: (text) => chalk.yellow(text),
	codeBlock: (text) => chalk.dim(text),
	codeBlockBorder: (text) => chalk.dim(text),
	quote: (text) => chalk.dim(text),
	quoteBorder: (text) => chalk.dim(text),
	hr: (text) => chalk.dim(text),
	listBullet: (text) => chalk.yellow(text),
	bold: (text) => chalk.bold(text),
	italic: (text) => chalk.italic(text),
	strikethrough: (text) => chalk.strikethrough(text),
	underline: (text) => chalk.underline(text),
};

interface PackageCommandOptions {
	command: PackageCommand;
	source?: string;
	updateTarget?: UpdateTarget;
	showExtensionsSkippedNote: boolean;
	local: boolean;
	force: boolean;
	projectTrustOverride?: boolean;
	help: boolean;
	invalidOption?: string;
	invalidArgument?: string;
	missingOptionValue?: string;
	conflictingOptions?: string;
}

function reportSettingsErrors(settingsManager: SettingsManager, context: string): void {
	const errors = settingsManager.drainErrors();
	for (const { scope, error } of errors) {
		console.error(chalk.yellow(`Warning (${context}, ${scope} settings): ${error.message}`));
		if (error.stack) {
			console.error(chalk.dim(error.stack));
		}
	}
}

function getPackageCommandUsage(command: PackageCommand): string {
	switch (command) {
		case "install":
			return `${APP_NAME} install <source> [-l] [--approve|--no-approve]`;
		case "remove":
			return `${APP_NAME} remove <source> [-l] [--approve|--no-approve]`;
		case "update":
			return `${APP_NAME} update [source|self|toucan] [--self|--extensions|--models|--all] [--extension <source>] [--approve|--no-approve] [--force]`;
		case "list":
			return `${APP_NAME} list [--approve|--no-approve]`;
		case "channel":
			return `${APP_NAME} channel [dev|nightly|stable]`;
		case "launcher":
			return `${APP_NAME} launcher`;
	}
}

const CONFIG_COMMAND_USAGE = `${APP_NAME} config [-l] [--approve|--no-approve]`;

function printConfigCommandHelp(): void {
	console.log(`${chalk.bold("Usage:")}
  ${CONFIG_COMMAND_USAGE}

Open the resource configuration TUI to enable or disable package resources.
Without -l, starts in global settings (~/${CONFIG_DIR_NAME}/agent/settings.json).
Press Tab in the TUI to switch between global and project-local modes.

Options:
  -l, --local       Edit project overrides (${CONFIG_DIR_NAME}/settings.json)
  -a, --approve     Trust project-local files for this command with -l
  -na, --no-approve Ignore project-local files for this command with -l
`);
}

function printPackageCommandHelp(command: PackageCommand): void {
	switch (command) {
		case "install":
			console.log(`${chalk.bold("Usage:")}
  ${getPackageCommandUsage("install")}

Install a package and add it to settings.

Options:
  -l, --local       Install project-locally (${CONFIG_DIR_NAME}/settings.json)
  -a, --approve     Trust project-local files for this command
  -na, --no-approve Ignore project-local files for this command

Examples:
  ${APP_NAME} install npm:@foo/bar
  ${APP_NAME} install git:github.com/user/repo
  ${APP_NAME} install git:git@github.com:user/repo
  ${APP_NAME} install https://github.com/user/repo
  ${APP_NAME} install ssh://git@github.com/user/repo
  ${APP_NAME} install ./local/path
`);
			return;

		case "remove":
			console.log(`${chalk.bold("Usage:")}
  ${getPackageCommandUsage("remove")}

Remove a package and its source from settings.
Alias: ${APP_NAME} uninstall <source> [-l]

Options:
  -l, --local       Remove from project settings (${CONFIG_DIR_NAME}/settings.json)
  -a, --approve     Trust project-local files for this command
  -na, --no-approve Ignore project-local files for this command

Examples:
  ${APP_NAME} remove npm:@foo/bar
  ${APP_NAME} uninstall npm:@foo/bar
`);
			return;

		case "update":
			console.log(`${chalk.bold("Usage:")}
  ${getPackageCommandUsage("update")}

Update toucan, installed packages, or model catalogs.

Options:
  --self                  Update toucan only (default when no target is given)
  --extensions            Update installed packages only
  --models                Refresh model catalogs only
  --all                   Update toucan and installed packages
  --extension <source>    Update one package only
  -a, --approve           Trust project-local files for this command
  -na, --no-approve       Ignore project-local files for this command
  --force                 Reinstall toucan even if the current version is latest

Short forms:
  ${APP_NAME} update                Update toucan only
  ${APP_NAME} update --all          Update toucan and all extensions
  ${APP_NAME} update --models       Refresh model catalogs only
  ${APP_NAME} update <source>       Update one package
  ${APP_NAME} update toucan             Update toucan only (self works as alias to toucan)
`);
			return;

		case "list":
			console.log(`${chalk.bold("Usage:")}
  ${getPackageCommandUsage("list")}

List installed packages from user and project settings.

Options:
  -a, --approve      Trust project-local files for this command
  -na, --no-approve  Ignore project-local files for this command
`);
			return;

		case "channel":
			console.log(`${chalk.bold("Usage:")}
  ${getPackageCommandUsage("channel")}

Without an argument, list the channel builds under ~/.toucan/builds and mark the
active one. With a channel name, make it active; the channel is built on demand
when it is missing. The launcher at ~/.toucan/bin/toucan starts the active channel,
so new and restarted runs pick the switch up.

Examples:
  ${APP_NAME} channel             List channel builds
  ${APP_NAME} channel dev         Use the dev channel
  ${APP_NAME} channel stable      Use the stable channel
`);
			return;

		case "launcher":
			console.log(`${chalk.bold("Usage:")}
  ${getPackageCommandUsage("launcher")}

Rewrite the ~/.toucan/bin/toucan launcher for the current ~/.toucan layout.
`);
			return;
	}
}

function parsePackageCommand(args: string[]): PackageCommandOptions | undefined {
	const [rawCommand, ...rest] = args;
	let command: PackageCommand | undefined;
	if (rawCommand === "uninstall") {
		command = "remove";
	} else if (
		rawCommand === "install" ||
		rawCommand === "remove" ||
		rawCommand === "update" ||
		rawCommand === "list" ||
		rawCommand === "channel" ||
		rawCommand === "launcher"
	) {
		command = rawCommand;
	}
	if (!command) {
		return undefined;
	}

	let local = false;
	let force = false;
	let projectTrustOverride: boolean | undefined;
	let help = false;
	let invalidOption: string | undefined;
	let invalidArgument: string | undefined;
	let missingOptionValue: string | undefined;
	let conflictingOptions: string | undefined;
	let source: string | undefined;
	let selfFlag = false;
	let extensionsFlag = false;
	let modelsFlag = false;
	let allFlag = false;
	let extensionFlagSource: string | undefined;

	for (let index = 0; index < rest.length; index++) {
		const arg = rest[index];
		if (arg === "-h" || arg === "--help") {
			help = true;
			continue;
		}

		if (arg === "-l" || arg === "--local") {
			if (command === "install" || command === "remove") {
				local = true;
			} else {
				invalidOption = invalidOption ?? arg;
			}
			continue;
		}

		if (arg === "--self") {
			if (command === "update") {
				selfFlag = true;
			} else {
				invalidOption = invalidOption ?? arg;
			}
			continue;
		}

		if (arg === "--extensions") {
			if (command === "update") {
				extensionsFlag = true;
			} else {
				invalidOption = invalidOption ?? arg;
			}
			continue;
		}

		if (arg === "--models") {
			if (command === "update") {
				modelsFlag = true;
			} else {
				invalidOption = invalidOption ?? arg;
			}
			continue;
		}

		if (arg === "--all") {
			if (command === "update") {
				allFlag = true;
			} else {
				invalidOption = invalidOption ?? arg;
			}
			continue;
		}

		if (arg === "--approve" || arg === "-a") {
			projectTrustOverride = true;
			continue;
		}

		if (arg === "--no-approve" || arg === "-na") {
			projectTrustOverride = false;
			continue;
		}

		if (arg === "--force") {
			if (command === "update") {
				force = true;
			} else {
				invalidOption = invalidOption ?? arg;
			}
			continue;
		}

		if (arg === "--extension") {
			if (command !== "update") {
				invalidOption = invalidOption ?? arg;
				continue;
			}

			const value = rest[index + 1];
			if (!value || value.startsWith("-")) {
				missingOptionValue = missingOptionValue ?? arg;
			} else if (extensionFlagSource) {
				conflictingOptions = conflictingOptions ?? "--extension can only be provided once";
				index++;
			} else {
				extensionFlagSource = value;
				index++;
			}
			continue;
		}

		if (arg.startsWith("-")) {
			invalidOption = invalidOption ?? arg;
			continue;
		}

		if (!source) {
			source = arg;
		} else {
			invalidArgument = invalidArgument ?? arg;
		}
	}

	let updateTarget: UpdateTarget | undefined;
	let showExtensionsSkippedNote = false;
	if (command === "update") {
		if (allFlag && (selfFlag || extensionsFlag || modelsFlag || extensionFlagSource)) {
			conflictingOptions =
				conflictingOptions ?? "--all cannot be combined with --self, --extensions, --models, or --extension";
		}
		if (allFlag && source) {
			conflictingOptions = conflictingOptions ?? "--all cannot be combined with a positional source";
		}

		if (modelsFlag) {
			if (selfFlag || extensionsFlag || allFlag || extensionFlagSource) {
				conflictingOptions =
					conflictingOptions ?? "--models cannot be combined with --self, --extensions, --all, or --extension";
			}
			if (source) {
				conflictingOptions = conflictingOptions ?? "--models cannot be combined with a positional source";
			}
			updateTarget = { type: "models" };
		} else if (extensionFlagSource) {
			if (selfFlag || extensionsFlag || allFlag) {
				conflictingOptions =
					conflictingOptions ?? "--extension cannot be combined with --self, --extensions, or --all";
			}
			if (source) {
				conflictingOptions = conflictingOptions ?? "--extension cannot be combined with a positional source";
			}
			updateTarget = { type: "extensions", source: extensionFlagSource };
		} else if (source) {
			const sourceIsSelf = source === "self" || source === "toucan";
			if (sourceIsSelf) {
				updateTarget = extensionsFlag ? { type: "all" } : { type: "self" };
			} else {
				if (extensionsFlag || selfFlag || allFlag) {
					conflictingOptions =
						conflictingOptions ??
						"positional update targets cannot be combined with --self, --extensions, or --all";
				}
				updateTarget = { type: "extensions", source };
			}
		} else if (allFlag) {
			updateTarget = { type: "all" };
		} else if (selfFlag && extensionsFlag) {
			updateTarget = { type: "all" };
		} else if (selfFlag) {
			updateTarget = { type: "self" };
		} else if (extensionsFlag) {
			updateTarget = { type: "extensions" };
		} else {
			updateTarget = { type: "self" };
			showExtensionsSkippedNote = true;
		}
	}

	return {
		command,
		source,
		updateTarget,
		showExtensionsSkippedNote,
		local,
		force,
		projectTrustOverride,
		help,
		invalidOption,
		invalidArgument,
		missingOptionValue,
		conflictingOptions,
	};
}

function updateTargetIncludesSelf(target: UpdateTarget): boolean {
	return target.type === "all" || target.type === "self";
}

function updateTargetIncludesExtensions(target: UpdateTarget): boolean {
	return target.type === "all" || target.type === "extensions";
}

async function refreshModelCatalogs(agentDir: string): Promise<void> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 15_000);
	try {
		const modelRuntime = await ModelRuntime.create({
			authPath: join(agentDir, "auth.json"),
			modelsPath: join(agentDir, "models.json"),
			allowModelNetwork: false,
			signal: controller.signal,
		});
		const result = await modelRuntime.refresh({
			allowNetwork: true,
			force: true,
			signal: controller.signal,
		});
		if (result.aborted) {
			throw new Error("Model catalog refresh timed out.");
		}
		if (result.errors.size > 0) {
			const details = Array.from(result.errors, ([provider, error]) => `${provider}: ${error.message}`).join("; ");
			throw new Error(`Could not refresh model catalogs: ${details}`);
		}
	} finally {
		clearTimeout(timeout);
	}
	console.log(chalk.green("Model catalogs refreshed"));
}

function printSelfUpdateUnavailable(
	npmCommand?: string[],
	updatePackageTarget: SelfUpdatePackageTarget = PACKAGE_NAME,
): void {
	console.error(`error: ${APP_NAME} cannot self-update this installation.`);
	console.error(getSelfUpdateUnavailableInstruction(PACKAGE_NAME, npmCommand, updatePackageTarget));
	console.error(
		`To make \`${APP_NAME} update\` run your own update command, set TOUCAN_SELF_UPDATE_COMMAND or the selfUpdateCommand setting.`,
	);

	const entrypoint = process.argv[1];
	if (entrypoint) {
		console.error("");
		console.error(`Location of ${APP_NAME} executable: ${entrypoint}`);
	}
}

function printSelfUpdateFallback(command: SelfUpdateCommand): void {
	console.error(chalk.dim(`If this keeps failing, run this command yourself: ${command.display}`));
}

function printPnpmSelfUpdateMetadataHint(): void {
	console.error(chalk.yellow("If pnpm reports missing package versions, its cached registry metadata may be stale."));
	console.error(chalk.yellow(`Run \`pnpm store prune\` and retry \`${APP_NAME} update --self\`.`));
}

function printSelfUpdateNote(note: string): void {
	const trimmedNote = note.trim();
	if (!trimmedNote) {
		return;
	}

	console.log();
	console.log(chalk.bold(chalk.yellow("Update note")));
	try {
		const width = Math.max(20, process.stdout.columns ?? 80);
		const renderedLines = new Markdown(trimmedNote, 0, 0, SELF_UPDATE_NOTE_MARKDOWN_THEME)
			.render(width)
			.map((line) => line.trimEnd());
		console.log(renderedLines.join("\n"));
	} catch {
		console.log(trimmedNote);
	}
	console.log();
}

interface SelfUpdatePlan {
	packageName: string;
	installSpec: string;
	version: string;
	shouldRun: boolean;
	note?: string;
}

async function getSelfUpdatePlan(force: boolean): Promise<SelfUpdatePlan> {
	let latestRelease: Awaited<ReturnType<typeof getLatestToucanRelease>>;
	try {
		latestRelease = await getLatestToucanRelease(VERSION, { retry: true });
	} catch (error: unknown) {
		throw new Error(`Could not determine latest ${APP_NAME} version: ${formatVersionCheckError(error)}`, {
			cause: error,
		});
	}
	if (!latestRelease) {
		throw new Error(`Could not determine latest ${APP_NAME} version.`);
	}

	const packageName = latestRelease.packageName ?? PACKAGE_NAME;
	const installSpec = `${packageName}@${latestRelease.version}`;
	if (force || packageName !== PACKAGE_NAME || isNewerPackageVersion(latestRelease.version, VERSION)) {
		return {
			packageName,
			installSpec,
			version: latestRelease.version,
			...(latestRelease.note ? { note: latestRelease.note } : {}),
			shouldRun: true,
		};
	}

	console.log(chalk.green(`${APP_NAME} is already up to date (${getBuildName()})`));
	return { packageName, installSpec, version: latestRelease.version, shouldRun: false };
}

async function runSelfUpdate(command: SelfUpdateCommand): Promise<void> {
	console.log(chalk.dim(`Updating ${APP_NAME} with ${command.display}...`));
	for (const step of command.steps ?? [command]) {
		await new Promise<void>((resolve, reject) => {
			const child = spawnProcess(step.command, step.args, {
				stdio: "inherit",
			});
			child.on("error", (error) => {
				reject(error);
			});
			child.on("close", (code, signal) => {
				if (code === 0) {
					resolve();
				} else if (signal) {
					reject(new Error(`${step.display} terminated by signal ${signal}`));
				} else {
					reject(new Error(`${step.display} exited with code ${code ?? "unknown"}`));
				}
			});
		});
	}
}

/** Run the user-configured self-update command, then report the version installed on disk. */
async function runConfiguredSelfUpdate(argv: string[], plan: SelfUpdatePlan): Promise<void> {
	const command = makeConfiguredSelfUpdateCommand(argv, plan);
	if (plan.note) {
		printSelfUpdateNote(plan.note);
	}
	try {
		await runSelfUpdate(command);
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : "Unknown self-update command error";
		console.error(chalk.red(`Error: ${message}`));
		process.exitCode = 1;
		return;
	}
	// Exit code 0 does not prove an update. Wrappers such as mise or Nix install each version into a
	// new directory and leave this installation untouched, so fall back to the toucan on PATH.
	const change = detectInstallChange();
	const installedVersion =
		change?.kind === "updated" && change.version === plan.version ? change.version : readVersionOnPath();
	if (installedVersion && numericVersion(installedVersion) === plan.version) {
		console.log(chalk.green(`Updated ${APP_NAME} from ${getBuildName()} to ${buildName(plan.version)}`));
		return;
	}
	console.log(
		chalk.yellow(
			`Ran ${command.display}, but \`${APP_NAME} --version\` reports ${installedVersion ?? "no version"}, not ${plan.version}.`,
		),
	);
}

/** Version printed by `toucan --version` as resolved from PATH, the toucan the user runs next. */
function readVersionOnPath(): string | undefined {
	// TOUCAN_PACKAGE_DIR points at this installation and would make the new toucan report the old version.
	const { TOUCAN_PACKAGE_DIR: _, ...env } = process.env;
	const result = spawnProcessSync(APP_NAME, ["--version"], {
		encoding: "utf-8",
		stdio: ["ignore", "pipe", "pipe"],
		env,
	});
	return result.status === 0 ? result.stdout.trim() || undefined : undefined;
}

function prepareWindowsNpmSelfUpdate(): void {
	if (process.platform !== "win32") {
		return;
	}

	const packageDir = getPackageDir();
	cleanupWindowsSelfUpdateQuarantine(packageDir);
	quarantineWindowsNativeDependencies(packageDir);
}

export interface PackageCommandRuntimeOptions {
	extensionFactories?: InlineExtension[];
}

interface CommandSettingsResult {
	settingsManager: SettingsManager;
	projectTrustWarnings: string[];
}

function getCommandAppMode(): AppMode {
	return process.stdin.isTTY && process.stdout.isTTY ? "interactive" : "print";
}

function reportProjectTrustWarnings(warnings: readonly string[]): void {
	for (const warning of warnings) {
		console.error(chalk.yellow(`Warning: ${warning}`));
	}
}

async function createCommandSettingsManager(options: {
	cwd: string;
	agentDir: string;
	projectTrustOverride?: boolean;
	useSavedProjectTrustOnly?: boolean;
	extensionFactories?: InlineExtension[];
}): Promise<CommandSettingsResult> {
	const settingsManager = SettingsManager.create(options.cwd, options.agentDir, { projectTrusted: false });
	const projectTrustWarnings: string[] = [];
	const trustStore = new ProjectTrustStore(options.agentDir);
	if (options.useSavedProjectTrustOnly) {
		const savedProjectTrusted = trustStore.get(options.cwd) === true;
		settingsManager.setProjectTrusted(options.projectTrustOverride ?? savedProjectTrusted);
		return { settingsManager, projectTrustWarnings };
	}

	const appMode = getCommandAppMode();
	const extensionsResult =
		options.projectTrustOverride === undefined && hasTrustRequiringProjectResources(options.cwd)
			? await new DefaultResourceLoader({
					cwd: options.cwd,
					agentDir: options.agentDir,
					settingsManager,
					extensionFactories: options.extensionFactories,
				}).loadProjectTrustExtensions()
			: undefined;
	for (const error of extensionsResult?.errors ?? []) {
		projectTrustWarnings.push(`Failed to load extension "${error.path}": ${error.error}`);
	}

	const projectTrusted = await resolveProjectTrusted({
		cwd: options.cwd,
		trustStore,
		trustOverride: options.projectTrustOverride,
		defaultProjectTrust: settingsManager.getDefaultProjectTrust(),
		extensionsResult,
		projectTrustContext: createProjectTrustContext({
			cwd: options.cwd,
			mode: appMode,
			settingsManager,
			hasUI: appMode === "interactive",
		}),
		onExtensionError: (message) => projectTrustWarnings.push(message),
	});
	settingsManager.setProjectTrusted(projectTrusted);
	return { settingsManager, projectTrustWarnings };
}

export async function handleConfigCommand(
	args: string[],
	runtimeOptions: PackageCommandRuntimeOptions = {},
): Promise<boolean> {
	const [command, ...rest] = args;
	if (command !== "config") {
		return false;
	}

	if (rest.includes("-h") || rest.includes("--help")) {
		printConfigCommandHelp();
		return true;
	}

	let local = false;
	let projectTrustOverride: boolean | undefined;
	for (const arg of rest) {
		if (arg === "-l" || arg === "--local") {
			local = true;
		} else if (arg === "-a" || arg === "--approve") {
			projectTrustOverride = true;
		} else if (arg === "-na" || arg === "--no-approve") {
			projectTrustOverride = false;
		} else if (arg.startsWith("-")) {
			console.error(chalk.red(`Unknown option ${arg} for "config".`));
			console.error(chalk.dim(`Use "${APP_NAME} --help" or "${CONFIG_COMMAND_USAGE}".`));
			process.exitCode = 1;
			return true;
		} else {
			console.error(chalk.red(`Unexpected argument ${arg}.`));
			console.error(chalk.dim(`Usage: ${CONFIG_COMMAND_USAGE}`));
			process.exitCode = 1;
			return true;
		}
	}

	const cwd = process.cwd();
	const agentDir = getAgentDir();
	const { settingsManager, projectTrustWarnings } = await createCommandSettingsManager({
		cwd,
		agentDir,
		projectTrustOverride,
		extensionFactories: runtimeOptions.extensionFactories,
	});
	reportProjectTrustWarnings(projectTrustWarnings);
	if (local && !settingsManager.isProjectTrusted()) {
		console.error(chalk.red("Project is not trusted. Use --approve to modify local resource config."));
		process.exitCode = 1;
		return true;
	}
	reportSettingsErrors(settingsManager, "config command");
	const builtinExtensions = (runtimeOptions.extensionFactories ?? [])
		.filter(isBuiltinExtension)
		.map((input) => input.name);
	const globalSettingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted: false });
	const globalResolvedPaths = await new DefaultPackageManager({
		cwd,
		agentDir,
		settingsManager: globalSettingsManager,
		builtinExtensions,
	}).resolve();
	const projectResolvedPaths = settingsManager.isProjectTrusted()
		? await new DefaultPackageManager({ cwd, agentDir, settingsManager, builtinExtensions }).resolve()
		: globalResolvedPaths;
	const installWarnings = new Set(
		[...(globalResolvedPaths.installFailures ?? []), ...(projectResolvedPaths.installFailures ?? [])].map(
			formatPackageInstallWarning,
		),
	);
	for (const warning of installWarnings) {
		console.error(chalk.yellow(`Warning: ${warning}`));
	}

	await selectConfig({
		resolvedPaths: { global: globalResolvedPaths, project: projectResolvedPaths },
		settingsManager,
		cwd,
		agentDir,
		writeScope: local ? "project" : "global",
		projectModeAvailable: settingsManager.isProjectTrusted(),
	});

	process.exit(0);
}

function rejectWindowsChannels(): void {
	console.error(chalk.red(`Channel builds are not supported on Windows yet. Install ${APP_NAME} from npm instead.`));
	process.exitCode = 1;
}

function formatChannelCommit(commit: string): string {
	return commit.slice(0, 8);
}

/** Nudge the user onto the launcher PATH when this installation is not reachable as `toucan`. */
function printLauncherPathNote(): void {
	const launcherDir = getChannelLauncherDir();
	if (!(process.env.PATH ?? "").split(delimiter).includes(launcherDir)) {
		console.log(chalk.dim(`Add the launcher to PATH for new shells: export PATH="${launcherDir}:$PATH"`));
	}
}

function printChannelBuildList(): void {
	const statuses = listChannelBuilds();
	if (statuses.length === 0) {
		console.log(chalk.dim(`No channel builds. Run ${APP_NAME} install toucan:stable.`));
		return;
	}
	for (const { info, active } of statuses) {
		const marker = active ? chalk.green("*") : " ";
		console.log(
			`${marker} ${info.channel.padEnd(8)} ${info.ref.padEnd(10)} ${formatChannelCommit(info.commit)}  built ${info.builtAt.slice(0, 10)}  ${chalk.dim(getChannelBuildDir(info.channel))}`,
		);
	}
	const active = readActiveChannel();
	if (!active) console.log(chalk.dim('No active channel; run "toucan channel <name>".'));
}

/**
 * Run `channel`/`launcher` and `toucan:`-prefixed install/remove. These operate on the
 * channel state directly, before any settings, project-trust, or package machinery.
 */
async function handleChannelCommand(options: PackageCommandOptions): Promise<boolean> {
	if (process.platform === "win32") {
		rejectWindowsChannels();
		return true;
	}
	try {
		switch (options.command) {
			case "launcher": {
				console.log(chalk.green(`Launcher written to ${ensureLauncher()}`));
				printLauncherPathNote();
				return true;
			}

			case "channel": {
				if (!options.source) {
					printChannelBuildList();
					return true;
				}
				if (!isChannelName(options.source)) {
					console.error(chalk.red(`Unknown channel "${options.source}". Use dev, nightly, or stable.`));
					process.exitCode = 1;
					return true;
				}
				const info = await switchChannel(options.source);
				console.log(
					chalk.green(`Active channel: ${options.source} (${info.ref} ${formatChannelCommit(info.commit)}).`),
				);
				console.log(chalk.dim("New and restarted toucan runs use it."));
				return true;
			}

			case "install": {
				const parsed = parseChannelSource(options.source ?? "");
				if (!parsed) {
					console.error(
						chalk.red(
							`Invalid channel source "${options.source}". Expected toucan:<dev|nightly|stable>[@<ref>].`,
						),
					);
					process.exitCode = 1;
					return true;
				}
				const result = await installChannel(
					parsed.channel,
					parsed.pinnedRef ? { pinnedRef: parsed.pinnedRef } : {},
				);
				if (result.kind === "up-to-date") {
					console.log(
						chalk.green(
							`toucan:${parsed.channel} is already up to date (${result.info.ref} ${formatChannelCommit(result.info.commit)}).`,
						),
					);
				} else {
					console.log(
						chalk.green(
							`Installed toucan:${parsed.channel} at ${result.info.ref} (${formatChannelCommit(result.info.commit)}).`,
						),
					);
				}
				printLauncherPathNote();
				return true;
			}

			case "remove": {
				const parsed = parseChannelSource(options.source ?? "");
				if (!parsed) {
					console.error(
						chalk.red(
							`Invalid channel source "${options.source}". Expected toucan:<dev|nightly|stable>[@<ref>].`,
						),
					);
					process.exitCode = 1;
					return true;
				}
				const wasActive = readActiveChannel() === parsed.channel;
				await removeChannel(parsed.channel);
				console.log(chalk.green(`Removed channel ${parsed.channel}.`));
				if (wasActive) {
					console.log(chalk.dim(`No active channel. Run ${APP_NAME} install toucan:<name> to pick one again.`));
				}
				return true;
			}
		}
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : "Unknown channel command error";
		console.error(chalk.red(`Error: ${message}`));
		process.exitCode = 1;
		return true;
	}
	return true;
}

export async function handlePackageCommand(
	args: string[],
	runtimeOptions: PackageCommandRuntimeOptions = {},
): Promise<boolean> {
	const options = parsePackageCommand(args);
	if (!options) {
		return false;
	}

	if (options.help) {
		printPackageCommandHelp(options.command);
		return true;
	}

	if (options.invalidOption) {
		console.error(chalk.red(`Unknown option ${options.invalidOption} for "${options.command}".`));
		console.error(chalk.dim(`Use "${APP_NAME} --help" or "${getPackageCommandUsage(options.command)}".`));
		process.exitCode = 1;
		return true;
	}

	if (options.missingOptionValue) {
		console.error(chalk.red(`Missing value for ${options.missingOptionValue}.`));
		console.error(chalk.dim(`Usage: ${getPackageCommandUsage(options.command)}`));
		process.exitCode = 1;
		return true;
	}

	if (options.invalidArgument) {
		console.error(chalk.red(`Unexpected argument ${options.invalidArgument}.`));
		console.error(chalk.dim(`Usage: ${getPackageCommandUsage(options.command)}`));
		process.exitCode = 1;
		return true;
	}

	if (options.conflictingOptions) {
		console.error(chalk.red(options.conflictingOptions));
		console.error(chalk.dim(`Usage: ${getPackageCommandUsage(options.command)}`));
		process.exitCode = 1;
		return true;
	}

	const source = options.source;
	if ((options.command === "install" || options.command === "remove") && !source) {
		console.error(chalk.red(`Missing ${options.command} source.`));
		console.error(chalk.dim(`Usage: ${getPackageCommandUsage(options.command)}`));
		process.exitCode = 1;
		return true;
	}

	// Channel operations work on ~/.toucan state directly; no settings, trust, or package machinery.
	const isChannelOperation =
		options.command === "channel" ||
		options.command === "launcher" ||
		((options.command === "install" || options.command === "remove") &&
			source !== undefined &&
			isChannelSource(source));
	if (isChannelOperation) {
		return handleChannelCommand(options);
	}

	if (options.command === "update" && options.updateTarget?.type === "models") {
		try {
			await refreshModelCatalogs(getAgentDir());
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "Unknown model catalog refresh error";
			console.error(chalk.red(`Error: ${message}`));
			process.exitCode = 1;
		}
		return true;
	}

	const cwd = process.cwd();
	const agentDir = getAgentDir();
	const writesProjectPackageConfig = (options.command === "install" || options.command === "remove") && options.local;
	const { settingsManager, projectTrustWarnings } = await createCommandSettingsManager({
		cwd,
		agentDir,
		projectTrustOverride: options.projectTrustOverride,
		useSavedProjectTrustOnly: options.command === "update",
		extensionFactories: runtimeOptions.extensionFactories,
	});
	reportProjectTrustWarnings(projectTrustWarnings);
	if (!settingsManager.isProjectTrusted() && writesProjectPackageConfig) {
		console.error(chalk.red("Project is not trusted. Use --approve to modify local package config."));
		process.exitCode = 1;
		return true;
	}
	reportSettingsErrors(settingsManager, "package command");
	const selfUpdateNpmCommand = settingsManager.getGlobalSettings().npmCommand;

	const packageManager = new DefaultPackageManager({ cwd, agentDir, settingsManager });

	// Update result events describe a changed package, e.g. "npm:foo 1.2.0 -> 1.3.0".
	const updatedPackages: string[] = [];
	// Progress messages are warnings, e.g. npm reinstalled the old version from stale registry metadata.
	let warningCount = 0;
	packageManager.setProgressCallback((event) => {
		if (event.type === "result" && event.action === "update" && event.message) {
			updatedPackages.push(event.message);
		} else if (event.type === "start") {
			process.stdout.write(chalk.dim(`${event.message}\n`));
		} else if (event.type === "progress" && event.message) {
			warningCount++;
			process.stdout.write(chalk.yellow(`${event.message}\n`));
		}
	});

	try {
		switch (options.command) {
			case "install":
				await packageManager.installAndPersist(source!, { local: options.local });
				console.log(chalk.green(`Installed ${source}`));
				return true;

			case "remove": {
				const removed = await packageManager.removeAndPersist(source!, { local: options.local });
				if (!removed) {
					console.error(chalk.red(`No matching package found for ${source}`));
					process.exitCode = 1;
					return true;
				}
				console.log(chalk.green(`Removed ${source}`));
				return true;
			}

			case "list": {
				const configuredPackages = packageManager.listConfiguredPackages();
				const userPackages = configuredPackages.filter((pkg) => pkg.scope === "user");
				const projectPackages = configuredPackages.filter((pkg) => pkg.scope === "project");

				if (configuredPackages.length === 0) {
					console.log(chalk.dim("No packages installed."));
					return true;
				}

				const formatPackage = (pkg: (typeof configuredPackages)[number]) => {
					const display = pkg.filtered ? `${pkg.source} (filtered)` : pkg.source;
					console.log(`  ${display}`);
					if (pkg.installedPath) {
						console.log(chalk.dim(`    ${pkg.installedPath}`));
					}
				};

				if (userPackages.length > 0) {
					console.log(chalk.bold("User packages:"));
					for (const pkg of userPackages) {
						formatPackage(pkg);
					}
				}

				if (projectPackages.length > 0) {
					if (userPackages.length > 0) console.log();
					console.log(chalk.bold("Project packages:"));
					for (const pkg of projectPackages) {
						formatPackage(pkg);
					}
				}

				return true;
			}

			case "update": {
				const target = options.updateTarget ?? { type: "self" };
				if (options.showExtensionsSkippedNote) {
					console.log(
						chalk.dim(`Extensions are skipped. Run ${APP_NAME} update --extensions to update extensions.`),
					);
				}
				if (updateTargetIncludesExtensions(target)) {
					const updateSource = target.type === "extensions" ? target.source : undefined;
					await packageManager.update(updateSource);
					// Only claim "up to date" when the update actually checked and nothing warned.
					if (isOfflineModeEnabled()) {
						console.log(chalk.yellow("Skipped package updates (offline mode)"));
					} else if (updatedPackages.length === 0 && warningCount > 0) {
						console.log(
							chalk.yellow(
								updateSource
									? `${updateSource} was not updated, see the warnings above`
									: "No packages were updated, see the warnings above",
							),
						);
					} else if (updatedPackages.length === 0) {
						console.log(
							chalk.green(
								updateSource ? `${updateSource} is already up to date` : "Packages are already up to date",
							),
						);
					} else {
						const count = updatedPackages.length;
						console.log(chalk.green(`Updated ${count} package${count === 1 ? "" : "s"}:`));
						for (const message of updatedPackages) {
							console.log(`  ${message}`);
						}
					}
				}
				if (updateTargetIncludesSelf(target)) {
					const configuredSelfUpdateArgv = getConfiguredSelfUpdateArgv(
						settingsManager.getGlobalSettings().selfUpdateCommand,
					);
					// A configured command is explicit user intent, so it replaces the channel update path too.
					const channelBuild = configuredSelfUpdateArgv ? undefined : detectChannelInstall();
					if (channelBuild) {
						if (process.platform === "win32") {
							rejectWindowsChannels();
							return true;
						}
						const result = await updateChannel(channelBuild.channel, { force: options.force });
						if (result.kind === "up-to-date") {
							console.log(
								chalk.green(
									`${APP_NAME} is already up to date (channel ${channelBuild.channel}: ${result.info.ref} ${formatChannelCommit(result.info.commit)}).`,
								),
							);
						} else {
							console.log(
								chalk.green(
									`Updated ${APP_NAME} (channel ${channelBuild.channel}) to ${result.info.ref} (${formatChannelCommit(result.info.commit)}).`,
								),
							);
							console.log(chalk.dim("New and restarted toucan runs use the new build."));
						}
						return true;
					}
					const selfUpdatePlan = await getSelfUpdatePlan(options.force);
					if (!selfUpdatePlan.shouldRun) {
						return true;
					}
					if (configuredSelfUpdateArgv) {
						await runConfiguredSelfUpdate(configuredSelfUpdateArgv, selfUpdatePlan);
						return true;
					}

					const installMethod = detectInstallMethod();
					if (process.platform === "win32" && installMethod !== "npm" && installMethod !== "pnpm") {
						console.error(
							chalk.red(`${APP_NAME} self-update on Windows is only supported for npm and pnpm installs.`),
						);
						console.error(chalk.dim(`Detected install method: ${installMethod}. Update ${APP_NAME} manually.`));
						process.exitCode = 1;
						return true;
					}
					const selfUpdateTarget = {
						packageName: selfUpdatePlan.packageName,
						installSpec: selfUpdatePlan.installSpec,
					};
					const selfUpdateCommand = getSelfUpdateCommand(PACKAGE_NAME, selfUpdateNpmCommand, selfUpdateTarget);
					if (!selfUpdateCommand) {
						printSelfUpdateUnavailable(selfUpdateNpmCommand, selfUpdateTarget);
						process.exitCode = 1;
						return true;
					}
					if (selfUpdatePlan.note) {
						printSelfUpdateNote(selfUpdatePlan.note);
					}
					try {
						if (installMethod === "npm") {
							prepareWindowsNpmSelfUpdate();
						}
						await runSelfUpdate(selfUpdateCommand);
					} catch (error: unknown) {
						const message = error instanceof Error ? error.message : "Unknown package command error";
						console.error(chalk.red(`Error: ${message}`));
						if (installMethod === "pnpm") {
							printPnpmSelfUpdateMetadataHint();
						}
						printSelfUpdateFallback(selfUpdateCommand);
						process.exitCode = 1;
						return true;
					}
					console.log(
						chalk.green(`Updated ${APP_NAME} from ${getBuildName()} to ${buildName(selfUpdatePlan.version)}`),
					);
				}
				return true;
			}
		}
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : "Unknown package command error";
		console.error(chalk.red(`Error: ${message}`));
		process.exitCode = 1;
		return true;
	}
	// channel and launcher are dispatched to handleChannelCommand before this switch.
	return true;
}
