/**
 * city-browser —— 地区页筛选/搜索/视图/状态恢复（DEVELOPMENT-PLAN §7 交互合同）。
 *
 * 设计原则：
 * - 渐进增强：卡片已由服务端渲染，无 JS 时全部可见可点；本模块只做「显示/隐藏 + 计数 + URL 状态」。
 * - 纯 DOM 筛选，不在前端二次清洗源数据；筛选依据来自卡片的 data 属性（构建时生成）。
 * - 共享状态写入地区路径内的查询参数（?category=&list=&q=&view=），可分享、返回可恢复。
 * - category(品类) 与 list(榜单) 为交集；每个维度内多选为并集；再与搜索词交集。
 * - 统计数量与实际可见卡片严格一致；零结果显示空态。
 *
 * 地图未接入：当前 0/47 已验证坐标 + 高德 key 域名白名单需部署后实测（见 docs/DECISIONS.md D1/D2）。
 * 因此本模块不触碰任何 marker；地图列保持诚实待补态。补坐标后在此扩展 map-adapter，不改筛选内核。
 */
type Level = "wubiChi" | "yingChiBang" | "keyiChi";
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "");
const toggle = (s: Set<string>, v: string) => (s.has(v) ? s.delete(v) : s.add(v));

function initCityApp(app: HTMLElement) {
  // 只选按钮控件：卡片 <article> 也带 data-level/data-cuisines，必须用 button[] 限定，
  // 否则 aria-pressed 会被泼到卡片上（卡片被读屏误当成切换按钮）。
  const input = app.querySelector<HTMLInputElement>("[data-q]");
  const catChips = [...app.querySelectorAll<HTMLButtonElement>("button[data-cat]")];
  const levelChips = [...app.querySelectorAll<HTMLButtonElement>("button[data-level]")];
  const viewBtns = [...app.querySelectorAll<HTMLButtonElement>("button[data-view]")];
  const clearBtns = [...app.querySelectorAll<HTMLElement>("[data-clear]")];
  const countEl = app.querySelector<HTMLElement>("[data-count]");
  const emptyEl = app.querySelector<HTMLElement>("[data-empty]");
  const cards = [...app.querySelectorAll<HTMLElement>(".rc")];

  const state = {
    cats: new Set<string>(),
    levels: new Set<string>(),
    q: "",
    view: "list" as "list" | "map",
  };

  // 已知合法值集合（防 URL 注入无效筛选造成「有筛选但零命中且清不掉」的错觉）
  const knownCats = new Set(catChips.map((b) => b.dataset.cat!));
  const knownLevels = new Set<Level>(levelChips.map((b) => b.dataset.level as Level));

  function readURL() {
    const p = new URLSearchParams(location.search);
    (p.get("category") || "").split(",").forEach((c) => c && knownCats.has(c) && state.cats.add(c));
    (p.get("list") || "").split(",").forEach((l) => l && knownLevels.has(l as Level) && state.levels.add(l));
    state.q = p.get("q") || "";
    const v = p.get("view");
    if (v === "map" || v === "list") state.view = v;
  }

  function writeURL() {
    const p = new URLSearchParams();
    if (state.cats.size) p.set("category", [...state.cats].join(","));
    if (state.levels.size) p.set("list", [...state.levels].join(","));
    if (state.q.trim()) p.set("q", state.q.trim());
    if (state.view !== "list") p.set("view", state.view);
    const qs = p.toString();
    history.replaceState(history.state, "", (qs ? `?${qs}` : location.pathname) + location.hash);
  }

  function apply() {
    const q = norm(state.q);
    let visible = 0;
    for (const card of cards) {
      const level = card.dataset.level || "";
      const cuisines = (card.dataset.cuisines || "").split("|").filter(Boolean);
      const hay = card.dataset.search || "";
      const okCat = state.cats.size === 0 || cuisines.some((c) => state.cats.has(c));
      const okLevel = state.levels.size === 0 || state.levels.has(level);
      const okQ = !q || hay.includes(q);
      const show = okCat && okLevel && okQ;
      card.hidden = !show;
      if (show) visible++;
    }
    catChips.forEach((b) => b.setAttribute("aria-pressed", String(state.cats.has(b.dataset.cat!))));
    levelChips.forEach((b) => b.setAttribute("aria-pressed", String(state.levels.has(b.dataset.level!))));
    viewBtns.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === state.view)));
    if (input && input.value !== state.q) input.value = state.q;
    app.dataset.view = state.view;

    const anyActive = state.cats.size > 0 || state.levels.size > 0 || state.q.trim().length > 0;
    // 顶部「清除筛选」按钮跟随；空态内的清除入口由空态自身可见性控制
    const topClear = app.querySelector<HTMLElement>(".controls [data-clear]");
    if (topClear) topClear.hidden = !anyActive;
    if (countEl) countEl.textContent = `${visible} 家`;
    if (emptyEl) emptyEl.hidden = visible !== 0;
    // 通知地图同步 marker 显隐（地图与卡片消费同一过滤结果）
    app.dispatchEvent(new CustomEvent("city:filtered"));
  }

  const commit = () => {
    apply();
    writeURL();
  };

  catChips.forEach((b) =>
    b.addEventListener("click", () => {
      toggle(state.cats, b.dataset.cat!);
      commit();
    }),
  );
  levelChips.forEach((b) =>
    b.addEventListener("click", () => {
      toggle(state.levels, b.dataset.level!);
      commit();
    }),
  );
  viewBtns.forEach((b) =>
    b.addEventListener("click", () => {
      state.view = (b.dataset.view as "list" | "map") ?? "list";
      commit();
    }),
  );
  clearBtns.forEach((b) =>
    b.addEventListener("click", () => {
      state.cats.clear();
      state.levels.clear();
      state.q = "";
      commit();
    }),
  );
  let t = 0;
  input?.addEventListener("input", () => {
    clearTimeout(t);
    t = window.setTimeout(() => {
      state.q = input.value;
      commit();
    }, 160);
  });

  // 返回详情前恢复滚动位置（筛选/视图靠 URL 参数恢复）
  const scrollKey = `dachitech:scroll:${location.pathname}`;
  const saveScroll = () => {
    try {
      sessionStorage.setItem(scrollKey, String(window.scrollY));
    } catch {}
  };
  window.addEventListener("pagehide", saveScroll);
  cards.forEach((c) => c.querySelectorAll("a").forEach((a) => a.addEventListener("click", saveScroll)));

  readURL();
  apply();

  // 恢复滚动：仅在存在保存值时（新访问无值不触发）
  try {
    const y = sessionStorage.getItem(scrollKey);
    if (y) requestAnimationFrame(() => window.scrollTo(0, parseInt(y, 10)));
  } catch {}
}

document.querySelectorAll<HTMLElement>(".city-app").forEach(initCityApp);
