export default function handler(req, res) {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'no token' });

  try {
    const user = JSON.parse(Buffer.from(token, 'base64').toString());
    res.status(200).json(user);
  } catch (e) {
    res.status(400).json({ error: 'invalid token' });
  }
}
