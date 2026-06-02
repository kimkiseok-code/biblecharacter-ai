export default async function handler(req, res) {
  const { code } = req.query;
  if (!code) return res.redirect('/?error=no_code');

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = 'https://biblecharacter-ai.vercel.app/api/auth/callback';

  try {
    // 토큰 교환
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code, client_id: clientId, client_secret: clientSecret,
        redirect_uri: redirectUri, grant_type: 'authorization_code'
      })
    });
    const tokenData = await tokenRes.json();

    // 유저 정보 가져오기
    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    const user = await userRes.json();

    // 간단한 토큰 생성 (base64)
    const userInfo = { email: user.email, name: user.name, photo: user.picture, id: user.id };
    const token = Buffer.from(JSON.stringify(userInfo)).toString('base64');

    res.redirect(`/?bca_token=${token}`);
  } catch (e) {
    res.redirect('/?error=auth_failed');
  }
}
