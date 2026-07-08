# velz-ops-dashboard

Panel operativo diario del pipeline de Velz Auto-Outreach: marcas (filas) × microservicios (columnas), con trigger ad-hoc y cascadas programadas.

**Estado actual: datos mock.** Las marcas y el estado inicial vienen de una foto real de Supabase (`velz-outreach`, 8 jul 2026); los triggers ("Ejecutar ahora") simulan la respuesta del orquestador (1–2.5s, ~78% éxito) en vez de llamar a Azure de verdad. Las cascadas guardadas persisten en `localStorage` del navegador (solo en tu máquina, no compartido entre dispositivos).

## Desarrollo local

```bash
npm install
npm run dev
```

## Desplegar en Netlify (primera vez)

1. Crea el repo en GitHub:
   ```bash
   git init
   git add .
   git commit -m "Scaffold inicial del dashboard"
   git branch -M main
   git remote add origin git@github.com:<tu-usuario>/velz-ops-dashboard.git
   git push -u origin main
   ```
   (Crea el repo vacío en GitHub primero desde github.com/new, sin README, y usa la URL que te dé.)

2. En [app.netlify.com](https://app.netlify.com) → **Add new site → Import an existing project → GitHub** → selecciona `velz-ops-dashboard`. Netlify detecta `netlify.toml` automáticamente (build: `npm run build`, publish: `dist`). Deploy.

3. Cada `git push` a `main` vuelve a desplegar solo. Para tu uso diario, entra directamente a la URL que te da Netlify (puedes ponerle un dominio propio en Site settings → Domain management, o quedarte con el `*.netlify.app` gratuito).

## Cuándo pasar a datos reales (siguiente fase, no incluida aún)

Dos cosas deben pasar antes de conectar Supabase de verdad:

1. **Arreglar RLS.** Hoy 21 tablas de `velz-outreach` tienen Row Level Security desactivado — el `anon key` da acceso total de lectura/escritura a leads reales. Hay que activar RLS + políticas de solo-lectura antes de meter el `anon key` en este frontend.
2. **Endpoint de orquestación real.** Los triggers de servicio y cascada necesitan un backend (función serverless de Netlify, o un endpoint en tu infra de Azure) que llame a los Container Apps Jobs con credenciales que nunca deben vivir en el navegador. `triggerService` y `runNow` en `src/App.jsx` son los dos puntos a sustituir por `fetch()` reales cuando ese endpoint exista.

## Estructura

```
src/
  App.jsx      # todo el dashboard (vista Ejecuciones + vista Cascadas)
  main.jsx     # entry point de React
  index.css    # Tailwind
```
