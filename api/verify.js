// api/verify.js — 로그인 토큰 검증 (서명 확인)
import { verifySession } from './_lib.js';

export default function handler(req, res) {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'no token' });

  try {
    const user = verifySession(token);
    if (!user) return res.status(401).json({ error: 'invalid or expired token' });

    res.status(200).json({
      email: user.email,
      name: user.name,
      picture: user.picture,
      session: token, // 이후 API 호출에 Authorization: Bearer 로 사용
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
