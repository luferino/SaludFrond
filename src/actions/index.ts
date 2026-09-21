import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import {
	handleLogin,
	handleLogout,
	handleRegister,
	handleForgotPassword,
	handleResetPassword,
} from '../pods/auth/actions';
import { handleCreateStudent } from '../pods/student/actions/students';
import { handleCreateTeacher } from '../pods/teacher/actions/teachers';
import { handleCreatePatient } from '../pods/paciente/actions/patients';

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
	createStudent: defineAction({
		accept: 'form',
		input: z.object({
			username: z.string().min(1),
			password: z.string().min(10),
			nombres: z.string().min(1),
			apellidos: z.string().min(1),
			codalumno: z.string().min(1),
			email: z.string().optional(),
			celular: z.string().optional(),
		}),
		handler: handleCreateStudent,
	}),
	createTeacher: defineAction({
		accept: 'form',
		input: z.object({
			username: z.string().min(1),
			password: z.string().min(10),
			nombres: z.string().min(1),
			apellidos: z.string().min(1),
			email: z.string().optional(),
			celular: z.string().optional(),
		}),
		handler: handleCreateTeacher,
	}),
	createPatient: defineAction({
		accept: 'form',
		input: z.object({
			documento: z.string().min(1),
			nombres: z.string().min(1),
			apellidos: z.string().min(1),
			fecha_nacimiento: z.string().min(1),
			email: z.string().min(1),
			celular: z.string().min(1),
			sexo: z.string().min(1),
			direccion: z.string().min(1),
		}),
		handler: handleCreatePatient,
	}),
};
