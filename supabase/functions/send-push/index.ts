// Supabase Edge Function: send-push
// La llama la base de datos (trigger micasa_push_notify) cada vez que se crea una
// notificación. Solo recibe el id: el contenido se lee de la base de datos con la
// clave de servicio, así nadie puede enviar mensajes inventados aunque conozca la URL.
//
// Secretos (Edge Functions → Secrets): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY ya existen por defecto.
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

const TAB: Record<string, string> = { friday: 'rewards', reward: 'rewards' };

Deno.serve(async (req) => {
  try {
    const payload = await req.json().catch(() => ({}));
    const id = payload?.record?.id ?? payload?.id;
    if (!id) return new Response('sin id', { status: 400 });

    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: n } = await sb.from('notifications').select('id, profile_id, type, title, body, created_at').eq('id', id).maybeSingle();
    if (!n) return new Response('no existe', { status: 404 });
    // Solo notificaciones recientes (evita reenvíos repetidos)
    if (Date.now() - new Date(n.created_at).getTime() > 10 * 60 * 1000) return new Response('antigua', { status: 200 });

    // Claves: primero de los secretos de la función; si no están, de la base de datos (privadas)
    let pub = Deno.env.get('VAPID_PUBLIC_KEY'), priv = Deno.env.get('VAPID_PRIVATE_KEY');
    if (!pub || !priv) {
      const { data: k } = await sb.rpc('micasa_push_keys');
      pub = k?.public_key; priv = k?.private_key;
    }
    if (!pub || !priv) return new Response('faltan claves VAPID', { status: 500 });
    webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') ?? 'https://nutricrispy-oss.github.io/micasa_hijos/', pub, priv);
    const { data: subs } = await sb.from('push_subscriptions').select('id, subscription').eq('profile_id', n.profile_id);
    const body = JSON.stringify({ title: n.title, body: n.body, tag: n.type, tab: TAB[n.type] ?? 'home' });
    let sent = 0;
    for (const s of subs ?? []) {
      try { await webpush.sendNotification(s.subscription, body, { TTL: 60 * 60 * 12 }); sent++; }
      catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await sb.from('push_subscriptions').delete().eq('id', s.id);
      }
    }
    return new Response(JSON.stringify({ sent }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(String(e), { status: 500 });
  }
});
