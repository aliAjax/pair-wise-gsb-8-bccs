// 初始数据层：战役、角色、章节及章节经验登记。
// 仅描述数据形态，不含结算逻辑。

export const seed = {
  version: 2,
  name: '暮光边境',
  system: 'D&D 5E',
  characters: [
    { id: 'c1', name: '艾德里安', role: '圣骑士', player: '林默', color: '#d8a153', ackLevel: 2 },
    { id: 'c2', name: '瑟琳', role: '游侠', player: '安然', color: '#93b7a6', ackLevel: 1 },
    { id: 'c3', name: '莫尔', role: '术士', player: '周岳', color: '#b9a6d1', ackLevel: 1 },
  ],
  sessions: [
    {
      id: 1,
      date: '2024-06-08',
      title: '第一章：灰港的钟声',
      summary: '队伍抵达灰港，在失落的钟楼发现了神秘符文。',
      tag: '主线',
      color: '#d8a153',
      // 已冻结结算：池 150，MVP 艾德里安 +10
      xp: {
        status: 'settled',
        pool: 150,
        participants: ['c1', 'c2', 'c3'],
        mvp: 'c1',
        bonus: 10,
        baseShare: 46,
        remainder: 2,
        allocations: { c1: 57, c2: 47, c3: 46 },
        settledAt: '2024-06-09T10:00:00.000Z',
        updatedAt: '2024-06-09T10:00:00.000Z',
        version: 1,
        versions: [],
        reason: '',
      },
    },
    {
      id: 2,
      date: '2024-06-15',
      title: '第二章：雾中来客',
      summary: '与流浪法师伊琳结盟，追踪海雾中的脚印。',
      tag: '主线',
      color: '#93b7a6',
      // 已冻结结算：池 180，MVP 瑟琳 +12（上限 floor(56/2)=28）
      xp: {
        status: 'settled',
        pool: 180,
        participants: ['c1', 'c2', 'c3'],
        mvp: 'c2',
        bonus: 12,
        baseShare: 56,
        remainder: 0,
        allocations: { c1: 56, c2: 68, c3: 56 },
        settledAt: '2024-06-16T10:00:00.000Z',
        updatedAt: '2024-06-16T10:00:00.000Z',
        version: 1,
        versions: [],
        reason: '',
      },
    },
    {
      id: 3,
      date: '2024-06-22',
      title: '支线：深林采药',
      summary: '帮助村民寻找月光草，瑟琳独自护送药草回程。',
      tag: '支线',
      color: '#b9a6d1',
      // 待结算草稿：名录奖励 30 超过基础份额一半（floor(45/2)=22），
      // 故意保留冲突，演示「保留草稿 + 列出章节、差额、冲突角色」。
      xp: {
        status: 'draft',
        pool: 120,
        participants: ['c1', 'c2'],
        mvp: 'c2',
        bonus: 30,
        insertedBeforeSettled: false,
      },
    },
  ],
  revisions: [],
  revisionSeq: 0,
};
