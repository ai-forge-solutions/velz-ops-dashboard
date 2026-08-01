# velz-ops-dashboard

Panel operativo diario del pipeline de Velz Auto-Outreach: marcas (filas) × microservicios (columnas), con trigger ad-hoc y cascadas programadas.

**Estado actual: datos reales de Supabase + triggers reales del conductor.** Las marcas se leen en vivo desde las tablas `brands` y `service_runs` del proyecto `velz-outreach`; cada celda muestra la última ejecución conocida por marca/servicio. Los triggers ("Ejecutar ahora"), el botón Pipeline y las cascadas llaman directamente al conductor configurado en `VITE_CONDUCTOR_BASE_URL` para el MVP interno; al terminar refrescan el estado persistido en Supabase. Las cascadas guardadas persisten en `localStorage` del navegador (solo en tu máquina, no compartido entre dispositivos).

## Desarrollo local

```bash
npm install
cp .env.example .env.local
# rellena VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY y VITE_CONDUCTOR_BASE_URL
# opcional: VITE_OUTREACH_ORCHESTRATION_BASE_URL habilita el CTA QA Saleshandy
npm run dev
```

La app necesita una `anon key` de Supabase con políticas RLS de solo lectura para `brands` y `service_runs`. No uses la service-role key en Vite/Netlify: cualquier variable `VITE_*` se publica al navegador.

## Outreach / Saleshandy QA

El dashboard carga una segunda capa operativa de Outreach desde Supabase: `v_lead_overview`, `email_sequences`, `email_sends`, `email_events`, `lead_magnet_events` y `email_suppression_entries`. Si esas lecturas no están concedidas a anon, la matriz de señales sigue cargando y Outreach muestra `Read blocked`; ver `docs/SUPABASE_OUTREACH_READS.md` para el SQL mínimo de lectura.

El botón `Launch Saleshandy QA bulk` solo se habilita para el lead QA hardcodeado `4768fa1e-21f7-4ff3-a82d-639deec5c4dd`, recipient `miguelcarmonar@gmail.com`, secuencia + tool URL presentes, sin suppression activa y con `VITE_OUTREACH_ORCHESTRATION_BASE_URL` configurado. La app llama únicamente al endpoint interno `/orchestration/saleshandy/bulks/qa-single-lead/launch`; no llama Saleshandy desde el navegador.

## Límite visual de Meta Ads

`loadMetaAds` mantiene `limit=500` como límite visual del drawer/detalle para evitar respuestas grandes en el navegador. No limita el scraper ni significa que solo existan 500 anuncios; si una marca necesita revisar más volumen, el siguiente paso correcto es paginación/infinite scroll en la vista de detalle.

## Acceso de seguridad

El dashboard queda protegido en Netlify con una Edge Function antes de servir la app. Si no hay una sesión válida, Netlify muestra una pantalla de acceso propia en `/auth/login` en vez de disparar el diálogo nativo del navegador. Al iniciar sesión se guarda una cookie `HttpOnly`/`Secure` durante 30 días para no pedir las credenciales en cada visita.

Configura estas variables en Netlify (**Site settings → Environment variables**) antes de desplegar:

```bash
VELZ_DASHBOARD_USERNAME=miguel
VELZ_DASHBOARD_PASSWORD=<contraseña fuerte generada fuera del repo>
# opcional, si quieres poder rotar la contraseña sin invalidar sesiones ya abiertas
VELZ_DASHBOARD_SESSION_SECRET=<secreto fuerte generado fuera del repo>
```

La contraseña real y el secreto de sesión no deben guardarse en Git. Si usuario o contraseña no están configurados, Netlify responde `503 Security access is not configured` en vez de dejar el dashboard público.

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

## Triggers del conductor

El dashboard llama directamente al conductor de Velz para este MVP interno:

```dotenv
VITE_CONDUCTOR_BASE_URL=https://velz-signals-conductor-stg.blackocean-de4b65c4.westeurope.azurecontainerapps.io
```

Los servicios desplegados (`meta_ad_library_scraper`, `brand_reviews`, `web_stack_wappalyzer`, `shopify_signals`, `brand_context`) envían `{ "supabase_id": "<brands.id>" }` a sus endpoints del conductor. `shopify_signals` dispara `POST /microservices/shopify-signals`, que a su vez llama al microservicio Shopify ya integrado por el conductor. Los servicios sin endpoint (`similarweb`, `drafting`, `export`) se muestran como no desplegados y no disparan llamadas. El botón Pipeline usa `POST /microservices/run-all`; las ejecuciones individuales y cascadas usan el endpoint de cada servicio.

## Estructura

```
src/
  App.jsx      # todo el dashboard (vista Ejecuciones + vista Cascadas)
  main.jsx     # entry point de React
  index.css    # Tailwind
```
