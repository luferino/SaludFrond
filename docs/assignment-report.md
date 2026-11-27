# Informe de asignaciones

La página `/assignment-report` presenta un informe agregado de solo lectura para administradores con `assignment-reports:read`. Consultar requiere `from` y `to` como `YYYY-MM-DD`; ambos extremos son inclusivos y el período admite como máximo 366 días civiles de Paraguay. El frontend no consulta datos hasta que la autorización y las fechas sean válidas.

El informe consume `GET /reports/assignments?from=YYYY-MM-DD&to=YYYY-MM-DD` y solo presenta el total y las filas agregadas de carrera, asignatura, grupo académico y cantidad de asignaciones. Los conteos incluyen asignaciones finalizadas o reemplazadas según el agregado del servidor. Tras una respuesta agregada no vacía, la página consulta las listas existentes de asignaturas y grupos, sujetas a la autorización independiente de cada endpoint. Si un catálogo deniega o no puede resolver un nombre, se muestra el identificador. No se solicitan ni muestran datos personales y no hay exportación ni gráficos.
