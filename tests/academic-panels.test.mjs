import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const pages = ['subjects', 'groups', 'subject-groups', 'teacher-habilitations', 'student-habilitations'];

test('all academic pages opt into the same card geometry without changing form actions', async () => {
 for (const page of pages) {
  const text = await source(`src/pages/${page}.astro`);
  assert.match(text, /import '\.\.\/styles\/academic-panels\.css';/);
  assert.match(text, /<main class="academic-page" aria-labelledby=/);
 }
});

test('academic cards share visible borders, padding and folder tabs with reserved spacing', async () => {
 const css = await source('src/styles/academic-panels.css');
 assert.match(css, /margin-block: 1rem 2rem;/);
 assert.match(css, /padding: clamp\(1\.25rem, 3vw, 2rem\);/);
 assert.match(css, /border: 1px solid var\(--line\);/);
 assert.match(css, /border-top: 5px solid var\(--sage\);/);
 assert.match(css, /inset-block-start: -17px;/);
 assert.match(css, /height: 12px;/);
 assert.match(css, /min-width: 0;/);
 assert.match(css, /\.subject-results > :is\(\.catalog, \.message\) \{ margin-block: 0; \}/);
});

test('subject pagination stays with its list, not in a third grid cell', async () => {
 const text = await source('src/pages/subjects.astro');
 assert.match(text, /<div class="subject-results">\s*<SubjectList[\s\S]*?\/>\s*<\/div>\s*<SubjectForm/);
});
