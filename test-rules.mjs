// 规则层不变量自检：node test-rules.mjs（不依赖任何第三方包）
import assert from 'node:assert';
import { planSettlement, cumulativeXp, settleChapter, emptyDraft, levelFromXp } from './src/rules/xp.js';
import { seed } from './src/data/seed.js';

const chars = seed.characters;
const [c1, c2, c3] = chars.map((c) => c.id);

// 1. 合法分配：均分 + 余数按角色顺序 + 最佳奖励，未分配额为零
{
  const p = planSettlement(chars, { pool: 150, participants: [c1, c2, c3], mvp: c1, bonus: 10 });
  assert.deepStrictEqual(p.errors, []);
  // (150-10)/3 = 46 余 2 → c1 47+10=57, c2 47, c3 46
  assert.strictEqual(p.shares[c1], 57);
  assert.strictEqual(p.shares[c2], 47);
  assert.strictEqual(p.shares[c3], 46);
  assert.strictEqual(p.unallocated, 0);
}

// 2. 余数顺序只取决于角色列表顺序，与出场选择顺序无关
{
  const a = planSettlement(chars, { pool: 101, participants: [c3, c1], mvp: c3, bonus: 0 });
  const b = planSettlement(chars, { pool: 101, participants: [c1, c3], mvp: c3, bonus: 0 });
  assert.deepStrictEqual(a.shares, b.shares);
  assert.strictEqual(a.shares[c1], 51); // 余数 1 归角色顺序靠前的 c1
  assert.strictEqual(a.shares[c3], 50);
  assert.strictEqual(a.unallocated, 0);
}

// 3. 最佳奖励超过基础份额一半 → 冲突 + 冲突角色
{
  const p = planSettlement(chars, { pool: 120, participants: [c1, c2], mvp: c2, bonus: 30 });
  assert.ok(p.errors.some((e) => e.includes('基础份额一半')));
  assert.deepStrictEqual([...new Set(p.conflicts)], [c2]);
  assert.strictEqual(p.bonusCap, 22); // floor(45/2)
}

// 4. 未选出场 / MVP 不在出场名单
{
  const p1 = planSettlement(chars, { pool: 100, participants: [], mvp: '', bonus: 0 });
  assert.ok(p1.errors.some((e) => e.includes('出场角色')));
  assert.ok(p1.errors.some((e) => e.includes('本场最佳')));
  const p2 = planSettlement(chars, { pool: 100, participants: [c1, c2], mvp: c3, bonus: 0 });
  assert.ok(p2.conflicts.includes(c3));
}

// 5. 种子：前两章累计 113/115/102，草稿冲突不参与累计
{
  const t = cumulativeXp(seed.sessions);
  assert.deepStrictEqual(t, { c1: 113, c2: 115, c3: 102 });
  assert.strictEqual(levelFromXp(113), 2);
}

// 6. 冻结章节普通结算后不可无原因改：先 settle 草稿第三章（时间线末尾，无需原因）
{
  let d = JSON.parse(JSON.stringify(seed));
  d.sessions[2].xp = { status: 'draft', pool: 120, participants: [c1, c2], mvp: c2, bonus: 10 };
  d = settleChapter(d, d.sessions[2].id, '', '2024-06-23T00:00:00Z', { value: 0 });
  assert.strictEqual(d.sessions[2].xp.status, 'settled');
  assert.strictEqual(d.sessions[2].xp.version, 1);
  // 无原因修订必须拒绝
  assert.throws(() => settleChapter(d, d.sessions[0].id, '', 'x', { value: 0 }), /原因/);
}

// 7. 补录较早章节：需原因、生成修订链、重算后续累计
{
  let d = JSON.parse(JSON.stringify(seed));
  // 在开头插入一个更早的未结算章节
  d.sessions.unshift({
    id: 99, date: '2024-06-01', title: '序章：出发', summary: '', tag: '主线', color: '#888',
    xp: { status: 'draft', pool: 90, participants: [c1, c2, c3], mvp: c3, bonus: 0, insertedBeforeSettled: true },
  });
  // 无原因 → 拒绝
  assert.throws(() => settleChapter(d, 99, '', 'x', { value: 0 }), /补录/);
  d = settleChapter(d, 99, '事后补登序章经验', '2024-07-01T00:00:00Z', { value: 0 });
  assert.strictEqual(d.sessions[0].xp.status, 'settled');
  assert.strictEqual(d.revisions.length, 1);
  assert.strictEqual(d.revisions[0].kind, 'backfill');
  const t = cumulativeXp(d.sessions);
  // 序章 (90/3=30): c1 30, c2 30, c3 30
  assert.deepStrictEqual(t, { c1: 143, c2: 145, c3: 132 });
}

// 8. 修订已结算章节：旧版本可查、version 递增、后续累计重算、修订链带原因
{
  let d = JSON.parse(JSON.stringify(seed));
  // 修订第一章：池 150 → 180，MVP 奖励保持 10
  d.sessions[0].xp = { ...emptyDraft(), pool: 180, participants: [c1, c2, c3], mvp: c1, bonus: 10, amending: true, _live: JSON.parse(JSON.stringify(seed.sessions[0].xp)) };
  d = settleChapter(d, d.sessions[0].id, 'GM 复核符文任务应得更多经验', '2024-07-02T00:00:00Z', { value: 0 });
  const xp = d.sessions[0].xp;
  assert.strictEqual(xp.version, 2);
  assert.strictEqual(xp.versions.length, 1);
  // 旧记录仍可查
  assert.strictEqual(xp.versions[0].version, 1);
  assert.deepStrictEqual(xp.versions[0].allocations, { c1: 57, c2: 47, c3: 46 });
  // 新分配：(180-10)/3 = 56 余 2 → c1 57+10=67
  assert.strictEqual(xp.allocations[c1], 67);
  assert.strictEqual(xp.allocations[c2], 57);
  assert.strictEqual(xp.allocations[c3], 56);
  assert.strictEqual(xp.unallocated ?? xp.pool - Object.values(xp.allocations).reduce((a, b) => a + b, 0), 0);
  // 修订链：章节修订 + 后续重算
  assert.strictEqual(d.revisions.length, 2);
  assert.strictEqual(d.revisions[0].kind, 'amend');
  assert.strictEqual(d.revisions[1].kind, 'ripple');
  const t = cumulativeXp(d.sessions);
  assert.deepStrictEqual(t, { c1: 67 + 56, c2: 57 + 68, c3: 56 + 56 });
}

// 9. 冲突草稿提交被拒、保持 draft
{
  const d = JSON.parse(JSON.stringify(seed)); // 第三章自带冲突
  try { settleChapter(d, 3, '', 'x', { value: 0 }); assert.fail('应抛错'); }
  catch (e) {
    assert.ok(e.plan);
    assert.strictEqual(d.sessions[2].xp.status, 'draft'); // 入参未变（纯函数）
  }
}

console.log('全部规则自检通过 ✓');
