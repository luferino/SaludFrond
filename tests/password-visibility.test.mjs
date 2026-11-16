import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const source = (path) => readFile(new URL(path, root), 'utf8');
const componentPath = 'src/components/PasswordToggle.astro';

const forms = [
	['src/pods/auth/components/LoginForm.astro', 'password', '../../../components/PasswordToggle.astro'],
	['src/pods/student/components/StudentForm.astro', 'password', '../../../components/PasswordToggle.astro'],
	['src/pods/teacher/components/TeacherForm.astro', 'password', '../../../components/PasswordToggle.astro'],
	['src/pods/auth/components/RegisterForm.astro', 'password', '../../../components/PasswordToggle.astro'],
	['src/pods/auth/components/ResetPasswordForm.astro', 'newPassword', '../../../components/PasswordToggle.astro'],
	['src/pages/reception-accounts.astro', 'account-password', '../components/PasswordToggle.astro'],
];

test('every password field is wrapped with a visibility toggle bound to its own input', async () => {
	for (const [path, id, importPath] of forms) {
		const form = await source(path);
		assert.equal(form.match(/type="password"/g)?.length, 1, `${path} keeps one password input`);
		assert.ok(form.includes(`import PasswordToggle from '${importPath}';`), `${path} imports the toggle`);
		const control = form.match(/<div class="password-control">\s*(<input\b[^>]*\/>)\s*<PasswordToggle for="([^"]+)" \/>\s*<\/div>/);
		assert.ok(control, `${path} wraps the password input with the toggle`);
		assert.match(control[1], new RegExp(`\\bid="${id}"`), `${path} wraps the password input`);
		assert.match(control[1], /\btype="password"/, `${path} keeps the input hidden by default`);
		assert.equal(control[2], id, `${path} binds the toggle to its own input`);
	}
});

test('the toggle is a non-submitting pressed button with a stable accessible name', async () => {
	const component = await source(componentPath);
	assert.match(component, /interface Props \{ for: string \}/);
	const button = component.match(/<button\b[^>]*>/)?.[0] ?? '';
	assert.match(button, /type="button"/);
	assert.match(button, /aria-controls=\{target\}/);
	assert.match(button, /aria-pressed="false"/);
	assert.match(button, /aria-label="Mostrar contraseña"/);
	assert.match(button, /data-password-toggle/);
	// Hidden until the script runs, so a browser without JavaScript never shows a dead control.
	assert.match(button, /\bhidden\b/);
});

test('the toggle script switches the input type and pressed state and hides the password again on submit', async () => {
	const component = await source(componentPath);
	const script = component.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? '';
	assert.match(script, /querySelectorAll<HTMLButtonElement>\('\[data-password-toggle\]'\)/);
	assert.match(script, /button\.hidden = false;/);
	assert.match(script, /input\.type = visible \? 'text' : 'password';/);
	assert.match(script, /button\.setAttribute\('aria-pressed', String\(visible\)\);/);
	assert.match(script, /input\.form\?\.addEventListener\('submit', \(\) => setVisible\(false\)\);/);
});
