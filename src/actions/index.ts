import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import {
	handleLogin,
	handleLogout,
	handleRegister,
	handleForgotPassword,
	handleResetPassword,
} from '../pods/auth/actions';

export const server = {
	login: defineAction({
		accept: 'form',
		input: z.object({
			username: z.string().min(1),
			password: z.string().min(1),
			returnTo: z.string().optional(),
		}),
		handler: handleLogin,
	}),
	logout: defineAction({
		accept: 'form',
		handler: handleLogout,
	}),
	register: defineAction({
		accept: 'form',
		input: z.object({
			username: z.string().min(1),
			email: z.string().min(1),
			password: z.string().min(1),
		}),
		handler: handleRegister,
	}),
	forgotPassword: defineAction({
		accept: 'form',
		input: z.object({
			username: z.string().min(1),
		}),
		handler: handleForgotPassword,
	}),
	resetPassword: defineAction({
		accept: 'form',
		input: z.object({
			token: z.string().min(1),
			newPassword: z.string().min(10),
		}),
		handler: handleResetPassword,
	}),
};
