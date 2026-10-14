/**
 * gallery.js —— 展示提取到的商品图片，支持勾选与批量下载。
 *
 * 下载与 PNG 转换逻辑直接在本扩展页面完成：
 * 扩展页面同样拥有 manifest 的 host_permissions，fetch 可跨域读取图片，
 * 且页面常驻不会休眠，彻底规避 Service Worker 休眠导致 port 断开的问题。
 */
(() => {
  'use strict';

  const FILENAME_PREFIX = '商品图_';

  const grid = document.getElementById('grid');
  const countEl = document.getElementById('count');
  const selectAllBtn = document.getElementById('select-all');
  const invertBtn = document.getElementById('invert');
  const downloadBtn = document.getElementById('download');
  const progressWrap = document.getElementById('progress-wrap');
  const progressText = document.getElementById('progress-text');
  const progressFill = document.getElementById('progress-fill');
  const resultEl = document.getElementById('result');

  let images = [];             // [{url,width,height}]
  const selected = new Set();  // 已选图片的下标
  let downloading = false;

  // 从 storage 读取 content script 提取到的图片列表
  chrome.storage.local.get(['images'], (data) => {
    images = data.images || [];
    render();
  });

  function render() {
    grid.innerHTML = '';
    if (!images.length) {
      grid.innerHTML = '<div class="empty">没有可显示的图片</div>';
      updateCount();
      return;
    }
    images.forEach((img, i) => grid.appendChild(createCard(img, i)));
    updateCount();
  }

  function createCard(img, i) {
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.index = String(i);

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'check';
    checkbox.checked = false;

    const figure = document.createElement('img');
    figure.src = img.url;
    figure.alt = '';
    figure.loading = 'lazy';
    // 不携带 Referer，避免部分 CDN 因 Referer 校验而拒绝展示
    figure.referrerPolicy = 'no-referrer';
    figure.addEventListener('error', () => { figure.src = brokenPlaceholder(); });

    const meta = document.createElement('div');
    meta.className = 'meta';
    const dims = document.createElement('span');
    dims.className = 'dims';
    dims.textContent = (img.width || '?') + ' × ' + (img.height || '?');
    const seq = document.createElement('span');
    seq.className = 'seq';
    seq.textContent = String(i + 1).padStart(3, '0');
    meta.appendChild(dims);
    meta.appendChild(seq);

    card.appendChild(figure);
    card.appendChild(meta);
    card.appendChild(checkbox);

    // 点击卡片切换选中；点击复选框本身时单独处理，避免重复切换
    card.addEventListener('click', (e) => {
      if (e.target === checkbox) return;
      setSelected(i, !selected.has(i));
    });
    checkbox.addEventListener('click', (e) => {
      e.stopPropagation();
      setSelected(i, checkbox.checked);
    });

    return card;
  }

  function setSelected(i, on) {
    const card = grid.querySelector('.card[data-index="' + i + '"]');
    if (on) {
      selected.add(i);
      if (card) { card.classList.add('selected'); card.querySelector('.check').checked = true; }
    } else {
      selected.delete(i);
      if (card) { card.classList.remove('selected'); card.querySelector('.check').checked = false; }
    }
    updateCount();
  }

  function updateCount() {
    countEl.textContent = '已选 ' + selected.size + ' / ' + images.length + ' 张';
    downloadBtn.disabled = downloading || selected.size === 0;
    selectAllBtn.disabled = downloading || images.length === 0;
    invertBtn.disabled = downloading || images.length === 0;
  }

  /* ---------- 全选 / 反选 ---------- */
  selectAllBtn.addEventListener('click', () => {
    images.forEach((_, i) => setSelected(i, true));
  });
  invertBtn.addEventListener('click', () => {
    images.forEach((_, i) => setSelected(i, !selected.has(i)));
  });

  /* ---------- 下载（在页面内直接完成） ---------- */
  downloadBtn.addEventListener('click', () => {
    if (downloading) return;
    if (selected.size === 0) { alert('请先勾选要下载的图片'); return; }

    // 按原始顺序整理待下载列表
    const list = [];
    images.forEach((img, i) => { if (selected.has(i)) list.push(img); });

    downloading = true;
    updateCount();
    resultEl.classList.add('hidden');
    progressWrap.classList.remove('hidden');
    progressFill.style.width = '0%';
    progressText.textContent = '准备下载 ' + list.length + ' 张…';

    runDownload(list);
  });

  // 逐张下载，并实时更新进度条与文案
  async function runDownload(list) {
    const total = list.length;
    let success = 0;
    let fail = 0;

    for (let i = 0; i < total; i++) {
      progressText.textContent = '正在处理 ' + (i + 1) + '/' + total;
      const r = await downloadOne(list[i], i + 1);
      if (r.ok) success++; else fail++;
      progressFill.style.width = Math.round(((i + 1) / total) * 100) + '%';
    }

    downloading = false;
    updateCount();
    progressWrap.classList.add('hidden');
    resultEl.classList.remove('hidden');
    resultEl.textContent = '下载完成：成功 ' + success + ' 张，失败 ' + fail + ' 张。';
    resultEl.classList.toggle('has-error', fail > 0);
  }

  /**
   * 下载单张图片。
   * 优先 fetch 后用 OffscreenCanvas 统一转 PNG；
   * 转换失败（跨域被拒 / 格式不支持）则回退为按原格式下载。
   */
  async function downloadOne(img, seq) {
    const seqStr = String(seq).padStart(3, '0'); // 001, 002, ...

    try {
      const blob = await fetchAndConvertToPng(img.url);
      const blobUrl = URL.createObjectURL(blob);
      await chrome.downloads.download({ url: blobUrl, filename: FILENAME_PREFIX + seqStr + '.png', saveAs: false });
      // 延迟释放 blob URL，确保下载任务已建立
      setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
      return { ok: true };
    } catch (e) {
      const ext = guessExt(img.url);
      try {
        await chrome.downloads.download({ url: img.url, filename: FILENAME_PREFIX + seqStr + ext, saveAs: false });
        return { ok: true };
      } catch (e2) {
        return { ok: false };
      }
    }
  }

  // 跨域读取图片并统一转为 PNG（依赖 host_permissions 覆盖图片 CDN）
  async function fetchAndConvertToPng(url) {
    const resp = await fetch(url, { credentials: 'include' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const buf = await resp.arrayBuffer();
    const bitmap = await createImageBitmap(new Blob([buf]));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    return await canvas.convertToBlob({ type: 'image/png' });
  }

  // 从 URL 猜测原始扩展名，用于转换失败时的回退下载命名
  function guessExt(url) {
    const m = url.match(/\.(png|jpe?g|webp|gif|bmp|svg|avif)(\?|#|$)/i);
    return m ? '.' + m[1].toLowerCase().replace('jpeg', 'jpg') : '.png';
  }

  // 图片加载失败时的占位 SVG
  function brokenPlaceholder() {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="160">' +
      '<rect width="100%" height="100%" fill="#eee"/>' +
      '<text x="50%" y="50%" fill="#aaa" font-size="14" text-anchor="middle" dominant-baseline="middle">图片加载失败</text>' +
      '</svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }
})();
