// api/chat.js — 대화 요청 (서버에서 남은 횟수 확인 후 Claude 호출)
import {
  getUser, getQuota, tryConsume, refund, clientIp,
  isFreeTier, tryConsumeFreeCap, refundFreeCap, MODEL_FREE, MODEL_PAID,
} from './_lib.js';

// 화면에 보여줄 사용량 정보
function usageOf(quota, c) {
  return {
    tier: quota.tier, used: c.used, limit: quota.limit, period: quota.period || null,
    totalUsed: c.totalUsed ?? null, totalLimit: quota.totalLimit ?? null,
  };
}

const MAX_MESSAGES = 20;        // 대화 맥락은 최근 20개까지만
const MAX_MESSAGE_CHARS = 2000; // 한 메시지 최대 길이
const MAX_SYSTEM_CHARS = 4000;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let quota = null;
  let consumed = false;
  let capConsumed = false;
  async function undo() {
    if (consumed && quota) { try { await refund(quota); } catch (e) {} consumed = false; }
    if (capConsumed) { try { await refundFreeCap(); } catch (e) {} capConsumed = false; }
  }

  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: 'API 키가 설정되지 않았습니다' });
    }

    // 1. 입력 검사 (과도하게 긴 요청으로 비용이 새지 않도록)
    const { system, messages } = req.body || {};
    if (typeof system !== 'string' || !system || system.length > MAX_SYSTEM_CHARS) {
      return res.status(400).json({ error: '잘못된 요청입니다' });
    }
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: '잘못된 요청입니다' });
    }
    const trimmed = messages.slice(-MAX_MESSAGES).map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content || '').slice(0, MAX_MESSAGE_CHARS),
    }));
    if (trimmed[0].role !== 'user') trimmed.shift();
    if (!trimmed.length || trimmed[trimmed.length - 1].role !== 'user') {
      return res.status(400).json({ error: '잘못된 요청입니다' });
    }

    // 2. 누구인지 확인 → 개인 한도 확인 → 1회 차감
    const authHeader = req.headers['authorization'] || '';
    const user = getUser(req);
    if (authHeader && !user) {
      return res.status(401).json({ error: '로그인이 만료되었습니다. 다시 로그인해 주세요', code: 'SESSION_EXPIRED' });
    }
    quota = await getQuota({ email: user && user.email, ip: clientIp(req) });
    const c = await tryConsume(quota);
    if (!c.ok) {
      const code = quota.tier === 'guest' ? 'GUEST_LIMIT'
        : c.reason === 'total' ? 'LIMIT'
        : quota.period === 'day' ? 'DAILY_LIMIT' : 'LIMIT';
      return res.status(402).json({
        error: '이용 가능한 횟수를 모두 사용했습니다',
        code,
        usage: usageOf(quota, c),
      });
    }
    consumed = true;

    // 3. 무료 사용자는 사이트 전체 하루 상한도 확인 (이용권 회원·관리자는 제외)
    const free = isFreeTier(quota);
    if (free) {
      if (!(await tryConsumeFreeCap())) {
        await undo();
        return res.status(402).json({
          error: '오늘 준비된 무료 대화가 모두 소진되었습니다',
          code: 'DAILY_CAP',
          usage: usageOf(quota, { used: c.used - 1 }),
        });
      }
      capConsumed = true;
    }

    // 4. Claude 호출 (무료: Haiku / 이용권·관리자: Sonnet)
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: free ? MODEL_FREE : MODEL_PAID,
        max_tokens: 1200,
        system,
        messages: trimmed,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      await undo(); // 실패한 대화는 횟수에서 빼지 않음
      return res.status(502).json({ error: data.error?.message || 'AI 응답 오류' });
    }

    return res.status(200).json({
      content: data.content,
      usage: usageOf(quota, c),
    });
  } catch (error) {
    console.error('chat error:', error);
    await undo();
    return res.status(500).json({ error: '서버 오류가 발생했습니다' });
  }
}
