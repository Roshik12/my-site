// Supabase Storage holds the files. Firebase still handles notes, chat, calls and file info.
// Leave url/anonKey empty to keep using Firebase Storage only.
window.SUPABASE = {
  url: 'https://slghfztlezjezbqszfkp.supabase.co',        // e.g. https://abcdxyz.supabase.co
  anonKey: 'sb_publishable_l5w4n5kjaebHxhiYCeViaw_4WPJnTRG',  // publishable key: safe in the browser. NEVER put an sb_secret_ key here
  bucket: 'files',
  maxMB: 50       // match your Supabase plan's file size limit
};

// TURN (calls across different networks) is no longer set here. Its key lives on the server: see api/turn.js
// and set METERED_APP + METERED_API_KEY in Vercel > Settings > Environment Variables.
