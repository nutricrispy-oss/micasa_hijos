// Supabase Edge Function: send-push
// Se ejecuta con un "Database Webhook" cada vez que se inserta una fila en public.notifications
// y envía la notificación push a todos los teléfonos del destinatario.
//
// Secretos necesarios (Edge Functions → Secrets):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (ej: mailto:tu-correo@gmail.com)
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY ya existen por defecto.
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

const TAB: Record<string, string> = { evidence: 'home', approved: 'home', rejected: 'home', redo: 'home', reminder: 'home', friday: 'rewards', reward: 'rewards' };

Deno.serve(async (req) => {
  try {
    const payload = await req.json();
    const rec = payload.record ?? payload;
    if (!rec?.profile_id) return new Response('sin destinatario', { status: 200 });

    webpush.setVapidDetails(
      Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com',
      Deno.env.get('VAPID_PUBLIC_KEY')!,
      Deno.env.get('VAPID_PRIVATE_KEY')!,
    );
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: subs } = await sb.from('push_subscriptions').select('id, subscription').eq('profile_id', rec.profile_id);

    const body = JSON.stringify({ title: rec.title, body: rec.body, tag: rec.type, tab: TAB[rec.type] ?? 'home' });
    let sent = 0;
    for (const s of subs ?? []) {
      try { await webpush.sendNotification(s.subscription, body, { TTL: 60 * 60 * 12 }); sent++; }
      catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await sb.from('push_subscriptions').delete().eq('id', s.id); // teléfono ya no suscrito
      }
    }
    return new Response(JSON.stringify({ sent }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(String(e), { status: 500 });
  }
});
