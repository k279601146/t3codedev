// @effect-diagnostics nodeBuiltinImport:off
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { ChildProcessSpawner } from "effect/unstable/process";
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import nodePath from "node:path";

import {
  VcsOutputDecodeError,
  type VcsError,
  VcsProcessExitError,
  VcsProcessSpawnError,
  VcsProcessTimeoutError,
} from "@t3tools/contracts";
import { ProcessRunner, layer as ProcessRunnerLive } from "../processRunner.ts";
import * as Match from "effect/Match";

export interface VcsProcessInput {
  readonly operation: string;
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd: string;
  readonly spawnCwd?: string;
  readonly stdin?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly allowNonZeroExit?: boolean;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly appendTruncationMarker?: boolean;
}

export interface VcsProcessOutput {
  readonly exitCode: ChildProcessSpawner.ExitCode;
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutTruncated: boolean;
  readonly stderrTruncated: boolean;
}

export interface VcsProcessShape {
  readonly run: (input: VcsProcessInput) => Effect.Effect<VcsProcessOutput, VcsError>;
  readonly resolveExecutable?: (
    command: string,
    env?: NodeJS.ProcessEnv,
  ) => Effect.Effect<Option.Option<string>, never>;
}

export class VcsProcess extends Context.Service<VcsProcess, VcsProcessShape>()(
  "t3/vcs/VcsProcess",
) {}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1_000_000;
const OUTPUT_TRUNCATED_MARKER = "\n\n[truncated]";

function commandLabel(command: string, args: ReadonlyArray<string>): string {
  return [command, ...args].join(" ");
}

function getEnvVar(env: NodeJS.ProcessEnv, key: string): string | undefined {
  if (env[key] !== undefined) return env[key];
  const upperKey = key.toUpperCase();
  for (const name in env) {
    if (name.toUpperCase() === upperKey) {
      return env[name];
    }
  }
  return undefined;
}

function hasPathSeparator(command: string): boolean {
  return command.includes("/") || command.includes("\\");
}

function windowsExecutableExtensions(env: NodeJS.ProcessEnv): ReadonlyArray<string> {
  const raw = getEnvVar(env, "PATHEXT") ?? ".COM;.EXE;.BAT;.CMD";
  const extensions = raw
    .split(";")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => (entry.startsWith(".") ? entry : `.${entry}`));
  return extensions.length > 0 ? extensions : [".COM", ".EXE", ".BAT", ".CMD"];
}

function executableNames(command: string, env: NodeJS.ProcessEnv): ReadonlyArray<string> {
  if (process.platform !== "win32" || nodePath.extname(command).length > 0) {
    return [command];
  }
  return [...windowsExecutableExtensions(env).map((extension) => `${command}${extension}`), command];
}

async function canAccessFile(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function resolveExecutablePath(
  command: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  const trimmed = command.trim();
  if (trimmed.length === 0) return null;

  const names = executableNames(trimmed, env);
  if (nodePath.isAbsolute(trimmed) || hasPathSeparator(trimmed)) {
    for (const candidate of names) {
      if (await canAccessFile(candidate)) return candidate;
    }
    return null;
  }

  const pathValue = getEnvVar(env, "PATH") ?? "";
  for (const directory of pathValue.split(nodePath.delimiter)) {
    const baseDirectory = directory.trim().length > 0 ? directory : ".";
    for (const name of names) {
      const candidate = nodePath.join(baseDirectory, name);
      if (await canAccessFile(candidate)) return candidate;
    }
  }

  return null;
}

export const make = Effect.fn("makeVcsProcess")(function* () {
  const processRunner = yield* ProcessRunner;

  const run = Effect.fn("VcsProcess.run")(function* (input: VcsProcessInput) {
    const label = commandLabel(input.command, input.args);
    const baseError = {
      operation: input.operation,
      command: label,
      cwd: input.cwd,
    };

    const result = yield* processRunner
      .run({
        command: input.command,
        args: input.args,
        cwd: input.cwd,
        ...(input.spawnCwd !== undefined ? { spawnCwd: input.spawnCwd } : {}),
        ...(input.stdin !== undefined ? { stdin: input.stdin } : {}),
        ...(input.env !== undefined ? { env: input.env } : {}),
        timeout: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxOutputBytes: input.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
        outputMode: "truncate",
        truncatedMarker: input.appendTruncationMarker ? OUTPUT_TRUNCATED_MARKER : "",
        timeoutBehavior: "error",
      })
      .pipe(
        Effect.mapError(
          Match.valueTags({
            ProcessSpawnError: (error) =>
              VcsProcessSpawnError.fromProcessSpawnError(baseError, error),
            ProcessOutputLimitError: (error) =>
              VcsOutputDecodeError.fromProcessOutputLimitError(baseError, error),
            ProcessTimeoutError: (error) =>
              VcsProcessTimeoutError.fromProcessTimeoutError(baseError, error),
            ProcessStdinError: (error) =>
              VcsOutputDecodeError.fromProcessStdinError(baseError, error),
            ProcessReadError: (error) =>
              VcsOutputDecodeError.fromProcessReadError(baseError, error),
          }),
        ),
      );

    if (result.code === null) {
      return yield* VcsOutputDecodeError.missingExitCode(baseError);
    }

    if (!input.allowNonZeroExit && result.code !== 0) {
      return yield* new VcsProcessExitError({
        operation: input.operation,
        command: label,
        cwd: input.cwd,
        exitCode: result.code,
        detail: result.stderr.trim() || `${label} exited with code ${result.code}.`,
      });
    }

    return {
      exitCode: result.code,
      stdout: result.stdout,
      stderr: result.stderr,
      stdoutTruncated: result.stdoutTruncated,
      stderrTruncated: result.stderrTruncated,
    } satisfies VcsProcessOutput;
  });

  const resolveExecutable: NonNullable<VcsProcessShape["resolveExecutable"]> = (
    command,
    env = process.env,
  ) =>
    Effect.promise(() => resolveExecutablePath(command, env)).pipe(
      Effect.map((value) => (value === null ? Option.none<string>() : Option.some(value))),
      Effect.catch(() => Effect.succeed(Option.none<string>())),
    );

  return VcsProcess.of({ run, resolveExecutable });
});

export const layer = Layer.effect(VcsProcess, make()).pipe(Layer.provide(ProcessRunnerLive));
