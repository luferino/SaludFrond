# Matriz de permisos

La página de solo lectura `/permission-matrix` consulta en el servidor `GET /auth/permission-matrix` mediante `apiFetch`. El backend es la autoridad de autorización; los datos de sesión del navegador no conceden acceso. La respuesta de página se marca `Cache-Control: no-store`.

El contrato esperado es:

```json
{
  "permissions": [{ "permission": "users:read", "enforced": true }],
  "roles": [{ "role": "admin", "permissions": ["users:read"] }]
}
```

`permissions` es el catálogo completo, incluidos permisos sin asignación. `roles` contiene únicamente los roles que tienen asignaciones registradas. La tabla informa por separado si el servidor aplica cada permiso y si cada rol lo tiene asignado. No hay acciones de edición.

Una respuesta 401 sigue el flujo de inicio de sesión existente; un 403 muestra un aviso sin cerrar la sesión. Errores de red/servidor, 404 y DTO inválidos muestran un estado de indisponibilidad sin datos ni fallback almacenado. La consulta y los casos de error se pueden verificar con las fixtures sintéticas de `tests/permission-matrix.test.mjs`.
