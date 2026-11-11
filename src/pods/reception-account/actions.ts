import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { ApiError } from '../../shared/apiClient';
import { createReceptionAccount as createAccount, createReceptionRoleGrant as createRoleGrant, grantReceptionCareer as grantCareer, isReceptionCareer, revokeReceptionCareerGrant as revokeGrant, revokeReceptionRoleGrant as revokeRoleGrant } from './api';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidField = () => z.string().trim().regex(UUID);

const CREATE_CONFLICT = 'El nombre de usuario o el correo ya están registrados.';
const GRANT_CONFLICT = 'La cuenta ya tiene un acceso activo para esta carrera.';
const REVOKE_CONFLICT = 'El acceso ya no está disponible para revocar.';
const ROLE_NOT_FOUND = 'No se encontró el estudiante o el rol indicado.';
const ROLE_CONFLICT = 'El estudiante ya tiene el rol de Recepción activo.';
// Role revocation is idempotent; an unexpected 409 is reported as a generic failure, never as a revocation.
const UNEXPECTED_FAILURE = 'No se pudo completar la operación. Probá de nuevo más tarde.';

function publicError(error: unknown, conflict: string, notFound = 'No se encontró la cuenta, la carrera o el acceso indicado.'): string {
	if (error instanceof ApiError) {
		if (error.status === 400) return 'Revisá los datos ingresados e intentá nuevamente.';
		if (error.status === 401) return 'Tu sesión venció. Iniciá sesión nuevamente.';
		if (error.status === 403) return 'Tu sesión no tiene permiso para realizar esta operación.';
		if (error.status === 404) return notFound;
		if (error.status === 409) return conflict;
	}
	return 'No se pudo completar la operación. Probá de nuevo más tarde.';
}

export async function handleCreateReceptionAccount(input: Record<string, unknown>, context: { cookies: import('astro').AstroCookies }) {
	const username = typeof input.username === 'string' ? input.username.trim() : '';
	const email = typeof input.email === 'string' ? input.email.trim() : '';
	const password = typeof input.password === 'string' ? input.password : '';
	if (!username || !email || !password) {
		return { success: false as const, error: 'Completá el nombre de usuario, el correo y la contraseña.' };
	}
	try {
		const account = await createAccount({ username, password, email }, context.cookies);
		return { success: true as const, account };
	} catch (error) {
		return { success: false as const, error: publicError(error, CREATE_CONFLICT) };
	}
}

export async function handleGrantReceptionCareer(input: Record<string, unknown>, context: { cookies: import('astro').AstroCookies }) {
	const accountId = typeof input.account_id === 'string' ? input.account_id.trim() : '';
	const career = typeof input.career === 'string' ? input.career : '';
	if (!UUID.test(accountId) || !isReceptionCareer(career)) {
		return { success: false as const, error: 'Seleccioná una cuenta válida y una carrera.' };
	}
	try {
		const grant = await grantCareer(accountId, career, context.cookies);
		return { success: true as const, grant };
	} catch (error) {
		return { success: false as const, error: publicError(error, GRANT_CONFLICT) };
	}
}

export async function handleRevokeReceptionCareerGrant(input: Record<string, unknown>, context: { cookies: import('astro').AstroCookies }) {
	const id = typeof input.id === 'string' ? input.id.trim() : '';
	if (!UUID.test(id) || input.confirm !== 'yes') {
		return { success: false as const, id, error: !UUID.test(id) ? 'Seleccioná un acceso válido.' : 'Confirmá explícitamente la revocación para continuar.' };
	}
	try {
		const grant = await revokeGrant(id, context.cookies);
		return { success: true as const, id, grant };
	} catch (error) {
		return { success: false as const, id, error: publicError(error, REVOKE_CONFLICT) };
	}
}

export async function handleGrantReceptionRole(input: Record<string, unknown>, context: { cookies: import('astro').AstroCookies }) {
	const studentId = typeof input.student_id === 'string' ? input.student_id.trim() : '';
	if (!UUID.test(studentId)) return { success: false as const, error: 'Seleccioná un estudiante válido.' };
	try {
		const grant = await createRoleGrant(studentId, context.cookies);
		return { success: true as const, grant };
	} catch (error) {
		return { success: false as const, error: publicError(error, ROLE_CONFLICT, ROLE_NOT_FOUND) };
	}
}

export async function handleRevokeReceptionRole(input: Record<string, unknown>, context: { cookies: import('astro').AstroCookies }) {
	const id = typeof input.id === 'string' ? input.id.trim() : '';
	if (!UUID.test(id) || input.confirm !== 'yes') {
		return { success: false as const, id, error: !UUID.test(id) ? 'Seleccioná una Recepción válida.' : 'Confirmá explícitamente la revocación para continuar.' };
	}
	try {
		const grant = await revokeRoleGrant(id, context.cookies);
		return { success: true as const, id, grant };
	} catch (error) {
		return { success: false as const, id, error: publicError(error, UNEXPECTED_FAILURE, ROLE_NOT_FOUND) };
	}
}

export const createReceptionAccount = defineAction({
	accept: 'form',
	input: z.object({ username: z.string().trim().min(1), password: z.string().min(1), email: z.string().trim().min(1) }),
	handler: handleCreateReceptionAccount,
});

export const grantReceptionCareer = defineAction({
	accept: 'form',
	input: z.object({ account_id: uuidField(), career: z.enum(['kinesiology', 'odontology']) }),
	handler: handleGrantReceptionCareer,
});

export const revokeReceptionCareerGrant = defineAction({
	accept: 'form',
	input: z.object({ id: uuidField(), confirm: z.string().optional() }),
	handler: handleRevokeReceptionCareerGrant,
});

export const grantReceptionRole = defineAction({
	accept: 'form',
	input: z.object({ student_id: uuidField() }),
	handler: handleGrantReceptionRole,
});

export const revokeReceptionRole = defineAction({
	accept: 'form',
	input: z.object({ id: uuidField(), confirm: z.string().optional() }),
	handler: handleRevokeReceptionRole,
});
