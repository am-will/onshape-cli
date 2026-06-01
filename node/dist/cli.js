"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.main = main;
async function main(argv) {
    if (argv.includes("--help") || argv.includes("-h") || argv.length === 0) {
        console.log(`onshape

Usage:
  onshape <command> [options]

Commands will be added incrementally to match onshape-cli.
`);
        return;
    }
    console.log(JSON.stringify({ ok: false, error: `Unknown command: ${argv[0]}`, detail: null }, null, 2));
    process.exitCode = 2;
}
