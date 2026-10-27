import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import {
	handleLogin,
	handleLogout,
	handleRegister,
	handleForgotPassword,
	handleResetPassword,
} from '../pods/auth/actions';
import { handleCreateSubject } from '../pods/subject/actions/subjects';
import { handleCreateGroup } from '../pods/group/actions/groups';
import { handleCreateSubjectGroup } from '../pods/subject-group/actions/subject-groups';
import { handleCreateStudent } from '../pods/student/actions/students';
import { handleCreateTeacher } from '../pods/teacher/actions/teachers';
import { handleCreatePatient } from '../pods/paciente/actions/patients';
import { activateTeacherHabilitation, revokeTeacherHabilitation } from '../pods/teacher-habilitation/actions';
import { activateStudentHabilitation, revokeStudentHabilitation } from '../pods/student-habilitation/actions';
import { handleCreateKinesiologyEvaluation, handleUpdateKinesiologyEvaluation } from '../pods/kinesiology-evaluation/actions/evaluations';

import { searchAvailablePatient, enablePatientAvailability, withdrawPatientAvailability } from '../pods/patient-availability/actions';
import { createTeacherAssignment } from '../pods/teacher-assignment/actions';

export const server = {
	searchAvailablePatient,
	enablePatientAvailability,
	withdrawPatientAvailability,
	createTeacherAssignment,
	activateTeacherHabilitation,
	revokeTeacherHabilitation,
	activateStudentHabilitation,
	revokeStudentHabilitation,
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
	createSubject: defineAction({
		accept: 'form',
		input: z.object({ name: z.string().trim().min(1) }),
		handler: handleCreateSubject,
	}),
	createGroup: defineAction({
		accept: 'form',
		input: z.object({
			academic_year: z.preprocess(
				(value) => typeof value === 'string' && /^[0-9]+$/.test(value) ? Number(value) : value,
				z.number().int().min(1).max(2_147_483_647),
			),
			curriculum_semester: z.preprocess(
				(value) => typeof value === 'string' && /^[0-9]+$/.test(value) ? Number(value) : value,
				z.number().int().min(1).max(2_147_483_647),
			),
			name: z.string().trim().min(1),
		}),
		handler: handleCreateGroup,
	}),
	createSubjectGroup: defineAction({
		accept: 'form',
		input: z.object({
			subject_id: z.string().trim().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
			academic_group_id: z.string().trim().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
		}),
		handler: handleCreateSubjectGroup,
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
	createKinesiologyEvaluation: defineAction({
		accept: 'form',
		input: z.object({
			patient_id: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
			subject_id: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
			academic_group_id: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
			assignment_id: z.string(), limit: z.string(), offset: z.string(), content: z.any(),
		}).strict(),
		handler: handleCreateKinesiologyEvaluation,
	}),
	updateKinesiologyEvaluation: defineAction({
		accept: 'form',
		input: z.object({
			id: z.string().regex(/^[1-9]\d{0,18}$/), assignment_id: z.string(), limit: z.string(), offset: z.string(),
			admission_date: z.string().optional(), admission_status: z.string().optional(), occupation: z.string().optional(),
			referring_physician: z.string().optional(), 'antecedent-hta': z.string().optional(),
			'antecedent-dbt': z.string().optional(), 'antecedent-diu': z.string().optional(),
			'antecedent-sedentary_lifestyle': z.string().optional(), 'antecedent-pacemaker': z.string().optional(),
			'antecedent-other': z.string().optional(), antecedents_keys: z.string().optional(), illness_history: z.string().optional(),
			medical_diagnosis: z.string().optional(), kinesiology_diagnosis: z.string().optional(),
			objectives: z.string().optional(), proposed_treatment: z.string().optional(),
		}).catchall(z.string()),

		handler: handleUpdateKinesiologyEvaluation,
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
