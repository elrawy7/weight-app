#!/usr/bin/env node
// FND-05 AC2: block hard-coded UI strings. Flags JSX text and user-visible string attributes in src/**/*.tsx.
import ts from 'typescript';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ATTRS = new Set(['label', 'placeholder', 'title', 'aria-label', 'description', 'alt', 'error', 'confirmLabel', 'body', 'subtitle', 'meta']);
const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.tsx')) files.push(p); } };
walk('src');
const problems = [];
for (const file of files) {
  const src = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const visit = (n) => {
    if (ts.isJsxText(n)) {
      const txt = n.getText().trim();
      // allow pure punctuation/symbols used as separators (·, –, —, ×, “ ”, •, :, /)
      if (/\p{L}/u.test(txt)) problems.push(`${file}:${src.getLineAndCharacterOfPosition(n.getStart()).line + 1}  text: ${JSON.stringify(txt.slice(0, 60))}`);
    }
    if (ts.isJsxAttribute(n) && n.initializer && ts.isStringLiteral(n.initializer) && ATTRS.has(n.name.getText()) && /\p{L}/u.test(n.initializer.text)) {
      problems.push(`${file}:${src.getLineAndCharacterOfPosition(n.getStart()).line + 1}  ${n.name.getText()}="${n.initializer.text}"`);
    }
    ts.forEachChild(n, visit);
  };
  visit(src);
}
if (problems.length) { console.error(`Hard-coded UI strings (use t()):\n${problems.join('\n')}`); process.exit(1); }
console.log(`i18n check: ${files.length} files, 0 hard-coded strings`);
