/**
 * @file shared/core/bannedWords.ts
 * 广告法极限词检测:贴回前标红,降低微商/电商用户的合规风险。
 * 词表为人工精选的常见极限词(官方列举 + 各平台审核实践交集),
 * ponytail: 故意排除"完美/精品/首选/全能"等日常聊天高误报的泛 praise 词,
 * 升级路径:接入 konsheng/Sensitive-lexicon 等 4k-star 开源词库做完整版。
 */

/** 广告法极限词表(低误报精选版)。 */
export const BANNED_WORDS: string[] = [
  // 最X 系列
  '最好', '最佳', '最优', '最强', '最先进', '最顶级', '最专业', '最优秀', '最好用',
  '最便宜', '最低价', '最高级', '最高端', '最出色', '最奢侈', '最牢固',
  // 第一 系列(单独"第一"误报高,只收短语)
  '第一品牌', '销量第一', '全网第一', '行业第一', '全国第一', '全球第一', '世界第一',
  '全网销量第一',
  // 绝对化
  '顶级', '顶尖', '极品', '绝佳', '绝无仅有', '绝版', '史无前例', '前无古人',
  '后无来者', '空前绝后', '万能', '百分之百', '百分百有效', '独家秘方',
  // 级别/地位
  '国家级', '世界级', '全球级', '世界领先', '行业领先', '全国领先', '领导品牌',
  '王牌', '销量冠军', '全网爆款之王',
  // 功效/医疗
  '根治', '根除', '药到病除', '立竿见影', '包治百病', '彻底根治', '无疤痕',
  '无副作用', '无效退款', '彻底摆脱',
  // 承诺/金融
  '稳赚', '稳赚不赔', '保本', '零风险', '无风险', '只赚不赔', '翻倍收益',
  '躺赚', '永久有效', '永久免费',
  // 促销施压
  '秒杀', '仅此一天', '错过不再', '最后一波', '清仓价',
];

const CLEAN_WORDS = Array.from(new Set(BANNED_WORDS));

/**
 * 找出文本中出现的极限词(去重,按词表顺序)。
 * customWords: 用户个人禁忌词(设置里的词库),与内置广告法词表合并检测。
 */
export function findBannedWords(text: string, customWords?: string[]): string[] {
  if (!text) return [];
  const hits = CLEAN_WORDS.filter((w) => text.includes(w));
  const seen = new Set(hits);
  for (const raw of customWords ?? []) {
    const w = (raw || '').trim();
    if (w && !seen.has(w) && text.includes(w)) {
      hits.push(w);
      seen.add(w);
    }
  }
  return hits;
}
