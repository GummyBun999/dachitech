/**
 * UI 只消费生成的公共投影（DEVELOPMENT-PLAN §5：UI 不现场清洗源数据）。
 */
import generated from "../data/restaurants.generated.json";

export interface PubDish { name: string; review?: string; score10?: number | null }
export interface PubRestaurant {
  id: string; slug: string; regionSlug: string; actualCity: string;
  brand: string; branch: string | null; category: string | null; cuisineTags: string[];
  reviewText: string; dishes: PubDish[];
  score10: number | null; scoreScope: "restaurant" | "none";
  recommendationLevel: "wubiChi" | "yingChiBang" | "keyiChi" | "daiChi";
  visitedAt: string | null; visitedAtPrecision: "day" | "month" | null;
  inRecent: boolean; multiShop: boolean; amapQuery: string;
  lng: number | null; lat: number | null; coordSystem: string | null; poiConfidence: string | null;
  contentUpdatedAt: string; coverImage: string | null;
}

export const data = generated as unknown as {
  generatedAt: string;
  policyVersion: string;
  recentWindowDays: number;
  regions: Array<{ slug: string; name: string; count: number }>;
  restaurants: PubRestaurant[];
};

export const restaurants = data.restaurants;

export const REGION_ORDER = ["shenzhen", "zhongshan", "chongqing", "guangzhou", "japan", "singapore", "thailand"] as const;
export const regionName = (slug: string) => data.regions.find((r) => r.slug === slug)?.name ?? slug;
export const regionCount = (slug: string) => data.regions.find((r) => r.slug === slug)?.count ?? 0;
export const regionWait = (slug: string) => (data.regions.find((r) => r.slug === slug) as any)?.wait ?? 0;
export const byRegion = (slug: string) => restaurants.filter((r) => r.regionSlug === slug);
export const eatenByRegion = (slug: string) => byRegion(slug).filter(isEaten);
export const waitByRegion = (slug: string) => byRegion(slug).filter((r) => r.recommendationLevel === "daiChi");

/** 推荐用语只允许这四个（DEVELOPMENT-PLAN §1） */
export const LEVEL_LABEL: Record<PubRestaurant["recommendationLevel"], string> = {
  wubiChi: "务必吃",
  yingChiBang: "应吃榜",
  keyiChi: "可以吃",
  daiChi: "待吃",
};

/** 实吃档（本人实吃记录，用于「本人实吃」计数，排除待吃） */
export const EATEN_LEVELS = ["wubiChi", "yingChiBang", "keyiChi"] as const;
export const isEaten = (r: PubRestaurant) => r.recommendationLevel !== "daiChi";

/** 最近吃了（Q3：120 天窗口内，构建时已按保守月精度判定） */
export const recentEats = restaurants.filter((r) => r.inRecent);
export const mustEats = restaurants.filter((r) => r.recommendationLevel === "wubiChi");
export const topList = restaurants.filter((r) => r.recommendationLevel === "yingChiBang");
export const waitList = restaurants.filter((r) => r.recommendationLevel === "daiChi");

/** 展示日期：月精度展示 YYYY.MM，不伪造具体日 */
export function fmtVisited(r: PubRestaurant): string | null {
  if (!r.visitedAt) return null;
  if (r.visitedAtPrecision === "month") {
    const [y, m] = r.visitedAt.split("-");
    return `${y}.${m}`;
  }
  return r.visitedAt.replaceAll("-", ".");
}

/** 评分展示：x.x/10；无分不显示（缺评分不显示分数） */
export function fmtScore(score: number | null): string | null {
  if (score === null) return null;
  return `${Number.isInteger(score) ? score.toFixed(0) : score.toFixed(1)}/10`;
}

/** 高德外链：店名+实际城市+分店，encodeURIComponent（生成时已编码） */
export const amapUrl = (r: PubRestaurant) => `https://uri.amap.com/search?keyword=${r.amapQuery}`;

/** 最后更新：可见内容实质变化（当前取发布集最大 contentUpdatedAt） */
export function lastUpdated(list = restaurants): string | null {
  const max = list.map((r) => r.contentUpdatedAt).sort().pop();
  return max ? max.replaceAll("-", ".") : null;
}

// base 感知的目录式路由（部署在 /dachitech/ 子路径；BASE_URL 由 astro.config.base 注入，带尾斜杠）
const BASE = import.meta.env.BASE_URL;
export const homePath = BASE;
export function detailPath(r: PubRestaurant) {
  return `${BASE}${r.regionSlug}/${encodeURIComponent(r.slug)}/`;
}
export function regionPath(slug: string) {
  return `${BASE}${slug}/`;
}
