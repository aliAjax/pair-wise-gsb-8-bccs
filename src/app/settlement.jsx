// 页面组件：章节经验结算表单、结算结果、草稿冲突、修订链。
import React, { useMemo, useState } from 'react';
import { planAllocation } from '../campaign/rules.js';

const nameOf = (characters, id) => characters.find((c) => c.id === id)?.name || id;

// 按角色名单顺序返回选中的出场角色（余数依此顺序分配）
export function orderedParticipants(selectedIds, characters) {
  return characters.filter((c) => selectedIds.includes(c.id)).map((c) => c.id);
}

function ConflictList({ errors, characters, title }) {
  if (!errors || errors.length === 0) return null;
  return (
    <div className="conflict-box">
      <div className="conflict-head"><span>⚠</span><strong>{title || '结算未通过校验，草稿已保留'}</strong></div>
      <ul>
        {errors.map((e, i) => (
          <li key={i}>
            <span className="conflict-msg">{e.message}</span>
            {typeof e.diff === 'number' && e.diff !== 0 && (
              <em className="conflict-diff">差额 {e.diff > 0 ? `+${e.diff}` : e.diff} XP</em>
            )}
            {Array.isArray(e.conflictIds) && e.conflictIds.length > 0 && (
              <span className="conflict-who">
                冲突角色：{e.conflictIds.map((id) => nameOf(characters, id)).join('、')}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SettlementForm({ session, characters, draft, frozen, backfill, settleErrors, onSettle, onSaveDraft, onDeleteDraft, onCancelRevision }) {
  const needsReason = Boolean(frozen || backfill);
  const [open, setOpen] = useState(!frozen);
  const [pool, setPool] = useState(draft?.pool ?? 600);
  const [selected, setSelected] = useState(
    draft?.participantIds?.length ? draft.participantIds : characters.map((c) => c.id),
  );
  const [mvpId, setMvpId] = useState(draft?.mvpId ?? characters[0]?.id ?? null);
  const [reason, setReason] = useState(draft?.reason || '');
  const [localErrors, setLocalErrors] = useState(null);

  const participantIds = useMemo(() => orderedParticipants(selected, characters), [selected, characters]);
  const plan = useMemo(() => {
    if (participantIds.length === 0 || !Number.isFinite(pool)) return null;
    return planAllocation({ pool, participantIds, mvpId });
  }, [pool, participantIds, mvpId]);

  const errors = localErrors || settleErrors || draft?.errors || null;

  if (!open && frozen) {
    return (
      <div className="revise-entry">
        <button className="outline small" onClick={() => setOpen(true)}>✎ 补录 / 修订本章结算</button>
        <small>本章已结算并冻结；修订须填写原因，旧记录保留在修订链中，后续累计经验自动重算。</small>
      </div>
    );
  }

  const toggle = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const submit = () => {
    if (needsReason && !reason.trim()) {
      setLocalErrors([{ code: 'REASON', message: frozen ? '已冻结章节的修订必须填写原因' : '补录较早章节必须填写原因（将重算后续累计经验）' }]);
      return;
    }
    setLocalErrors(null);
    onSettle({
      sessionId: session.id,
      pool: Math.trunc(Number(pool)),
      participantIds,
      mvpId,
      reason: reason.trim(),
      chapterTitle: session.title,
    });
  };

  const saveAsDraft = () => {
    onSaveDraft(session.id, {
      pool: Math.trunc(Number(pool)) || 0,
      participantIds,
      mvpId,
      reason,
      errors: [{ code: 'MANUAL_DRAFT', message: '手动保留的草稿（尚未结算）' }],
    });
  };

  return (
    <div className="settle-form">
      <div className="settle-head">
        <strong>{frozen ? '修订本章结算（已冻结）' : backfill ? '补录本章结算（后续章节已结算）' : '章节经验结算'}</strong>
        {frozen && <button className="link-btn" onClick={() => { setOpen(false); onCancelRevision?.(); }}>取消</button>}
      </div>
      {backfill && !frozen && (
        <div className="conflict-box" style={{ background: '#eef4ef', borderColor: '#c9dccd' }}>
          <div className="conflict-head" style={{ color: '#3f6b50' }}>
            <span>↶</span><strong>补录较早章节：提交后将重算后续已结算章节的累计经验与升级状态，并留下带原因修订记录。</strong>
          </div>
        </div>
      )}

      {needsReason && (
        <label className="field">修订 / 补录原因<input value={reason} onChange={(e) => setReason(e.target.value)}
          placeholder={frozen ? '例：更正经验池 / 出场名单' : '例：补录漏登的本章经验'} /></label>
      )}

      <label className="field">经验池 XP
        <input type="number" min="1" step="1" value={pool} onChange={(e) => setPool(e.target.value)} />
      </label>

      <div className="field">
        <span className="field-label">出场角色（顺序即余数分配顺序）</span>
        <div className="cast-picker">
          {characters.map((c) => {
            const on = selected.includes(c.id);
            return (
              <label key={c.id} className={`cast-chip ${on ? 'on' : ''}`} style={on ? { borderColor: c.color, background: `${c.color}22` } : undefined}>
                <input type="checkbox" checked={on} onChange={() => toggle(c.id)} />
                <i className="dot" style={{ background: c.color }} />{c.name}
              </label>
            );
          })}
        </div>
      </div>

      <div className="field">
        <span className="field-label">本场最佳（额外奖励，上限为基础份额一半）</span>
        <div className="mvp-row">
          {participantIds.length === 0 && <small className="muted">请先选择出场角色</small>}
          {participantIds.map((id) => (
            <label key={id} className={`mvp-opt ${mvpId === id ? 'on' : ''}`}>
              <input type="radio" name={`mvp-${session.id}`} checked={mvpId === id} onChange={() => setMvpId(id)} />
              {nameOf(characters, id)}
            </label>
          ))}
        </div>
      </div>

      {plan && (
        <div className="alloc-preview">
          <div className="alloc-meta">
            <span>基础份额 <b>{plan.base}</b></span>
            <span>余数 <b>{plan.remainder}</b>（前 {plan.remainder} 位各 +1）</span>
            <span>最佳奖励 <b>{plan.award}</b>（上限 {plan.maxAward}）</span>
            <span className={plan.unassigned === 0 ? 'ok' : 'bad'}>未分配 <b>{plan.unassigned}</b></span>
          </div>
          <table>
            <thead><tr><th>角色</th><th>基础</th><th>余数</th><th>最佳</th><th>合计</th></tr></thead>
            <tbody>
              {plan.allocations.map((a) => (
                <tr key={a.characterId}>
                  <td>{nameOf(characters, a.characterId)}{a.characterId === mvpId && <i className="mvp-mark">★</i>}</td>
                  <td>{a.base}</td>
                  <td>{a.remainder ? '+1' : '—'}</td>
                  <td>{a.award ? `+${a.award}` : '—'}</td>
                  <td><b>{a.total}</b></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td>合计</td><td colSpan="3">经验池 {plan.poolAllocated} + 最佳奖励 {plan.award}</td><td><b>{plan.poolAllocated + plan.award}</b></td></tr>
            </tfoot>
          </table>
        </div>
      )}

      <ConflictList errors={errors} characters={characters}
        title={frozen ? '修订未通过校验，原冻结记录未改动，内容已存为草稿' : '结算未通过校验，草稿已保留'} />

      <div className="settle-actions">
        <button className="primary" onClick={submit}>
          {frozen ? '提交修订并重算' : backfill ? '补录结算并重算后续' : '结算并冻结'}
        </button>
        <button className="outline" onClick={saveAsDraft}>保留草稿</button>
        {draft && <button className="link-btn danger" onClick={() => onDeleteDraft(session.id)}>删除草稿</button>}
      </div>
    </div>
  );
}

export function SettlementView({ settlement, characters, levelUps, revisions, onConfirmLevel }) {
  const mvp = characters.find((c) => c.id === settlement.mvpId);
  return (
    <div className="settle-view">
      <div className="settle-view-head">
        <span className="frozen-badge">❄ 已结算 · 已冻结</span>
        <small>{new Date(settlement.settledAt).toLocaleString('zh-CN')}</small>
      </div>
      <div className="alloc-meta static">
        <span>经验池 <b>{settlement.pool}</b></span>
        <span>基础份额 <b>{settlement.base}</b></span>
        <span>最佳奖励 <b>{settlement.mvpAward}</b></span>
        <span>本场最佳 <b>★ {mvp?.name || settlement.mvpId}</b></span>
      </div>
      <table className="alloc-table">
        <thead><tr><th>出场角色</th><th>基础</th><th>余数</th><th>最佳</th><th>获得 XP</th></tr></thead>
        <tbody>
          {settlement.allocations.map((a) => (
            <tr key={a.characterId}>
              <td>{nameOf(characters, a.characterId)}{a.characterId === settlement.mvpId && <i className="mvp-mark">★</i>}</td>
              <td>{a.base}</td>
              <td>{a.remainder ? '+1' : '—'}</td>
              <td>{a.award ? `+${a.award}` : '—'}</td>
              <td><b>{a.total}</b></td>
            </tr>
          ))}
        </tbody>
      </table>
      {levelUps?.length > 0 && (
        <div className="levelup-line">
          {levelUps.map((u) => (
            <span key={u.characterId} className={`levelup-chip ${u.confirmed ? 'done' : 'todo'}`}>
              ⬆ {nameOf(characters, u.characterId)} 达到 {u.level} 级（{u.threshold} XP）
              {!u.confirmed && <button className="link-btn" onClick={() => onConfirmLevel(u.characterId, u.level)}>确认</button>}
            </span>
          ))}
        </div>
      )}
      <RevisionList revisions={revisions} characters={characters} />
    </div>
  );
}

function RevisionList({ revisions, characters }) {
  if (!revisions || revisions.length === 0) return null;
  return (
    <div className="revisions">
      <h4>修订链（{revisions.length}）· 旧记录仍可查</h4>
      {[...revisions].reverse().map((rev) => (
        <details className="rev-item" key={rev.id}>
          <summary>
            <span className="rev-tag">{rev.frozen ? '冻结后修订' : '补录'}</span>
            <b>{rev.reason}</b>
            <small>{new Date(rev.createdAt).toLocaleString('zh-CN')}</small>
          </summary>
          <div className="rev-body">
            {rev.previousSettlement ? (
              <div className="rev-old">
                <small>旧记录（{new Date(rev.previousSettlement.settledAt).toLocaleDateString('zh-CN')}）</small>
                <span>经验池 {rev.previousSettlement.pool} · 最佳 ★{nameOf(characters, rev.previousSettlement.mvpId)}</span>
                <span>{rev.previousSettlement.allocations.map((a) => `${nameOf(characters, a.characterId)} ${a.total}`).join('　')}</span>
              </div>
            ) : <div className="rev-old"><small>此前无结算记录（补录）</small></div>}
            <div className="rev-new">
              <small>新记录</small>
              <span>经验池 {rev.settlement.pool} · 最佳 ★{nameOf(characters, rev.settlement.mvpId)} · 奖励 {rev.settlement.mvpAward}</span>
              <span>{rev.settlement.allocations.map((a) => `${nameOf(characters, a.characterId)} ${a.total}`).join('　')}</span>
            </div>
            {rev.affected?.length > 0 && (
              <div className="rev-affected">
                <small>重算影响（后续章节累计经验）</small>
                {rev.affected.map((af) => (
                  <div key={af.sessionId} className="rev-affect-row">
                    <b>章节 #{af.sessionId}</b>
                    {af.changes.length === 0 ? <span className="muted">累计经验无变化</span> :
                      af.changes.map((ch) => (
                        <span key={ch.characterId} className={ch.diff > 0 ? 'up' : 'down'}>
                          {nameOf(characters, ch.characterId)} {ch.before}→{ch.after}（{ch.diff > 0 ? '+' : ''}{ch.diff}）
                        </span>
                      ))}
                  </div>
                ))}
              </div>
            )}
            {rev.levelChanges?.length > 0 && (
              <div className="rev-levels">
                <small>升级状态变化</small>
                {rev.levelChanges.map((lc) => (
                  <span key={lc.characterId}>{nameOf(characters, lc.characterId)}：{lc.fromLevel} → {lc.toLevel} 级</span>
                ))}
              </div>
            )}
          </div>
        </details>
      ))}
    </div>
  );
}
