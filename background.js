/**
 * background.js —— MV3 Service Worker（简化版）
 *
 * 职责：
 *   接收 content script 发来的图片列表，存入 storage 并打开 gallery 页。
 *
 * 下载与 PNG 转换逻辑已移至 gallery.js（扩展页面）完成，
 * 避免 Service Worker 休眠导致长连接 port 断开的问题。
 */

'use strict';

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'SAVE_AND_OPEN') {
    // 异步处理完成后通过 sendResponse 回应，返回 true 保持消息通道开启
    saveAndOpen(msg.images).then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});

async function saveAndOpen(images) {
  await chrome.storage.local.set({ images: images || [], savedAt: Date.now() });
  await chrome.tabs.create({ url: chrome.runtime.getURL('gallery.html') });
}
