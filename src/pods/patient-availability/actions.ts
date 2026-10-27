import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { ApiError, apiFetch } from '../../shared/apiClient';
import { isPatientPeriod, UUID_PATTERN } from './api';
const uuid=z.string().regex(UUID_PATTERN);
const pair=z.string().regex(new RegExp(`^${UUID_PATTERN.source.slice(1,-1)}\\|${UUID_PATTERN.source.slice(1,-1)}$`,'i'));
const publicError=(error:unknown,operation:string)=>{
 if(error instanceof ApiError){if(error.status===400)return 'Revisá los datos seleccionados e intentá nuevamente.';if(error.status===401)return 'Tu sesión venció. Iniciá sesión nuevamente.';if(error.status===403)return 'No tenés permiso para administrar la disponibilidad de pacientes.';if(error.status===404)return 'No se encontró el paciente o el contexto académico indicado.';if(error.status===409)return error.message==='patient is already available in this context'?'El paciente ya está habilitado en este contexto.':'El período cambió y no se pudo completar la operación.';}
 return `No se pudo ${operation}. Probá de nuevo más tarde.`;
};
export async function handleSearchAvailablePatient(input:Record<string,unknown>,context:{cookies:import('astro').AstroCookies}){
 const documento=typeof input.documento==='string'?input.documento.trim():'';
 if(!documento)return{success:false as const,error:'Ingresá el documento exacto del paciente.',patients:[],documento};
 try{const response=await apiFetch<unknown>('/patient-availabilities/patient-search',{method:'POST',body:{documento},cookies:context.cookies});if(!response||typeof response!=='object'||!Array.isArray((response as any).items)||(response as any).items.some((p:any)=>!p||typeof p.patient_id!=='string'||!UUID_PATTERN.test(p.patient_id)||typeof p.nombres!=='string'||!p.nombres.trim()||typeof p.apellidos!=='string'||!p.apellidos.trim()))return{success:false as const,error:'El servicio devolvió resultados incompletos.',patients:[],documento};return{success:true as const,patients:(response as any).items,documento};}
 catch(error){return{success:false as const,error:publicError(error,'buscar el paciente'),patients:[],documento,unauthorized:error instanceof ApiError&&error.status===401};}
}
export async function handleEnablePatientAvailability(input:Record<string,unknown>,context:{cookies:import('astro').AstroCookies}){
 const patientId=typeof input.patient_id==='string'?input.patient_id:'';const pairValue=typeof input.context_pair==='string'?input.context_pair:'';const contextPair=pairValue.match(new RegExp(`^(${UUID_PATTERN.source.slice(1,-1)})\\|(${UUID_PATTERN.source.slice(1,-1)})$`,'i'));
 if(!UUID_PATTERN.test(patientId)||!contextPair)return{success:false as const,error:'Seleccioná un paciente y un contexto vinculado válidos.',patientId:UUID_PATTERN.test(patientId)?patientId:'',contextPair:''};
 const subjectId=contextPair[1],groupId=contextPair[2];
 try{const period=await apiFetch<unknown>('/patient-availabilities',{method:'POST',body:{patient_id:patientId,subject_id:subjectId,academic_group_id:groupId},cookies:context.cookies});if(!isPatientPeriod(period)||period.withdrawn_at!==null||period.withdrawn_by!==null||period.patient_id.toLowerCase()!==patientId.toLowerCase()||period.subject_id.toLowerCase()!==subjectId.toLowerCase()||period.academic_group_id.toLowerCase()!==groupId.toLowerCase())return{success:false as const,error:'El servicio devolvió datos incompletos o inconsistentes del período.',patientId,contextPair:pairValue};return{success:true as const,patientId,contextPair:pairValue,period};}
 catch(error){return{success:false as const,error:publicError(error,'habilitar el período'),patientId,contextPair:pairValue,unauthorized:error instanceof ApiError&&error.status===401};}
}
export async function handleWithdrawPatientAvailability(input:Record<string,unknown>,context:{cookies:import('astro').AstroCookies}){
 const id=typeof input.id==='string'?input.id:'';const patientId=typeof input.patient_id==='string'&&UUID_PATTERN.test(input.patient_id)?input.patient_id:'';if(!UUID_PATTERN.test(id)||input.confirm_consequences!=='yes')return{success:false as const,error:'Confirmá el retiro y sus consecuencias para continuar.',patientId};
 try{const period=await apiFetch<unknown>(`/patient-availabilities/${id}/withdraw`,{method:'POST',cookies:context.cookies});if(!isPatientPeriod(period)||period.id.toLowerCase()!==id.toLowerCase()||period.withdrawn_at===null||period.withdrawn_by===null)return{success:false as const,error:'El servicio devolvió datos incompletos o inconsistentes del período retirado.',patientId};return{success:true as const,period,patientId:period.patient_id};}
 catch(error){return{success:false as const,error:publicError(error,'retirar el período'),patientId,unauthorized:error instanceof ApiError&&error.status===401};}
}
export const searchAvailablePatient=defineAction({accept:'form',input:z.object({documento:z.string()}),handler:handleSearchAvailablePatient});
export const enablePatientAvailability=defineAction({accept:'form',input:z.object({patient_id:uuid,context_pair:pair}),handler:handleEnablePatientAvailability});
export const withdrawPatientAvailability=defineAction({accept:'form',input:z.object({id:uuid,confirm_consequences:z.literal('yes'),patient_id:uuid.optional()}),handler:handleWithdrawPatientAvailability});
