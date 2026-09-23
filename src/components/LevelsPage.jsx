import { cumulativeXp, levelFromXp, nextThreshold, planSettlement } from '../rules/xp.js';

const dt = (iso) => new Date(iso).toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' });

// 升级待办页：待升级确认、累计经验、草稿冲突、修订链
export default function LevelsPage({ data, totals, onAckLevel }) {
  const characters = data.characters;
  const nameOf = Object.fromEntries(characters.map((c) => [c.id, c]));

  const rows = characters.map((c) => {
    const xp = totals[c.id] || 0;
    const level = levelFromXp(xp);
    const need = nextThreshold(xp);
    return { c, xp, level, pending: level - (c.ackLevel || 1), need };
  });
  const pendingCount = rows.reduce((a, r) => a + Math.max(0, r.pending), 0);

  // 全部草稿章节的试算冲突：章节、差额、冲突角色
  const drafts = data.sessions
    .map((s, i) => {
      if (s.xp?.status !== 'draft') return null;
      return { s, i, plan: planSettlement(characters, s.xp) };
    })
    .filter(Boolean);
  const conflicts = drafts.filter((x) => x.plan.errors.length > 0);

  return (
    <section className="levels-page">
      <div className="levels-summary">
        <div><small>待处理升级</small><strong>{pendingCount}</strong></div>
        <div><small>待结算草稿</small><strong>{drafts.length}</strong></div>
        <div><small>分配冲突草稿</small><strong className={conflicts.length ? 'danger' : ''}>{conflicts.length}</strong></div>
        <div><small>修订记录</small><strong>{data.revisions.length}</strong></div>
      </div>

      <h3 className="block-title">升级待办</h3>
      {pendingCount === 0 ? (
        <p className="muted">所有角色都已确认到当前等级。新章节结算后会自动重算。</p>
      ) : (
        <div className="todo-list">
          {rows.filter((r) => r.pending > 0).map((r) => (
            <article className="todo-card" key={r.c.id}>
              <div className="avatar sm" style={{ background: r.c.color }}>{r.c.name[0]}</div>
              <div className="todo-main">
                <b>{r.c.name}</b>
                <small>{r.c.role} · 玩家 {r.c.player}</small>
                <span>累计 {r.xp} XP · 已确认 Lv{r.c.ackLevel || 1} → 实际 Lv{r.level}，可升 {r.pending} 级</span>
              </div>
              <button className="primary" onClick={() => onAckLevel(r.c.id, r.level)}>确认升至 Lv{r.level}</button>
            </article>
          ))}
        </div>
      )}

      <h3 className="block-title">累计经验与等级</h3>
      <div className="xp-table">
        <div className="xp-tr head"><span>角色</span><span>累计经验</span><span>已确认</span><span>实际等级</span><span>距下一级</span></div>
        {rows.map((r) => (
          <div className="xp-tr" key={r.c.id}>
            <span>{r.c.name}</span>
            <span>{r.xp} XP</span>
            <span>Lv{r.c.ackLevel || 1}</span>
            <span className={r.pending > 0 ? 'lv-up' : ''}>Lv{r.level}{r.pending > 0 ? ` ↑${r.pending}` : ''}</span>
            <span>{r.need === null ? '已达上限' : `还需 ${r.need - r.xp} XP`}</span>
          </div>
        ))}
      </div>

      <h3 className="block-title">待结算草稿与分配冲突</h3>
      {drafts.length === 0 ? (
        <p className="muted">没有草稿章节。</p>
      ) : (
        <div className="draft-conflict-list">
          {drafts.map(({ s, i, plan }) => (
            <article key={s.id} className={'conflict-card ' + (plan.errors.length ? 'bad' : 'ok')}>
              <header>
                <b>第{i + 1}章 · {s.title}</b>
                <span>{plan.errors.length ? '保留为草稿' : '可结算'}</span>
              </header>
              <div className="conflict-meta">
                经验池 {plan.pool} · 出场 {plan.participants.length} 人 · 基础份额 {plan.q} · 余数 {plan.remainder} ·
                未分配额 <b className={plan.unallocated === 0 ? '' : 'danger'}>{plan.unallocated}</b>
              </div>
              {plan.errors.length > 0 && (
                <ul className="xp-errors">
                  {plan.errors.map((e, k) => <li key={k}>⚠ {e}</li>)}
                </ul>
              )}
              <div className="conflict-roles-line">
                冲突角色：
                {plan.conflicts.length
                  ? [...new Set(plan.conflicts)].map((id) => <i key={id}>{nameOf[id]?.name || id}</i>)
                  : <em className="muted">无</em>}
              </div>
            </article>
          ))}        </div>
      )}

      <h3 className="block-title">修订链</h3>
      {data.revisions.length === 0 ? (
        <p className="muted">尚无修订。补录较早章节或修订已结算章节时，会在此生成带原因的修订链，旧记录仍可在章节卡片中查阅。</p>
      ) : (
        <ol className="revision-chain">
          {[...data.revisions].reverse().map((rev) => (
            <li key={rev.id}>
              <div className="rev-head">
                <i className={'rev-kind ' + rev.kind}>
                  {rev.kind === 'amend' ? '章节修订' : rev.kind === 'backfill' ? '补录较早章节' : '后续重算'}
                </i>
                <b>{rev.id}</b>
                <small>{dt(rev.createdAt)}</small>
              </div>
              <p className="rev-reason">原因：{rev.reason}</p>
              {rev.kind === 'amend' && (
                <p className="muted">第{rev.chapterIndex}章《{rev.chapterTitle}》→ v{rev.versionAfter}</p>
              )}
              {rev.kind === 'backfill' && (
                <p className="muted">新结算第{rev.sourceChapterIndex}章《{rev.sourceChapterTitle}》，已重算其后全部章节的累计经验与升级状态</p>
              )}
              {rev.kind === 'ripple' && (
                <p className="muted">因第{rev.sourceChapterIndex}章《{rev.sourceChapterTitle}》修订，已重算后续累计经验与升级状态</p>
              )}
              {rev.changes.length > 0 && (
                <div className="rev-changes">
                  {rev.changes.map((ch) => (
                    <span key={ch.id}>{ch.name}：{ch.from} → {ch.to} XP</span>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
