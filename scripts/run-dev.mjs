import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');


async function getAvailablePort(startPort) {
  return new Promise((resolve, reject) => {
    const tester = net.createServer();

    tester.once('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        resolve(getAvailablePort(startPort + 1));
        return;
      }

      reject(error);
    });

    tester.once('listening', () => {
      const address = tester.address();
      const port = typeof address === 'object' ? address.port : startPort;
      tester.close(() => resolve(port));
    });

    tester.listen(startPort, '127.0.0.1');
  });
}

const processes = [];
let shuttingDown = false;

/**
 * Kills a child and everything it started. On Windows the child is a cmd.exe
 * shell, and killing only the shell leaves node/nodemon/vite orphaned (still
 * holding the ports), so the whole tree is terminated with taskkill /T.
 */
function killTree(proc) {
  if (!proc.pid || proc.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  } else {
    proc.kill('SIGTERM');
  }
}

function shutdownAll(exitCode = 0) {
  shuttingDown = true;
  for (const proc of processes) killTree(proc);
  process.exit(exitCode);
}

function startProcess(label, script, envOverrides = {}) {
  // A single command string (no args array) avoids Node's DEP0190 warning, and
  // a shell is needed on Windows to resolve npm.cmd. `script` is a constant.
  const child = spawn(`npm run ${script}`, {
    cwd: rootDir,
    env: { ...process.env, ...envOverrides },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
    windowsHide: true
  });

  processes.push(child);

  child.stdout.on('data', (chunk) => {
    process.stdout.write(`[${label}] ${chunk}`);
  });

  child.stderr.on('data', (chunk) => {
    process.stderr.write(`[${label}] ${chunk}`);
  });

  child.on('exit', (code, signal) => {
    if (shuttingDown) return;

    if (signal) {
      console.error(`[${label}] exited with signal ${signal}`);
    } else if (code !== 0) {
      console.error(`[${label}] exited with code ${code}`);
    }

    shutdownAll(code ?? 0);
  });

  return child;
}

// API_PORT (not PORT): tools that launch the dev server often set PORT for the frontend.
const apiPort = await getAvailablePort(Number(process.env.API_PORT) || 5000);

startProcess('api', 'dev:server', {
  PORT: String(apiPort)
});

startProcess('web', 'dev:client', {
  VITE_API_PROXY_TARGET: `http://127.0.0.1:${apiPort}`
});

process.on('SIGINT', () => shutdownAll(0));
process.on('SIGTERM', () => shutdownAll(0));
