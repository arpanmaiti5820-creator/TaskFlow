/* =========================================================
   TaskFlow – shared helpers (API, auth store, icons, toasts,
   page transitions, scroll reveal, navbar)
   ========================================================= */
const API = "/api";

const Auth = {
  get token() {
    return localStorage.getItem("tf_token");
  },
  get user() {
    try {
      return JSON.parse(localStorage.getItem("tf_user"));
    } catch {
      return null;
    }
  },
  save(token, user) {
    localStorage.setItem("tf_token", token);
    localStorage.setItem("tf_user", JSON.stringify(user));
  },
  setUser(user) {
    localStorage.setItem("tf_user", JSON.stringify(user));
  },
  clear() {
    localStorage.removeItem("tf_token");
    localStorage.removeItem("tf_user");
  },
};

async function api(path, { method = "GET", body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (Auth.token) headers.Authorization = "Bearer " + Auth.token;
  let res;
  try {
    res = await fetch(API + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("Cannot reach the server. Is it running?");
  }
  const data = await res.json().catch(() => ({}));
  if (
    res.status === 401 &&
    Auth.token &&
    !path.startsWith("/auth/login") &&
    !path.startsWith("/auth/google")
  ) {
    Auth.clear();
    location.href = "/login.html";
    throw new Error(data.message || "Session expired");
  }
  if (!res.ok) throw new Error(data.message || "Something went wrong");
  return data;
}

/* ---------- Icons (feather-style) ---------- */
const ICONS = {
  home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  list: '<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  board:
    '<rect x="3" y="3" width="5" height="18" rx="1.5"/><rect x="10" y="3" width="5" height="12" rx="1.5"/><rect x="17" y="3" width="4" height="8" rx="1.5"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  logout:
    '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  search:
    '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  menu: '<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>',
  trash:
    '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
  clock:
    '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  alert:
    '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
  zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  layers:
    '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  phone:
    '<rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>',
  trend:
    '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  mail: '<path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/><polyline points="22 6 12 13 2 6"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  calendar:
    '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  pause:
    '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  undo: '<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>',
  arrow:
    '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
};
const icon = (n, cls = "") =>
  `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n] || ""}</svg>`;
function renderIcons(root = document) {
  root.querySelectorAll("i[data-icon]").forEach((el) => {
    el.outerHTML = icon(el.dataset.icon, el.className);
  });
}

/* ---------- Helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s = "") =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const initials = (n = "?") =>
  n
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");

function toast(message, type = "info", action = null) {
  let box = $("#toasts");
  if (!box) {
    box = document.createElement("div");
    box.id = "toasts";
    document.body.appendChild(box);
  }
  const t = document.createElement("div");
  t.className = "toast " + type;
  t.innerHTML =
    icon(type === "error" ? "alert" : "check") + `<span>${esc(message)}</span>`;
  const close = () => {
    t.classList.remove("show");
    setTimeout(() => t.remove(), 400);
  };
  if (action) {
    const b = document.createElement("button");
    b.className = "t-act";
    b.textContent = action.label;
    b.addEventListener("click", () => {
      close();
      action.fn();
    });
    t.appendChild(b);
  }
  box.appendChild(t);
  requestAnimationFrame(() => t.classList.add("show"));
  setTimeout(close, action ? 6000 : 3200);
}

function countUp(el, to, duration = 900) {
  const start = performance.now();
  const from = 0;
  const step = (now) => {
    const p = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(from + (to - from) * eased);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* ---------- Page transitions ---------- */
function initTransitions() {
  document.body.classList.add("page-in");
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[href]");
    if (!a || a.target === "_blank" || e.ctrlKey || e.metaKey || e.shiftKey)
      return;
    const href = a.getAttribute("href");
    if (
      !href ||
      href.startsWith("#") ||
      href.startsWith("http") ||
      href.startsWith("mailto:")
    )
      return;
    e.preventDefault();
    document.body.classList.add("page-out");
    setTimeout(() => (location.href = href), 320);
  });
  window.addEventListener("pageshow", (e) => {
    if (e.persisted) document.body.classList.remove("page-out");
  });
}

/* ---------- Scroll reveal ---------- */
function initReveal() {
  const els = $$(".reveal");
  if (!("IntersectionObserver" in window))
    return els.forEach((e) => e.classList.add("in"));
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) {
          en.target.classList.add("in");
          io.unobserve(en.target);
        }
      });
    },
    { threshold: 0.15 },
  );
  els.forEach((el) => io.observe(el));
}

/* ---------- Navbar ---------- */
function initNavbar() {
  const nav = $(".navbar");
  if (!nav) return;
  const burger = $(".burger", nav),
    menu = $(".nav-menu", nav);
  const onScroll = () => nav.classList.toggle("scrolled", window.scrollY > 20);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });
  burger?.addEventListener("click", () => {
    const open = burger.classList.toggle("open");
    menu.classList.toggle("open", open);
    document.body.classList.toggle("no-scroll", open);
  });
  $$(".nav-menu a", nav).forEach((a) =>
    a.addEventListener("click", () => {
      burger.classList.remove("open");
      menu.classList.remove("open");
      document.body.classList.remove("no-scroll");
    }),
  );
  // Auth-aware buttons
  if (Auth.token) {
    $$("[data-guest]").forEach((e) => (e.style.display = "none"));
    $$("[data-authed]").forEach((e) => (e.style.display = ""));
  } else {
    $$("[data-authed]").forEach((e) => (e.style.display = "none"));
  }
  // Active link highlight on scroll (landing)
  const links = $$('.nav-menu a[href^="#"]', nav);
  if (links.length && "IntersectionObserver" in window) {
    const map = new Map(links.map((l) => [l.getAttribute("href").slice(1), l]));
    const io = new IntersectionObserver(
      (ens) =>
        ens.forEach((en) => {
          if (en.isIntersecting) {
            links.forEach((l) => l.classList.remove("active"));
            map.get(en.target.id)?.classList.add("active");
          }
        }),
      { rootMargin: "-45% 0px -50% 0px" },
    );
    map.forEach((_, id) => {
      const s = document.getElementById(id);
      if (s) io.observe(s);
    });
  }
}

/* Button ripple position for hover glow */
document.addEventListener("pointermove", (e) => {
  const b = e.target.closest?.(".btn");
  if (!b) return;
  const r = b.getBoundingClientRect();
  b.style.setProperty("--mx", e.clientX - r.left + "px");
  b.style.setProperty("--my", e.clientY - r.top + "px");
});

document.addEventListener("DOMContentLoaded", () => {
  renderIcons();
  initTransitions();
  initNavbar();
  initReveal();
});
