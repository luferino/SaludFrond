# Habilitaciones docentes

La pantalla `/teacher-habilitations` permite activar perfiles docentes en contextos de asignatura/grupo ya vinculados, consultar períodos y solicitar la revocación explícita de un período activo.

## Permisos y catálogos

El servidor SaludBack es la autoridad para cada operación. La pantalla no interpreta el rol como permiso ni supone que una autorización de escritura concede lectura. Los perfiles (`GET /teachers`), contextos vinculados (`GET /subject-groups`), etiquetas (`GET /subjects` y `GET /groups`) y períodos (`GET /teacher-habilitations`) se consultan por separado y sus estados de denegación o falla se muestran de forma independiente. En particular, no existe por defecto una lista de contextos propios de docentes.

Los catálogos de perfiles y pares vinculados están paginados mediante formularios HTML nativos; cada control de página conserva los offsets de los demás catálogos y las selecciones actuales, incluso sin JavaScript. La selección de contexto conserva la pareja exacta de asignatura y grupo; no se ofrece ingreso manual de UUID para activar. Los selectores muestran nombres legibles junto a los identificadores cuando hay etiquetas disponibles. Si un permiso de catálogo independiente falta, no se fabrican opciones ni se asume que la operación de escritura vaya a ser permitida.

## Períodos y auditoría

La lista acepta filtros combinables por perfil, asignatura, grupo y estado (`active` o `revoked`); un valor vacío único equivale a no aplicar ese filtro, mientras que valores repetidos o malformados se rechazan sin consultar períodos. El formulario nativo común conserva las selecciones actuales y las coordenadas de los catálogos al filtrar o paginar; al aplicar filtros reinicia únicamente el offset de períodos. Sus controles GET evitan la validación de campos de activación requeridos sin relajar la validación del botón de activación. La lista usa paginación acotada sin total inferido. Una respuesta mal formada no se presenta como período válido. Cada fila diferencia períodos activos y revocados, muestra la etiqueta legible disponible, UUID de período/perfil/contexto y los actores y marcas de tiempo de activación/revocación devueltos por el backend.

La activación exige un contexto con exactamente un UUID de asignatura y uno de grupo; sufijos o componentes adicionales se rechazan antes de llamar al backend. La acción envía únicamente `teacher_id`, `subject_id` y `academic_group_id`; actor y timestamps son propiedad del backend. La acción exportada `activateTeacherHabilitation` y la acción `revokeTeacherHabilitation` son definiciones Astro `defineAction` para que el registro del servidor las conecte. La revocación envía `POST /teacher-habilitations/:id/revoke` sin cuerpo. Requiere una casilla de confirmación explícita y explica que quita el acceso docente asociado al período seleccionado: no revoca períodos estudiantiles ni cierra asignaciones o documentos clínicos. Una reactivación posterior crea otro período.

Los errores HTTP se expresan como mensajes seguros; no se muestran mensajes arbitrarios del backend. `401` conserva el comportamiento compartido de limpiar la sesión, mientras que `403` y fallas de lectura no borran la sesión ni se presentan como éxito.

## Límites

La pantalla no cambia los helpers académicos compartidos, el cliente de API, el registro global de acciones, navegación, permisos del backend ni datos persistidos. La paginación común conserva sus límites existentes (tamaño 1–100 y offset 0–10000). Las lecturas no prueban que una operación de escritura será autorizada; la respuesta backend sigue siendo final.
