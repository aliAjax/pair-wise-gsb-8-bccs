import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { loadData, saveData, exportJson } from './storage/store.js';
import {
  cumulativeXp,
  emptyDraft,
  planSettlement,
  settleChapter,
  startAmendment,
  levelFromXp,
} from './rules/xp.js';
import SettlementCard from './components/SettlementCard.jsx';
import LevelsPage from './components/LevelsPage.jsx';

function App() {
  const [data, setData] = useState(loadData);
  const [tab, setTab] = useState('timeline');
  const [active, setActive] = useState(data.sessions[0]?.id);
  const [show, setShow] = useState(false);
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState({ title: '', date: '2024-07-01', summary: '', tag: '主线', beforeId: '' });

  useEffect(() => saveData(data), [data]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 2600);
    return () => clearTimeout(t);
  }, [notice]);

  // 累计经验完全由已结算章节派生：任何补录/修订后自动一致
  const totals = useMemo(() => cumulativeXp(data.sessions), [data.sessions]);
  const pendingLevels = data.characters.reduce(
    (a, c) => a + Math.max(0, levelFromXp(totals[c.id] || 0) - (c.ackLevel || 1)),
    0
  );
  const draftConflicts = data.sessions.filter((s) => {
    if (s.xp?.status !== 'draft') return false;
    return planSettlement(data.characters, s.xp).errors.length > 0;
  }).length;
  const todoBadge = pendingLevels + draftConflicts;

  const cur = data.sessions.find((x) => x.id === active) || data.sessions[0];
  const curIndex = data.sessions.findIndex((x) => x.id === cur?.id);
  const backfillRequired =
    cur?.xp?.status === 'draft' &&
    !cur.xp.amending &&
    !!cur.xp.insertedBeforeSettled;

  const patchDraft = (id, patch) => {
    setData((d) => ({
      ...d,
      sessions: d.sessions.map((s) =>
        s.id === id ? { ...s, xp: { ...(s.xp || emptyDraft()), ...patch } } : s
      ),
    }));
  };

  const handleSettle = (id, reason) => {
    setData((d) => {
      try {
        const prev = d.sessions.find((x) => x.id === id);
        const kind = prev?.xp?.amending ? 'amend' : prev?.xp?.insertedBeforeSettled ? 'backfill' : 'settle';
        const next = settleChapter(d, id, reason, new Date().toISOString(), { value: d.revisionSeq });
        const s = next.sessions.find((x) => x.id === id);
        setNotice(
          kind === 'amend'
            ? `章节修订已生效（v${s.xp.version}），后续累计经验已重算`
            : kind === 'backfill'
              ? '补录完成，已生成修订链并重算后续累计经验与升级状态'
              : '章节已结算并冻结'
        );
        return next;
      } catch (e) {
        setNotice(e.plan ? `无法结算：${e.plan.errors[0]}（章节保留为草稿）` : e.message);
        return d;
      }
    });
  };

  const handleStartAmend = (id) => {
    setData((d) => ({
      ...d,
      sessions: d.sessions.map((s) =>
        s.id === id ? { ...s, xp: startAmendment(s) } : s
      ),
    }));
    setNotice('已从冻结记录开出修订草稿，填写原因并提交后生效；放弃则保持原冻结状态');
  };

  const handleCancelAmend = (id) => {
    // 放弃修订：用草稿中保存的生效版本快照原样还原，旧记录不受影响
    setData((d) => ({
      ...d,
      sessions: d.sessions.map((s) => {
        if (s.id !== id || !s.xp?.amending) return s;
        const live = s.xp._live;
        return live ? { ...s, xp: live } : { ...s, xp: emptyDraft() };
      }),
    }));
    setNotice('已放弃修订，章节保持原冻结状态');
  };

  const handleAckLevel = (cid, level) => {
    setData((d) => ({
      ...d,
      characters: d.characters.map((c) => (c.id === cid ? { ...c, ackLevel: level } : c)),
    }));
    setNotice('升级已确认');
  };

  const addChapter = () => {
    if (!form.title.trim()) {
      setNotice('请填写章节标题');
      return;
    }
    let s;
    setData((d) => {
      const sessions = [...d.sessions];
      const at = form.beforeId ? sessions.findIndex((x) => x.id === Number(form.beforeId)) : -1;
      // 插入位置之前已有结算章节 → 标记为补录草稿，结算时必须给原因并重算后续
      const insertedBeforeSettled =
        at > 0 && sessions.slice(0, at).some((x) => x.xp?.status === 'settled');
      s = {
        ...form,
        title: form.title.trim(),
        id: Date.now(),
        color: '#d8a153',
        xp: emptyDraft(insertedBeforeSettled),
      };
      if (at >= 0) sessions.splice(at, 0, s);
      else sessions.push(s);
      return { ...d, sessions };
    });
    setActive(s.id);
    setShow(false);
    setForm({ title: '', date: '2024-07-01', summary: '', tag: '主线', beforeId: '' });
    setNotice(
      s.xp.insertedBeforeSettled
        ? '已作为补录章节插入到已结算章节之前，结算时需填写原因并重算后续'
        : '新章节已加入时间线，请登记经验池后结算'
    );
  };

  const nav = [
    ['timeline', '◌', '时间线', 0],
    ['levels', '★', '经验与升级', todoBadge],
    ['characters', '♙', '角色与阵营', 0],
    ['places', '⌖', '地点图鉴', 0],
    ['loot', '◇', '战利品', 0],
  ];

  return (
    <div className="shell">
      <aside>
        <div className="logo"><span>✦</span> CAMPAIGNER</div>
        <div className="campaign">
          <small>当前战役</small>
          <strong>{data.name}</strong>
          <span>{data.system} · 2024</span>
        </div>
        <nav>
          {nav.map(([id, icon, label, badge]) => (
            <button className={tab === id ? 'active' : ''} onClick={() => setTab(id)} key={id}>
              <i>{icon}</i>{label}
              {badge > 0 && <em className="nav-badge">{badge}</em>}
            </button>
          ))}
        </nav>
        <div className="side-bottom">
          <button>⚙ 偏好设置</button>
          <small>本地存储已开启 · 刷新不丢档</small>
        </div>
      </aside>

      <main>
        <header>
          <div>
            <span className="crumb">MY CAMPAIGN / {data.system}</span>
            <h1>
              {tab === 'timeline' ? '战役时间线'
                : tab === 'levels' ? '章节经验结算与升级待办'
                : tab === 'characters' ? '角色与阵营'
                : tab === 'places' ? '地点图鉴' : '战利品'}
            </h1>
          </div>
          <div className="actions">
            <button onClick={() => exportJson(data)} className="outline">↓ 导出</button>
            <button onClick={() => setShow(true)} className="primary">＋ 新建章节</button>
          </div>
        </header>

        {tab === 'timeline' && (
          <div className="timeline-layout">
            <section className="timeline">
              <div className="timeline-intro">
                <div>
                  <span>THE CHRONICLE</span>
                  <h2>记录每一次冒险</h2>
                </div>
                <span className="count">{data.sessions.length} CHAPTERS</span>
              </div>
              {data.sessions.map((s, i) => {
                const st = s.xp?.status === 'settled';
                const conflict = s.xp?.status === 'draft' && planSettlement(data.characters, s.xp).errors.length > 0;
                return (
                  <button className={'chapter ' + (cur?.id === s.id ? 'selected' : '')} onClick={() => setActive(s.id)} key={s.id}>
                    <div className="date">
                      <b>{new Date(s.date).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}</b>
                      <small>{new Date(s.date).getFullYear()}</small>
                    </div>
                    <div className="line">
                      <span style={{ background: st ? s.color : conflict ? '#c0504d' : '#fff' }}></span>
                      {i < data.sessions.length - 1 && <i />}
                    </div>
                    <div className="chapter-copy">
                      <div className="tag-row">
                        <div className="tag">{s.tag}</div>
                        <em className={'xp-state ' + (st ? 'settled' : conflict ? 'conflict' : 'draft')}>
                          {st ? `已结算 v${s.xp.version}` : conflict ? '草稿·冲突' : '待结算'}
                        </em>
                      </div>
                      <h3>{s.title}</h3>
                      <p>{s.summary}</p>
                    </div>
                    <span className="arrow">↗</span>
                  </button>
                );
              })}
            </section>

            <section className="detail-panel">
              <div className="detail-cover" style={{ background: cur?.color }}>
                <span>CHAPTER {String(curIndex + 1).padStart(2, '0')}</span>
                <i>✦</i>
              </div>
              <div className="detail-body">
                <span className="tag">{cur?.tag}</span>
                <h2>{cur?.title}</h2>
                <p>{cur?.summary}</p>
                <div className="meta-grid">
                  <div><small>游戏日期</small><strong>{cur?.date}</strong></div>
                  <div>
                    <small>结算状态</small>
                    <strong>{cur?.xp?.status === 'settled' ? `已冻结 · v${cur.xp.version}` : '待结算草稿'}</strong>
                  </div>
                </div>

                {cur && (
                  <SettlementCard
                    key={cur.id + ':' + (cur.xp?.amending ? 'a' : cur.xp?.status)}
                    session={cur}
                    characters={data.characters}
                    backfillRequired={backfillRequired}
                    onPatchDraft={patchDraft}
                    onSettle={handleSettle}
                    onStartAmend={handleStartAmend}
                    onCancelAmend={handleCancelAmend}
                  />
                )}
              </div>
            </section>
          </div>
        )}

        {tab === 'levels' && (
          <div className="page-pad">
            <LevelsPage data={data} totals={totals} onAckLevel={handleAckLevel} />
          </div>
        )}

        {tab === 'characters' && (
          <section className="cards">
            <div className="section-note">
              队伍中有 {data.characters.length} 位冒险者。角色顺序同时是余数分配顺序。
            </div>
            {data.characters.map((c) => (
              <article className="char-card" key={c.id}>
                <div className="avatar" style={{ background: c.color }}>{c.name[0]}</div>
                <div>
                  <small>{c.role}</small>
                  <h3>{c.name}</h3>
                  <p>玩家 · {c.player}</p>
                  <p className="char-xp">
                    累计 {totals[c.id] || 0} XP · Lv{levelFromXp(totals[c.id] || 0)}
                    {levelFromXp(totals[c.id] || 0) > (c.ackLevel || 1) && <em className="lv-up-inline"> 可升级</em>}
                  </p>
                </div>
                <button onClick={() => { setTab('levels'); }}>↗</button>
              </article>
            ))}
          </section>
        )}

        {tab === 'places' && (
          <section className="empty">
            <div>⌖</div>
            <h2>地点图鉴</h2>
            <p>从章节笔记中收集地点。当前已记录灰港、雾林和失落钟楼。</p>
            <div className="place-list">
              <span>01　灰港 <b>已探索</b></span>
              <span>02　失落钟楼 <b>已探索</b></span>
              <span>03　雾林 <b>待探索</b></span>
            </div>
          </section>
        )}

        {tab === 'loot' && (
          <section className="empty">
            <div>◇</div>
            <h2>战利品清单</h2>
            <p>追踪旅途中获得的装备、遗物和金币。</p>
            <div className="place-list">
              <span>月光草 × 3 <b>消耗品</b></span>
              <span>古老铜币 × 1 <b>遗物</b></span>
              <span>灰港守卫徽章 × 2 <b>任务物品</b></span>
            </div>
          </section>
        )}
      </main>

      {show && (
        <div className="modal-bg">
          <div className="modal">
            <button className="close" onClick={() => setShow(false)}>×</button>
            <span className="crumb">NEW CHAPTER</span>
            <h2>记录新的章节</h2>
            <label>章节标题
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="例：第三章：月下集市" />
            </label>
            <label>游戏日期
              <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </label>
            <label>章节摘要
              <textarea rows="3" value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} placeholder="发生了什么？" />
            </label>
            <label>章节类型
              <select value={form.tag} onChange={(e) => setForm({ ...form, tag: e.target.value })}>
                <option>主线</option><option>支线</option><option>番外</option>
              </select>
            </label>
            <label>插入位置（补录较早章节时选择）
              <select value={form.beforeId} onChange={(e) => setForm({ ...form, beforeId: e.target.value })}>
                <option value="">追加到时间线末尾</option>
                {data.sessions.map((s, i) => (
                  <option key={s.id} value={s.id}>第{i + 1}章之前：{s.title}</option>
                ))}
              </select>
            </label>
            <button className="primary full" onClick={addChapter}>保存章节</button>
          </div>
        </div>
      )}

      {notice && <div className="toast">{notice}</div>}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
