# Regresión, cobertura e integración continua

## Objetivo

Garantizar que el proyecto siga funcionando correctamente tras cada cambio, que la suite de pruebas cubra los riesgos reales y que la validación se ejecute automáticamente en CI.

## Qué se aplicó

1. Se conservan pruebas de regresión para casos de defectos ya corregidos.
2. La suite completa se ejecuta con `npm test`.
3. La cobertura se genera con `npm run test:coverage`.
4. La validación de CI se ejecuta automáticamente con GitHub Actions.

## Comandos útiles

```bash
npm test
npm run test:coverage
npm run test:ci
```

## Política de construcción rota

Si una validación obligatoria falla (pruebas o cobertura), la incorporación queda bloqueada y se debe:

1. localizar la causa,
2. reparar o revertir el cambio responsable,
3. volver a ejecutar la misma verificación completa.

## Evidencia actual

El proyecto ya tiene pruebas automatizadas y la ejecución real demuestra que la suite pasa. La cobertura también puede emitirse de forma reproducible en el entorno local.
