// api/google.js — 구글 로그인 시작 (OAuth 리다이렉트)
export default function handler(req, res) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'https://biblecharacter-ai.vercel.app/api/callback';

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'select_account',
  });

  res.redirect(302, `https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}
