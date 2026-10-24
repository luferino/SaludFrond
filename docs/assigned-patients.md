# Pacientes asignados

`/my-patients` muestra las asignaciones activas devueltas por el endpoint autenticado `GET /patient-assignments/mine`. Cada fila representa una asignación, no una identidad clínica única: un mismo paciente puede aparecer varias veces cuando existen contextos distintos. Se muestran los nombres y el documento planos recibidos junto con los UUID de asignatura (`subject_id`) y grupo académico (`academic_group_id`); no se consultan catálogos académicos ni se inventan etiquetas.

La lista pagina con `limit` (1–100; predeterminado 50) y `offset` (entero seguro no negativo; predeterminado 0). Solo se ofrece “Siguiente” cuando la página llega completa; no se infiere un total. El enlace de cada asignación conserva ambos valores de paginación para que la ruta de borradores pueda revalidar el contexto.

Los enlaces de borrador se incorporan en la siguiente parte del flujo. Esta lista no crea ni modifica asignaciones y no implementa consentimiento, envío ni revisión docente. Los roles y permisos visibles en la interfaz son únicamente indicaciones; el backend sigue siendo la autoridad de acceso.
