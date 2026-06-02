// api/callback.js — 구글 로그인 후 콜백 처리
export default async function handler(req, res) {
  const { code, error } = req.query;

  if (error || !code) {
    return res.redirect('/?login_error=cancelled');
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'https://biblecharacter-ai.vercel.app/api/callback';

  try {
    // 1. code → access_token 교환
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      return res.redirect('/?login_error=token_fail');
    }

    // 2. access_token → 유저 정보 조회
    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const user = await userRes.json();

    if (!user.email) {
      return res.redirect('/?login_error=no_email');
    }

    // 3. 유저 정보를 간단한 토큰(base64)으로 인코딩해서 프론트로 전달
    const payload = {
      email: user.email,
      name: user.name || user.email.split('@')[0],
      picture: user.picture || '',
      loginAt: Date.now(),
    };
    const token = Buffer.from(JSON.stringify(payload)).toString('base64url');

    // 4. 프론트엔드로 리다이렉트 (토큰 포함)
    res.redirect(`/?bca_token=${token}`);

  } catch (err) {
    console.error('OAuth callback error:', err);
    res.redirect('/?login_error=server_error');
  }
}
