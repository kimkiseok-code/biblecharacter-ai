// api/track.js — 방문 기록 (?from= 꼬리표별). 화면에서 창 하나당 한 번만 호출
import { redis, bumpStats, clientIp, ipTag, kstDayKey } from './_lib.js';

const MAX_PER_IP_PER_DAY = 20; // 같은 곳에서 숫자를 부풀리지 못하게

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const ua = String(req.headers['user-agent'] || '');
    if (!ua || /bot|crawl|spider|preview|facebookexternalhit|kakaotalk-scrap|slurp/i.test(ua)) {
      return res.status(204).end();
    }
    const key = `rl:track:${ipTag(clientIp(req))}:${kstDayKey()}`;
    const n = await redis('INCR', key);
    if (n === 1) await redis('EXPIRE', key, String(2 * 86400));
    if (n > MAX_PER_IP_PER_DAY) return res.status(204).end();

    const { from } = req.body || {};
    await bumpStats(from, { visit: 1 });
    return res.status(204).end();
  } catch (e) {
    console.error('track error:', e);
    return res.status(204).end(); // 통계 실패가 화면에 영향을 주지 않게
  }
}
