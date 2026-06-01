"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CliError = void 0;
exports.emit = emit;
exports.emitError = emitError;
function emit(result) {
    console.log(JSON.stringify({ ok: true, result }, null, 2));
}
function emitError(error, detail = null) {
    console.log(JSON.stringify({ ok: false, error, detail }, null, 2));
}
class CliError extends Error {
    detail;
    exitCode;
    constructor(message, detail = null, exitCode = 1) {
        super(message);
        this.name = "CliError";
        this.detail = detail;
        this.exitCode = exitCode;
    }
}
exports.CliError = CliError;
