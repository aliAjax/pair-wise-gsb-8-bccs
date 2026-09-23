// 页面组件：角色卡片 + 累计经验 / 升级进度 / 升级待办。
import React from 'react';
import { LEVEL_THRESHOLDS } from '../campaign/data.js';
import { nextThreshold } from '../campaign/rules.js';

function progress(xp) {
  const t = nextThreshold(xp);
  if (t === null) return 1;
  const prev = [...LEVEL_THRESHOLDS].reverse().find((p) => xp >= p) || 0;
  return Math.min(1, (xp - prev) / (t - prev));
}

export function CharacterXP({ characters, levels, onConfirm }) {
  const pendingCount = Object.values(levels).filter((l) => l.pending).reduce((n, l) => n + l.pendingUps, 0);
  return (
    <section className="cards">
      <div className="section-note">
        队伍中有 {characters.length} 位冒险者；累计经验按已结算章节自动汇总。
        {pendingCount > 0 && <span className="todo-banner">有 {pendingCount} 项升级待办，请确认。</span>}
      </div>
      {characters.map((c) => {
        const info = levels[c.id] || { xp: 0, level: 1, autoLevel: 1, pending: false, pendingUps: 0 };
        const t = nextThreshold(info.xp);
        return (
          <article className="char-card xp-card" key={c.id}>
            <div className="avatar" style={{ background: c.color }}>{c.name[0]}</div>
            <div className="xp-main">
              <small>{c.role} · 玩家 {c.player}</small>
              <h3>{c.name}</h3>
              <div className="xp-level-row">
                <span className="level-badge">LV {info.level}</span>
                <b className="xp-num">{info.xp} XP</b>
                {info.pending && (
                  <button className="confirm-lv" onClick={() => onConfirm(c.id, c.name, info.autoLevel)}>
                    ⬆ 升至 {info.autoLevel} 级（待办 {info.pendingUps}）
                  </button>
                )}
              </div>
              <div className="xp-bar">
                <i style={{ width: `${progress(info.xp) * 100}%`, background: c.color }} />
              </div>
              <p className="xp-next">
                {t === null ? '已达满级' : `距 ${LEVEL_THRESHOLDS.indexOf(t) + 1} 级还差 ${t - info.xp} XP（${t}）`}
              </p>
            </div>
          </article>
        );
      })}
    </section>
  );
}
