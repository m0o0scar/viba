#!/usr/bin/env node
// Finds a free port starting from BASE_PORT (default 3000) and prints it to stdout.
// If extra args are provided after '--', spawns that command with {PORT} replaced by the found port.
//
// Usage (standalone):   node scripts/find-port.js [basePort]
// Usage (with command): node scripts/find-port.js [basePort] -- <cmd> [args...]
//   e.g. node scripts/find-port.js 3000 -- next dev --webpack -p {PORT}

const net = require('net');
const { spawn } = require('child_process');

const separatorIndex = process.argv.indexOf('--');
const scriptArgs = separatorIndex === -1 ? process.argv.slice(2) : process.argv.slice(2, separatorIndex);
const commandArgs = separatorIndex === -1 ? [] : process.argv.slice(separatorIndex + 1);

const BASE_PORT = parseInt(scriptArgs[0] ?? '3000', 10);

function findFreePort(port) {
    return new Promise((resolve) => {
        const server = net.createServer();
        server.listen(port, () => {
            server.close(() => resolve(port));
        });
        server.on('error', () => resolve(findFreePort(port + 1)));
    });
}

findFreePort(BASE_PORT).then((port) => {
    if (commandArgs.length === 0) {
        // Standalone mode: just print the port
        process.stdout.write(String(port));
        return;
    }

    // Command mode: replace {PORT} placeholder in args, then spawn
    const [cmd, ...args] = commandArgs.map((arg) => arg.replace('{PORT}', String(port)));
    console.log(`Found free port ${port}. Running: ${cmd} ${args.join(' ')}`);

    const child = spawn(cmd, args, { stdio: 'inherit', shell: true });
    child.on('exit', (code) => process.exit(code ?? 0));
});
