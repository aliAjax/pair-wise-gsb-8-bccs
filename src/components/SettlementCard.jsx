import { useMemo, useState } from 'react';
import { planSettlement } from '../rules/xp.js';

// 章节经验登记与结算卡片。
// 已结算：冻结展示 + 历史版本；草稿：可编辑、实时试算、冲突时保留草稿。
export default function SettlementCard({ session, characters, backfillRequired, onPatchDraft, onSettle, onStartAmend, onCancelAmend }) {
  const xp = session.xp;
  const settled = xp?.status === 'settled';
  const [reason, setReason] = useState('');
  const plan = useMemo(() => (!settled ? planSettlement(characters, xp) : null), [settled, characters, xp]);
  const nameOf = Object.fromEntries(characters.map((c) => [c.id, c]));
  const reasonRequired = !settled && (xp?.amending || backfillRequired);
  const reasonMissing = reasonRequired && !reason.trim();

  if (settled) {
    return (
      <div className="xp-card settled">
        <div className="xp-head">
          <span className="xp-badge">已结算 · v{xp.version}</span>
          <b>{xp.pool} XP 经验池</b>
          <small>{new Date(xp.settledAt).toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' })}</small>
        </div>
        <div className="xp-formula">
          基础份额 <b>{xp.baseShare}</b> × {xp.participants.length} ＋ 余数 <b>{xp.remainder}</b>（按角色顺序）＋ 名录奖励 <b>{xp.bonus}</b>
          {xp.reason && <em title={xp.reason}>· {xp.reason}</em>}
        </div>
        <div className="xp-rows">
          {xp.participants.map((id, i) => (
            <div className="xp-row" key={id}>
              <span className="xp-char">
                <i className="order-no">{i + 1}</i>
                {nameOf[id]?.name || id}
                {xp.mvp === id && <em className="mvp">本场最佳 +{xp.bonus}</em>}
              </span>
              <b>+{xp.allocations[id]}</b>
            </div>
          ))}
        </div>
        <div className="xp-actions">
          <button className="link" onClick={() => onStartAmend(session.id)}>✎ 以原因修订</button>
          {xp.versions?.length > 0 && (
            <details className="xp-history">
              <summary>旧记录（{xp.versions.length} 版）</summary>
              {[...xp.versions].reverse().map((v) => (
                <div className="xp-version" key={v.version}>
                  <span>v{v.version} · {v.pool} XP{v.reason ? ` · ${v.reason}` : ''}</span>
                  <small>{v.participants.map((id) => `${nameOf[id]?.name || id} +${v.allocations[id]}`).join('，')}</small>
                </div>
              ))}
            </details>
          )}
        </div>
      </div>
    );
  }

  const toggleParticipant = (id) => {
    const has = xp.participants.includes(id);
    const next = has ? xp.participants.filter((x) => x !== id) : [...xp.participants, id];
    onPatchDraft(session.id, {
      participants: next,
      mvp: has && xp.mvp === id ? '' : xp.mvp,
    });
  };

  return (
    <div className="xp-card draft">
      <div className="xp-head">
        <span className={'xp-badge ' + (plan.errors.length ? 'conflict' : 'pending')}>
          {xp.amending ? '修订草稿' : '待结算草稿'}
        </span>
        <b>登记本章经验</b>
      </div>

      <div className="xp-fields">
        <label>经验池 XP
          <input type="number" min="0" value={xp.pool} onChange={(e) => onPatchDraft(session.id, { pool: e.target.value })} />
        </label>
        <label>名录奖励
          <input type="number" min="0" value={xp.bonus} onChange={(e) => onPatchDraft(session.id, { bonus: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} />
          <small>{plan.bonusCap !== null ? `不得超过基础份额一半：${plan.bonusCap}` : '先选出场角色'}</small>
        </label>
      </div>

      <div className="xp-pickers">
        <div className="xp-group">
          <small>出场角色（顺序即角色列表顺序，余数先分给靠前角色）</small>
          <div className="chip-row">
            {characters.map((c) => (
              <button
                key={c.id}
                className={'chip ' + (xp.participants.includes(c.id) ? 'on' : '')}
                onClick={() => toggleParticipant(c.id)}
              >{c.name}</button>
            ))}
          </div>
        </div>
        <div className="xp-group">
          <small>本场最佳</small>
          <select value={xp.mvp} onChange={(e) => onPatchDraft(session.id, { mvp: e.target.value })}>
            <option value="">— 选择一名出场角色 —</option>
            {xp.participants.map((id) => (
              <option key={id} value={id}>{nameOf[id]?.name || id}</option>
            ))}
          </select>
        </div>
      </div>

      <div className={'xp-preview ' + (plan.errors.length ? 'bad' : 'ok')}>
        <div className="xp-formula">
          试算：基础份额 <b>{plan.q}</b>，余数 <b>{plan.remainder}</b>，未分配额{' '}
          <b className={plan.unallocated === 0 ? '' : 'danger'}>{plan.unallocated}</b>
        </div>
        {plan.errors.length > 0 ? (
          <ul className="xp-errors">
            {plan.errors.map((err, i) => (
              <li key={i}>⚠ {err}</li>
            ))}
            {plan.conflicts.length > 0 && (
              <li className="conflict-roles">
                冲突角色：{[...new Set(plan.conflicts)].map((id) => nameOf[id]?.name || id).join('、')}
                <span className="muted">｜未分配额 {plan.unallocated}（必须为零）</span>
              </li>
            )}
          </ul>
        ) : (
          <div className="xp-rows">
            {Object.entries(plan.shares).map(([id, v], i) => (
              <div className="xp-row" key={id}>
                <span className="xp-char">
                  <i className="order-no">{i + 1}</i>
                  {nameOf[id]?.name || id}
                  {i < plan.remainder && <em className="rem">+1 余数</em>}
                  {plan.mvp === id && <em className="mvp">最佳 +{plan.bonus}</em>}
                </span>
                <b>+{v}</b>
              </div>
            ))}
          </div>
        )}
      </div>

      {(backfillRequired || xp.amending) && (
        <label className="xp-reason">修订原因（必填，将进入修订链）
          <textarea rows="2" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={xp.amending ? '例：结算时经验池登记有误，GM 复核后修订' : '例：该章漏登，补录较早章节'} />
        </label>
      )}

      <div className="xp-actions">
        {xp.amending && <button className="link" onClick={() => onCancelAmend(session.id)}>放弃修订（保持冻结）</button>}
        <button
          className="primary"
          disabled={plan.errors.length > 0 || reasonMissing}
          title={reasonMissing ? '请先填写修订原因' : ''}
          onClick={() => onSettle(session.id, reason)}
        >
          {xp.amending ? '提交修订并重算后续' : backfillRequired ? '补录结算并重算后续' : '确认结算（章节冻结）'}
        </button>
      </div>
    </div>
  );
}
