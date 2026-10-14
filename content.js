/**
 * content.js —— 注入「获取图片」悬浮按钮，并在商品详情页提取商品图片。
 *
 * 运行环境：由 manifest.json 的 content_scripts.matches 决定，
 * 仅在淘宝/天猫、京东、拼多多(含商家版 yangkeduo)域名下注入；
 * 但按钮只会出现在「商品详情页」，其它页面不显示。
 */
(() => {
  'use strict';

  // 防止重复注入（SPA 或扩展重载场景）
  if (window.__IMG_GRAB_INIT__) return;
  window.__IMG_GRAB_INIT__ = true;

  // 最小有效尺寸：宽、高均需 >= 该值，否则视为图标/占位图被过滤
  const MIN_SIZE = 100;

  /* ------------------------- 详情页判断 ------------------------- */

  /**
   * 通过 URL 特征判断当前是否为商品详情页。
   * 覆盖三大平台的 PC 端与部分移动端（H5）地址。
   */
  function isProductDetailPage() {
    const url = location.href;
    const host = location.hostname;
    const path = location.pathname;

    // 淘宝 / 天猫
    if (/\.(taobao|tmall)\.com$/.test(host)) {
      return /\/item\.(htm|html)/i.test(url)
        || /item\.taobao\.com/.test(url)
        || /detail\.tmall\.com/.test(url)
        || /\/detail/i.test(path);
    }
    // 京东（含移动端 item.m.jd.com）
    if (/\.jd\.com$/.test(host)) {
      return /item(\.m)?\.jd\.com/.test(url)
        || /\/product\/\d+\.html/i.test(url)
        || /\/\d+\.html$/i.test(path);
    }
    // 拼多多 / 拼多多商家版（yangkeduo.com 为拼多多移动端域名）
    if (/\.(pinduoduo|yangkeduo)\.com$/.test(host)) {
      return /\/goods/i.test(path)
        || /goods_id|goodsId/i.test(url)
        || /\/detail/i.test(path);
    }
    return false;
  }

  /* ------------------------- 工具函数 ------------------------- */

  // 相对路径 / 协议相对路径（//xxx）转绝对 URL
  function toAbsolute(u) {
    if (!u) return '';
    try {
      return new URL(u, location.href).href;
    } catch (e) {
      return '';
    }
  }

  // 仅保留 http(s) 链接，排除 data: / blob: / about: 等
  function isHttpUrl(u) {
    return /^https?:\/\//i.test(u);
  }

  // 明显是占位图 / loading / 图标 / logo 的地址，直接排除
  function isBlockedUrl(u) {
    const lower = u.toLowerCase();
    // 占位 / 加载 / 1x1 像素等
    if (/(placeholder|loading\.(gif|png|jpg|jpeg)|blank\.(gif|png)|spacer|1x1|pixel)/.test(lower)) {
      return true;
    }
    // 目录或文件名以 logo / icon / avatar / iconfont / sprite 命名
    if (/\/(logo|icon|avatar|iconfont|sprite)s?([-_]?\d*)?\.(png|jpe?g|gif|webp|svg)(\?|$)/.test(lower)) {
      return true;
    }
    return false;
  }

  // 解析 srcset 字符串为候选数组
  function parseSrcset(srcset) {
    return srcset.split(',').map((s) => s.trim()).filter(Boolean).map((p) => {
      const m = p.match(/^(\S+)\s+(.+)$/);
      return m ? { url: m[1], desc: m[2] } : { url: p, desc: '' };
    });
  }

  // 从 srcset 候选里挑选分辨率（w 描述符）最大的一张
  function bestFromSrcset(srcset) {
    const cands = parseSrcset(srcset);
    let best = '';
    let bestW = -1;
    for (const c of cands) {
      const wm = c.desc.match(/(\d+)w/);
      const w = wm ? parseInt(wm[1], 10) : 0;
      if (w > bestW) { bestW = w; best = c.url; }
    }
    if (best) return best;
    return cands.length ? cands[0].url : '';
  }

  /**
   * 从 <img> 元素中挑选最合适的一张图片地址。
   * 兼容各平台懒加载属性差异：data-src / data-lazy-src / data-original /
   * data-lazyload / data-image / data-url / data-echo / data-srcset 等。
   */
  function pickBestSrc(img) {
    const lazyAttrs = [
      'data-src', 'data-lazy-src', 'data-lazyload', 'data-original',
      'data-lazy', 'data-image', 'data-url', 'data-echo', 'data-srcset'
    ];
    for (const a of lazyAttrs) {
      const v = img.getAttribute(a);
      if (!v) continue;
      if (a === 'data-srcset') {
        const best = bestFromSrcset(v);
        if (best) return best;
      } else if (/^https?:\/\/|\/\//.test(v)) {
        return v;
      }
    }
    // srcset（响应式图片，挑最大分辨率）
    if (img.srcset) {
      const best = bestFromSrcset(img.srcset);
      if (best) return best;
    }
    // currentSrc：浏览器实际选中的加载地址，优先于 src
    if (img.currentSrc) return img.currentSrc;
    if (img.src) return img.src;
    return '';
  }

  // 从元素计算样式中收集 background-image 的 url()（支持多个背景层）
  function collectBackgroundImages(set) {
    const SKIP_TAGS = new Set([
      'SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT', 'HEAD',
      'TITLE', 'IFRAME', 'OBJECT', 'EMBED', 'TEMPLATE', 'SVG', 'PATH', 'BR', 'HR'
    ]);
    const els = document.querySelectorAll('*');
    const MAX_SCAN = 30000; // 防止超大页面卡死
    let count = 0;
    for (const el of els) {
      if (count++ > MAX_SCAN) break;
      if (SKIP_TAGS.has(el.tagName)) continue;
      let bg = '';
      try {
        bg = getComputedStyle(el).backgroundImage;
      } catch (e) { continue; }
      if (!bg || bg === 'none') continue;
      const re = /url\(\s*(['"]?)(.*?)\1\s*\)/g;
      let m;
      while ((m = re.exec(bg))) {
        const raw = (m[2] || '').trim();
        if (!raw || raw === 'none') continue;
        const abs = toAbsolute(raw);
        if (abs) set.add(abs);
      }
    }
  }

  // 加载图片获取真实宽高（仅读取尺寸，不涉及像素读取，无需 CORS）
  function loadDims(url) {
    return new Promise((resolve) => {
      const img = new Image();
      let settled = false;
      const finish = (w, h) => {
        if (!settled) { settled = true; resolve({ w, h }); }
      };
      const timer = setTimeout(() => { img.src = ''; finish(0, 0); }, 6000);
      img.onload = () => { clearTimeout(timer); finish(img.naturalWidth, img.naturalHeight); };
      img.onerror = () => { clearTimeout(timer); finish(0, 0); };
      img.decoding = 'async';
      img.src = url;
    });
  }

  // 尺寸过滤：过滤加载失败 / 1x1 像素 / 小于最小尺寸的图
  function passFilter(w, h) {
    if (w === 0 || h === 0) return false;
    if (w === 1 && h === 1) return false;
    if (w < MIN_SIZE || h < MIN_SIZE) return false;
    return true;
  }

  /* ------------------------- 图片提取 ------------------------- */

  async function extractImages() {
    const urlSet = new Set();
    const knownDims = new Map(); // url -> {w,h}，已知尺寸的优先使用，避免重复请求

    // 1) 遍历 <img> 标签
    document.querySelectorAll('img').forEach((img) => {
      const src = pickBestSrc(img);
      if (!src) return;
      const abs = toAbsolute(src);
      if (!abs || !isHttpUrl(abs) || isBlockedUrl(abs)) return;
      urlSet.add(abs);
      // 只有当元素“实际加载”的地址与挑选出的地址一致时，才信任 naturalWidth/Height。
      // 否则（例如 src 是 1x1 占位图、data-src 才是大图）会误把占位图尺寸记到大图上。
      const currentAbs = toAbsolute(img.currentSrc || img.src);
      if (img.naturalWidth > 0 && img.naturalHeight > 0 && currentAbs === abs) {
        knownDims.set(abs, { w: img.naturalWidth, h: img.naturalHeight });
      }
    });

    // 2) 背景图（含懒加载后写入的 style）
    collectBackgroundImages(urlSet);

    const urls = Array.from(urlSet);
    const results = [];

    // 3a) 已知尺寸的先过滤
    for (const u of urls) {
      const d = knownDims.get(u);
      if (d && passFilter(d.w, d.h)) {
        results.push({ url: u, width: d.w, height: d.h });
      }
    }

    // 3b) 未知尺寸的并发加载并过滤
    const toLoad = urls.filter((u) => !knownDims.has(u));
    const CONCURRENCY = 6;
    let idx = 0;
    const workers = Array.from(
      { length: Math.min(CONCURRENCY, toLoad.length) },
      async () => {
        while (idx < toLoad.length) {
          const u = toLoad[idx++];
          const { w, h } = await loadDims(u);
          if (passFilter(w, h)) results.push({ url: u, width: w, height: h });
        }
      }
    );
    await Promise.all(workers);

    return results;
  }

  /* ------------------------- UI：按钮与提示 ------------------------- */

  function injectButton() {
    if (document.getElementById('ig-grab-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'ig-grab-btn';
    btn.type = 'button';
    btn.textContent = '获取图片';
    btn.addEventListener('click', onGrab);
    document.body.appendChild(btn);
  }

  function showToast(text) {
    let t = document.getElementById('ig-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'ig-toast';
      document.body.appendChild(t);
    }
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  async function onGrab() {
    const btn = document.getElementById('ig-grab-btn');
    btn.disabled = true;
    btn.textContent = '提取中…';

    let images = [];
    try {
      images = await extractImages();
    } catch (e) {
      images = [];
    }

    btn.disabled = false;
    btn.textContent = '获取图片';

    if (!images.length) {
      showToast('未找到符合条件的商品图片');
      return;
    }
    showToast('已提取 ' + images.length + ' 张图片，正在打开…');
    // 把图片列表交给 service worker，由其存入 storage 并打开 gallery 页
    chrome.runtime.sendMessage({ type: 'SAVE_AND_OPEN', images }, () => {
      void chrome.runtime.lastError;
    });
  }

  /* ------------------------- 初始化与 SPA 兼容 ------------------------- */

  function refresh() {
    if (isProductDetailPage()) {
      injectButton();
    } else {
      const btn = document.getElementById('ig-grab-btn');
      if (btn) btn.remove();
    }
  }

  function boot() {
    // 监听 SPA 路由变化，重新判断是否显示按钮
    const origPush = history.pushState;
    const origReplace = history.replaceState;
    history.pushState = function (...args) {
      origPush.apply(this, args);
      window.dispatchEvent(new Event('ig-route'));
    };
    history.replaceState = function (...args) {
      origReplace.apply(this, args);
      window.dispatchEvent(new Event('ig-route'));
    };
    window.addEventListener('popstate', () => window.dispatchEvent(new Event('ig-route')));
    window.addEventListener('ig-route', refresh);
    refresh();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
