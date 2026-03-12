#!/usr/bin/env node
import { spawnSync } from 'child_process';
import { randomBytes } from 'crypto';
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
const HEALTH_TIMEOUT_MS = 9_000;
const HEALTH_POLL_INTERVAL_MS = 1_000;
const DOCKER_BASE_PORT = 3_000;
const FRAMEWORKS = ['express', 'fastify'];

function printUsageAndExit(message) {
  if (message) {
    console.error(message);
  }
  console.error('Usage: node scripts/run-examples.js [--framework <express|fastify|both>]');
  console.error('       node scripts/run-examples.js [-f <express|fastify|both>]');
  process.exit(1);
}

function parseFrameworkArg(argv) {
  let frameworkSelection = 'both';

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--framework' || arg === '-f') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) {
        printUsageAndExit(`Missing value for ${arg}`);
      }
      frameworkSelection = value.toLowerCase();
      i += 1;
      continue;
    }
    if (arg.startsWith('--framework=')) {
      frameworkSelection = arg.slice('--framework='.length).toLowerCase();
      continue;
    }
    printUsageAndExit(`Unknown argument: ${arg}`);
  }

  if (frameworkSelection === 'both') {
    return [...FRAMEWORKS];
  }
  if (FRAMEWORKS.includes(frameworkSelection)) {
    return [frameworkSelection];
  }
  printUsageAndExit(
    `Invalid framework "${frameworkSelection}". Expected one of: express, fastify, both.`
  );
}

const selectedFrameworks = parseFrameworkArg(process.argv.slice(2));

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
logLine(`frameworks: ${selectedFrameworks.join(', ')}`);
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

function formatFetchError(error) {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause instanceof Error ? error.cause.message : '';
  return cause ? `${error.message}: ${cause}` : error.message;
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
      lastError = formatFetchError(error);
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

function patchEnvSecrets(envPath) {
  const startedAt = new Date();
  const startedMs = Date.now();
  try {
    let content = readFileSync(envPath, 'utf8');

    const jwtLine = content.match(/^JWT_SECRET=.*$/m)?.[0] ?? '';
    const needsSecret = !jwtLine || /change-me/i.test(jwtLine);

    if (needsSecret) {
      const secret = randomBytes(48).toString('base64');
      if (/^JWT_SECRET=/m.test(content)) {
        content = content.replace(/^JWT_SECRET=.*$/m, `JWT_SECRET="${secret}"`);
      } else {
        content += `\nJWT_SECRET="${secret}"\n`;
      }
      writeFileSync(envPath, content, 'utf8');
    }

    return {
      command: `patchEnvSecrets(${envPath})`,
      cwd: dirname(envPath),
      startedAt,
      endedAt: new Date(),
      durationMs: Date.now() - startedMs,
      status: 0,
      stdout: needsSecret ? 'JWT_SECRET injected' : 'JWT_SECRET already set',
      stderr: '',
      success: true,
      spawnError: '',
    };
  } catch (error) {
    return {
      command: `patchEnvSecrets(${envPath})`,
      cwd: dirname(envPath),
      startedAt,
      endedAt: new Date(),
      durationMs: Date.now() - startedMs,
      status: 1,
      stdout: '',
      stderr: String(error),
      success: false,
      spawnError: '',
    };
  }
}

function summarizeCommandFailure(commandResult, diagnostics) {
  const actionableError = diagnostics.errors.find(
    (line) => !/Command failed \(exit/i.test(normalizeLine(line))
  );
  if (actionableError) {
    return normalizeLine(actionableError);
  }

  const lines = [...splitLines(commandResult.stderr), ...splitLines(commandResult.stdout)];
  const lastLine = lines.at(-1);
  return lastLine ? normalizeLine(lastLine) : '';
}

async function runDockerSmoke(exampleName, framework, outputDir, port, provider, dbPort, redisPort) {
  const projectName = sanitizeProjectName(`${exampleName}_${framework}`);
  const exampleLabel = `${exampleName} [${framework}]`;
  const env = { ...process.env, PORT: String(port), DB_PORT: String(dbPort), REDIS_PORT: String(redisPort) };

  let success = true;
  let healthResult = null;
  let failureSummary = '';

  try {
    const up = runCommand(
      `docker compose --project-name ${projectName} up --build -d`,
      outputDir,
      { env }
    );
    const upDiagnostics = recordDiagnostics(exampleLabel, 'docker smoke/up', up);
    writeCommandLog(exampleLabel, 'docker smoke/up', up, upDiagnostics);
    if (!up.success) {
      success = false;
      failureSummary = summarizeCommandFailure(up, upDiagnostics);
    }

    if (up.success) {
      const healthUrl = `http://localhost:${port}/health`;
      healthResult = await waitForHealth(healthUrl, HEALTH_TIMEOUT_MS, HEALTH_POLL_INTERVAL_MS);
      logLine(`\n--- ${exampleLabel} :: docker smoke/health ---`);
      logLine(`url: ${healthUrl}`);
      logLine(`success: ${healthResult.success}`);
      logLine(`attempts: ${healthResult.attempts}`);
      logLine(`elapsedMs: ${healthResult.elapsedMs}`);
      logLine(`statusCode: ${healthResult.statusCode}`);
      if (healthResult.success) {
        logLine(`[response body]\n${healthResult.body || '(empty)'}`);
      } else {
        const errLine = `Docker health check failed: ${healthResult.lastError || 'unknown error'}`;
        addErrorEntry(exampleLabel, 'docker smoke/health', errLine);
        logLine(`[health error]\n${errLine}`);
        success = false;

        const logsResult = runCommand(
          `docker compose --project-name ${projectName} logs --no-color --tail 200`,
          outputDir,
          { env }
        );
        const logsDiagnostics = recordDiagnostics(exampleLabel, 'docker smoke/logs', logsResult);
        writeCommandLog(exampleLabel, 'docker smoke/logs', logsResult, logsDiagnostics);
        failureSummary = summarizeCommandFailure(logsResult, logsDiagnostics) || failureSummary;
      }
    } else {
      const logsResult = runCommand(
        `docker compose --project-name ${projectName} logs --no-color --tail 200`,
        outputDir,
        { env }
      );
      const logsDiagnostics = recordDiagnostics(exampleLabel, 'docker smoke/logs', logsResult);
      writeCommandLog(exampleLabel, 'docker smoke/logs', logsResult, logsDiagnostics);
      failureSummary = summarizeCommandFailure(logsResult, logsDiagnostics) || failureSummary;
    }

    if (up.success && success && healthResult?.success) {
      const seed = runCommand(
        `docker compose --project-name ${projectName} exec -T app npm run seed`,
        outputDir,
        { env }
      );
      const seedDiagnostics = recordDiagnostics(exampleLabel, 'docker smoke/seed', seed);
      writeCommandLog(exampleLabel, 'docker smoke/seed', seed, seedDiagnostics);
      if (!seed.success) {
        success = false;
        failureSummary = summarizeCommandFailure(seed, seedDiagnostics) || failureSummary;
      }
    }
  } catch (error) {
    success = false;
    const msg = error instanceof Error ? error.stack || error.message : String(error);
    addErrorEntry(exampleLabel, 'docker smoke/unhandled', msg);
    logLine(`\n--- ${exampleLabel} :: docker smoke/unhandled ---`);
    logLine(msg);
    failureSummary = normalizeLine(msg);
  } finally {
    const down = runCommand(
      `docker compose --project-name ${projectName} down -v --remove-orphans`,
      outputDir,
      { env }
    );
    const downDiagnostics = recordDiagnostics(exampleLabel, 'docker smoke/down', down);
    writeCommandLog(exampleLabel, 'docker smoke/down', down, downDiagnostics);
    if (!down.success) {
      success = false;
    }
  }

  if (healthResult && !healthResult.success) {
    success = false;
  }

  return { success, healthResult, failureSummary };
}

let matrixPassed = 0;
let matrixFailed = 0;
let failedStepsCount = 0;
const matrixRuns = schemas.length * selectedFrameworks.length;
let matrixIndex = 0;
const examplesWithFailures = new Set();

for (const schema of schemas) {
  const name = basename(schema, '.prisma');
  const schemaPath = join(examplesDir, schema);

  const schemaText = readFileSync(schemaPath, 'utf8');
  const providerMatch = schemaText.match(/provider\s*=\s*["'](\w+)["']/);
  const provider = providerMatch?.[1] ?? 'unknown';
  
  for (const framework of selectedFrameworks) {
    const outputDir = join(outDir, name, framework);
    const matrixLabel = `${name} [${framework}]`;
    const dockerPort = DOCKER_BASE_PORT + matrixIndex;
    const dbPort = DOCKER_BASE_PORT + 2000 + matrixIndex;
    const redisPort = DOCKER_BASE_PORT + 3000 + matrixIndex;
    matrixIndex += 1;

    console.log(`\n  ${matrixLabel}`);
    logLine(`\n==================== EXAMPLE: ${matrixLabel} ====================`);
    logLine(`provider: ${provider}`);
    logLine(`schemaPath: ${schemaPath}`);
    logLine(`framework: ${framework}`);
    logLine(`outputDir: ${outputDir}`);
    logLine(`dockerPort: ${dockerPort}`);

    let matrixRunFailedSteps = 0;

    const steps = [
      {
        label: 'generate',
        run: () => runCommand(
          `node ${cli} generate --schema ${schemaPath} --output ${outputDir} --framework ${framework}`,
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
        label: 'patch .env',
        run: () => patchEnvSecrets(join(outputDir, '.env')),
      },
      {
        label: 'prisma generate',
        run: () => runCommand('npx prisma generate', outputDir),
      },
      {
        label: 'prisma sync',
        skip: provider !== 'sqlite'
          ? 'non-sqlite schema sync handled by container bootstrap'
          : '',
        run: () => runCommand('npx prisma db push', outputDir),
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
        logLine(`\n--- ${matrixLabel} :: ${step.label} ---`);
        logLine('status: skipped');
        logLine(`reason: ${step.skip}`);
        continue;
      }

      const result = step.run();
      const diagnostics = recordDiagnostics(matrixLabel, step.label, result);
      writeCommandLog(matrixLabel, step.label, result, diagnostics);

      if (result.success) {
        console.log('ok');
      } else {
        console.log('FAILED');
        const msg = result.stderr.trim() || result.spawnError || `exit code ${result.status}`;
        if (msg) console.error(msg.split('\n').map((l) => `      ${l}`).join('\n'));
        matrixRunFailedSteps++;
        failedStepsCount++;
      }
    }

    process.stdout.write(`    ${'docker smoke'.padEnd(16)} ... `);
    const dockerResult = await runDockerSmoke(name, framework, outputDir, dockerPort, provider, dbPort, redisPort);
    if (dockerResult.success) {
      console.log('ok');
    } else {
      console.log('FAILED');
      const healthErr = dockerResult.healthResult && !dockerResult.healthResult.success
        ? `health failed: ${dockerResult.healthResult.lastError || 'unknown'}`
        : 'docker compose up/down failed';
      console.error(`      ${healthErr}`);
      if (dockerResult.failureSummary) {
        console.error(`      cause: ${dockerResult.failureSummary}`);
      }
      matrixRunFailedSteps++;
      failedStepsCount++;
    }

    if (matrixRunFailedSteps > 0) {
      matrixFailed++;
      examplesWithFailures.add(name);
    } else {
      matrixPassed++;
    }
  }
}

const runEndedAt = new Date();
logLine('\n==================== SUMMARY ====================');
logLine(`endedAt: ${runEndedAt.toISOString()}`);
logLine(`durationMs: ${runEndedAt.getTime() - runStartedAt.getTime()}`);
logLine(`examplesTotal: ${schemas.length}`);
logLine(`frameworksSelected: ${selectedFrameworks.join(', ')}`);
logLine(`matrixRunsTotal: ${matrixRuns}`);
logLine(`matrixRunsPassed: ${matrixPassed}`);
logLine(`matrixRunsFailed: ${matrixFailed}`);
logLine(`examplesFailed: ${examplesWithFailures.size}`);
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

console.log(`\nframeworks: ${selectedFrameworks.join(', ')}`);
console.log(`${matrixPassed} passed, ${matrixFailed} failed (matrix runs)`);
console.log(`${examplesWithFailures.size} examples with at least one framework failure`);
console.log(`Log file: ${resolve(logPath)}`);
if (matrixFailed > 0) process.exit(1);
