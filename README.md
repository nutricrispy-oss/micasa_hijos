# 🏠 Mi Casa – Mis Responsabilidades

PWA familiar para organizar las responsabilidades del hogar. Los hijos envían fotos como evidencia, los padres aprueban o rechazan, y el avance habilita privilegios y el **Viernes de recompensa**.

- **Frontend:** HTML + CSS + JavaScript (sin compilar). Se publica gratis en GitHub Pages.
- **Servidor:** Supabase (plan gratuito). Ofrece base de datos PostgreSQL, inicio de sesión, fotos privadas y sincronización en tiempo real entre teléfonos.
- **Modo local:** sirve para probar la app en un solo teléfono, sin configurar nada.

---

## 📁 Contenido

```
index.html               Página principal
manifest.json            Instalación como app (PWA)
sw.js                    Service Worker: funcionamiento offline y notificaciones push
css/styles.css           Diseño (modo claro y oscuro)
js/app.js                Pantallas y lógica de la app
js/logic.js              Cálculo de progreso, rachas, insignias y actividades de ejemplo
js/ui.js                 Ventanas, avisos, compresión de fotos y campos de fecha y hora
js/store-supabase.js     Conexión con Supabase (nube)
js/store-local.js        Modo local (IndexedDB)
js/config.js             Datos del servidor (opcional)
icons/                   Íconos de la app
supabase/schema.sql      ⭐ Base de datos completa: tablas, seguridad y funciones
supabase/functions/send-push/index.ts   Envío de notificaciones push (opcional)
supabase/recordatorios-opcional.sql     Recordatorio diario automático (opcional)
```

---

## ⚡ Prueba rápida, sin servidor

1. Publicá la app (paso 4) o abrí `index.html` con un servidor local.
2. En la pantalla inicial tocá **"Probar en modo local"**.
3. Creá la familia, agregá un hijo/a con PIN y asignale actividades.
4. Para entrar como hijo/a: **Más → Cerrar sesión → pestaña "Hijo / Hija"**.

> En modo local los datos quedan **solo en ese teléfono**. Para usar varios teléfonos hacé los pasos 1 a 3.

---

## 1️⃣ Crear el proyecto en Supabase (gratis)

1. Entrá a **https://supabase.com** → *Start your project* → registrate con GitHub o con tu correo.
2. **New project** → nombre: `micasa` → definí una contraseña para la base de datos (guardala) → región: **São Paulo** (la más cercana a Paraguay) → *Create*.
3. Esperá 1 o 2 minutos hasta que el proyecto esté listo.

> Usá un proyecto **exclusivo** para esta app: el script reemplaza las reglas de seguridad del esquema `public`.

## 2️⃣ Crear la base de datos

1. Menú izquierdo → **SQL Editor** → **New query**.
2. Abrí `supabase/schema.sql`, copiá **todo** el contenido, pegalo y tocá **Run**.
3. Tiene que aparecer *Success*. El script se puede ejecutar más de una vez sin problemas.

El script crea:

| Tabla | Para qué sirve |
|---|---|
| `families` | Familia, código familiar y configuración (meta semanal, modo viernes, fotos, zona horaria) |
| `profiles` | Padres e hijos (rol, usuario, foto, color, activo) |
| `activities` | Actividades configuradas (frecuencia, días, hora límite, puntos, foto sí/no) |
| `task_instances` | Cada actividad de cada día: estado, foto, horarios, observaciones |
| `rewards` / `reward_uses` | Privilegios diarios y su uso |
| `friday_rewards` | Viernes de recompensa: votos, elección y aprobación |
| `notifications` / `push_subscriptions` | Avisos internos y teléfonos suscritos a push |
| Storage `evidencias` | Fotos **privadas**, organizadas como `familia/hijo/fecha/` |

## 3️⃣ Configurar el inicio de sesión

1. **Authentication → Sign In / Providers → Email**:
   - **Enable Email provider**: activado.
   - **Confirm email**: **DESACTIVADO** (obligatorio). Los hijos ingresan con usuario y PIN, sin correo, y si esta opción queda activa sus cuentas no se pueden crear.
   - Guardá con *Save*.
2. **Authentication → Sign In / Providers**: dejá activado **"Allow new users to sign up"**.
3. Copiá los datos de conexión desde **Project Settings → API Keys** (o **Data API**):
   - **Project URL** (ej. `https://abcd1234.supabase.co`)
   - **Publishable key** (o *anon public key*, en proyectos más antiguos)

> Estas claves son públicas por diseño. La seguridad la dan las reglas RLS: cada familia solo ve sus propios datos, los hijos no pueden aprobar actividades y las fotos solo las abren los miembros autorizados.

## 4️⃣ Publicar la app en GitHub Pages (desde el celular o la PC)

1. En **github.com** → **New repository** → nombre: `micasa` → **Public** → *Create*.
2. **Add file → Upload files** → subí **todo el contenido** de esta carpeta (index.html, manifest.json, sw.js y las carpetas css, js, icons y supabase), respetando las carpetas → *Commit changes*.
3. **Settings → Pages** → *Source: Deploy from a branch* → Branch **main** / **(root)** → *Save*.
4. En 1 o 2 minutos la app queda en: `https://TU-USUARIO.github.io/micasa/`

**Conectar la app con Supabase** (elegí una opción):

- **A (recomendada):** editá `js/config.js` en GitHub (ícono ✏️), pegá `SUPABASE_URL` y `SUPABASE_ANON_KEY` (va la Publishable key) → *Commit*. Así todos los teléfonos quedan conectados automáticamente.
- **B:** sin tocar el código, abrí la app, pegá la URL y la clave en la pantalla **"Conectar con el servidor familiar"**. Los enlaces que les compartas a tus hijos ya incluyen esos datos.

---

## 👨‍👩‍👧 Crear las cuentas

**Padre o madre (administrador):**
1. Abrí la app → pestaña **Papá / Mamá** → **"¿Primera vez? Crear cuenta familiar"**.
2. Completá el nombre de la familia, tu nombre, tu correo y una contraseña → **Crear familia**.
3. Se genera el **código familiar** (por ejemplo, `K7MP2Q`), visible en **Más → Familia**.

**Hijos:**
1. **Más → Miembros → ➕ Hijo/a** → nombre, **usuario** (ej. `sofi`), color y foto → **Guardar**.
2. Se abre **Crear acceso**: elegí un **PIN de 6 números** → **Crear acceso**.
3. Tocá **📤 Enviar por WhatsApp**: le llega el enlace, el código familiar, el usuario y el PIN.

**Segundo administrador (otro padre o madre):** **Más → Miembros → ➕ Administrador** → usuario + PIN. Ingresa por la pestaña "Hijo / Hija" con esos datos y tiene permisos completos.

**¿Se olvidó el PIN o cambió de teléfono?** Más → Miembros → tocá el nombre → **🔑 Cambiar PIN / nuevo acceso**. El PIN anterior deja de funcionar y el historial se conserva.

## 📲 Vincular los teléfonos

Cada hijo, desde su propio celular:
1. Abre el **enlace que le enviaste por WhatsApp**. Ya trae el servidor, el código familiar y el usuario.
2. Elige **Hijo / Hija** → escribe el **PIN** → **Entrar**.
3. Desde ese momento todo se sincroniza en tiempo real: las fotos que envía aparecen al instante en **PENDIENTES DE VERIFICACIÓN** del padre, y la aprobación actualiza la barra de progreso del hijo.

## 📥 Instalar en Android

1. Abrí la app en **Google Chrome**.
2. Menú **⋮** → **"Instalar app"** (o **"Agregar a la pantalla principal"**). También podés usar el botón **⬇️ Instalar la app** dentro de la app, si aparece.
3. Queda un ícono en el inicio y la app se abre a pantalla completa, como una app nativa.
4. Al primer ingreso, tocá **🔔 Activar notificaciones** (Más o Perfil) y aceptá el permiso.

---

## 🔔 Notificaciones

| Aviso | Cómo llega |
|---|---|
| Nueva evidencia (al padre) · Aprobada / Rechazada / Nueva foto (al hijo) · Meta semanal · Recompensa en uso | En tiempo real dentro de la app (🔔 y aviso emergente) y como notificación del sistema si la app está abierta o en segundo plano |
| Actividades pendientes y hora límite próxima | Recordatorio en el teléfono del hijo mientras la app esté abierta (30 min antes de la hora límite y a partir de las 17 h) |
| **Con la app cerrada** | Requiere el paso 6 (opcional, gratis) |

## 6️⃣ (Opcional) Notificaciones push con la app cerrada

1. **Claves:** en la app (administrador) → **Más → Notificaciones push → Generar / cargar claves VAPID** → **Generar claves nuevas** → **Guardar clave pública**. Copiá también la **clave privada** (es secreta).
2. **Función:** Supabase → **Edge Functions** → **Deploy a new function → Via Editor** → nombre **`send-push`** → pegá el contenido de `supabase/functions/send-push/index.ts` → **Deploy**.
3. **Secretos:** Edge Functions → **Secrets** → agregá:
   - `VAPID_PUBLIC_KEY` = clave pública
   - `VAPID_PRIVATE_KEY` = clave privada
   - `VAPID_SUBJECT` = `mailto:tucorreo@gmail.com`
4. **Disparador:** **Database → Webhooks → Create a new hook**:
   - Table: `notifications` · Events: **Insert**
   - Type: **Supabase Edge Functions** → función `send-push` · Method POST
   - Activá **"Add auth header with service key"** → *Create*.
5. En cada teléfono: cerrá sesión, volvé a entrar y tocá **Activar notificaciones**.

**Recordatorio diario automático (opcional):** Database → Extensions → activá **pg_cron**, y ejecutá `supabase/recordatorios-opcional.sql` en el SQL Editor. Todos los días, a las 18:00 (hora de Paraguay), avisa a cada hijo que tenga actividades pendientes.

---

## 💾 Copias de seguridad

**Más → Copias de seguridad:**
- **⬇️ Descargar respaldo**: genera `micasa-respaldo-AAAA-MM-DD.json` con miembros, actividades, historial completo, configuración, recompensas y premios del viernes. Si activás **"Incluir fotografías"**, las fotos se agregan dentro del archivo, que pesa más.
- **⬆️ Restaurar**: elegí un archivo de respaldo. Los registros se agregan o actualizan y nada se borra. Si restaurás en un proyecto nuevo, después creá otra vez el acceso (PIN) de cada hijo.
- Ahí también se ve la **fecha del último respaldo**.
- Recomendación: descargá un respaldo una vez por semana y guardalo en Google Drive.

**Fotos:** en **Más → Fotografías** podés elegir la calidad (optimizada o alta), definir los días de conservación, activar el borrado automático o limpiar las fotos antiguas a mano. Al borrar una foto, el registro de la actividad se mantiene.

---

## 📊 Cómo se calculan el progreso y los premios

- **Progreso diario** = actividades aprobadas ÷ actividades asignadas × 100. Solo avanza cuando el padre **aprueba**.
- Las actividades marcadas **"No aplica hoy"** (o desactivadas) **no cuentan** en el porcentaje.
- Las actividades no realizadas pasan a **vencida** al día siguiente y sí cuentan como asignadas.
- **Racha**: días seguidos con el 100 %. Los días sin actividades no cortan la racha.
- **Privilegios diarios**: se habilitan al llegar al % configurado del día. El hijo toca **"Usar ahora"** y corre una cuenta regresiva visible para todos. Se puede usar una vez por día.
- **Viernes de recompensa**: desde el viernes, si el cumplimiento de **lunes a viernes** alcanza la meta (85 %, 90 %, 100 % o la que elijas), se desbloquea. Los hijos votan entre 🍽️ cena y 🛵 delivery, y el padre aprueba y registra la elección. Puede ser **individual** o una **meta familiar** compartida.
- Comidas, higiene, descanso, salud y necesidades básicas **nunca** se condicionan: los hábitos se registran como hábitos y las recompensas son solo privilegios extra.

## 🔒 Seguridad

- Contraseña para los padres; usuario y PIN de 6 dígitos para los hijos.
- Reglas RLS en la base de datos: cada familia está aislada de las demás, los hijos solo envían evidencias de sus propias actividades del día, y aprobar, editar o configurar es exclusivo de los administradores. Probado contra intentos de acceso desde otra familia.
- Fotos en un depósito **privado**: se abren con enlaces temporales de 1 hora, y cada hijo solo ve sus propias fotos.
- Comunicación cifrada por HTTPS (GitHub Pages + Supabase).

## ⚠️ Plan gratuito de Supabase

- Incluye 500 MB de base de datos y 1 GB de fotos, más que suficiente para una familia con fotos optimizadas (unos 150–250 KB cada una).
- **Un proyecto gratuito se pausa si pasa 7 días sin uso.** Con el uso diario de la familia no ocurre. Si alguna vez se pausa (por ejemplo, en vacaciones), entrá a supabase.com y tocá **Restore**: los datos se conservan.

## 🛠️ Problemas frecuentes

| Problema | Solución |
|---|---|
| "Supabase pide confirmar el correo" al crear un acceso | Desactivá **Confirm email** (paso 3) |
| "No se encontró ese usuario en la familia" | Revisá el código familiar y el usuario. El acceso tiene que estar creado con PIN |
| El hijo no ve una actividad nueva | Se genera para el día en curso. Las extraordinarias aparecen en su fecha. Revisá los días asignados |
| No llegan notificaciones con la app cerrada | Hacé el paso 6 y volvé a activar las notificaciones en cada teléfono |
| Actualicé archivos en GitHub y no veo cambios | Cerrá la app por completo y abrila de nuevo (con conexión) |
