import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { z as realZod } from 'astro/zod';

const root = new URL('../', import.meta.url);
const ids = { subject: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', group: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', student: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', habilitation: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', patient: 'ffffffff-ffff-4fff-8fff-ffffffffffff', actor: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
const iso = '2026-01-02T03:04:05.000Z';
const assignment = () => ({ id: '9223372036854775807', patient_id: ids.patient, student_habilitation_id: ids.habilitation, subject_id: ids.subject, academic_group_id: ids.group, assigned_by: ids.actor, assigned_at: iso, ended_by: null, ended_at: null, end_reason: null });
const plain = (value) => JSON.parse(JSON.stringify(value));

async function executePage(search = '', options = {}) {
 const pageUrl = new URL('../src/pages/teacher-assignments.astro', import.meta.url);
 const source = await readFile(pageUrl, 'utf8');
 const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---/)[1];
 const parsed = ts.createSourceFile(pageUrl.pathname, frontmatter, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
 const removals = parsed.statements.filter(ts.isImportDeclaration).map((s) => [s.getFullStart(), s.getEnd()]);
 let code = frontmatter;
 for (const [start, end] of removals.sort((a,b) => b[0]-a[0])) code = code.slice(0,start)+code.slice(end);
 code = code.replace(/^export const prerender = false;\s*$/m, '');
 const requests = [];
 const contexts = options.contexts ?? [ids.subject + ':' + ids.group, ids.subject + ':cccccccc-cccc-4ccc-8ccc-dddddddddddd'];
 const contextItems = contexts.map((pair) => { const [subject_id, academic_group_id] = pair.split(':'); return {subject_id, subject_name:'Subject '+subject_id, academic_group_id, academic_group_name:'Group '+academic_group_id, academic_year:2026, curriculum_semester:1}; });
 const page = (items, limit, offset) => ({items, limit, offset});
 const mocks = {
  actions:{ createTeacherAssignment:'create-action' }, Layout:{}, ApiError: class ApiError extends Error { constructor(status){super('error');this.status=status;} },
  getSession:()=> 'session-token', parseTeacherAssignmentPagination: (params) => { const get=(key,d)=>{const v=params.getAll(key); if(v.length>1|| (v.length===1&&!/^[0-9]+$/.test(v[0])))throw Error('invalid pagination'); const n=v.length?Number(v[0]):d; if(n>(key==='limit'?100:10000)||n<(key==='limit'?1:0))throw Error('invalid pagination');return n;};return {limit:get('limit',50),offset:get('offset',0)}; },
  listTeacherContexts: async (pagination) => { requests.push(['contexts',pagination]); if(options.contextStatus)throw new mocks.ApiError(options.contextStatus); return page(contextItems.slice(pagination.offset,pagination.offset+pagination.limit),pagination.limit,pagination.offset); },
  listTeacherStudents: async (query) => { requests.push(['students',query]); if(options.studentStatus)throw new mocks.ApiError(options.studentStatus); return page(options.emptyStudents?[]:[{student_habilitation_id:ids.habilitation,student_id:ids.student,nombres:'Ana',apellidos:'Pérez'}],query.limit,query.offset); },
  listAvailablePatients: async (query) => { requests.push(['patients',query]); if(options.patientStatus)throw new mocks.ApiError(options.patientStatus); return page(options.emptyPatients?[]:[{patient_id:ids.patient,nombres:'Luis',apellidos:'Díaz'}],query.limit,query.offset); },
 };
 const form = new FormData(); for(const [k,v] of Object.entries(options.form ?? {})) form.set(k,v);
 const Astro = { cookies:{}, url:new URL(`https://front.invalid/teacher-assignments${search?`?${search}`:''}`), response:{headers:{set:(...args)=>requests.push(['header',...args])},}, request:{clone:()=>({formData:async()=>form})}, getActionResult:(action)=>action==='create-action'?options.actionResult:undefined, redirect:(url)=>({redirect:url}) };
 const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
 const output = ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^export \{\};?$/m,'');
 const fn = new AsyncFunction('Astro',...Object.keys(mocks),`${output}; return {queryError,contextPage,studentPage,patientPage,contexts,students,patients,contextsState,studentsState,patientsState,selectedContext,selectedStudent,selectedPatient,contextValid,nav,showPrevious,showNext};`);
 return {value:await fn(Astro,...Object.values(mocks)),requests};
}

async function fixture(options = {}) {
 const cookies = { get: () => ({ value: 'session-token' }), set() {}, delete() {} };
 const requests = [];
 const sandbox = vm.createContext({ URL, URLSearchParams, Response, Error, Date, BigInt, fetch: async (url, init) => {
  requests.push({ url, ...init });
  const path = new URL(url).pathname;
  let body = options.responses?.[path];
  if (Array.isArray(body)) body = body.shift();
  if (body === undefined) {
   const limit = Number(new URL(url).searchParams.get('limit')); const offset = Number(new URL(url).searchParams.get('offset'));
   body = init.method === 'POST' ? assignment() : path.endsWith('/contexts') ? { items: [{ subject_id: ids.subject, subject_name: 'Anatomía', academic_group_id: ids.group, academic_group_name: 'Grupo A', academic_year: 2026, curriculum_semester: 1 }], limit, offset } : path.endsWith('/students') ? { items: [{ student_habilitation_id: ids.habilitation, student_id: ids.student, nombres: 'Ana', apellidos: 'Pérez' }], limit, offset } : { items: [{ patient_id: ids.patient, nombres: 'Luis', apellidos: 'Díaz' }], limit, offset };
  }
  return Response.json(body, { status: options.status ?? 200 });
 }});
 const modules = new Map();
 function sourceModule(code, identifier) {
  if (modules.has(identifier)) return modules.get(identifier);
  const pendingModule = Promise.resolve().then(() => {
   const output = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
   return new vm.SourceTextModule(output, { context: sandbox, identifier, initializeImportMeta: (meta) => { meta.env = { PUBLIC_API_URL: 'https://backend.invalid', PROD: false }; } });
  });
  modules.set(identifier, pendingModule);
  return pendingModule;
 }
 const linker = async (specifier, parent) => {
  if (specifier === 'astro:actions') return new vm.SourceTextModule('export const defineAction = (definition) => definition;', { context: sandbox });
  if (specifier === 'astro/zod') return new vm.SyntheticModule(['z'], function () { this.setExport('z', realZod); }, { context: sandbox });
  const resolved = new URL(/\.(?:ts|astro)$/.test(specifier) ? specifier : `${specifier}.ts`, parent.identifier);
  return sourceModule(await readFile(resolved, 'utf8'), resolved.href);
 };
 async function load(path) {
  const url = new URL(path, root);
  const module = await sourceModule(await readFile(url, 'utf8'), url.href);
  if (module.status === 'unlinked') await module.link(linker);
  if (module.status === 'linked') await module.evaluate();
  return module.namespace;
 }
 return { cookies, requests, load, sandbox };
}

test('named paginated context and dependent selectors use bounded exact query parameters', async () => {
 const f = await fixture(); const api = await f.load('src/pods/teacher-assignment/api.ts');
 assert.deepEqual(plain(await api.listTeacherContexts({ limit: 7, offset: 14 }, f.cookies)).items[0], { subject_id: ids.subject, subject_name: 'Anatomía', academic_group_id: ids.group, academic_group_name: 'Grupo A', academic_year: 2026, curriculum_semester: 1 });
 await api.listTeacherStudents({ subject_id: ids.subject, academic_group_id: ids.group, limit: 7, offset: 14 }, f.cookies);
 await api.listAvailablePatients({ subject_id: ids.subject, academic_group_id: ids.group, limit: 7, offset: 14 }, f.cookies);
 assert.deepEqual(f.requests.map((r) => new URL(r.url).search), [`?limit=7&offset=14`, `?subject_id=${ids.subject}&academic_group_id=${ids.group}&limit=7&offset=14`, `?subject_id=${ids.subject}&academic_group_id=${ids.group}&limit=7&offset=14`]);
 assert.ok(f.requests.every((r) => r.method === 'GET' && r.headers.Authorization === 'Bearer session-token'));
 for (const params of [new URLSearchParams('limit=0'), new URLSearchParams('limit=101'), new URLSearchParams('offset=10001'), new URLSearchParams('limit=2&limit=3')]) assert.throws(() => api.parseTeacherAssignmentPagination(params));
 assert.deepEqual(plain(api.parseTeacherAssignmentPagination(new URLSearchParams())), { limit: 50, offset: 0 });
});

test('empty dependent page stays empty and create uses habilitation UUID with exact four-field body', async () => {
 const f = await fixture(); const api = await f.load('src/pods/teacher-assignment/api.ts');
 const result = await api.createTeacherAssignment({ patient_id: ids.patient, student_habilitation_id: ids.habilitation, subject_id: ids.subject, academic_group_id: ids.group }, f.cookies);
 assert.equal(result.id, '9223372036854775807');
 assert.deepEqual(JSON.parse(f.requests[0].body), { patient_id: ids.patient, student_habilitation_id: ids.habilitation, subject_id: ids.subject, academic_group_id: ids.group });
 assert.equal(f.requests[0].method, 'POST'); assert.deepEqual(Object.keys(JSON.parse(f.requests[0].body)).sort(), ['academic_group_id','patient_id','student_habilitation_id','subject_id']);
 const empty = await fixture({ responses: { '/patient-assignment-options/students': { items: [], limit: 50, offset: 0 } } });
 const emptyApi = await empty.load('src/pods/teacher-assignment/api.ts');
 assert.deepEqual((await emptyApi.listTeacherStudents({ subject_id: ids.subject, academic_group_id: ids.group, limit: 50, offset: 0 }, empty.cookies)).items, []);
 assert.equal(empty.requests.length, 1);
});

test('create validates direct reply audits, reference identity, and rejects invalid inputs without writes', async () => {
 const f = await fixture(); const actions = await f.load('src/pods/teacher-assignment/actions.ts');
 const form = new FormData(); Object.entries({ patient_id: ids.patient, student_habilitation_id: ids.habilitation, subject_id: ids.subject, academic_group_id: ids.group }).forEach(([k,v]) => form.set(k,v));
 assert.equal(actions.createTeacherAssignment.input.safeParse(Object.fromEntries(form)).success, true);
 const ok = await actions.createTeacherAssignment.handler(Object.fromEntries(form), { cookies: f.cookies }); assert.equal(ok.success, true); assert.equal(ok.assignment.id, '9223372036854775807');
 assert.deepEqual(JSON.parse(f.requests[0].body), { patient_id:ids.patient, student_habilitation_id:ids.habilitation, subject_id:ids.subject, academic_group_id:ids.group });
 const invalid = await actions.createTeacherAssignment.handler({ patient_id: ' '+ids.patient, student_habilitation_id: ids.habilitation, subject_id: ids.subject, academic_group_id: ids.group }, { cookies: f.cookies }); assert.equal(invalid.success, false);
 assert.equal(f.requests.length, 1);
});

test('malformed create replies, audit facts, and mismatched references never report success', async () => {
 const invalidReplies = [
  {...assignment(), id:'0'}, {...assignment(), id:'01'}, {...assignment(), id:'9223372036854775808'}, {...assignment(), id:17}, {...assignment(), id:null}, {...assignment(), assigned_by:null}, {...assignment(), assigned_at:'not-a-date'}, {...assignment(), ended_at:'2026-01-03T00:00:00Z'}, {...assignment(), patient_id:ids.student},
 ];
 const f=await fixture({responses:{'/patient-assignments':invalidReplies.slice()}}); const actions=await f.load('src/pods/teacher-assignment/actions.ts');
 for (const [index, reply] of invalidReplies.entries()) {
  const result=await actions.createTeacherAssignment.handler({patient_id:ids.patient,student_habilitation_id:ids.habilitation,subject_id:ids.subject,academic_group_id:ids.group},{cookies:f.cookies});
  assert.equal(result.success,false,`reply fixture ${index} (${String(reply.id)}) must be rejected`);
 }
 assert.equal(f.requests.length,invalidReplies.length);
 assert.deepEqual(invalidReplies.map((reply) => reply.id), ['0','01','9223372036854775808',17,null,'9223372036854775807','9223372036854775807','9223372036854775807','9223372036854775807']);
});

test('401, 403, and 404 create failures are actionable and never reported as success', async () => {
 for (const [status, expected] of [[401,/sesión venció/i],[403,/permiso|contexto docente/i],[404,/habilitado|paciente/i]]) {
  const f = await fixture({status}); const actions = await f.load('src/pods/teacher-assignment/actions.ts');
  const result = await actions.createTeacherAssignment.handler({patient_id:ids.patient,student_habilitation_id:ids.habilitation,subject_id:ids.subject,academic_group_id:ids.group},{cookies:f.cookies});
  assert.equal(result.success,false); assert.match(result.error,expected); assert.equal(f.requests.length,1);
 }
});

test('409 conflicts explain unavailable destination and existing subject assignment separately', async () => {
 for (const [message, expected] of [['patient is not available in the destination context', /ya no está disponible en este contexto/i], ['patient already has an active assignment for this subject', /ya tiene una asignación activa/i]]) {
  const f = await fixture({ status:409, responses:{ '/patient-assignments':{error:{code:'CONFLICT',message}}} });
  const actions = await f.load('src/pods/teacher-assignment/actions.ts');
  const result = await actions.createTeacherAssignment.handler({patient_id:ids.patient,student_habilitation_id:ids.habilitation,subject_id:ids.subject,academic_group_id:ids.group},{cookies:f.cookies});
  assert.equal(result.success,false); assert.match(result.error,expected); assert.equal(f.requests.length,1);
 }
});

test('page navigation preserves selected page coordinates and page-two context choices', async () => {
 const secondContext = `${ids.subject}:cccccccc-cccc-4ccc-8ccc-dddddddddddd`;
 const evaluated = await executePage(`limit=1&offset=1&context=${encodeURIComponent(secondContext)}&current_context=${encodeURIComponent(secondContext)}&student_limit=7&student_offset=14&patient_limit=9&patient_offset=27`);
 assert.equal(evaluated.value.contextValid,true);
 assert.equal(evaluated.value.selectedContext,secondContext);
 assert.deepEqual(evaluated.requests.filter(([kind])=>kind==='contexts')[0][1],{limit:1,offset:1});
 assert.deepEqual(evaluated.requests.filter(([kind])=>kind==='students')[0][1],{subject_id:ids.subject,academic_group_id:secondContext.split(':')[1],limit:7,offset:14});
 assert.deepEqual(evaluated.requests.filter(([kind])=>kind==='patients')[0][1],{subject_id:ids.subject,academic_group_id:secondContext.split(':')[1],limit:9,offset:27});
 const links = evaluated.value.nav('patient_',36,9,secondContext);
 const params = new URLSearchParams(links.slice(1)); assert.equal(params.get('limit'),'1'); assert.equal(params.get('offset'),'1'); assert.equal(params.get('student_limit'),'7'); assert.equal(params.get('student_offset'),'14'); assert.equal(params.get('patient_offset'),'36'); assert.equal(params.get('context'),secondContext);
});

test('malformed navigation, repeated context, and action failure use submitted context without fetching dependents', async () => {
 const repeated = await executePage(`context=${ids.subject}:${ids.group}&context=${ids.subject}:cccccccc-cccc-4ccc-8ccc-dddddddddddd`);
 assert.notEqual(repeated.value.queryError,''); assert.equal(repeated.requests.some(([kind])=>kind==='students'||kind==='patients'),false); assert.equal(repeated.value.contextValid,false);
 const invalid = await executePage(`context=${ids.subject}:${ids.group}&student_offset=nope`);
 assert.notEqual(invalid.value.queryError,'', JSON.stringify({value:invalid.value,requests:invalid.requests})); assert.equal(invalid.requests.some(([kind])=>kind==='students'||kind==='patients'),false); assert.equal(invalid.value.contextValid,false);
 for (const query of ['context=bad',`context=${ids.subject}:${ids.group}&student_offset=1&student_offset=2`]) {
  const malformed = await executePage(query); assert.notEqual(malformed.value.queryError,'');
  assert.equal(malformed.requests.some(([kind])=>kind==='contexts'||kind==='students'||kind==='patients'),false);
 }
 const old = `${ids.subject}:${ids.group}`, newer=`${ids.subject}:cccccccc-cccc-4ccc-8ccc-dddddddddddd`;
 const failed = await executePage(`context=${encodeURIComponent(old)}&limit=50&offset=0`,{actionResult:{data:{success:false,error:'conflict'}},form:{subject_id:ids.subject,academic_group_id:newer.split(':')[1],student_habilitation_id:ids.habilitation,patient_id:ids.patient,limit:'1',offset:'1',student_limit:'7',student_offset:'14',patient_limit:'9',patient_offset:'27'}});
 assert.equal(failed.value.selectedContext,newer); assert.equal(failed.value.selectedStudent,ids.habilitation); assert.equal(failed.value.selectedPatient,ids.patient);
 assert.equal(failed.value.contextPage.offset,1); assert.equal(failed.value.studentPage.offset,14); assert.equal(failed.value.patientPage.offset,27);
 assert.deepEqual(failed.requests.filter(([kind])=>kind==='students')[0][1],{subject_id:ids.subject,academic_group_id:newer.split(':')[1],limit:7,offset:14});
});

test('selector pages show only valid previous/next links, including empty-page previous navigation', async () => {
 const page = await executePage(`context=${ids.subject}:${ids.group}&current_context=${ids.subject}:${ids.group}&limit=1&offset=10000&student_limit=7&student_offset=14&patient_limit=9&patient_offset=27`,{emptyStudents:true,emptyPatients:true});
 assert.equal(page.value.showPrevious(page.value.studentPage),true); assert.equal(page.value.showNext(page.value.studentPage,page.value.students.length),false);
 assert.equal(page.value.showPrevious(page.value.patientPage),true); assert.equal(page.value.showNext(page.value.patientPage,page.value.patients.length),false);
 assert.equal(page.value.showNext(page.value.contextPage,page.value.contexts.length),false);
 assert.equal(page.value.showNext({limit:1,offset:9999},1),true); assert.equal(page.value.showNext({limit:1,offset:10000},1),false);
 const secondContext = `${ids.subject}:cccccccc-cccc-4ccc-8ccc-dddddddddddd`;
 const changed = await executePage(`context=${ids.subject}:${ids.group}&current_context=${secondContext}&student_limit=7&student_offset=14&patient_limit=9&patient_offset=27`);
 assert.deepEqual(changed.value.studentPage,{limit:50,offset:0}); assert.deepEqual(changed.value.patientPage,{limit:50,offset:0});
});

test('401 selector responses redirect to login and stop remaining dependent requests', async () => {
 const contextDenied = await executePage('',{contextStatus:401});
 assert.equal(contextDenied.value.redirect,'/auth/login?returnTo=%2Fteacher-assignments'); assert.equal(contextDenied.requests.filter(([kind])=>kind==='contexts').length,1);
 const studentDenied = await executePage(`context=${ids.subject}:${ids.group}`,{studentStatus:401});
 assert.equal(studentDenied.value.redirect,`/auth/login?returnTo=${encodeURIComponent(`/teacher-assignments?context=${ids.subject}:${ids.group}`)}`);
 assert.equal(studentDenied.requests.some(([kind])=>kind==='patients'),false);
});

test('page returns successful submissions to a clean GET and uses submitted context after failed actions', async () => {
 const success = await executePage('',{actionResult:{data:{success:true,assignment:assignment()}}});
 assert.equal(success.value.redirect,'/teacher-assignments?created=9223372036854775807');
 const failed = await executePage(`context=${ids.subject}:${ids.group}`,{actionResult:{data:{success:false,error:'conflict'}},form:{subject_id:'bad',academic_group_id:ids.group}});
 assert.equal(failed.value.selectedContext,''); assert.equal(failed.value.contextValid,false); assert.equal(failed.requests.some(([kind])=>kind==='students'||kind==='patients'),false);
});

test('page offers native context-dependent forms, pagination, conflict distinctions, authentication and no-store', async () => {
 const source = await readFile(new URL('../src/pages/teacher-assignments.astro', import.meta.url), 'utf8');
 assert.match(source, /createTeacherAssignment/); assert.match(source, /listTeacherContexts/); assert.match(source, /student_habilitation_id/);
 const actions = await (await fixture()).load('src/pods/teacher-assignment/actions.ts');
 assert.equal(typeof actions.createTeacherAssignment.handler, 'function'); assert.match(source, /no-store/i); assert.match(source, /context/); assert.match(source, /student_/); assert.match(source, /patient_/);
 assert.doesNotMatch(source, /\/patients\?/); assert.match(source, /getSession\(Astro.cookies\)/); assert.match(source, /<form[\s\S]*method="POST"/);
 const contextForm = source.match(/<form method="GET"[\s\S]*?<\/form>/)?.[0] ?? '';
 assert.match(contextForm, /name="context"/); assert.match(contextForm,/name="current_context"/); assert.match(contextForm,/name="student_offset"/); assert.match(contextForm,/name="patient_offset"/); assert.doesNotMatch(contextForm,/student_habilitation_id|name="patient_id"/);
 const createForm = source.match(/<form method="POST"[\s\S]*?<\/form>/)?.[0] ?? '';
 for (const name of ['subject_id','academic_group_id','student_habilitation_id','patient_id']) assert.match(createForm, new RegExp(`name="${name}"`));
 assert.match(createForm, /value=\{item\.student_habilitation_id\}/);
});
