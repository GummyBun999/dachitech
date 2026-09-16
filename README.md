# 大吃特吃

深圳及其他地方的本人实吃记录 —— 一张给朋友看的个人美食地图。

先选地区，再按品类 / 推荐榜（务必吃 / 应吃榜 / 可以吃）筛选，看本人点评、推荐单品，一键跳高德，有坐标的店在地图上可点。

## 技术

- [Astro](https://astro.build) 静态站，TypeScript
- 高德 JS API 2.0 站内地图（仅渲染已核实坐标的门店）
- 部署：GitHub Pages（`.github/workflows/deploy.yml` 自动构建）
- 站点：https://gummybun999.github.io/dachitech/

## 本地开发

```bash
npm install
npm run dev        # 本地预览
npm run build      # 生产构建到 dist/
npm run preview    # 预览构建产物
```

地图需要高德凭据：本地放 `data/map-config.json`（gitignore），CI 用仓库 Secret `PUBLIC_AMAP_KEY` / `PUBLIC_AMAP_SECURITY` 注入。缺凭据时地图降级为列表，不影响其余功能。

> 数据管线（Notion 采集、去重、评分、发布过滤）在私有工作区维护；本仓只包含站点前端与已脱敏的发布数据 `src/data/restaurants.generated.json`。
