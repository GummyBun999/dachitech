/**
 * map-adapter —— 高德 JS API 2.0 站内地图（DEVELOPMENT-PLAN §7 交互合同 / §8 POI）。
 *
 * 边界：
 * - 只渲染有「已验证坐标」的门店（GCJ02，高德原生坐标系，构建时来自 manual-overrides.poi）。
 *   无坐标的店留列表「位置待补」，绝不落到城市中心假装有位置。
 * - key + securityJsCode 由页面注入（window.__AMAP）；缺凭据或 SDK 加载失败 → 显示降级文案 + 重试，
 *   列表/详情/高德外链不依赖本模块。
 * - 与 city-browser 解耦：通过 DOM 事件和 data 属性联动，不共享内部状态对象。
 *   marker↔card 双向选中用事件来源标记防递归。
 */
export {}; // 使本文件成为模块，declare global 才生效

type Pt = { id: string; lng: number; lat: number; name: string };

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

  // 收集本区有坐标的卡片
  const points: Pt[] = [];
  app.querySelectorAll<HTMLElement>(".rc").forEach((card) => {
    const lng = parseFloat(card.dataset.lng || "");
    const lat = parseFloat(card.dataset.lat || "");
    if (Number.isFinite(lng) && Number.isFinite(lat)) {
      const nameEl = card.querySelector(".rc-name");
      points.push({ id: card.dataset.id || "", lng, lat, name: nameEl?.textContent?.trim() || "" });
    }
  });

  const cfg = window.__AMAP;
  const showFallback = (msg: string, retry = false) => {
    if (!fallback) return;
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
  const markers = new Map<string, any>();
  let selecting = false; // 事件来源标记：防 marker↔card 递归

  function selectCard(id: string, fromMap: boolean) {
    if (selecting) return;
    selecting = true;
    try {
      app.querySelectorAll<HTMLElement>(".rc").forEach((c) =>
        c.classList.toggle("rc--active", c.dataset.id === id));
      const card = app.querySelector<HTMLElement>(`.rc[data-id="${id}"]`);
      if (card && fromMap) card.scrollIntoView({ block: "nearest", behavior: "smooth" });
      markers.forEach((mk, mid) => mk.setzIndex?.(mid === id ? 130 : 110));
      if (!fromMap && map && markers.has(id)) map.setCenter(markers.get(id).getPosition());
    } finally {
      selecting = false;
    }
  }

  async function start() {
    try {
      const AMap = await loadAMap(cfg!.key, cfg!.security);
      map = new AMap.Map(panel, { zoom: 12, resizeEnable: true, viewMode: "2D" });
      const pos = points.map((p) => {
        const marker = new AMap.Marker({ position: [p.lng, p.lat], title: p.name });
        marker.on("click", () => selectCard(p.id, true));
        markers.set(p.id, marker);
        return marker;
      });
      map.add(pos);
      map.setFitView(pos, false, [24, 24, 24, 24]);
      if (fallback) fallback.hidden = true;

      // 筛选同步：被筛掉的卡片对应 marker 隐藏；零结果时地图无点（列表空态已提示）
      const syncMarkers = () => {
        markers.forEach((mk, id) => {
          const card = app.querySelector<HTMLElement>(`.rc[data-id="${id}"]`);
          mk.setMap(card?.hidden ? null : map); // setMap(null) 彻底移除 DOM，比 hide() 可靠
        });
      };
      app.addEventListener("city:filtered", syncMarkers);
      syncMarkers(); // 地图异步加载完成时，立即对齐已生效的（URL 恢复的）筛选态

      // 卡片 → 地图：点击卡片定位控件（详情链接除外）
      app.querySelectorAll<HTMLElement>(".rc").forEach((card) => {
        if (!card.dataset.lng) return;
        card.addEventListener("click", (e) => {
          if ((e.target as HTMLElement).closest("a")) return; // 店名/图片链接进详情，不拦截
          selectCard(card.dataset.id || "", false);
        });
      });
    } catch (err) {
      showFallback("地图暂时没加载出来，可继续看列表。", true);
    }
  }

  // 首次进入地图视图或桌面直接可见时才加载 SDK（懒加载）
  const visible = () => panel.getClientRects().length > 0 && panel.offsetParent !== null;
  if (visible()) start();
  else {
    const io = new IntersectionObserver((ents) => {
      if (ents.some((e) => e.isIntersecting)) { io.disconnect(); start(); }
    });
    io.observe(panel);
    // 移动端点「地图」视图时也触发
    app.querySelectorAll<HTMLButtonElement>('button[data-view="map"]').forEach((b) =>
      b.addEventListener("click", () => { if (!map) start(); }, { once: true }));
  }
}

document.querySelectorAll<HTMLElement>(".city-app").forEach(initMap);
