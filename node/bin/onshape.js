#!/usr/bin/env node
"use strict";

const { main } = require("../dist/cli");

main(process.argv.slice(2)).catch((error) => {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.log(JSON.stringify({ ok: false, error: message, detail: null }, null, 2));
  process.exit(1);
});
