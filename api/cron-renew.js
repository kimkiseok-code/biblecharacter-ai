// api/cron-renew.js — 매일 1회(오전 9시) 정기구독 자동 갱신 (Vercel Cron)
// - 기간 종료 24시간 이내인 활성 구독 → 다음 달 결제 (기간은 이전 종료일부터 이어짐)
// - 결제 실패 → 다음 날 다시 시도, 3회 실패 시 구독 종료
// - 해지한 구독 → 기간이 끝나면 빌키 삭제 후 종료
import { redis, PLANS, addOneMonth, nicepay, newOrderId, getSub, saveSub, grantPeriod } from './_lib.js';

const MAX_FAILS = 3;
const DAY = 86400000;

export default async function handler(req, res) {
  // Vercel Cron은 Authorization: Bearer <CRON_SECRET> 헤더를 붙여 호출함
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers['authorization'] !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const emails = (await redis('SMEMBERS', 'subs:index')) || [];
  const report = { checked: emails.length, renewed: 0, failed: 0, ended: 0, skipped: 0 };
  const now = Date.now();

  for (const email of emails) {
    try {
      const sub = await getSub(email);
      if (!sub) { await redis('SREM', 'subs:index', email); continue; }

      // 해지한 구독: 기간 끝나면 빌키 삭제 후 종료
      if (sub.status === 'cancelled') {
        if (sub.periodEnd <= now) {
          await expireBid(sub.bid);
          await saveSub(email, { ...sub, status: 'ended', endedAt: now, endReason: 'cancelled' });
          report.ended++;
        } else report.skipped++;
        continue;
      }
      if (sub.status !== 'active') { await redis('SREM', 'subs:index', email); continue; }

      // 아직 갱신일이 아님 (종료까지 24시간 넘게 남음)
      if (sub.periodEnd - now > DAY) { report.skipped++; continue; }

      // 같은 회차를 두 번 결제하지 않도록 잠금 (하루)
      const nextCount = (sub.renewCount || 1) + 1;
      const locked = await redis('SET', `lock:renew:${email}:${nextCount}`, '1', 'NX', 'EX', '72000');
      if (!locked) { report.skipped++; continue; }

      const p = PLANS[sub.plan];
      const orderId = newOrderId('BCAR');
      const pay = await nicepay(`/v1/subscribe/${encodeURIComponent(sub.bid)}/payments`, {
        orderId, amount: p.amount, goodsName: `${p.name.replace('한 달 이용권', '정기구독')} (${nextCount}회차)`,
        cardQuota: 0, useShopInterest: false, buyerEmail: email,
      });

      if (pay.resultCode === '0000') {
        const periodStart = sub.periodEnd;
        const periodEnd = addOneMonth(sub.periodEnd);
        await grantPeriod({ email, plan: sub.plan, orderId, tid: pay.tid, amount: p.amount, kind: 'sub-renew', periodStart, periodEnd });
        await saveSub(email, { ...sub, periodEnd, renewCount: nextCount, failCount: 0, lastError: '', lastRenewedAt: now });
        report.renewed++;
      } else {
        const failCount = (sub.failCount || 0) + 1;
        if (failCount >= MAX_FAILS) {
          await expireBid(sub.bid);
          await saveSub(email, { ...sub, status: 'ended', failCount, lastError: pay.resultMsg || '', endedAt: now, endReason: 'payment_failed' });
          report.ended++;
        } else {
          await saveSub(email, { ...sub, failCount, lastError: pay.resultMsg || '', lastFailedAt: now });
          await redis('DEL', `lock:renew:${email}:${nextCount}`); // 다음 날 다시 시도할 수 있게
        }
        report.failed++;
      }
    } catch (e) {
      console.error('renew error for a subscriber:', e && e.message);
      report.failed++;
    }
  }

  await redis('SET', 'cron:lastRun', JSON.stringify({ at: now, ...report }));
  return res.status(200).json(report);
}

async function expireBid(bid) {
  if (!bid) return;
  try { await nicepay(`/v1/subscribe/${encodeURIComponent(bid)}/expire`, { orderId: newOrderId('BCAX') }); } catch (e) {}
}
