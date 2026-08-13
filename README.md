# MEV Monitor — stack mínimo standalone

Reemplazo minimalista de lo que hoy vive dentro de `develop` (backend NestJS completo +
frontend completo + Postgres, corriendo 24/7 solo para el check diario de MEV). Este repo
es independiente de `legal-saas` — no lo toca, solo reutiliza (copiado, no importado)
`scripts/mev_scraper.py` tal cual está en producción.

## Arquitectura

| Servicio | Qué hace | Cuándo corre |
|---|---|---|
| `cron/` | Un solo chequeo de MEV vía el mismo `mev_scraper.py` (Selenium), actualiza la DB, manda mail si hay movimientos | Cron nativo de Railway, ~10-20 min/día |
| `viewer/` | Panel de solo lectura + alta de expedientes a seguir | Sleep activado — despierta con HTTP cuando entrás |
| `mev-db` | Postgres con 2 tablas (`Organization`, `ExpedienteMev`) | 24/7, liviano |

`cron` y `viewer` comparten la misma base (`mev-db`) mediante `DATABASE_URL`.

## 1) Crear el ambiente nuevo en Railway

```bash
railway environment new mev --project adorable-victory
railway add --database postgres --environment mev   # crea mev-db
```

Dentro del dashboard, crear dos servicios más apuntando a este repo (uno para `cron/`,
otro para `viewer/`), cada uno con su **Root Directory** seteado a `cron` y `viewer`
respectivamente (Railway detecta el Dockerfile de cada carpeta).

## 2) Variables de entorno

Copiar `cron/.env.example` y `viewer/.env.example` como base. Completar:

- `DATABASE_URL` — la de `mev-db` (Railway la inyecta sola si linkeás el servicio a la DB).
- `ORGANIZATION_ID` — ver paso de migración de datos abajo (es el mismo UUID que ya existe).
- `MEV_USERNAME` / `MEV_PASSWORD` — las mismas credenciales que ya usa `develop`.
- `RESEND_API_KEY` / `RESEND_FROM_EMAIL` / `RESEND_FROM_NAME` — las mismas que ya tenés en Resend.
- `NOTIFY_EMAIL=Barcellajoaquin@gmail.com`
- Para `viewer`: `VIEWER_USERNAME`, `VIEWER_PASSWORD_HASH` (generar con `npm run hash-password`
  **local**, nunca pegar la contraseña en texto plano en Railway) y `SESSION_SECRET`
  (`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`).

## 3) Configurar el cron nativo

En el servicio `mev-cron` → Settings → **Cron Schedule**:

```
6 15 * * *
```

(15:06 UTC = 12:06 ART, mismo horario que corre hoy en `develop`). Railway prende el
contenedor, corre `dist/run-mev-check.js`, y lo apaga solo al terminar.

## 4) Activar sleep en el viewer

En el servicio `mev-viewer` → Settings → **Sleep Application** → activado. A diferencia
del cron (que depende de un trigger interno y por eso NO puede dormir), el viewer se
despierta solo con la request HTTP cuando entrás a mirarlo.

## 5) Migrar datos históricos (Organization + ExpedienteMev)

Los expedientes que ya está siguiendo el `develop` actual hay que copiarlos a `mev-db`
antes de apagar nada. Usando el CLI ya logueado (`railway link` apuntando al proyecto
actual, environment `develop`, servicio `Postgres`):

```bash
# 1. Traer el DATABASE_PUBLIC_URL de la Postgres de develop (conexión externa, no la
#    interna *.railway.internal que solo funciona desde dentro de Railway)
railway variable list --service Postgres --environment develop --kv | grep DATABASE_PUBLIC_URL

# 2. Volcar solo tu organización (reemplazá ORG_ID por tu ORGANIZATION_ID real)
psql "$DATABASE_PUBLIC_URL_DEVELOP" -c "\copy (SELECT * FROM \"Organization\" WHERE id = 'ORG_ID') TO 'org.csv' WITH CSV HEADER"
psql "$DATABASE_PUBLIC_URL_DEVELOP" -c "\copy (SELECT * FROM \"ExpedienteMev\" WHERE \"organizationId\" = 'ORG_ID') TO 'expedientes.csv' WITH CSV HEADER"

# 3. Aplicar el schema en mev-db (desde cron/ o viewer/, da igual, comparten schema)
cd cron && npx prisma migrate deploy   # o `prisma db push` si preferís sin historial de migraciones

# 4. Restaurar en mev-db (DATABASE_PUBLIC_URL del Postgres nuevo)
psql "$DATABASE_PUBLIC_URL_MEV" -c "\copy \"Organization\" FROM 'org.csv' WITH CSV HEADER"
psql "$DATABASE_PUBLIC_URL_MEV" -c "\copy \"ExpedienteMev\" FROM 'expedientes.csv' WITH CSV HEADER"
```

Requiere `psql` instalado localmente (viene con PostgreSQL o `winget install PostgreSQL.PostgreSQL`).
**No ejecuté nada de esto todavía** — es la receta para cuando quieras avanzar.

## 6) Verificar antes de tocar `develop`

- Confirmar que `mev-cron` corrió al menos una vez en el nuevo ambiente y llegó el mail.
- Confirmar que `mev-viewer` muestra los expedientes migrados.
- Recién ahí, en `develop`: apagar/borrar el servicio `backend` y `frontend` (dejando
  o borrando el Postgres viejo de `develop` según si te sirve de algo más).

## Fuera de alcance

`develop` también corre un cron de **PJN** (`PjnCronService`, separado de MEV, horario
configurable por `PJN_CRON_TIME`). No lo migré porque dijiste que MEV es lo único que
usás ahí — si en algún momento lo necesitás, es el mismo patrón (spawnea
`scripts/pjn/*.py` vía Playwright en vez de Selenium).

## Seguridad

- La contraseña del viewer nunca se guarda en texto plano — `VIEWER_PASSWORD_HASH` es
  un hash bcrypt, generado localmente con `npm run hash-password`.
- Login con rate-limit + lockout de 15 min tras 5 intentos fallidos por IP.
- CSRF token por sesión en todos los POST.
- Cookies de sesión `httpOnly` + `secure` (Railway sirve todo por HTTPS).
- No commitear ningún `.env` — están en `.gitignore`.
