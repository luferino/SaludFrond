# Disponibilidad de pacientes

La ruta `/patient-availability` está destinada a administración. El servidor vuelve a verificar el rol para la experiencia de usuario; la API sigue siendo la autoridad de permisos. La pantalla no busca por nombre ni carga un catálogo global de pacientes: el documento exacto se envía por POST y sólo los nombres devueltos se presentan en los resultados de esa solicitud. No se copia el documento a la URL.

Los catálogos académicos usan páginas acotadas (50 elementos por omisión; máximo 100). El selector nativo de asignatura conserva las coordenadas de paciente, historial y catálogos al enviar el formulario; al cambiar de asignatura reinicia únicamente la página de asociaciones. Las asociaciones habilitadas son exclusivamente las devueltas por la relación asignatura-grupo. Debido a la paginación independiente, las opciones sin etiqueta de grupo visible se excluyen y la interfaz informa que hay etiquetas faltantes; no se crean asociaciones ni se inventan nombres. El historial se consulta únicamente para el paciente seleccionado.

Habilitar crea un período nuevo. Retirar un período requiere confirmación y no revoca asignaciones existentes ni su acceso. Los errores de autenticación y autorización se muestran con mensajes seguros y las respuestas 409 se presentan como conflicto; la API conserva la decisión final.

La página establece `Cache-Control: no-store`. La implementación no contacta servicios reales durante sus pruebas; éstas usan respuestas sintéticas aisladas.
