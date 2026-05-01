#!/usr/bin/env node

// Reads sync/compat.json and replaces the compatibility table
// between <!-- compat:start --> and <!-- compat:end --> in README.md.
// Must be run from the repo root.

import { readFileSync, writeFileSync } from "fs";

const compat = JSON.parse(readFileSync("sync/compat.json", "utf8"));

const rows = compat.map(({ extension, piMin, piMax }) => {
  const pi = piMin === piMax ? piMin : `${piMin} - ${piMax}`;
  return `| ${extension} | ${pi} |`;
});

const table = [
  "| Extension | pi |",
  "|-----------|-----|",
  ...rows,
].join("\n");

const readme = readFileSync("README.md", "utf8");
const updated = readme.replace(
  /<!-- compat:start -->[\s\S]*?<!-- compat:end -->/,
  `<!-- compat:start -->\n${table}\n<!-- compat:end -->`
);

writeFileSync("README.md", updated);
