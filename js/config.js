// =====================================================================
//  CONFIGURACIÓN DEL SERVIDOR (Supabase)
//  Opción A: pegá aquí los datos de tu proyecto (Project Settings → API).
//  Opción B: dejalo vacío y cargalos desde la pantalla inicial de la app.
//  La "anon public key" es pública por diseño: la seguridad la dan las
//  reglas RLS de la base de datos.
// =====================================================================
export const CONFIG = {
  SUPABASE_URL: 'https://rujhmxkdhdbavdruudbr.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_id0woysUO6GYDyNlNPQBhw_oL1R3n9a',
  // Clave pública para notificaciones push (la privada está solo en Supabase)
  VAPID_PUBLIC_KEY: 'BDaZWsKdEpj1mrU1I_RbBppIz4VQx16nPRg5nluu1m_cTyHPDMShZDRFSHuXWLExIO8SSDGAa_xqhxYnL90LVxg',
  VERSION: '1.0.2',
  APP_ID: 'micasa-hijos-app',
};
