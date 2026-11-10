-- OPCIONAL: recordatorio automático diario a los hijos con actividades pendientes.
-- 1) Supabase → Database → Extensions → activar "pg_cron".
-- 2) Ejecutar esto en el SQL Editor.
-- La hora del cron está en UTC: 21:00 UTC = 18:00 en Paraguay (UTC-3).

select cron.schedule('micasa-recordatorio-diario', '0 21 * * *', $$ select public.send_daily_reminders(); $$);

-- Para quitarlo:
-- select cron.unschedule('micasa-recordatorio-diario');
