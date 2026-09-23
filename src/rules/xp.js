// 经验结算规则（纯函数，不依赖存储与页面）
//
// 结算口径（写死在本模块，便于审查）：
// 1. 每章登记一个经验池 P，从池中先划出名录奖励 b 给本场最佳（MVP）；
// 2. 基础份额 q = floor((P - b) / n)，n 为出场角色数，出场角色均分 q；
// 3. 余数 r = (P - b) - n*q，按「角色顺序」（即角色列表顺序）分给前 r 名出场角色；
// 4. 名录奖励上限 = floor(q / 2)，超过即违规；
// 5. 未分配额 = P - 已分配总额，合法结算必须为零；
// 6. 违反任意一条，章节保留为草稿，由调用方列出章节、差额与冲突角色。

export const LEVEL_THRESHOLDS = [0, 100, 250, 450, 700, 1000, 1400, 1900, 2500, 3200, 4000];
export const MAX_LEVEL = LEVEL_THRESHOLDS.length;

export function levelFromXp(xp) {
  let lv = 1;
  for (let i = 0; i < LEVEL_THRESHOLDS.length; i++) {
    if (xp >= LEVEL_THRESHOLDS[i]) lv = i + 1;
  }
  return lv;
}

export function nextThreshold(xp) {
  return LEVEL_THRESHOLDS.find((t) => t > xp) ?? null;
}

export function emptyDraft(backfill = false) {
  return { status: 'draft', pool: '', participants: [], mvp: '', bonus: 0, insertedBeforeSettled: backfill };
}

// 按角色列表顺序返回出场角色 ID
export function orderedParticipants(characters, ids) {
  const set = new Set(ids);
  return characters.map((c) => c.id).filter((id) => set.has(id));
}

/**
 * 试算一次分配。不抛异常，所有违规都收集到 errors 中。
 * 入参：characters（角色列表）、draft {pool, participants, mvp, bonus}
 * 返回：{ pool, q, remainder, mvp, bonus, shares:{id:xp}, allocated,
 *        unallocated, bonusCap, conflicts:[characterId], errors:[string] }
 */
export function planSettlement(characters, draft) {
  const pool = Math.floor(Number(draft.pool));
  const bonus = Math.floor(Number(draft.bonus) || 0);
  const participants = orderedParticipants(characters, draft.participants || []);
  const n = participants.length;
  const result = {
    pool: Number.isFinite(pool) ? pool : 0,
    q: 0,
    remainder: 0,
    mvp: draft.mvp || '',
    bonus,
    participants,
    shares: {},
    allocated: 0,
    unallocated: Number.isFinite(pool) ? pool : 0,
    bonusCap: null,
    conflicts: [],
    errors: [],
  };

  if (!Number.isFinite(pool) || pool <= 0) {
    result.errors.push('经验池必须为正整数');
  }
  if (n === 0) {
    result.errors.push('至少登记一名出场角色');
  }

  const mvpIn = result.mvp && participants.includes(result.mvp);
  if (!result.mvp) result.errors.push('未选择本场最佳');
  else if (!mvpIn) {
    result.errors.push('本场最佳不在出场角色中');
    result.conflicts.push(result.mvp);
  }

  const remaining = result.pool - bonus;
  const q = n > 0 ? Math.floor(remaining / n) : 0;
  const r = n > 0 ? remaining - n * q : 0;
  result.q = q;
  result.remainder = r;
  result.bonusCap = n > 0 ? Math.floor(q / 2) : null;

  if (bonus < 0) result.errors.push('名录奖励不能为负');
  if (mvpIn && bonus > 0 && q >= 0 && bonus > Math.floor(q / 2)) {
    result.errors.push(`名录奖励 ${bonus} 超过基础份额一半（上限 ${Math.floor(q / 2)}）`);
    result.conflicts.push(result.mvp);
  }
  if (remaining < 0) {
    result.errors.push('名录奖励超出经验池，基础份额无法均分');
    if (mvpIn && !result.conflicts.includes(result.mvp)) result.conflicts.push(result.mvp);
  }
  if (r > n) {
    result.errors.push(`余数 ${r} 超过出场角色数 ${n}，无法按角色顺序分完`);
    result.conflicts.push(...participants);
  }

  if (n > 0 && remaining >= 0 && r <= n) {
    participants.forEach((id, i) => {
      result.shares[id] = q + (i < r ? 1 : 0) + (id === result.mvp ? bonus : 0);
    });
    result.allocated = Object.values(result.shares).reduce((a, b) => a + b, 0);
  }
  result.unallocated = result.pool - result.allocated;
  if (result.errors.length === 0 && result.unallocated !== 0) {
    result.errors.push(`未分配额为 ${result.unallocated}，必须为零`);
    result.conflicts.push(...participants.filter((id) => !result.conflicts.includes(id)));
  }
  return result;
}

// 按时间线顺序累计每个角色的已结算经验：{ id: xp }
// 修订草稿期间（amending + _live）仍按冻结中的旧版本计入，保证页面不跳变。
export function cumulativeXp(sessions, base = {}) {
  const totals = { ...base };
  for (const s of sessions) {
    let xp = s.xp;
    if (xp?.amending && xp._live) xp = xp._live;
    if (xp && xp.status === 'settled') {
      for (const [id, v] of Object.entries(xp.allocations)) {
        totals[id] = (totals[id] || 0) + v;
      }
    }
  }
  return totals;
}

function diffRows(before, after, characters) {
  const ids = new Set([...Object.keys(before), ...Object.keys(after)]);
  const nameOf = Object.fromEntries(characters.map((c) => [c.id, c.name]));
  return [...ids]
    .map((id) => ({ id, name: nameOf[id] || id, from: before[id] || 0, to: after[id] || 0 }))
    .filter((row) => row.from !== row.to)
    .sort((a, b) => b.to - b.from || a.name.localeCompare(b.name, 'zh'));
}

/**
 * 结算章节（纯函数，返回新 data，不修改入参）。
 * 已结算章节冻结；补录较早章节或修订已结算章节时：
 *  - 必须给出 reason，生成带原因的修订记录；
 *  - 重算后续累计经验与升级状态（升级状态由累计经验派生，无需额外存储）；
 *  - 旧记录以 version 形式保留，仍可查。
 */
export function settleChapter(data, sessionId, reason, nowIso, seqRef) {
  const idx = data.sessions.findIndex((s) => s.id === sessionId);
  if (idx < 0) throw new Error('章节不存在');
  const session = data.sessions[idx];

  // 修订草稿携带冻结中的生效版本快照（startAmendment 写入）
  const live = session.xp?.amending ? session.xp._live : null;
  const wasSettled = session.xp?.status === 'settled' || !!live;
  const isFirstSettle = !wasSettled;
  // 补录：该草稿由数据层在插入到已结算章节之前时显式标记
  const isBackfill = isFirstSettle && !!session.xp?.insertedBeforeSettled;
  const needReason = wasSettled || isBackfill;
  if (needReason && !reason?.trim()) {
    throw new Error(wasSettled ? '修订已结算章节必须填写原因' : '补录较早章节必须填写修订原因');
  }

  const plan = planSettlement(data.characters, session.xp || emptyDraft());
  if (plan.errors.length) {
    const error = new Error('存在分配冲突，章节保留为草稿');
    error.plan = plan;
    throw error;
  }

  // 修订号在历史最大值上递增，避免与已有修订链冲突
  const maxExisting = (data.revisions || []).reduce((m, r) => {
    const n = parseInt(String(r.id || '').replace(/^R/, ''), 10);
    return Number.isFinite(n) ? Math.max(m, n) : m;
  }, 0);
  const seq = { value: Math.max(seqRef?.value ?? 0, maxExisting) };
  const nextVersion = (wasSettled ? (live ? live.version : session.xp.version) : 0) + 1;
  const nextRevisionNo = () => {
    seq.value += 1;
    return `R${String(seq.value).padStart(3, '0')}`;
  };

  // 结算前的累计快照（供修订记录展示）
  const beforeTotals = cumulativeXp(data.sessions);
  const beforeAll = Object.fromEntries(data.characters.map((c) => [c.id, c.id in beforeTotals ? beforeTotals[c.id] : 0]));

  // 修订自身：归档当前生效版本，并写入修订记录
  const revisions = [...(data.revisions || [])];
  let archivedVersions = [];
  if (wasSettled) {
    const oldVersion = live || session.xp;
    archivedVersions = [
      ...(oldVersion.versions || []).map((v) => ({ ...v, allocations: { ...v.allocations } })),
      { ...oldVersion, versions: undefined, _live: undefined, allocations: { ...oldVersion.allocations } },
    ];
    revisions.push({
      id: nextRevisionNo(),
      kind: 'amend',
      reason: reason.trim(),
      createdAt: nowIso,
      chapterId: sessionId,
      chapterTitle: session.title,
      chapterIndex: idx + 1,
      sourceChapterId: sessionId,
      versionAfter: nextVersion,
      changes: diffRows(oldVersion.allocations, plan.shares, data.characters),
    });
  }

  const sessions = data.sessions.map((s, i) => {
    if (i !== idx) return { ...s, xp: s.xp ? { ...s.xp } : undefined };
    return {
      ...s,
      xp: {
        status: 'settled',
        pool: plan.pool,
        participants: Object.keys(plan.shares),
        mvp: plan.mvp,
        bonus: plan.bonus,
        baseShare: plan.q,
        remainder: plan.remainder,
        allocations: { ...plan.shares },
        settledAt: wasSettled ? (live ? live.settledAt : session.xp.settledAt) : nowIso,
        updatedAt: nowIso,
        version: nextVersion,
        versions: archivedVersions,
        reason: needReason ? reason.trim() : '',
      },
    };
  });

  // 重算后续累计，变化的章节生成「补录/修订引发」的修订链记录
  if (needReason) {
    const afterTotals = cumulativeXp(sessions);
    const affected = diffRows(beforeAll, afterTotals, data.characters);
    if (affected.length || wasSettled) {
      revisions.push({
        id: nextRevisionNo(),
        kind: isBackfill ? 'backfill' : 'ripple',
        reason: reason.trim(),
        createdAt: nowIso,
        chapterId: null,
        chapterTitle: '',
        chapterIndex: null,
        sourceChapterId: sessionId,
        sourceChapterTitle: session.title,
        sourceChapterIndex: idx + 1,
        affectedUpTo: data.sessions.length,
        versionAfter: null,
        changes: affected,
      });
    }
  }

  return { ...data, sessions, revisions, revisionSeq: seq.value };
}

// 从已结算章节开出一张可编辑修订稿；_live 保存冻结中的生效版本，
// 放弃修订时原样还原，提交修订时作为旧版本归档。
export function startAmendment(session) {
  if (!session.xp || session.xp.status !== 'settled') return null;
  return {
    status: 'draft',
    pool: session.xp.pool,
    participants: [...session.xp.participants],
    mvp: session.xp.mvp,
    bonus: session.xp.bonus,
    amending: true,
    _live: JSON.parse(JSON.stringify(session.xp)),
  };
}
