export {}; // 使本文件成为模块，declare global 才生效

/**
 * map-adapter —— 高德 JS API 2.0 站内地图（DEVELOPMENT-PLAN §7 交互合同 / §8 POI）。
 *
 * 本版新增（用户 2026-09-16 需求 1/4）：
 * - marker 按榜单着色（务必吃/应吃榜/可以吃）；
 * - 点击 marker 弹信息窗：店名 + 评分 + 导航 + 详情（移动端地图视图下即列表↔地图的联动载体）；
 * - 「查看全部」重置回全览。
 *
 * 边界：只渲染已验证坐标；缺凭据/SDK 失败降级；筛选同步 marker 显隐；与 city-browser 事件解耦。
 */
type Pt = {
  pid: string;   // 点位唯一 id（单店=卡 id；多门店=门店 id）
  id: string;    // 所属卡片 id
  lng: number; lat: number; name: string; level: string;
  score: string; detail: string; amap: string;
};
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

declare global {
  interface Window {
    AMap?: any;
    _AMapSecurityConfig?: { securityJsCode: string };
    __AMAP?: { key: string; security: string };
  }
}

function loadAMap(key: string, security: string): Promise<any> {
  if (window.AMap) return Promise.resolve(window.AMap);
  window._AMapSecurityConfig = { securityJsCode: security };
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}`;
    s.async = true;
    s.onload = () => (window.AMap ? resolve(window.AMap) : reject(new Error("AMap 未就绪")));
    s.onerror = () => reject(new Error("AMap 脚本加载失败"));
    document.head.appendChild(s);
  });
}

function initMap(app: HTMLElement) {
  const panel = app.querySelector<HTMLElement>("[data-mappanel]");
  const fallback = app.querySelector<HTMLElement>("[data-mapfallback]");
  if (!panel) return;

  // 从卡片 DOM 收集有坐标的点（含导航/详情链接与评分，避免另存一份 JSON）
  const points: Pt[] = [];
  app.querySelectorAll<HTMLElement>(".rc").forEach((card) => {
    const base = {
      id: card.dataset.id || "",
      name: card.querySelector(".rc-name")?.textContent?.trim() || "",
      level: card.dataset.level || "keyiChi",
      score: card.querySelector(".rc-score .num")?.textContent?.trim() || "",
      detail: card.querySelector<HTMLAnchorElement>(".rc-name a")?.getAttribute("href") || "",
    };
    const branches = card.querySelectorAll<HTMLElement>(".rc-br");
    if (branches.length) {
      // 同品牌多门店：每家有坐标的门店一个点，全部指向同一张卡
      branches.forEach((b) => {
        const lng = parseFloat(b.dataset.lng || ""), lat = parseFloat(b.dataset.lat || "");
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
        points.push({ ...base, pid: b.dataset.branchId || base.id, lng, lat,
          name: `${base.name} · ${b.dataset.branch || ""}`, amap: b.dataset.nav || "" });
      });
      return;
    }
    const lng = parseFloat(card.dataset.lng || ""), lat = parseFloat(card.dataset.lat || "");
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
    points.push({ ...base, pid: base.id, lng, lat,
      amap: card.querySelector<HTMLAnchorElement>(".rc-nav")?.getAttribute("href") || "" });
  });

  const cfg = window.__AMAP;
  const showFallback = (msg: string, retry = false) => {
    if (!fallback) return;
    fallback.hidden = false;
    fallback.innerHTML = "";
    const t = document.createElement("p");
    t.className = "mf-title";
    t.textContent = "地图";
    const p = document.createElement("p");
    p.className = "mf-sub";
    p.textContent = msg;
    fallback.append(t, p);
    if (retry) {
      const b = document.createElement("button");
      b.className = "mf-retry";
      b.textContent = "重试";
      b.addEventListener("click", () => { fallback.innerHTML = "<p class='mf-sub'>地图加载中…</p>"; start(); });
      fallback.append(b);
    }
  };

  if (points.length === 0) return; // 保留服务端渲染的「位置待补」诚实文案
  if (!cfg?.key) { showFallback("地图凭据未配置，先看列表；每家都能一键跳转高德搜索。"); return; }

  let map: any = null;
  let info: any = null;
  const markers = new Map<string, { marker: any; el: HTMLElement; cardId: string }>();
  let selecting = false; // 事件来源标记：防 marker↔card 递归
  let activeId: string | null = null; // 当前选中的卡片 id
  // PC（有精确指针且支持 hover）：marker 悬停即预览；移动端不加 hover（用户要求不改）
  const hoverCapable = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

  const LEVEL_CN: Record<string, string> = { wubiChi: "务必吃", yingChiBang: "应吃榜", keyiChi: "可以吃", daiChi: "待吃" };

  /** 高亮：卡片按卡 id，marker / 门店行按点位 id */
  function highlight(p: Pt | null) {
    markers.forEach((m, pid) => m.el.classList.toggle("is-active", !!p && pid === p.pid));
    app.querySelectorAll<HTMLElement>(".rc").forEach((c) =>
      c.classList.toggle("rc--active", !!p && c.dataset.id === p.id));
    app.querySelectorAll<HTMLElement>(".rc-br").forEach((b) =>
      b.classList.toggle("is-active", !!p && b.dataset.branchId === p.pid));
    activeId = p ? p.id : null;
  }

  function openInfo(p: Pt) {
    if (!info) return;
    const box = document.createElement("div");
    box.className = "map-iw";
    box.innerHTML =
      `<div class="map-iw-name">${esc(p.name)}</div>` +
      `<div class="map-iw-meta">${LEVEL_CN[p.level] ?? ""}${p.score ? ` · <span class="num">${esc(p.score)}</span>` : ""}</div>` +
      `<div class="map-iw-actions">` +
        `<a class="map-iw-nav" href="${esc(p.amap)}" target="_blank" rel="noopener noreferrer">导航</a>` +
        `<a class="map-iw-detail" href="${esc(p.detail)}">详情</a>` +
      `</div>`;
    info.setContent(box);
    info.open(map, [p.lng, p.lat]);
  }

  function selectPoint(p: Pt, fromMap: boolean) {
    if (selecting) return;
    selecting = true;
    try {
      highlight(p);
      openInfo(p);
      const card = app.querySelector<HTMLElement>(`.rc[data-id="${p.id}"]`);
      if (card && fromMap) card.scrollIntoView({ block: "nearest", behavior: "smooth" });
      if (!fromMap && map) map.setCenter([p.lng, p.lat]);
    } finally {
      selecting = false;
    }
  }

  async function start() {
    try {
      const AMap = await loadAMap(cfg!.key, cfg!.security);
      map = new AMap.Map(panel, { zoom: 12, resizeEnable: true, viewMode: "2D" });
      info = new AMap.InfoWindow({ isCustom: true, autoMove: true, offset: new AMap.Pixel(0, -14) });
      map.on("click", () => { info.close(); highlight(null); });

      const all: any[] = [];
      for (const p of points) {
        const el = document.createElement("div");
        el.className = `map-pin map-pin--${p.level}`;
        el.title = p.name;
        const marker = new AMap.Marker({ position: [p.lng, p.lat], content: el, anchor: "center", zIndex: 110 });
        // 自定义 content 的 marker，AMap 不自动绑点击 → 直接在元素上绑（并阻止冒泡到地图 click 关窗）
        el.addEventListener("click", (ev) => { ev.stopPropagation(); selectPoint(p, true); });
        marker.on("click", () => selectPoint(p, true));
        // PC 悬停预览：只开信息窗 + 高亮，不滚动卡片（避免每次 hover 抖动）
        if (hoverCapable) el.addEventListener("mouseenter", () => { if (!selecting) { highlight(p); openInfo(p); } });
        markers.set(p.pid, { marker, el, cardId: p.id });
        all.push(marker);
      }
      map.add(all);
      map.setFitView(all, false, [30, 30, 30, 30]);
      if (fallback) fallback.hidden = true;

      // 「查看全部」重置（DEVELOPMENT-PLAN §7）
      const reset = document.createElement("button");
      reset.className = "map-reset";
      reset.type = "button";
      reset.textContent = "查看全部";
      reset.addEventListener("click", () => {
        info.close(); highlight(null);
        const vis = [...markers.values()].filter((m) => m.marker.getMap()).map((m) => m.marker);
        if (vis.length) map.setFitView(vis, false, [30, 30, 30, 30]);
      });
      panel!.appendChild(reset); // 顶部已 `if (!panel) return`，异步闭包内 TS 未保留收窄

      // 筛选同步：被筛掉的卡片对应 marker 移除；当前选中被筛掉则关信息窗
      const syncMarkers = () => {
        markers.forEach((m) => {
          const card = app.querySelector<HTMLElement>(`.rc[data-id="${m.cardId}"]`);
          m.marker.setMap(card?.hidden ? null : map);
        });
        if (activeId) {
          const c = app.querySelector<HTMLElement>(`.rc[data-id="${activeId}"]`);
          if (c?.hidden) { info.close(); highlight(null); }
        }
      };
      app.addEventListener("city:filtered", syncMarkers);
      syncMarkers();

      // 卡片 → 地图：点击卡片定位（店名/图片/导航链接除外）
      app.querySelectorAll<HTMLElement>(".rc").forEach((card) => {
        const own = points.filter((x) => x.id === card.dataset.id);
        if (!own.length) return;
        card.addEventListener("click", (e) => {
          const t = e.target as HTMLElement;
          if (t.closest("a")) return;
          // 点在某个门店行上 → 定位到那家门店；否则定位到第一家有坐标的门店
          const br = t.closest<HTMLElement>(".rc-br");
          const p = (br && own.find((x) => x.pid === br.dataset.branchId)) || own[0];
          selectPoint(p, false);
        });
      });
    } catch {
      showFallback("地图暂时没加载出来，可继续看列表。", true);
    }
  }

  // 懒加载：可见即加载；否则进入视口或切到地图视图时加载
  const visible = () => panel.getClientRects().length > 0 && panel.offsetParent !== null;
  if (visible()) start();
  else {
    const io = new IntersectionObserver((ents) => {
      if (ents.some((e) => e.isIntersecting)) { io.disconnect(); start(); }
    });
    io.observe(panel);
    app.querySelectorAll<HTMLButtonElement>('button[data-view="map"]').forEach((b) =>
      b.addEventListener("click", () => { if (!map) start(); }, { once: true }));
  }
}

document.querySelectorAll<HTMLElement>(".city-app").forEach(initMap);
