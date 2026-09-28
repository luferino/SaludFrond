import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const source = (path) => readFile(new URL(path, root), 'utf8');
const layoutPath = 'src/layouts/Layout.astro';

const tokens = {
	'--sage': '#bac3b0',
	'--sage-soft': '#e5eadf',
	'--rust-deep': '#843b28',
	'--rust-soft': '#fae8df',
	'--rust-line': '#b97560',
	'--field': '#fffdf8',
	'--field-line': '#a49985',
};

const tokenBlock = (layout) => layout.match(/:global\(:root\)\s*\{[^}]*\}/)?.[0] ?? '';

async function sourceFiles(dir = 'src/') {
	const entries = await readdir(new URL(dir, root), { withFileTypes: true });
	const nested = await Promise.all(entries.map((entry) => {
		const path = `${dir}${entry.name}`;
		if (entry.isDirectory()) return sourceFiles(`${path}/`);
		return /\.(astro|css|ts|mjs)$/.test(entry.name) ? [path] : [];
	}));
	return nested.flat();
}

test('Layout defines the shared palette tokens in its root token block', async () => {
	const block = tokenBlock(await source(layoutPath));
	for (const [name, value] of Object.entries(tokens)) {
		assert.match(block, new RegExp(`${name}:\\s*${value};`, 'i'), `${name} must be ${value}`);
	}
});

test('no source file hardcodes a palette color outside the Layout token block', async () => {
	const hardcoded = new RegExp(Object.values(tokens).join('|'), 'i');
	for (const path of await sourceFiles()) {
		let text = await source(path);
		if (path === layoutPath) text = text.replace(tokenBlock(text), '');
		assert.doesNotMatch(text, hardcoded, `${path} must use the palette tokens`);
	}
});
