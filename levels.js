(function (root) {
  'use strict';
  const levels = [
    {
      id: 1, title: '一车定乾坤', chapter: '初识杀法', theme: '白脸将', moves: 1,
      intro: '帅与将的遥遥相望，也是一种力量。让车封住最后一条退路。',
      lesson: '白脸将：借助将帅不能照面的规则，限制对方将的活动，再用车完成将杀。',
      pieces: [['bK', 0, 5], ['rK', 9, 4], ['rR', 2, 0]]
    },
    {
      id: 2, title: '双车叩宫门', chapter: '初识杀法', theme: '双车错', moves: 1,
      intro: '两辆车交替控制横线。找准落点，让黑将无处可退。',
      lesson: '双车错：两辆车分别控制相邻的横线或纵线，交替将军，逐步压缩将的空间。',
      pieces: [['bK', 0, 4], ['rK', 9, 3], ['rR', 1, 0], ['rR', 3, 8]]
    },
    {
      id: 3, title: '马跃卧槽处', chapter: '初识杀法', theme: '卧槽马', moves: 1,
      intro: '马落在将侧的要点，车在远处守住退路。留意马腿。',
      lesson: '卧槽马：红马跳到黑方二路或八路的卧槽点将军，配合其他子力封住逃路。',
      pieces: [['bK', 0, 4], ['bA', 0, 3], ['bA', 0, 5], ['rK', 9, 3], ['rR', 1, 8], ['rN', 3, 5]]
    },
    {
      id: 4, title: '隔山一声炮', chapter: '初识杀法', theme: '重炮', moves: 1,
      intro: '炮需要一个炮架。两门炮站在同一条线上，会发生什么？',
      lesson: '重炮：两门炮在同一条线上，前炮充当炮架，后炮将军；将吃前炮也会被后炮攻击。',
      pieces: [['bK', 0, 4], ['bA', 0, 3], ['bA', 0, 5], ['rK', 9, 3], ['rC', 2, 4], ['rC', 4, 0]]
    },
    {
      id: 5, title: '铁门横锁', chapter: '子力相济', theme: '车炮牵制', moves: 1,
      intro: '士象挡在中路，却也牵制了彼此。车从侧翼切入，看看谁能回防。',
      lesson: '炮在中路牵制士象。车从底线将军后，黑方若移开中间的守子，就会暴露在炮火之下。',
      pieces: [['bK', 0, 4], ['bA', 1, 4], ['bE', 2, 4], ['rK', 9, 3], ['rC', 5, 4], ['rR', 3, 0]]
    },
    {
      id: 6, title: '小兵立奇功', chapter: '子力相济', theme: '兵车联手', moves: 2,
      intro: '过河的小兵也能左右战局。让兵和车各守一道关。',
      lesson: '过河兵可以左右移动。兵控制将的退路，车负责将军，少量子力也能完成绝杀。',
      pieces: [['bK', 0, 4], ['rK', 9, 3], ['rP', 3, 4], ['rR', 4, 0]]
    },
    {
      id: 7, title: '双车步步紧', chapter: '子力相济', theme: '双车接力', moves: 2,
      intro: '不要急着靠近。先用一辆车封线，再让另一辆车完成将军。',
      lesson: '双车配合时，一车封路、一车将军。两车不必靠得很近，也能建立有效的封锁。',
      pieces: [['bK', 0, 4], ['rK', 9, 3], ['rR', 3, 0], ['rR', 4, 8]]
    },
    {
      id: 8, title: '马后藏锋', chapter: '子力相济', theme: '马后炮', moves: 2,
      intro: '马管两侧，炮管中路。寻找一条让两枚棋子互相照应的线。',
      lesson: '马后炮：马在将前方隔一格，控制将的两个侧翼；炮在马后借马为架，封锁中路。',
      pieces: [['bK', 0, 4], ['rK', 9, 3], ['rN', 4, 3], ['rC', 5, 0]]
    },
    {
      id: 9, title: '长车破阵', chapter: '步步为营', theme: '运车取势', moves: 3,
      intro: '黑方多了一层守卫。先控制关键横线，再观察黑将的应手。',
      lesson: '残局中先取得位置优势，再实施将军。每次落子后，都要重新检查对方的所有退路。',
      pieces: [['bK', 0, 4], ['bA', 2, 5], ['rK', 9, 3], ['rR', 5, 0], ['rR', 6, 8]]
    },
    {
      id: 10, title: '炮火连营', chapter: '步步为营', theme: '双炮借势', moves: 3,
      intro: '把分散的炮组织起来。借用黑方的守子做炮架，打开宫门。',
      lesson: '炮架不分敌我。利用黑方自己的守子架炮，配合另一门炮和兵，连续封锁将的退路。',
      pieces: [['bK', 0, 4], ['bA', 0, 3], ['bA', 0, 5], ['rK', 9, 3], ['rC', 3, 0], ['rC', 5, 8], ['rP', 3, 4]]
    },
    {
      id: 11, title: '车马共长风', chapter: '步步为营', theme: '车马合击', moves: 3,
      intro: '车的直线与马的斜势，拼出一张无形的网。先让马站到好位置。',
      lesson: '车马配合的关键是分工：马限制宫内活动，车控制整条线。注意不要让车挡住马腿。',
      pieces: [['bK', 0, 4], ['bA', 0, 3], ['bA', 0, 5], ['rK', 9, 3], ['rR', 4, 8], ['rN', 4, 6]]
    },
    {
      id: 12, title: '一局见天地', chapter: '步步为营', theme: '入门试炼', moves: 3,
      intro: '把学过的封线与配合用在这一局。步步有回应，着着有目的。',
      lesson: '入门杀法已练成，接下来进入不限步数的实战关。先看退路、保持配合，让每一着棋都有意义。',
      pieces: [['bK', 1, 4], ['bA', 0, 3], ['bE', 0, 6], ['bP', 3, 2], ['rK', 9, 3], ['rR', 5, 0], ['rR', 6, 8], ['rP', 3, 4]]
    }
  ];
  const chapters = typeof module !== 'undefined' && module.exports ? require('./campaign-design') : root.XiangqiChapters;
  const campaign = typeof module !== 'undefined' && module.exports ? require('./campaign-data') : root.XiangqiCampaign;
  for (const level of levels) {
    level.kind = 'puzzle';
    level.chapterIndex = Math.floor((level.id - 1) / 10);
    level.chapter = chapters[level.chapterIndex].title;
  }
  levels.push(...campaign);
  root.XiangqiLevels = levels;
  if (typeof module !== 'undefined' && module.exports) module.exports = levels;
})(typeof globalThis !== 'undefined' ? globalThis : this);
