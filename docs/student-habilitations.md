# Habilitaciones de estudiantes

La página `/student-habilitations` permite seleccionar un perfil de estudiante del catálogo global, elegir una asociación existente entre asignatura y grupo, activar un período, y filtrar/paginar períodos históricos. El formulario de activación envía el perfil seleccionado y una asociación mediante `context_pair` (`subject_id|academic_group_id`); el action valida y separa el par antes de enviar al backend solo los tres UUID contractuales. Los selectores y la lista usan las APIs con la sesión vigente; el backend decide permisos y contextos. En particular, la lectura de períodos de estudiantes puede requerir un contexto docente activo incluso para administradores, mientras que los permisos de lectura y escritura son independientes.

Cada período muestra su UUID, perfil/contexto legibles cuando sus catálogos están disponibles y auditoría de activación/revocación. Revocar exige confirmación visible: el backend cierra las asignaciones activas asociadas a ese período. Una activación posterior crea otro período y nunca restaura esas asignaciones. Los campos de actor/auditoría se obtienen exclusivamente de respuestas del backend.

La página no otorga autorización, no simula contexto, y no llama a base de datos. Errores del API se presentan sin indicar éxito; un 401 conserva el comportamiento existente de `apiFetch` que elimina la sesión.
