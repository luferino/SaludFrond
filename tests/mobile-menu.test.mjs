import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const layout = await readFile(new URL('src/layouts/Layout.astro', root), 'utf8');
const mobileRules = layout.match(/@media \(max-width: 760px\) \{([\s\S]*?)\n\t\}/)?.[1] ?? '';

test('signed-in sidebar has a menu button that controls the wrapped navigation', () => {
	assert.match(layout, /<button type="button" class="menu-toggle" aria-expanded="false" aria-controls="sidebar-menu" hidden>Menú<\/button>/);
	const menu = layout.match(/<div id="sidebar-menu" class="sidebar-menu">([\s\S]*?)<\/div>\s*<\/>/)?.[1] ?? '';
	for (const label of ['aria-label="Principal"', 'aria-label="Personas"', 'aria-label="Recepción"', 'aria-label="Atención clínica"', 'aria-label="Académico"', 'aria-labelledby="account-title"']) {
		assert.ok(menu.includes(label), `menu wraps ${label}`);
	}
	// The anonymous sidebar keeps its single login link without a menu button.
	assert.equal(layout.match(/class="menu-toggle"/g)?.length, 1);
	assert.match(layout, /\{isLoggedIn \? \([\s\S]*class="menu-toggle"[\s\S]*\) : currentPath !== '\/auth\/login' && \(/);
});

test('the menu collapses only on narrow screens and only after the script runs', () => {
	assert.match(mobileRules, /\.js-menu \.menu-toggle \{ display: inline-flex; \}/);
	assert.match(mobileRules, /\.js-menu \.sidebar-menu:not\(\.is-open\) \{ display: none; \}/);
	assert.doesNotMatch(layout.replace(mobileRules, ''), /sidebar-menu:not\(\.is-open\)/);
});

test('the menu script toggles the expanded state and closes with Escape', () => {
	const script = layout.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? '';
	assert.match(script, /sidebar\.classList\.add\('js-menu'\);/);
	assert.match(script, /toggle\.hidden = false;/);
	assert.match(script, /toggle\.setAttribute\('aria-expanded', String\(open\)\);/);
	assert.match(script, /menu\.classList\.toggle\('is-open', open\);/);
	assert.match(script, /event\.key === 'Escape'/);
	assert.match(script, /toggle\.focus\(\);/);
});
