#!/usr/bin/env node
// NFR-PERF-05: initial route JS ≤ 350 KB gzip. Measures the entry chunk + its static imports from dist/index.html.
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
const html = readFileSync('dist/index.html', 'utf8');
const refs = [...html.matchAll(/(?:src|href)="\.\/(assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]);
let total = 0;
for (const r of refs) { const n = gzipSync(readFileSync(`dist/${r}`)).length; total += n; console.log(`${(n / 1024).toFixed(1).padStart(7)} KB  ${r}`); }
const kb = total / 1024;
console.log(`initial route: ${kb.toFixed(1)} KB gzip (budget 350 KB)`);
if (kb > 350) process.exit(1);
