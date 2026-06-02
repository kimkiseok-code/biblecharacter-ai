// api/verify.js — 토큰 검증 (프론트에서 fetch로 호출)
export default function handler(req, res) {
  const { token } = req.query;

  if (!token) {
    return res.status(400).json({ error: 'no token' });
  }

  try {
    const payload = JSON.parse(Buffer.from(token, 'base64url').toString('utf-8'));

    // 토큰 발급 후 24시간 이내만 유효
    if (Date.now() - payload.loginAt > 24 * 60 * 60 * 1000) {
      return res.status(401).json({ error: 'token expired' });
    }

    res.status(200).json({
      email: payload.email,
      name: payload.name,
      picture: payload.picture,
    });
  } catch (e) {
    res.status(400).json({ error: 'invalid token' });
  }
}
