/* ==========================================================================
   图提取 ImageGrab · 官网交互脚本
   功能：移动端菜单 / 导航吸顶阴影 / 滚动高亮 / 滚动进入动画 / 年份
   ========================================================================== */

// 等待 DOM 就绪后执行
document.addEventListener('DOMContentLoaded', function () {
  'use strict';

  /* ---------- 1. 移动端汉堡菜单 ---------- */
  var navToggle = document.getElementById('navToggle');
  var navMenu = document.getElementById('navMenu');

  if (navToggle && navMenu) {
    navToggle.addEventListener('click', function () {
      var isOpen = navMenu.classList.toggle('is-open');
      navToggle.classList.toggle('is-open', isOpen);
      navToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      navToggle.setAttribute('aria-label', isOpen ? '关闭菜单' : '打开菜单');
    });

    // 点击任意导航链接后自动收起菜单（提升移动端体验）
    navMenu.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') {
        navMenu.classList.remove('is-open');
        navToggle.classList.remove('is-open');
        navToggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  /* ---------- 2. 导航吸顶阴影（滚动时添加 .is-scrolled） ---------- */
  var navbar = document.getElementById('navbar');

  function onScroll() {
    if (!navbar) return;
    if (window.scrollY > 8) {
      navbar.classList.add('is-scrolled');
    } else {
      navbar.classList.remove('is-scrolled');
    }
  }

  // 初始调用 + 监听滚动（使用 rAF 节流，避免高频触发）
  onScroll();
  var ticking = false;
  window.addEventListener('scroll', function () {
    if (!ticking) {
      window.requestAnimationFrame(function () {
        onScroll();
        ticking = false;
      });
      ticking = true;
    }
  }, { passive: true });

  /* ---------- 3. 导航当前区块高亮（Scroll Spy） ---------- */
  var sections = document.querySelectorAll('main section[id]');
  var navLinks = document.querySelectorAll('.navbar__link');

  function highlightNav() {
    // 以「导航栏高度 + 偏移量」为判断基准线
    var offset = (navbar ? navbar.offsetHeight : 64) + 60;
    var currentId = '';

    sections.forEach(function (section) {
      var top = section.getBoundingClientRect().top;
      // 区块顶部越过基准线，即视为进入该区块
      if (top <= offset) {
        currentId = section.getAttribute('id');
      }
    });

    navLinks.forEach(function (link) {
      var href = link.getAttribute('href');
      var isActive = href === '#' + currentId;
      link.classList.toggle('is-active', isActive);
    });
  }

  // 高亮监听复用上面的节流滚动
  var tickingNav = false;
  window.addEventListener('scroll', function () {
    if (!tickingNav) {
      window.requestAnimationFrame(function () {
        highlightNav();
        tickingNav = false;
      });
      tickingNav = true;
    }
  }, { passive: true });

  // 页面加载与窗口缩放时也计算一次，保证首屏正确
  highlightNav();
  window.addEventListener('resize', highlightNav);

  /* ---------- 4. 滚动进入视口动画（IntersectionObserver） ---------- */
  var revealEls = document.querySelectorAll('.reveal');

  // 仅在支持 IntersectionObserver 的浏览器中启用；否则直接显示
  if ('IntersectionObserver' in window) {
    var observer = new IntersectionObserver(function (entries, obs) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          // 进入一次后即停止观察，避免重复触发
          obs.unobserve(entry.target);
        }
      });
    }, {
      // 元素进入视口 12% 时触发，观感更自然
      threshold: 0.12,
      // 提前 40px 触发，让上移动画先开始
      rootMargin: '0px 0px -40px 0px'
    });

    revealEls.forEach(function (el) { observer.observe(el); });
  } else {
    // 降级：老浏览器直接全部显示
    revealEls.forEach(function (el) { el.classList.add('is-visible'); });
  }

  /* ---------- 5. 页脚年份自动更新 ---------- */
  var yearEl = document.getElementById('year');
  if (yearEl) {
    yearEl.textContent = new Date().getFullYear();
  }
});
