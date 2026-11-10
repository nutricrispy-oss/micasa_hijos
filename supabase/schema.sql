-- =====================================================================
--  MI CASA – MIS RESPONSABILIDADES
--  Estructura de base de datos para Supabase (PostgreSQL)
--  Cómo usar: Supabase → SQL Editor → New query → pegar TODO → Run.
--  Se puede ejecutar más de una vez sin romper nada.
-- =====================================================================

-- (usa gen_random_uuid(), incluido en PostgreSQL; no requiere extensiones)

-- ---------------------------------------------------------------------
-- 1. TABLAS
-- ---------------------------------------------------------------------

-- Familia (una cuenta familiar = un "espacio" privado)
create table if not exists public.families (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  code        text not null unique,              -- código para vincular teléfonos
  settings    jsonb not null default '{}'::jsonb, -- umbral semanal, modo viernes, fotos, zona horaria…
  created_at  timestamptz not null default now()
);

-- Miembros: padres (admin) e hijos (child)
create table if not exists public.profiles (
  id            uuid primary key default gen_random_uuid(),
  family_id     uuid not null references public.families(id) on delete cascade,
  user_id       uuid unique references auth.users(id) on delete set null, -- cuenta de acceso vinculada
  role          text not null check (role in ('admin','child')),
  display_name  text not null,
  username      text,
  login_email   text,
  avatar        text,                    -- imagen pequeña (data URL)
  color         text default '#4f46e5',
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (family_id, username)
);

-- Invitaciones de un solo uso para crear/restablecer el acceso de un miembro
create table if not exists public.invites (
  token       uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  used_at     timestamptz
);

-- Actividades (plantillas que se repiten)
create table if not exists public.activities (
  id              uuid primary key default gen_random_uuid(),
  family_id       uuid not null references public.families(id) on delete cascade,
  child_id        uuid not null references public.profiles(id) on delete cascade,
  title           text not null,
  description     text not null default '',
  category        text not null default 'Otras',
  icon            text not null default '✅',
  image           text,                       -- foto ilustrativa opcional (data URL)
  frequency       text not null default 'daily' check (frequency in ('daily','weekly','custom','once')),
  days            int[] not null default '{0,1,2,3,4,5,6}', -- 0=domingo … 6=sábado
  once_date       date,                       -- para actividades extraordinarias
  start_date      date not null default current_date,
  due_time        text,                       -- 'HH:MM'
  points          int not null default 10,
  requires_photo  boolean not null default true,
  is_habit        boolean not null default false,
  active          boolean not null default true,
  deleted         boolean not null default false,
  created_at      timestamptz not null default now()
);

-- Actividad de un día concreto (lo que el hijo realiza y el padre aprueba)
create table if not exists public.task_instances (
  id              uuid primary key default gen_random_uuid(),
  family_id       uuid not null references public.families(id) on delete cascade,
  activity_id     uuid references public.activities(id) on delete set null,
  child_id        uuid not null references public.profiles(id) on delete cascade,
  date            date not null,
  title           text not null,
  description     text not null default '',
  category        text not null default 'Otras',
  icon            text not null default '✅',
  points          int not null default 10,
  requires_photo  boolean not null default true,
  is_habit        boolean not null default false,
  due_time        text,
  status          text not null default 'pending'
                  check (status in ('pending','submitted','approved','rejected','redo','expired','cancelled')),
  photo_path      text,
  photo_deleted   boolean not null default false,
  submitted_at    timestamptz,
  late            boolean not null default false,
  attempts        int not null default 0,
  reviewed_at     timestamptz,
  reviewed_by     uuid references public.profiles(id) on delete set null,
  note            text,
  created_at      timestamptz not null default now(),
  unique (activity_id, date)
);
create index if not exists ti_family_date on public.task_instances(family_id, date);
create index if not exists ti_child_date  on public.task_instances(child_id, date);

-- Recompensas / privilegios diarios
create table if not exists public.rewards (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families(id) on delete cascade,
  child_id    uuid references public.profiles(id) on delete cascade, -- null = para todos los hijos
  name        text not null,
  icon        text not null default '🎁',
  minutes     int not null default 60,
  min_pct     int not null default 100,  -- % del día necesario para habilitarla
  description text not null default '',
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Uso de recompensas
create table if not exists public.reward_uses (
  id           uuid primary key default gen_random_uuid(),
  family_id    uuid not null references public.families(id) on delete cascade,
  child_id     uuid not null references public.profiles(id) on delete cascade,
  reward_id    uuid references public.rewards(id) on delete set null,
  reward_name  text not null,
  date         date not null,
  minutes      int not null,
  started_at   timestamptz not null default now(),
  unique (child_id, reward_id, date)
);

-- Viernes de recompensa
create table if not exists public.friday_rewards (
  id           uuid primary key default gen_random_uuid(),
  family_id    uuid not null references public.families(id) on delete cascade,
  week_start   date not null,            -- lunes de la semana
  scope        text not null,            -- 'family' o el id del hijo
  child_id     uuid references public.profiles(id) on delete cascade,
  pct          numeric not null,
  status       text not null default 'unlocked' check (status in ('unlocked','approved','done')),
  votes        jsonb not null default '{}'::jsonb,
  choice       text check (choice in ('cena','delivery')),
  approved_by  uuid references public.profiles(id) on delete set null,
  approved_at  timestamptz,
  created_at   timestamptz not null default now(),
  unique (family_id, week_start, scope)
);

-- Notificaciones internas (también disparan push si se configura)
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  type        text not null,
  title       text not null,
  body        text not null default '',
  ref         text,
  read        boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists notif_profile on public.notifications(profile_id, created_at desc);

-- Suscripciones push de cada teléfono
create table if not exists public.push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  family_id     uuid not null references public.families(id) on delete cascade,
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  endpoint      text not null unique,
  subscription  jsonb not null,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2. FUNCIONES AUXILIARES DE SEGURIDAD
-- ---------------------------------------------------------------------
create or replace function public.my_profile() returns uuid
language sql stable security definer set search_path = public as $$
  select id from profiles where user_id = auth.uid() and active limit 1
$$;

create or replace function public.my_family() returns uuid
language sql stable security definer set search_path = public as $$
  select family_id from profiles where user_id = auth.uid() and active limit 1
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from profiles where user_id = auth.uid() and active and role = 'admin')
$$;

-- Fecha "de hoy" según la zona horaria de la familia
create or replace function public.fam_today(fam uuid) returns date
language sql stable security definer set search_path = public as $$
  select (now() at time zone coalesce(
            (select settings->>'timezone' from families where id = fam), 'America/Asuncion'))::date
$$;

create or replace function public.notify(p_family uuid, p_profile uuid, p_type text,
                                         p_title text, p_body text, p_ref text default null)
returns void language sql security definer set search_path = public as $$
  insert into notifications(family_id, profile_id, type, title, body, ref)
  values (p_family, p_profile, p_type, p_title, coalesce(p_body,''), p_ref)
$$;

-- ---------------------------------------------------------------------
-- 3. ALTA DE CUENTAS (se ejecuta al registrarse un usuario)
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  meta  jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_inv invites;
  v_fam uuid;
  v_code text;
begin
  if meta ? 'invite' then
    select * into v_inv from invites
     where token = (meta->>'invite')::uuid and used_at is null
       and created_at > now() - interval '1 day'
     for update;
    if not found then
      raise exception 'Invitación inválida o vencida';
    end if;
    update profiles set user_id = new.id, login_email = new.email where id = v_inv.profile_id;
    update invites set used_at = now() where token = v_inv.token;
  elsif meta ? 'family_name' then
    loop
      v_code := '';
      for i in 1..6 loop
        v_code := v_code || substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1);
      end loop;
      exit when not exists (select 1 from families where code = v_code);
    end loop;
    insert into families(name, code, settings)
    values (meta->>'family_name', v_code,
            jsonb_build_object(
              'timezone', coalesce(meta->>'timezone', 'America/Asuncion'),
              'weekly_threshold', 90,
              'friday_mode', 'individual',
              'photo_retention_days', 90,
              'photo_quality', 'optimized'))
    returning id into v_fam;
    insert into profiles(family_id, user_id, role, display_name, login_email)
    values (v_fam, new.id, 'admin', coalesce(nullif(meta->>'display_name',''), 'Administrador'), new.email);
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Busca el correo interno de un hijo a partir del código familiar + usuario (para iniciar sesión con PIN)
create or replace function public.resolve_login(p_code text, p_username text) returns text
language sql stable security definer set search_path = public as $$
  select p.login_email from profiles p join families f on f.id = p.family_id
   where f.code = upper(trim(p_code)) and lower(p.username) = lower(trim(p_username))
     and p.active and p.user_id is not null
   limit 1
$$;

-- El padre crea una invitación de un solo uso para dar acceso a un miembro
create or replace function public.create_invite(p_profile uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare t uuid;
begin
  if not is_admin() then raise exception 'Solo los administradores pueden crear accesos'; end if;
  if not exists (select 1 from profiles where id = p_profile and family_id = my_family()) then
    raise exception 'Miembro no encontrado';
  end if;
  insert into invites(family_id, profile_id, created_by) values (my_family(), p_profile, my_profile())
  returning token into t;
  return t;
end $$;

-- ---------------------------------------------------------------------
-- 4. LÓGICA DE ACTIVIDADES
-- ---------------------------------------------------------------------

-- Genera las actividades del día y marca como vencidas las de días anteriores
create or replace function public.ensure_today() returns date
language plpgsql security definer set search_path = public as $$
declare fam uuid := my_family(); d date; dw int;
begin
  if fam is null then raise exception 'Sin acceso'; end if;
  d := fam_today(fam);
  dw := extract(dow from d)::int;

  update task_instances set status = 'expired'
   where family_id = fam and date < d and status in ('pending','redo');

  insert into task_instances(family_id, activity_id, child_id, date, title, description, category,
                             icon, points, requires_photo, is_habit, due_time)
  select a.family_id, a.id, a.child_id, d, a.title, a.description, a.category,
         a.icon, a.points, a.requires_photo, a.is_habit, a.due_time
    from activities a join profiles p on p.id = a.child_id and p.active
   where a.family_id = fam and a.active and not a.deleted and a.start_date <= d
     and ((a.frequency = 'once' and a.once_date = d)
       or (a.frequency <> 'once' and dw = any(a.days)))
  on conflict (activity_id, date) do nothing;
  return d;
end $$;

-- El hijo envía su evidencia
create or replace function public.submit_task(p_id uuid, p_photo text default null) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := my_profile(); fam uuid := my_family(); t task_instances; tz text; d date;
begin
  select * into t from task_instances where id = p_id and child_id = me for update;
  if not found then raise exception 'Actividad no encontrada'; end if;
  d := fam_today(fam);
  if t.date <> d then raise exception 'Solo se pueden enviar actividades del día'; end if;
  if t.status not in ('pending','rejected','redo') then
    raise exception 'Esta actividad ya fue enviada o no está disponible';
  end if;
  if t.requires_photo and coalesce(p_photo,'') = '' then
    raise exception 'Esta actividad necesita una fotografía';
  end if;
  if p_photo is not null and p_photo not like fam::text || '/' || me::text || '/%' then
    raise exception 'Ruta de foto no permitida';
  end if;
  select coalesce(settings->>'timezone','America/Asuncion') into tz from families where id = fam;
  update task_instances set
    status = 'submitted', photo_path = coalesce(p_photo, photo_path), photo_deleted = false,
    submitted_at = now(), attempts = attempts + 1,
    late = coalesce(t.due_time ~ '^\d{1,2}:\d{2}$' and (now() at time zone tz)::time > t.due_time::time, false)
  where id = p_id;
end $$;

-- El padre aprueba, rechaza o pide nueva foto
create or replace function public.review_task(p_id uuid, p_action text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare t task_instances;
begin
  if not is_admin() then raise exception 'Solo los administradores pueden revisar'; end if;
  if p_action not in ('approve','reject','redo') then raise exception 'Acción inválida'; end if;
  select * into t from task_instances where id = p_id and family_id = my_family() for update;
  if not found then raise exception 'Actividad no encontrada'; end if;
  if t.status = 'cancelled' then raise exception 'La actividad está cancelada'; end if;
  update task_instances set
    status = case p_action when 'approve' then 'approved' when 'reject' then 'rejected' else 'redo' end,
    note = nullif(trim(coalesce(p_note,'')), ''),
    reviewed_at = now(), reviewed_by = my_profile()
  where id = p_id;
end $$;

-- Notificaciones automáticas cuando cambia el estado de una actividad
create or replace function public.on_task_status() returns trigger
language plpgsql security definer set search_path = public as $$
declare kid text; a record;
begin
  if new.status is not distinct from old.status and new.attempts = old.attempts then return new; end if;
  select display_name into kid from profiles where id = new.child_id;
  if new.status = 'submitted' then
    for a in select id from profiles where family_id = new.family_id and role = 'admin' and active loop
      perform notify(new.family_id, a.id, 'evidence', '📸 Nueva evidencia',
                     kid || ' envió: ' || new.title, new.id::text);
    end loop;
  elsif new.status = 'approved' then
    perform notify(new.family_id, new.child_id, 'approved', '✅ ¡Actividad aprobada!', new.title, new.id::text);
  elsif new.status = 'rejected' then
    perform notify(new.family_id, new.child_id, 'rejected', '⚠️ Necesita corrección',
                   new.title || coalesce(': ' || new.note, ''), new.id::text);
  elsif new.status = 'redo' then
    perform notify(new.family_id, new.child_id, 'redo', '📷 Enviá una nueva foto',
                   new.title || coalesce(': ' || new.note, ''), new.id::text);
  end if;
  return new;
end $$;

drop trigger if exists task_status_notify on public.task_instances;
create trigger task_status_notify after update on public.task_instances
  for each row execute function public.on_task_status();

-- ---------------------------------------------------------------------
-- 5. RECOMPENSAS
-- ---------------------------------------------------------------------
create or replace function public.day_pct(p_child uuid, p_date date) returns numeric
language sql stable security definer set search_path = public as $$
  select case when count(*) filter (where status <> 'cancelled') = 0 then 0
         else round(count(*) filter (where status = 'approved') * 100.0
                    / count(*) filter (where status <> 'cancelled'), 1) end
    from task_instances where child_id = p_child and date = p_date
$$;

create or replace function public.use_reward(p_reward uuid) returns public.reward_uses
language plpgsql security definer set search_path = public as $$
declare me uuid := my_profile(); fam uuid := my_family(); r rewards; d date; u reward_uses; a record; kid text;
begin
  select * into r from rewards
   where id = p_reward and family_id = fam and active and (child_id is null or child_id = me);
  if not found then raise exception 'Recompensa no disponible'; end if;
  d := fam_today(fam);
  if (select count(*) from task_instances where child_id = me and date = d and status <> 'cancelled') = 0 then
    raise exception 'Hoy no tenés actividades asignadas';
  end if;
  if day_pct(me, d) < r.min_pct then
    raise exception '%', format('Necesitás llegar al %s%% del día para usar esta recompensa', r.min_pct);
  end if;
  if exists (select 1 from reward_uses where child_id = me and reward_id = r.id and date = d) then
    raise exception 'Ya usaste esta recompensa hoy';
  end if;
  insert into reward_uses(family_id, child_id, reward_id, reward_name, date, minutes)
  values (fam, me, r.id, r.name, d, r.minutes) returning * into u;
  select display_name into kid from profiles where id = me;
  for a in select id from profiles where family_id = fam and role = 'admin' and active loop
    perform notify(fam, a.id, 'reward', '🎁 Recompensa en uso',
                   kid || ' empezó: ' || r.name || ' (' || r.minutes || ' min)', u.id::text);
  end loop;
  return u;
end $$;

-- Evalúa el Viernes de recompensa de la semana actual (lunes a viernes)
create or replace function public.refresh_friday() returns void
language plpgsql security definer set search_path = public as $$
declare fam uuid := my_family(); d date; ws date; s jsonb; thr numeric; mode text;
        c record; tot int; ok int; n int; m record;
begin
  if fam is null then return; end if;
  d := fam_today(fam);
  if extract(isodow from d) < 5 then return; end if;      -- solo desde el viernes
  ws := d - (extract(isodow from d)::int - 1);
  select settings into s from families where id = fam;
  thr  := coalesce((s->>'weekly_threshold')::numeric, 90);
  mode := coalesce(s->>'friday_mode', 'individual');

  if mode = 'family' then
    select count(*) filter (where status <> 'cancelled'), count(*) filter (where status = 'approved')
      into tot, ok from task_instances
     where family_id = fam and date between ws and ws + 4;
    if tot > 0 and ok * 100.0 / tot >= thr then
      insert into friday_rewards(family_id, week_start, scope, child_id, pct)
      values (fam, ws, 'family', null, round(ok * 100.0 / tot, 1))
      on conflict (family_id, week_start, scope) do nothing;
      get diagnostics n = row_count;
      if n > 0 then
        for m in select id from profiles where family_id = fam and active loop
          perform notify(fam, m.id, 'friday', '🎉 ¡Meta semanal familiar alcanzada!',
                         'Se desbloqueó el Viernes de recompensa. ¡A votar: cena o delivery!', ws::text);
        end loop;
      end if;
    end if;
  else
    for c in select id, display_name from profiles where family_id = fam and role = 'child' and active loop
      select count(*) filter (where status <> 'cancelled'), count(*) filter (where status = 'approved')
        into tot, ok from task_instances
       where child_id = c.id and date between ws and ws + 4;
      if tot > 0 and ok * 100.0 / tot >= thr then
        insert into friday_rewards(family_id, week_start, scope, child_id, pct)
        values (fam, ws, c.id::text, c.id, round(ok * 100.0 / tot, 1))
        on conflict (family_id, week_start, scope) do nothing;
        get diagnostics n = row_count;
        if n > 0 then
          perform notify(fam, c.id, 'friday', '🎉 ¡Meta semanal alcanzada!',
                         'Desbloqueaste el Viernes de recompensa. Elegí: cena o delivery.', ws::text);
          for m in select id from profiles where family_id = fam and role = 'admin' and active loop
            perform notify(fam, m.id, 'friday', '🎉 Meta semanal alcanzada',
                           c.display_name || ' desbloqueó el Viernes de recompensa', ws::text);
          end loop;
        end if;
      end if;
    end loop;
  end if;
end $$;

create or replace function public.vote_friday(p_id uuid, p_option text) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := my_profile(); f friday_rewards;
begin
  if p_option not in ('cena','delivery') then raise exception 'Opción inválida'; end if;
  select * into f from friday_rewards where id = p_id and family_id = my_family() for update;
  if not found then raise exception 'Premio no encontrado'; end if;
  if f.status <> 'unlocked' then raise exception 'La votación ya cerró'; end if;
  if f.scope <> 'family' and f.scope <> me::text then raise exception 'Este premio no es tuyo'; end if;
  update friday_rewards set votes = votes || jsonb_build_object(me::text, p_option) where id = p_id;
end $$;

-- Recordatorio diario (opcional: programarlo con pg_cron, ver guía)
create or replace function public.send_daily_reminders() returns void
language plpgsql security definer set search_path = public as $$
declare c record;
begin
  for c in
    select t.family_id, t.child_id, count(*) n
      from task_instances t join profiles p on p.id = t.child_id and p.active
     where t.date = fam_today(t.family_id) and t.status in ('pending','rejected','redo')
     group by t.family_id, t.child_id
  loop
    perform notify(c.family_id, c.child_id, 'reminder', '⏰ Te faltan actividades',
                   'Tenés ' || c.n || ' actividad(es) por completar hoy.', null);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 6. SEGURIDAD POR FILAS (RLS)
-- ---------------------------------------------------------------------
alter table public.families           enable row level security;
alter table public.profiles           enable row level security;
alter table public.invites            enable row level security;
alter table public.activities         enable row level security;
alter table public.task_instances     enable row level security;
alter table public.rewards            enable row level security;
alter table public.reward_uses        enable row level security;
alter table public.friday_rewards     enable row level security;
alter table public.notifications      enable row level security;
alter table public.push_subscriptions enable row level security;

do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public' loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- Familia
create policy fam_select on public.families for select to authenticated using (id = my_family());
create policy fam_update on public.families for update to authenticated
  using (id = my_family() and is_admin()) with check (id = my_family());

-- Miembros
create policy prof_select on public.profiles for select to authenticated using (family_id = my_family());
create policy prof_insert on public.profiles for insert to authenticated
  with check (family_id = my_family() and is_admin());
create policy prof_update on public.profiles for update to authenticated
  using (family_id = my_family() and is_admin()) with check (family_id = my_family());
create policy prof_delete on public.profiles for delete to authenticated
  using (family_id = my_family() and is_admin() and id <> my_profile());

-- Actividades
create policy act_select on public.activities for select to authenticated using (family_id = my_family());
create policy act_admin  on public.activities for all to authenticated
  using (family_id = my_family() and is_admin()) with check (family_id = my_family() and is_admin());

-- Actividades del día (los hijos solo leen; envían por submit_task)
create policy ti_select on public.task_instances for select to authenticated using (family_id = my_family());
create policy ti_admin  on public.task_instances for all to authenticated
  using (family_id = my_family() and is_admin()) with check (family_id = my_family() and is_admin());

-- Recompensas
create policy rw_select on public.rewards for select to authenticated using (family_id = my_family());
create policy rw_admin  on public.rewards for all to authenticated
  using (family_id = my_family() and is_admin()) with check (family_id = my_family() and is_admin());

create policy ru_select on public.reward_uses for select to authenticated using (family_id = my_family());
create policy ru_admin  on public.reward_uses for delete to authenticated using (family_id = my_family() and is_admin());

-- Viernes
create policy fr_select on public.friday_rewards for select to authenticated using (family_id = my_family());
create policy fr_admin  on public.friday_rewards for all to authenticated
  using (family_id = my_family() and is_admin()) with check (family_id = my_family() and is_admin());

-- Notificaciones (cada uno ve las suyas)
create policy nt_select on public.notifications for select to authenticated using (profile_id = my_profile());
create policy nt_update on public.notifications for update to authenticated
  using (profile_id = my_profile()) with check (profile_id = my_profile());
create policy nt_delete on public.notifications for delete to authenticated using (profile_id = my_profile());

-- Push
create policy ps_own on public.push_subscriptions for all to authenticated
  using (profile_id = my_profile()) with check (profile_id = my_profile() and family_id = my_family());

-- Columnas protegidas: nadie puede cambiar user_id / login_email desde la app
revoke insert, update on public.profiles from authenticated, anon;
grant insert (id, family_id, role, display_name, username, avatar, color, active) on public.profiles to authenticated;
grant update (id, family_id, role, display_name, username, avatar, color, active) on public.profiles to authenticated;
revoke update on public.notifications from authenticated, anon;
grant update (read) on public.notifications to authenticated;
revoke all on public.invites from anon, authenticated;

-- Funciones: el visitante sin sesión solo puede resolver el inicio de sesión
revoke execute on function public.resolve_login(text, text) from public;
grant execute on function public.resolve_login(text, text) to anon, authenticated;
revoke execute on function public.send_daily_reminders() from public, anon, authenticated;
revoke execute on function public.notify(uuid, uuid, text, text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 7. FOTOS PRIVADAS (Storage)
--    Ruta: <familia>/<hijo>/<fecha>/<archivo>.jpg
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('evidencias', 'evidencias', false)
on conflict (id) do update set public = false;

drop policy if exists evid_select on storage.objects;
drop policy if exists evid_insert on storage.objects;
drop policy if exists evid_delete on storage.objects;

create policy evid_select on storage.objects for select to authenticated using (
  bucket_id = 'evidencias'
  and (storage.foldername(name))[1] = public.my_family()::text
  and (public.is_admin() or (storage.foldername(name))[2] = public.my_profile()::text));

create policy evid_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'evidencias'
  and (storage.foldername(name))[1] = public.my_family()::text
  and (public.is_admin() or (storage.foldername(name))[2] = public.my_profile()::text));

create policy evid_delete on storage.objects for delete to authenticated using (
  bucket_id = 'evidencias'
  and (storage.foldername(name))[1] = public.my_family()::text
  and public.is_admin());

-- ---------------------------------------------------------------------
-- 8. TIEMPO REAL (sincronización instantánea entre teléfonos)
-- ---------------------------------------------------------------------
do $$ begin
  begin alter publication supabase_realtime add table public.notifications;  exception when others then null; end;
  begin alter publication supabase_realtime add table public.task_instances; exception when others then null; end;
  begin alter publication supabase_realtime add table public.friday_rewards; exception when others then null; end;
  begin alter publication supabase_realtime add table public.reward_uses;    exception when others then null; end;
end $$;

-- Listo ✅
