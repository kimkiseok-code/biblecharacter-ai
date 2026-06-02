export default function handler(req, res) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = 'https://biblecharacter-ai.vercel.app/api/auth/callback';
  const scope = 'openid email profile';
  const state = Math.random().toString(36).substring(2);

  const url = `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${clientId}&` +
    `redirect_uri=${encodeURIComponent(redirectUri)}&` +
    `response_type=code&` +
    `scope=${encodeURIComponent(scope)}&` +
    `state=${state}&` +
    `access_type=offline`;

  res.redirect(url);
}
