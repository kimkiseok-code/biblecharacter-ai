// api/subscribe.js — 정기구독: 시작(카드 등록 + 첫 결제) / 해지 / 해지 취소
// body: { action: 'start', plan, cardNo, expYear, expMonth, idNo, cardPw, agree }
//       { action: 'cancel' } | { action: 'resume' }
// ⚠️ 카드 정보는 저장·로그하지 않음. 암호화해서 나이스페이로만 전송
import {
  getUser, redis, getJSON, PLANS, addOneMonth, clientIp,
  nicepay, encryptCard, newOrderId, getSub, saveSub, grantPeriod,
} from './_lib.js';

const MAX_TRIES_PER_DAY = 5; // 도난 카드 시험(카드 테스팅) 방지

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: '로그인이 필요합니다', code: 'SESSION_EXPIRED' });
    const email = user.email;
    const body = req.body || {};

    if (body.action === 'cancel') return await cancel(res, email);
    if (body.action === 'resume') return await resume(res, email);
    if (body.action === 'start') return await start(req, res, email, body);
    return res.status(400).json({ error: '잘못된 요청입니다' });
  } catch (e) {
    console.error('subscribe error:', e && e.message); // 요청 본문(카드정보)은 절대 로그하지 않음
    return res.status(500).json({ error: '서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요' });
  }
}

async function start(req, res, email, body) {
  const p = PLANS[body.plan];
  if (!p) return res.status(400).json({ error: '잘못된 상품입니다' });
  if (body.agree !== true) return res.status(400).json({ error: '자동결제 동의가 필요합니다' });

  // 1. 이미 구독 중이거나, 한 달 이용권 기간이 남아 있으면 시작하지 않음 (이중 결제 방지)
  const sub = await getSub(email);
  if (sub && (sub.status === 'active' || sub.status === 'cancelled') && sub.periodEnd > Date.now()) {
    return res.status(409).json({ error: '이미 구독 중입니다. 구독 관리에서 확인해 주세요', code: 'ALREADY_SUBSCRIBED' });
  }
  const ent = await getJSON(`plan:${email}`);
  if (ent && ent.expiresAt > Date.now()) {
    return res.status(409).json({
      error: `현재 이용권이 ${new Date(ent.expiresAt).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })}까지 남아 있어요. 기간이 끝난 뒤 구독을 시작해 주세요`,
      code: 'HAS_PASS',
    });
  }

  // 2. 입력값 검사 (숫자만)
  const only = (v) => String(v || '').replace(/\D/g, '');
  const cardNo = only(body.cardNo), expMonth = only(body.expMonth).padStart(2, '0'), expYear = only(body.expYear).slice(-2);
  const idNo = only(body.idNo), cardPw = only(body.cardPw);
  if (cardNo.length < 14 || cardNo.length > 16) return res.status(400).json({ error: '카드번호를 확인해 주세요' });
  if (!/^(0[1-9]|1[0-2])$/.test(expMonth) || expYear.length !== 2) return res.status(400).json({ error: '유효기간을 확인해 주세요' });
  if (idNo.length !== 6 && idNo.length !== 10) return res.status(400).json({ error: '생년월일 6자리(법인카드는 사업자번호 10자리)를 확인해 주세요' });
  if (cardPw.length !== 2) return res.status(400).json({ error: '카드 비밀번호 앞 2자리를 입력해 주세요' });

  // 3. 시도 횟수 제한 (계정·IP 각각 하루 5회)
  const day = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  for (const k of [`subtry:e:${email}:${day}`, `subtry:ip:${clientIp(req)}:${day}`]) {
    const n = await redis('INCR', k);
    if (n === 1) await redis('EXPIRE', k, '172800');
    if (n > MAX_TRIES_PER_DAY) return res.status(429).json({ error: '오늘 카드 등록 시도 횟수를 초과했습니다. 내일 다시 시도해 주세요' });
  }

  // 4. 빌키 발급 (카드 등록)
  const regOrderId = newOrderId('BCAK');
  const reg = await nicepay('/v1/subscribe/regist', {
    encData: encryptCard({ cardNo, expYear, expMonth, idNo, cardPw }),
    orderId: regOrderId,
    buyerEmail: email,
  });
  if (reg.resultCode !== '0000' || !reg.bid) {
    return res.status(400).json({ error: `카드 등록 실패: ${reg.resultMsg || '카드 정보를 확인해 주세요'}` });
  }
  const bid = reg.bid;
  const last4 = cardNo.slice(-4);

  // 5. 첫 달 결제
  const orderId = newOrderId('BCAS');
  const pay = await nicepay(`/v1/subscribe/${encodeURIComponent(bid)}/payments`, {
    orderId, amount: p.amount, goodsName: `${p.name.replace('한 달 이용권', '정기구독')} (1회차)`,
    cardQuota: 0, useShopInterest: false, buyerEmail: email,
  });
  if (pay.resultCode !== '0000') {
    await nicepay(`/v1/subscribe/${encodeURIComponent(bid)}/expire`, { orderId: newOrderId('BCAX') }).catch(() => {});
    return res.status(400).json({ error: `결제 실패: ${pay.resultMsg || '카드 한도나 상태를 확인해 주세요'}` });
  }

  // 6. 구독·이용권 저장
  const now = Date.now();
  const periodEnd = addOneMonth(now);
  await grantPeriod({ email, plan: body.plan, orderId, tid: pay.tid, amount: p.amount, kind: 'sub-first', periodStart: now, periodEnd });
  await saveSub(email, {
    plan: body.plan, bid, cardName: reg.cardName || (pay.card && pay.card.cardName) || '', last4,
    status: 'active', startedAt: now, periodEnd, renewCount: 1, failCount: 0, lastError: '',
    agreedAt: now,
  });

  return res.status(200).json({ ok: true, plan: body.plan, periodEnd, nextBillingAt: periodEnd, amount: p.amount });
}

async function cancel(res, email) {
  const sub = await getSub(email);
  if (!sub || sub.status !== 'active') return res.status(400).json({ error: '해지할 구독이 없습니다' });
  // 빌키는 기간 종료 시 자동 갱신 작업에서 삭제 (그 전까지는 해지 취소 가능)
  await saveSub(email, { ...sub, status: 'cancelled', cancelledAt: Date.now() });
  return res.status(200).json({ ok: true, usableUntil: sub.periodEnd });
}

async function resume(res, email) {
  const sub = await getSub(email);
  if (!sub || sub.status !== 'cancelled' || sub.periodEnd <= Date.now()) {
    return res.status(400).json({ error: '다시 이어갈 수 있는 구독이 없습니다' });
  }
  await saveSub(email, { ...sub, status: 'active', cancelledAt: null });
  return res.status(200).json({ ok: true, nextBillingAt: sub.periodEnd });
}
