#!/usr/bin/env node
import { spawnSync } from 'child_process';
import {
  appendFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { basename, dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const examplesDir = join(root, 'examples');
const outDir = join(root, 'out');
const logsDir = join(root, 'logs');
const cli = join(root, 'dist', 'generator', 'cli.js');
const MAX_BUFFER_BYTES = 1024 * 1024 * 100; // 100MB
const HEALTH_TIMEOUT_MS = 90_000;
const HEALTH_POLL_INTERVAL_MS = 2_000;
const DOCKER_BASE_PORT = 39_000;

// Remove and recreate out/
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir);
mkdirSync(logsDir, { recursive: true });

const schemas = readdirSync(examplesDir)
  .filter((f) => f.endsWith('.prisma'))
  .sort();

const runStartedAt = new Date();
const logPath = join(logsDir, `run-examples-${formatTimestamp(runStartedAt)}.log`);

const warningEntriesRaw = [];
const warningEntriesActionable = [];
const errorEntriesRaw = [];
const errorEntriesActionable = [];

writeFileSync(logPath, '');
logLine('=== run-examples.js log ===');
logLine(`startedAt: ${runStartedAt.toISOString()}`);
logLine(`root: ${root}`);
logLine(`schemas: ${schemas.length}`);
logLine(`node: ${process.version}`);

function formatTimestamp(date) {
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

function logLine(line = '') {
  appendFileSync(logPath, `${line}\n`, 'utf8');
}

function splitLines(text) {
  if (!text) return [];
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function sanitizeProjectName(name) {
  return `backgen_${name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
}

function stripAnsi(text) {
  return String(text).replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
}

function normalizeLine(text) {
  return stripAnsi(text).replace(/\s+/g, ' ').trim();
}

function isActionableWarning(line) {
  const normalized = normalizeLine(line);
  if (!normalized) return false;
  if (!/\bwarn(?:ing)?\b/i.test(normalized)) return false;
  if (/Tarball download average speed/i.test(normalized)) return false;
  if (/^[╭╰│─]+/u.test(normalized)) return false;
  if (/^Warning\s*[─-]+/i.test(normalized)) return false;
  return true;
}

function isActionableError(line) {
  const normalized = normalizeLine(line);
  if (!normalized) return false;
  if (/^[⎯─\s]+$/u.test(normalized)) return false;
  if (/[⎯─]{4,}.*Failed Tests/i.test(normalized)) return false;

  return (
    /Command failed \(exit/i.test(normalized)
    || /\b(error|failed|exception)\b/i.test(normalized)
    || /\berror\s+TS\d+/i.test(normalized)
    || /\bP\d{4}\b/.test(normalized)
  );
}

function addWarningEntry(exampleName, stepLabel, line) {
  warningEntriesRaw.push({ example: exampleName, step: stepLabel, line });
  if (isActionableWarning(line)) {
    warningEntriesActionable.push({
      example: exampleName,
      step: stepLabel,
      line: normalizeLine(line),
    });
  }
}

function addErrorEntry(exampleName, stepLabel, line) {
  errorEntriesRaw.push({ example: exampleName, step: stepLabel, line });
  if (isActionableError(line)) {
    errorEntriesActionable.push({
      example: exampleName,
      step: stepLabel,
      line: normalizeLine(line),
    });
  }
}

function extractWarningLines(stdout, stderr) {
  const regex = /\bwarn(?:ing)?\b/i;
  return [...splitLines(stdout), ...splitLines(stderr)].filter((line) => regex.test(line));
}

function extractErrorLines(stdout, stderr) {
  const regex = /\b(error|failed|exception)\b/i;
  return [...splitLines(stdout), ...splitLines(stderr)].filter((line) => regex.test(line));
}

function runCommand(command, cwd, options = {}) {
  const startedAt = new Date();
  const startedMs = Date.now();
  const child = spawnSync(command, {
    cwd,
    env: options.env || process.env,
    shell: true,
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER_BYTES,
  });
  const endedAt = new Date();

  const status = typeof child.status === 'number' ? child.status : 1;
  const stdout = child.stdout || '';
  const stderr = child.stderr || '';
  const success = status === 0 && !child.error;

  return {
    command,
    cwd,
    startedAt,
    endedAt,
    durationMs: Date.now() - startedMs,
    status,
    stdout,
    stderr,
    success,
    spawnError: child.error ? String(child.error) : '',
  };
}

function recordDiagnostics(exampleName, stepLabel, commandResult) {
  const warnings = extractWarningLines(commandResult.stdout, commandResult.stderr);
  const errors = extractErrorLines(commandResult.stdout, commandResult.stderr);

  for (const warning of warnings) {
    addWarningEntry(exampleName, stepLabel, warning);
  }
  for (const error of errors) {
    addErrorEntry(exampleName, stepLabel, error);
  }
  if (!commandResult.success) {
    const failedLine = `Command failed (exit ${commandResult.status}): ${commandResult.command}`;
    errors.push(failedLine);
    addErrorEntry(exampleName, stepLabel, failedLine);
  }

  return { warnings, errors };
}

function writeCommandLog(exampleName, stepLabel, commandResult, diagnostics) {
  logLine(`\n--- ${exampleName} :: ${stepLabel} ---`);
  logLine(`command: ${commandResult.command}`);
  logLine(`cwd: ${commandResult.cwd}`);
  logLine(`startedAt: ${commandResult.startedAt.toISOString()}`);
  logLine(`endedAt: ${commandResult.endedAt.toISOString()}`);
  logLine(`durationMs: ${commandResult.durationMs}`);
  logLine(`status: ${commandResult.status}`);
  logLine(`success: ${commandResult.success}`);
  if (commandResult.spawnError) {
    logLine(`spawnError: ${commandResult.spawnError}`);
  }

  logLine('\n[stdout]');
  logLine(commandResult.stdout.trim() || '(empty)');

  logLine('\n[stderr]');
  logLine(commandResult.stderr.trim() || '(empty)');

  logLine('\n[extracted warnings]');
  if (diagnostics.warnings.length === 0) {
    logLine('(none)');
  } else {
    for (const warning of diagnostics.warnings) {
      logLine(`- ${warning}`);
    }
  }

  logLine('\n[extracted errors]');
  if (diagnostics.errors.length === 0) {
    logLine('(none)');
  } else {
    for (const error of diagnostics.errors) {
      logLine(`- ${error}`);
    }
  }
}

async function waitForHealth(url, timeoutMs, intervalMs) {
  const startedMs = Date.now();
  let attempts = 0;
  let lastError = 'no attempts';

  while (Date.now() - startedMs <= timeoutMs) {
    attempts++;
    try {
      const res = await fetch(url, { method: 'GET' });
      if (res.ok) {
        return {
          success: true,
          attempts,
          elapsedMs: Date.now() - startedMs,
          statusCode: res.status,
          body: await res.text(),
        };
      }
      lastError = `HTTP ${res.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, intervalMs));
  }

  return {
    success: false,
    attempts,
    elapsedMs: Date.now() - startedMs,
    statusCode: 0,
    body: '',
    lastError,
  };
}

async function runDockerSmoke(exampleName, outputDir, port, provider) {
  const projectName = sanitizeProjectName(exampleName);
  const env = { ...process.env, PORT: String(port) };

  let success = true;
  let healthResult = null;

  try {
    const up = runCommand(
      `docker compose --project-name ${projectName} up --build -d`,
      outputDir,
      { env }
    );
    const upDiagnostics = recordDiagnostics(exampleName, 'docker smoke/up', up);
    writeCommandLog(exampleName, 'docker smoke/up', up, upDiagnostics);
    if (!up.success) {
      success = false;
    }

    if (up.success && provider !== 'sqlite') {
      const dbPush = runCommand(
        `docker compose --project-name ${projectName} exec -T app npx prisma db push --force-reset`,
        outputDir,
        { env }
      );
      const dbPushDiagnostics = recordDiagnostics(exampleName, 'docker smoke/db push', dbPush);
      writeCommandLog(exampleName, 'docker smoke/db push', dbPush, dbPushDiagnostics);
      if (!dbPush.success) {
        success = false;
      }
    }

    if (up.success) {
      const healthUrl = `http://127.0.0.1:${port}/health`;
      healthResult = await waitForHealth(healthUrl, HEALTH_TIMEOUT_MS, HEALTH_POLL_INTERVAL_MS);
      logLine(`\n--- ${exampleName} :: docker smoke/health ---`);
      logLine(`url: ${healthUrl}`);
      logLine(`success: ${healthResult.success}`);
      logLine(`attempts: ${healthResult.attempts}`);
      logLine(`elapsedMs: ${healthResult.elapsedMs}`);
      logLine(`statusCode: ${healthResult.statusCode}`);
      if (healthResult.success) {
        logLine(`[response body]\n${healthResult.body || '(empty)'}`);
      } else {
        const errLine = `Docker health check failed: ${healthResult.lastError || 'unknown error'}`;
        addErrorEntry(exampleName, 'docker smoke/health', errLine);
        logLine(`[health error]\n${errLine}`);
        success = false;

        const logsResult = runCommand(
          `docker compose --project-name ${projectName} logs --no-color --tail 200`,
          outputDir,
          { env }
        );
        const logsDiagnostics = recordDiagnostics(exampleName, 'docker smoke/logs', logsResult);
        writeCommandLog(exampleName, 'docker smoke/logs', logsResult, logsDiagnostics);
      }
    } else {
      const logsResult = runCommand(
        `docker compose --project-name ${projectName} logs --no-color --tail 200`,
        outputDir,
        { env }
      );
      const logsDiagnostics = recordDiagnostics(exampleName, 'docker smoke/logs', logsResult);
      writeCommandLog(exampleName, 'docker smoke/logs', logsResult, logsDiagnostics);
    }
  } catch (error) {
    success = false;
    const msg = error instanceof Error ? error.stack || error.message : String(error);
    addErrorEntry(exampleName, 'docker smoke/unhandled', msg);
    logLine(`\n--- ${exampleName} :: docker smoke/unhandled ---`);
    logLine(msg);
  } finally {
    const down = runCommand(
      `docker compose --project-name ${projectName} down -v --remove-orphans`,
      outputDir,
      { env }
    );
    const downDiagnostics = recordDiagnostics(exampleName, 'docker smoke/down', down);
    writeCommandLog(exampleName, 'docker smoke/down', down, downDiagnostics);
    if (!down.success) {
      success = false;
    }
  }

  if (healthResult && !healthResult.success) {
    success = false;
  }

  return { success, healthResult };
}

let passed = 0;
let failed = 0;
let failedStepsCount = 0;

for (const [index, schema] of schemas.entries()) {
  const name = basename(schema, '.prisma');
  const outputDir = join(outDir, name);
  const schemaPath = join(examplesDir, schema);

  const schemaText = readFileSync(schemaPath, 'utf8');
  const providerMatch = schemaText.match(/provider\s*=\s*["'](\w+)["']/);
  const provider = providerMatch?.[1] ?? 'unknown';

  console.log(`\n  ${name}`);
  logLine(`\n==================== EXAMPLE: ${name} ====================`);
  logLine(`provider: ${provider}`);
  logLine(`schemaPath: ${schemaPath}`);
  logLine(`outputDir: ${outputDir}`);

  let exampleFailedSteps = 0;
  const dockerPort = DOCKER_BASE_PORT + index;

  const steps = [
    {
      label: 'generate',
      run: () => runCommand(
        `node ${cli} generate --schema ${schemaPath} --output ${outputDir}`,
        root
      ),
    },
    {
      label: 'pnpm install',
      run: () => runCommand('pnpm install', outputDir),
    },
    {
      label: 'cp .env',
      run: () => runCommand('cp .env.example .env', outputDir),
    },
    {
      label: 'prisma generate',
      run: () => runCommand('npx prisma generate', outputDir),
    },
    {
      label: 'prisma migrate',
      skip: provider !== 'sqlite'
        ? 'non-sqlite schema sync handled in docker smoke/db push'
        : '',
      run: () => runCommand('npx prisma migrate dev --name init', outputDir),
    },
    {
      label: 'npm run build',
      run: () => runCommand('npm run build', outputDir),
    },
    {
      label: 'npm test',
      run: () => runCommand('npm test', outputDir),
    },
  ];

  for (const step of steps) {
    process.stdout.write(`    ${step.label.padEnd(16)} ... `);

    if (step.skip) {
      console.log(`skipped (${step.skip})`);
      logLine(`\n--- ${name} :: ${step.label} ---`);
      logLine(`status: skipped`);
      logLine(`reason: ${step.skip}`);
      continue;
    }

    const result = step.run();
    const diagnostics = recordDiagnostics(name, step.label, result);
    writeCommandLog(name, step.label, result, diagnostics);

    if (result.success) {
      console.log('ok');
    } else {
      console.log('FAILED');
      const msg = result.stderr.trim() || result.spawnError || `exit code ${result.status}`;
      if (msg) console.error(msg.split('\n').map((l) => `      ${l}`).join('\n'));
      exampleFailedSteps++;
      failedStepsCount++;
    }
  }

  process.stdout.write(`    ${'docker smoke'.padEnd(16)} ... `);
  const dockerResult = await runDockerSmoke(name, outputDir, dockerPort, provider);
  if (dockerResult.success) {
    console.log('ok');
  } else {
    console.log('FAILED');
    const healthErr = dockerResult.healthResult && !dockerResult.healthResult.success
      ? `health failed: ${dockerResult.healthResult.lastError || 'unknown'}`
      : 'docker compose up/down failed';
    console.error(`      ${healthErr}`);
    exampleFailedSteps++;
    failedStepsCount++;
  }

  if (exampleFailedSteps > 0) {
    failed++;
  } else {
    passed++;
  }
}

const runEndedAt = new Date();
logLine('\n==================== SUMMARY ====================');
logLine(`endedAt: ${runEndedAt.toISOString()}`);
logLine(`durationMs: ${runEndedAt.getTime() - runStartedAt.getTime()}`);
logLine(`examplesTotal: ${schemas.length}`);
logLine(`examplesPassed: ${passed}`);
logLine(`examplesFailed: ${failed}`);
logLine(`failedSteps: ${failedStepsCount}`);
logLine(`warningsRaw: ${warningEntriesRaw.length}`);
logLine(`warningsActionable: ${warningEntriesActionable.length}`);
logLine(`errorsRaw: ${errorEntriesRaw.length}`);
logLine(`errorsActionable: ${errorEntriesActionable.length}`);
logLine(`logPath: ${resolve(logPath)}`);

logLine('\n[warning summary actionable]');
if (warningEntriesActionable.length === 0) {
  logLine('(none)');
} else {
  for (const warning of warningEntriesActionable) {
    logLine(`- [${warning.example}] [${warning.step}] ${warning.line}`);
  }
}

logLine('\n[error summary actionable]');
if (errorEntriesActionable.length === 0) {
  logLine('(none)');
} else {
  for (const error of errorEntriesActionable) {
    logLine(`- [${error.example}] [${error.step}] ${error.line}`);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
console.log(`Log file: ${resolve(logPath)}`);
if (failed > 0) process.exit(1);
