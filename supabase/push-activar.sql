-- Activa el envío push: cada notificación nueva llama a la función send-push.
-- Requiere la extensión pg_net (incluida en Supabase).
-- Antes de ejecutar, reemplazá PEGAR_CLAVE_PRIVADA por la clave privada VAPID.

-- Claves VAPID guardadas en un esquema privado (la app nunca puede leerlas)
create schema if not exists micasa_private;
revoke all on schema micasa_private from public, anon, authenticated;
create table if not exists micasa_private.push_keys (id int primary key default 1 check (id = 1), public_key text not null, private_key text not null);
insert into micasa_private.push_keys(id, public_key, private_key)
values (1, 'PEGAR_CLAVE_PUBLICA', 'PEGAR_CLAVE_PRIVADA')
on conflict (id) do update set public_key = excluded.public_key, private_key = excluded.private_key;

create or replace function public.micasa_push_keys() returns jsonb
language sql stable security definer set search_path = micasa_private as $$
  select jsonb_build_object('public_key', public_key, 'private_key', private_key) from micasa_private.push_keys where id = 1
$$;
revoke execute on function public.micasa_push_keys() from public, anon, authenticated;
grant execute on function public.micasa_push_keys() to service_role;

create extension if not exists pg_net with schema extensions;

create or replace function public.micasa_push_notify() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform net.http_post(
    url     := 'https://rujhmxkdhdbavdruudbr.supabase.co/functions/v1/send-push',
    body    := jsonb_build_object('id', new.id),
    headers := '{"Content-Type":"application/json"}'::jsonb,
    timeout_milliseconds := 5000
  );
  return new;
exception when others then
  return new; -- si falla el push, la notificación igual se guarda
end $$;

drop trigger if exists micasa_push_notify on public.notifications;
create trigger micasa_push_notify after insert on public.notifications
  for each row execute function public.micasa_push_notify();

-- Recordatorio diario a las 18:00 de Paraguay (21:00 UTC) para hijos con tareas pendientes
create extension if not exists pg_cron;
select cron.unschedule('micasa-recordatorio-diario') where exists (select 1 from cron.job where jobname = 'micasa-recordatorio-diario');
select cron.schedule('micasa-recordatorio-diario', '0 21 * * *', $$ select public.send_daily_reminders(); $$);
