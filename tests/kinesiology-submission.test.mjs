import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const pagePath = 'src/pages/kinesiology-evaluations/[id].astro';

// Minimal DOM stand-in: the browser script only needs listeners, flags and text.
function fakeDom() {
 const element = (selector) => ({
  selector, disabled: false, hidden: true, textContent: '', dataset: {}, handlers: {},
  addEventListener(name, callback) { this.handlers[name] = callback; },
  querySelectorAll: () => [],
 });
 const elements = Object.fromEntries(['#evaluation-form', '#submit-form', '#submit-button', '#dirty-notice', '#discard-button', '#studies', '#add-study'].map((selector) => [selector, element(selector)]));
 return { elements, document: { querySelector: (selector) => elements[selector] ?? null } };
}

async function editorScript() {
 const page = await readFile(new URL(pagePath, root), 'utf8');
 const script = page.match(/<script>([\s\S]*?)<\/script>/)?.[1];
 assert.ok(script, 'editor browser script must exist');
 return ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
}

test('dirty guard disables the submit button and shows the saved-version explanation after any form field changes', async () => {
 const dom = fakeDom();
 vm.runInNewContext(await editorScript(), { document: dom.document, window: { location: { pathname: '/kinesiology-evaluations/7', search: '?assignment_id=17', assign: (href) => { dom.discardHref = href; } } } });
 const { '#evaluation-form': form, '#submit-button': button, '#dirty-notice': notice } = dom.elements;
 assert.equal(button.disabled, false);
 assert.equal(notice.hidden, true);
 form.handlers.input();
 assert.equal(button.disabled, true);
 assert.equal(notice.hidden, false);
 const discard = dom.elements['#discard-button'];
 assert.equal(discard.hidden, false);
 discard.handlers.click();
 assert.equal(dom.discardHref, '/kinesiology-evaluations/7?assignment_id=17');
});

test('submit form double-submit guard prevents a second submit event without a second POST', async () => {
 const dom = fakeDom();
 vm.runInNewContext(await editorScript(), { document: dom.document, window: { location: { pathname: '/', search: '', assign() {} } } });
 const { '#submit-form': form, '#submit-button': button } = dom.elements;
 let prevented = 0;
 form.handlers.submit({ preventDefault() { prevented++; } });
 assert.equal(button.disabled, true);
 assert.equal(form.dataset.submitting, 'true');
 form.handlers.submit({ preventDefault() { prevented++; } });
 assert.equal(prevented, 1);
});

test('amend form double-submit guard prevents a second create request', async () => {
 const dom = fakeDom();
 dom.elements['#amend-form'] = { dataset: {}, handlers: {}, addEventListener(name, callback) { this.handlers[name] = callback; } };
 dom.elements['#amend-button'] = { disabled: false, textContent: 'Crear enmienda' };
 vm.runInNewContext(await editorScript(), { document: dom.document, window: { location: { pathname: '/', search: '', assign() {} } } });
 const { '#amend-form': form, '#amend-button': button } = dom.elements;
 let prevented = 0;
 form.handlers.submit({ preventDefault() { prevented++; } });
 assert.equal(button.disabled, true);
 assert.equal(form.dataset.submitting, 'true');
 form.handlers.submit({ preventDefault() { prevented++; } });
 assert.equal(prevented, 1);
});
