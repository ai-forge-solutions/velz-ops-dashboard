# velz-ops-dashboard

Panel operativo diario del pipeline de Velz Auto-Outreach: marcas (filas) × microservicios (columnas), con trigger ad-hoc y cascadas programadas.

**Estado actual: datos reales de Supabase.** Las marcas se leen en vivo desde las tablas `brands` y `service_runs` del proyecto `velz-outreach`; cada celda muestra la última ejecución conocida por marca/servicio. Los triggers ("Ejecutar ahora") todavía actualizan solo la UI localmente porque necesitan un endpoint backend seguro para llamar al orquestador sin exponer credenciales en el navegador. Las cascadas guardadas persisten en `localStorage` del navegador (solo en tu máquina, no compartido entre dispositivos).

## Desarrollo local

```bash
npm install
cp .env.example .env.local
# rellena VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY
npm run dev
```

La app necesita una `anon key` de Supabase con políticas RLS de solo lectura para `brands` y `service_runs`. No uses la service-role key en Vite/Netlify: cualquier variable `VITE_*` se publica al navegador.

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

## Pendiente para triggers reales

Los triggers de servicio y cascada necesitan un backend (función serverless de Netlify, o un endpoint en tu infra de Azure) que llame a los Container Apps Jobs con credenciales que nunca deben vivir en el navegador. `triggerService` y `runNow` en `src/App.jsx` son los dos puntos a sustituir por `fetch()` reales cuando ese endpoint exista.

## Estructura

```
src/
  App.jsx      # todo el dashboard (vista Ejecuciones + vista Cascadas)
  main.jsx     # entry point de React
  index.css    # Tailwind
```
