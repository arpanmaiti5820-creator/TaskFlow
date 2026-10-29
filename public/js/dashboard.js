/* =========================================================
   TaskFlow dashboard
   Features: tasks, board, calendar, subtasks, recurring tasks,
   timer + focus mode, insights/goals/streaks, notes + activity,
   reminders, trash, export/import
   ========================================================= */
(async function () {
  if (!Auth.token) {
    location.replace("/login.html");
    return;
  }

  // extra icons (must be added before common.js renders icons)
  Object.assign(ICONS, {
    bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
    chart:
      '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
    target:
      '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    download:
      '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    upload:
      '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
    repeat:
      '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
  });

  /* ---------- local settings / storage ---------- */
  const lsGet = (k, d) => {
    try {
      const v = JSON.parse(localStorage.getItem(k));
      return v === null || v === undefined ? d : v;
    } catch {
      return d;
    }
  };
  const lsSet = (k, v) => {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch { }
  };
  const ST = Object.assign(
    {
      focusMin: 25,
      breakMin: 5,
      longMin: 15,
      defaultRemind: 60,
      overdueAlerts: true,
    },
    lsGet("tf_settings", {}),
  );
  const saveST = () => lsSet("tf_settings", ST);

  const BASE_TITLE = document.title;
  const now0 = new Date();
  const S = {
    tasks: [],
    trash: [],
    stats: null,
    week: [],
    ins: null,
    view: "overview",
    status: "",
    prio: "",
    q: "",
    editing: null,
    confirm: null,
    offset: 0,
    open: new Set(),
    drawerId: null,
    acts: {},
    cal: {
      y: now0.getFullYear(),
      m: now0.getMonth(),
      mode: "month",
      anchor: new Date(now0),
      sel: "",
    },
  };
  const STATUS_LABEL = { todo: "To do", progress: "In progress", done: "Done" };
  const TITLES = {
    overview: "Overview",
    tasks: "My tasks",
    board: "Board",
    calendar: "Calendar",
    insights: "Insights",
    trash: "Trash",
    profile: "Profile & settings",
  };
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const REPEAT_LABEL = {
    daily: "Daily",
    weekdays: "Weekdays",
    weekly: "Weekly",
    monthly: "Monthly",
  };

  /* ---------- User ---------- */
  let user = Auth.user;
  try {
    user = (await api("/auth/me")).user;
    Auth.setUser(user);
  } catch {
    return;
  }
  function paintUser() {
    ["sideAvatar", "profAvatar"].forEach((id) => {
      const a = $("#" + id);
      a.textContent = initials(user.name);
      a.style.backgroundImage = "";
      if (user.avatar) {
        const img = new Image();
        img.referrerPolicy = "no-referrer";
        img.onload = () => {
          a.style.backgroundImage = `url("${user.avatar}")`;
          a.textContent = "";
        };
        img.src = user.avatar;
      }
    });
    $("#sideName").textContent = user.name;
    $("#sideEmail").textContent = user.email;
    $("#pName").value = user.name;
    $("#pEmail").value = user.email;
    $("#pSince").value = new Date(user.createdAt).toLocaleDateString(
      undefined,
      { year: "numeric", month: "long", day: "numeric" },
    );
    const h = new Date().getHours();
    $("#greeting").textContent =
      `${h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"}, ${user.name.split(" ")[0]} 👋`;
  }
  paintUser();

  /* ---------- Helpers ---------- */
  const pad = (n) => String(n).padStart(2, "0");
  const dkeyOf = (d) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; // local date key
  const todayKey = () => dkeyOf(new Date());
  const dueKey = (t) =>
    t.dueDate ? new Date(t.dueDate).toISOString().slice(0, 10) : ""; // date the user picked
  const fmtKey = (k, o = { month: "short", day: "numeric" }) =>
    new Date(k + "T00:00:00Z").toLocaleDateString(undefined, {
      timeZone: "UTC",
      ...o,
    });
  const isLate = (t) =>
    t.status !== "done" && t.dueDate && dueKey(t) < todayKey();
  const find = (list, id) => list.find((x) => x._id === id);
  const subProg = (t) => {
    const s = t.subtasks || [];
    return { done: s.filter((x) => x.done).length, total: s.length };
  };
  const plainSubs = (t) =>
    (t.subtasks || []).map((s) => ({ title: s.title, done: !!s.done }));
  const visible = () =>
    S.tasks.filter(
      (t) =>
        (!S.status || t.status === S.status) &&
        (!S.prio || t.priority === S.prio) &&
        (!S.q || t.title.toLowerCase().includes(S.q.toLowerCase())),
    );

  const syncClock = (serverTime) => {
    if (serverTime) S.offset = new Date(serverTime).getTime() - Date.now();
  };
  const elapsed = (t) =>
    (t.timeSpent || 0) +
    (t.timerStartedAt
      ? Math.max(
        0,
        Math.floor(
          (Date.now() + S.offset - new Date(t.timerStartedAt).getTime()) /
          1000,
        ),
      )
      : 0);
  const fmtClock = (s) =>
    `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
  const fmtShort = (s) => {
    const h = Math.floor(s / 3600),
      m = Math.floor((s % 3600) / 60);
    return h ? `${h}h ${m}m` : m ? `${m}m` : `${s}s`;
  };
  const ago = (d) => {
    const m = Math.floor((Date.now() - new Date(d)) / 60000);
    return m < 1
      ? "just now"
      : m < 60
        ? `${m}m ago`
        : m < 1440
          ? `${Math.floor(m / 60)}h ago`
          : `${Math.floor(m / 1440)}d ago`;
  };
  const repeatText = (t) =>
    t.repeat === "custom"
      ? (t.repeatDays || [])
        .slice()
        .sort()
        .map((d) => DOW[d])
        .join(", ")
      : REPEAT_LABEL[t.repeat] || "";
  function adopt(task) {
    // replace a task in state with a fresh copy from the server
    if (task.activity) S.acts[task._id] = task.activity;
    S.tasks = S.tasks.map((x) => (x._id === task._id ? task : x));
  }

  /* ---------- Navigation ---------- */
  const views = $(".views");
  let naTimer;
  function moveGlow() {
    const btn = $(".nav-btn.active");
    if (!btn) return;
    $("#navGlow").style.transform = `translateY(${btn.offsetTop}px)`;
    $("#navGlow").style.height = btn.offsetHeight + "px";
  }
  function go(view) {
    S.view = view;
    views.classList.remove("no-anim");
    $$(".nav-btn").forEach((b) =>
      b.classList.toggle("active", b.dataset.view === view),
    );
    $$(".view").forEach((v) =>
      v.classList.toggle("active", v.id === "view-" + view),
    );
    $("#pageTitle").textContent = TITLES[view];
    moveGlow();
    closeSidebar();
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (view === "insights") loadInsights();
    if (view === "profile") paintSettings();
  }
  $$(".nav-btn").forEach((b) =>
    b.addEventListener("click", () => go(b.dataset.view)),
  );
  document.addEventListener("click", (e) => {
    const g = e.target.closest("[data-goto]");
    if (g) go(g.dataset.goto);
  });
  window.addEventListener("resize", moveGlow);

  const sidebar = $("#sidebar"),
    overlay = $("#overlay");
  const openSidebar = () => {
    sidebar.classList.add("open");
    overlay.classList.add("show");
  };
  function closeSidebar() {
    sidebar.classList.remove("open");
    overlay.classList.remove("show");
  }
  $("#menuBtn").addEventListener("click", openSidebar);
  overlay.addEventListener("click", closeSidebar);

  $("#logoutBtn").addEventListener("click", () => {
    const modal = $("#logoutModal");
    if (modal) {
      modal.classList.add("show");
    }
  });

  $("#cancelLogout").addEventListener("click", () => {
    $("#logoutModal").classList.remove("show");
  });

  $("#confirmLogout").addEventListener("click", () => {
    Auth.clear();
    toast("Logged out. See you soon!");
    document.body.classList.add("page-out");
    setTimeout(() => (location.href = "/"), 400);
  });

  $("#logoutModal").addEventListener("click", (event) => {
    if (event.target.id === "logoutModal") {
      event.target.classList.remove("show");
    }
  });


  /* ---------- Data ---------- */
  async function load() {
    try {
      const [t, s, tr] = await Promise.all([
        api("/tasks"),
        api("/tasks/stats"),
        api("/tasks/trash"),
      ]);
      S.tasks = t.tasks;
      syncClock(t.serverTime);
      S.stats = s.stats;
      S.week = s.week;
      S.trash = tr.tasks;
    } catch (e) {
      toast(e.message, "error");
    }
    render();
  }
  async function refreshStats() {
    try {
      const s = await api("/tasks/stats");
      S.stats = s.stats;
      S.week = s.week;
    } catch { }
  }
  async function refreshActs(id) {
    try {
      const r = await api("/tasks/" + id);
      S.acts[id] = r.task.activity;
      if (S.drawerId === id) renderDrawer();
    } catch { }
  }
  async function loadInsights() {
    try {
      S.ins = await api("/insights");
    } catch (e) {
      return;
    }
    const sc = $("#streakChip"),
      cur = S.ins.streak.current;
    sc.textContent = `🔥 ${cur}`;
    sc.title = `${cur}-day streak · longest ${S.ins.streak.longest}`;
    sc.classList.toggle("show", cur > 0);
    if (S.view === "insights") renderInsights();
  }

  /* ---------- Row builders ---------- */
  function tags(t) {
    const sp = subProg(t);
    return (
      `<span class="tag prio">${t.priority}</span>` +
      (t.status === "progress"
        ? `<span class="tag st-progress">In progress</span>`
        : "") +
      (t.status === "done" ? `<span class="tag st-done">Done</span>` : "") +
      (t.dueDate
        ? `<span class="tag ${isLate(t) ? "late" : ""}">${icon("calendar")} ${fmtKey(dueKey(t))}${t.dueTime ? " · " + t.dueTime : ""}${isLate(t) ? " · overdue" : ""}</span>`
        : "") +
      (sp.total
        ? `<button class="tag btn-tag" data-expand="${t._id}" title="Show checklist">${icon("list")} ${sp.done}/${sp.total}</button>`
        : "") +
      (t.repeat && t.repeat !== "none"
        ? `<span class="tag rep">${icon("repeat")} ${repeatText(t)}</span>`
        : "") +
      (t.pomodoros ? `<span class="tag pomo">🍅 ${t.pomodoros}</span>` : "")
    );
  }
  function timeTag(t) {
    if (!t.timeSpent && !t.timerStartedAt) return "";
    return `<span class="tag timer ${t.timerStartedAt ? "on" : ""}" data-timer="${t._id}">${icon("clock")}<span class="tt">${fmtClock(elapsed(t))}</span>${t.estimateMinutes ? `<span class="est"> / ${t.estimateMinutes}m</span>` : ""}</span>`;
  }
  function timerBtn(t) {
    if (t.status === "done") return "";
    const run = !!t.timerStartedAt;
    return `<button class="btn timer-btn ${run ? "running" : ""}" data-timer-toggle="${t._id}" aria-label="${run ? "Pause timer" : "Start task"}">${icon(run ? "pause" : "play")}<span class="lbl">${run ? "Pause" : "Start"}</span></button>`;
  }
  const actions = (t) =>
    `<div class="row-acts">${timerBtn(t)}<div class="acts"><button class="act" data-edit="${t._id}" aria-label="Edit">${icon("edit")}</button><button class="act del" data-del="${t._id}" aria-label="Move to trash">${icon("trash")}</button></div></div>`;

  function subRows(t, removable) {
    return (t.subtasks || [])
      .map(
        (s, i) =>
          `<label class="sub ${s.done ? "done" : ""}"><input type="checkbox" data-sub="${t._id}:${i}" ${s.done ? "checked" : ""}><span>${esc(s.title)}</span>${removable ? `<button type="button" class="x" data-subdel="${t._id}:${i}" aria-label="Remove step">${icon("x")}</button>` : ""}</label>`,
      )
      .join("");
  }
  function taskRow(t, i) {
    return `<div class="task p-${t.priority} ${t.status === "done" ? "done" : ""} ${t.timerStartedAt ? "running" : ""}" style="--i:${Math.min(i, 12)}">
      <button class="check" data-toggle="${t._id}" aria-label="Toggle done">${icon("check")}</button>
      <div class="task-body"><div class="task-title" data-open="${t._id}">${esc(t.title)}</div>${t.description ? `<div class="task-desc">${esc(t.description)}</div>` : ""}<div class="meta">${tags(t)}${timeTag(t)}</div>
        ${S.open.has(t._id) && (t.subtasks || []).length ? `<div class="checklist">${subRows(t, false)}</div>` : ""}</div>
      ${actions(t)}</div>`;
  }
  const emptyBox = (msg = "No tasks here yet") =>
    `<div class="empty">${icon("list")}<h4>${msg}</h4><p>Create a task to start building momentum.</p><button class="btn btn-primary btn-sm" data-new>${icon("plus")} New task</button></div>`;

  /* ---------- Overview / Tasks / Board ---------- */
  function renderOverview() {
    const animate = !views.classList.contains("no-anim");
    const s = S.stats || { total: 0, progress: 0, done: 0, completion: 0 };
    const overdue = S.tasks.filter(isLate).length; // computed in the browser so it matches your local date
    const cards = [
      ["Total tasks", s.total, "layers", "var(--primary)"],
      ["In progress", s.progress, "zap", "var(--primary2)"],
      ["Completed", s.done, "check", "var(--green)"],
      ["Overdue", overdue, "alert", "var(--red)"],
    ];
    $("#statGrid").innerHTML = cards
      .map(
        (c, i) =>
          `<div class="stat" style="--i:${i};--c:${c[3]}"><div class="s-ic">${icon(c[2])}</div><b data-n="${c[1]}">${animate ? 0 : c[1]}</b><span>${c[0]}</span></div>`,
      )
      .join("");
    if (animate) $$("#statGrid b").forEach((b) => countUp(b, +b.dataset.n));

    const max = Math.max(1, ...S.week.flatMap((d) => [d.created, d.completed]));
    $("#chart").innerHTML = S.week
      .map(
        (d, i) => `<div class="col"><div class="bars">
      <div class="bar c" data-v="${d.created}" style="height:${(d.created / max) * 100}%;--i:${i}"></div>
      <div class="bar d" data-v="${d.completed}" style="height:${(d.completed / max) * 100}%;--i:${i}"></div></div><small>${d.label}</small></div>`,
      )
      .join("");

    const ring = $("#ringFg"),
      off = 326.7 * (1 - s.completion / 100);
    if (animate) {
      ring.style.strokeDashoffset = 326.7;
      requestAnimationFrame(() =>
        requestAnimationFrame(() => (ring.style.strokeDashoffset = off)),
      );
      countUp($("#ringPct"), s.completion, 1400);
    } else {
      ring.style.strokeDashoffset = off;
      $("#ringPct").textContent = s.completion;
    }
    $("#ringNote").textContent = !s.total
      ? "Add tasks to get started"
      : s.completion === 100
        ? "🎉 Everything is done!"
        : `${s.total - s.done} task${s.total - s.done === 1 ? "" : "s"} left to go`;

    const next = S.tasks
      .filter((t) => t.status !== "done")
      .sort(
        (a, b) =>
          (b.timerStartedAt ? 1 : 0) - (a.timerStartedAt ? 1 : 0) ||
          (dueKey(a) || "9999").localeCompare(dueKey(b) || "9999"),
      )
      .slice(0, 5);
    $("#upNext").innerHTML = next.length
      ? next.map(taskRow).join("")
      : emptyBox("Nothing pending 🎉");
  }

  function renderTasks() {
    const list = visible();
    $("#taskList").innerHTML = list.length
      ? list.map(taskRow).join("")
      : emptyBox(
        S.q || S.status || S.prio ? "No matching tasks" : "No tasks yet",
      );
  }

  function renderBoard() {
    const lanes = [
      ["todo", "To do", "var(--muted)"],
      ["progress", "In progress", "var(--primary2)"],
      ["done", "Done", "var(--green)"],
    ];
    const list = visible();
    $("#board").innerHTML = lanes
      .map(([k, label, color]) => {
        const items = list.filter((t) => t.status === k);
        return `<div class="lane" data-lane="${k}"><div class="lane-head" style="--lc:${color}"><i></i>${label}<em>${items.length}</em></div>
        <div class="lane-body">${items
            .map(
              (
                t,
                i,
              ) => `<div class="card p-${t.priority} ${t.status === "done" ? "done" : ""} ${t.timerStartedAt ? "running" : ""}" draggable="true" data-id="${t._id}" style="--i:${Math.min(i, 10)}">
          <h4 data-open="${t._id}">${esc(t.title)}</h4><div class="meta">${tags(t)}${timeTag(t)}</div>${actions(t)}</div>`,
            )
            .join("")}</div></div>`;
      })
      .join("");
  }

  /* ---------- Calendar ---------- */
  function calCells() {
    const { y, m, mode, anchor } = S.cal;
    if (mode === "week") {
      const s = new Date(anchor);
      s.setHours(0, 0, 0, 0);
      s.setDate(s.getDate() - s.getDay());
      return Array.from(
        { length: 7 },
        (_, i) => new Date(s.getFullYear(), s.getMonth(), s.getDate() + i),
      );
    }
    const lead = new Date(y, m, 1).getDay(),
      days = new Date(y, m + 1, 0).getDate(),
      weeks = Math.ceil((lead + days) / 7);
    return Array.from(
      { length: weeks * 7 },
      (_, i) => new Date(y, m, 1 - lead + i),
    );
  }
  function renderCalendar() {
    const cells = calCells(),
      week = S.cal.mode === "week",
      tk = todayKey();
    if (!S.cal.sel) S.cal.sel = tk;
    const byDay = {};
    S.tasks
      .filter(
        (t) =>
          t.dueDate &&
          (!S.q || t.title.toLowerCase().includes(S.q.toLowerCase())),
      )
      .forEach((t) => {
        (byDay[dueKey(t)] = byDay[dueKey(t)] || []).push(t);
      });

    $("#calTitle").textContent = week
      ? `${cells[0].toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${cells[6].toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`
      : new Date(S.cal.y, S.cal.m, 1).toLocaleDateString(undefined, {
        month: "long",
        year: "numeric",
      });
    $$("#calMode .chip").forEach((c) =>
      c.classList.toggle("active", c.dataset.mode === S.cal.mode),
    );

    const max = week ? 8 : 3;
    $("#calGrid").className = "cal" + (week ? " week" : "");
    $("#calGrid").innerHTML =
      DOW.map((d) => `<div class="cal-dow">${d}</div>`).join("") +
      cells
        .map((d) => {
          const key = dkeyOf(d),
            list = byDay[key] || [],
            out = !week && d.getMonth() !== S.cal.m;
          return `<div class="cal-cell ${out ? "out" : ""} ${key === tk ? "today" : ""} ${key === S.cal.sel ? "sel" : ""} ${list.length ? "has" : ""}" data-day="${key}" data-n="${list.length}">
        <span class="cal-num">${d.getDate()}</span>
        ${list
              .slice(0, max)
              .map(
                (t) =>
                  `<button class="cal-chip p-${t.priority} ${t.status === "done" ? "done" : ""}" data-open="${t._id}" title="${esc(t.title)}">${esc(t.title)}</button>`,
              )
              .join("")}
        ${list.length > max ? `<div class="cal-more">+${list.length - max} more</div>` : ""}</div>`;
        })
        .join("");

    const sel = S.cal.sel,
      dayTasks = byDay[sel] || [];
    $("#dayPanel").innerHTML =
      `<div class="panel-head"><h3>${fmtKey(sel, { weekday: "long", month: "long", day: "numeric" })}</h3>
      <button class="btn btn-primary btn-sm" data-new-day="${sel}">${icon("plus")} Add task on this day</button></div>
      <div class="task-list">${dayTasks.length ? dayTasks.map(taskRow).join("") : '<div class="empty" style="padding:1.6rem"><p style="margin:0">Nothing due on this day.</p></div>'}</div>`;
  }
  function calShift(dir) {
    if (S.cal.mode === "week") {
      S.cal.anchor.setDate(S.cal.anchor.getDate() + dir * 7);
      S.cal.y = S.cal.anchor.getFullYear();
      S.cal.m = S.cal.anchor.getMonth();
    } else {
      const d = new Date(S.cal.y, S.cal.m + dir, 1);
      S.cal.y = d.getFullYear();
      S.cal.m = d.getMonth();
      S.cal.anchor = new Date(d);
    }
    renderCalendar();
    renderIcons($("#view-calendar"));
  }
  $("#calPrev").addEventListener("click", () => calShift(-1));
  $("#calNext").addEventListener("click", () => calShift(1));
  $("#calToday").addEventListener("click", () => {
    const n = new Date();
    S.cal = {
      ...S.cal,
      y: n.getFullYear(),
      m: n.getMonth(),
      anchor: n,
      sel: todayKey(),
    };
    renderCalendar();
    renderIcons($("#view-calendar"));
  });
  $("#calMode").addEventListener("click", (e) => {
    const c = e.target.closest(".chip");
    if (!c) return;
    S.cal.mode = c.dataset.mode;
    S.cal.anchor = new Date(S.cal.sel + "T00:00:00");
    S.cal.y = S.cal.anchor.getFullYear();
    S.cal.m = S.cal.anchor.getMonth();
    renderCalendar();
    renderIcons($("#view-calendar"));
  });
  $("#calGrid").addEventListener("click", (e) => {
    if (e.target.closest("[data-open]")) return; // chip → opens task details instead
    const c = e.target.closest("[data-day]");
    if (!c) return;
    S.cal.sel = c.dataset.day;
    renderCalendar();
    renderIcons($("#view-calendar"));
  });

  /* ---------- Insights ---------- */
  function animateMeters(root) {
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        $$(".meter i[data-w]", root).forEach(
          (i) => (i.style.width = i.dataset.w + "%"),
        ),
      ),
    );
  }
  function renderInsights() {
    const d = S.ins;
    if (!d) return;
    const tt = d.totals;
    const cards = [
      [
        "Focus this week",
        fmtShort(tt.weekMinutes * 60),
        "clock",
        "var(--primary)",
      ],
      [
        "Avg time per task",
        tt.avgSeconds ? fmtShort(tt.avgSeconds) : "—",
        "trend",
        "var(--primary2)",
      ],
      [
        "Most productive day",
        tt.mostProductiveDay || "—",
        "calendar",
        "var(--green)",
      ],
      ["Focus sessions", tt.pomodoros, "target", "var(--red)"],
    ];
    $("#insCards").innerHTML = cards
      .map(
        (c, i) =>
          `<div class="stat" style="--i:${i};--c:${c[3]}"><div class="s-ic">${icon(c[2])}</div><b style="${String(c[1]).length > 7 ? "font-size:1.45rem" : ""}">${esc(c[1])}</b><span>${c[0]}</span></div>`,
      )
      .join("");

    const max = Math.max(10, ...d.week.map((x) => x.minutes));
    $("#focusChart").innerHTML = d.week
      .map(
        (x, i) =>
          `<div class="col"><div class="bars"><div class="bar c" data-v="${x.minutes}m" style="height:${(x.minutes / max) * 100}%;--i:${i}"></div></div><small>${x.label}</small></div>`,
      )
      .join("");

    const g = d.goals,
      pct = (v, goal) => Math.min(100, Math.round((v / goal) * 100));
    $("#goalPanel").innerHTML =
      `<div class="panel-head"><h3>Weekly goals</h3></div>
      <div class="streak-big"><span class="fire">🔥</span><div><b>${d.streak.current} day${d.streak.current === 1 ? "" : "s"}</b><small>Current streak · longest ${d.streak.longest}</small></div></div>
      <div class="goal-row"><div class="gl"><span>Tasks completed</span><b>${tt.weekTasks} / ${g.weeklyTasks}</b></div><div class="meter green"><i data-w="${pct(tt.weekTasks, g.weeklyTasks)}"></i></div></div>
      <div class="goal-row"><div class="gl"><span>Focus minutes</span><b>${tt.weekMinutes} / ${g.weeklyFocusMinutes}</b></div><div class="meter"><i data-w="${pct(tt.weekMinutes, g.weeklyFocusMinutes)}"></i></div></div>
      <form class="goal-edit" id="goalForm"><label>Tasks / week<input class="input num" id="gTasks" type="number" min="1" max="1000" value="${g.weeklyTasks}"></label>
      <label>Focus min / week<input class="input num" id="gMins" type="number" min="10" max="10000" value="${g.weeklyFocusMinutes}"></label><button class="btn btn-ghost btn-sm" type="submit">Save goals</button></form>`;
    animateMeters($("#goalPanel"));

    const lvl = (o) => {
      const v = o.tasks + o.minutes / 30;
      return v === 0 ? 0 : v < 1.5 ? 1 : v < 3 ? 2 : v < 5 ? 3 : 4;
    };
    $("#heatmap").innerHTML =
      "<span></span>".repeat(d.days[0].dow) +
      d.days
        .map(
          (o, i) =>
            `<div class="hc h${lvl(o)}" style="--i:${i}" title="${o.date}: ${o.tasks} task${o.tasks === 1 ? "" : "s"} · ${o.minutes} min focus"></div>`,
        )
        .join("");

    $("#accNote").textContent = d.totals.accuracy
      ? `${d.totals.accuracy}% of estimated time used`
      : "";
    $("#estList").innerHTML = d.estVsActual.length
      ? d.estVsActual
        .map((r) => {
          const m = Math.max(r.estimate, r.actual, 1);
          return `<div class="est-row"><div class="et"><span>${esc(r.title)}</span><span class="muted" style="margin:0">${r.actual}m / ${r.estimate}m</span></div>
        <div class="est-bars"><i class="e" style="width:0" data-bw="${(r.estimate / m) * 100}"></i><i class="a ${r.actual > r.estimate ? "over" : ""}" style="width:0" data-bw="${(r.actual / m) * 100}"></i></div></div>`;
        })
        .join("")
      : `<div class="empty" style="padding:1.6rem"><p style="margin:0">Add an estimate to a task and track its time to compare here.</p></div>`;
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        $$("#estList [data-bw]").forEach(
          (i) => (i.style.width = i.dataset.bw + "%"),
        ),
      ),
    );
    renderIcons($("#view-insights"));
  }
  document.addEventListener("submit", async (e) => {
    if (e.target.id !== "goalForm") return;
    e.preventDefault();
    try {
      await api("/insights/goals", {
        method: "PUT",
        body: {
          weeklyTasks: +$("#gTasks").value,
          weeklyFocusMinutes: +$("#gMins").value,
        },
      });
      toast("Goals saved 🎯");
      loadInsights();
    } catch (ex) {
      toast(ex.message, "error");
    }
  });

  /* ---------- Trash ---------- */
  function trashRow(t, i) {
    const left = Math.max(
      0,
      30 - Math.floor((Date.now() - new Date(t.deletedAt)) / 864e5),
    );
    return `<div class="task trashed p-${t.priority}" style="--i:${Math.min(i, 12)}">
      <div class="task-body"><div class="task-title">${esc(t.title)}</div>${t.description ? `<div class="task-desc">${esc(t.description)}</div>` : ""}
        <div class="meta">${tags(t)}${t.timeSpent ? `<span class="tag">${icon("clock")} ${fmtShort(t.timeSpent)}</span>` : ""}<span class="expiry">Deleted ${ago(t.deletedAt)} · auto-removed in ${left}d</span></div></div>
      <div class="trash-acts"><button class="btn btn-ghost btn-sm" data-restore="${t._id}">${icon("undo")} Restore</button><button class="btn btn-danger btn-sm" data-purge="${t._id}">${icon("trash")}<span class="lbl">Delete forever</span></button></div></div>`;
  }
  function renderTrash() {
    $("#trashList").innerHTML = S.trash.length
      ? S.trash.map(trashRow).join("")
      : `<div class="empty">${icon("trash")}<h4>Trash is empty</h4><p>Deleted tasks will show up here so you can restore them.</p></div>`;
    $("#emptyTrashBtn").style.display = S.trash.length ? "" : "none";
  }

  function render() {
    if (S.view === "overview") renderOverview();
    else if (S.view === "tasks") renderTasks();
    else if (S.view === "board") renderBoard();
    else if (S.view === "calendar") renderCalendar();
    else if (S.view === "trash") renderTrash();
    else if (S.view === "insights") renderInsights();
    const c = $("#trashCount");
    c.textContent = S.trash.length > 99 ? "99+" : S.trash.length;
    c.classList.toggle("show", S.trash.length > 0);
    renderIcons($(".view.active"));
    renderDock();
    updateFocus();
    if (S.drawerId) renderDrawer();
    clearTimeout(naTimer);
    naTimer = setTimeout(() => views.classList.add("no-anim"), 900);
  }

  /* ---------- Live timer: ticker + floating dock ---------- */
  let dockKey = null;
  S.dockTitle = null;
  const fmtMS = (s) => `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
  function setTitle() {
    document.title =
      (F.running
        ? `${fmtMS(fRemaining())} · ${F.mode === "focus" ? "Focus" : "Break"}`
        : S.dockTitle) || BASE_TITLE;
  }
  function renderDock() {
    const dock = $("#timerDock"),
      t = S.tasks.find((x) => x.timerStartedAt);
    if (!t) {
      if (dockKey) {
        dock.classList.remove("show");
        dockKey = null;
      }
      S.dockTitle = null;
      setTitle();
      return;
    }
    const key = t._id + "|" + t.title;
    if (dockKey !== key) {
      dockKey = key;
      dock.innerHTML = `<span class="dock-dot"></span><div class="dock-info"><small>Now working on</small><b>${esc(t.title)}</b></div><div class="dock-time" id="dockTime">00:00:00</div>
        <div class="dock-btns"><button class="btn btn-ghost btn-sm" data-timer-toggle="${t._id}">${icon("pause")}<span class="lbl">Pause</span></button><button class="btn btn-primary btn-sm" data-toggle="${t._id}">${icon("check")}<span class="lbl">Finish</span></button></div>`;
      dock.classList.add("show");
    }
    const clock = fmtClock(elapsed(t));
    $("#dockTime").textContent = clock;
    S.dockTitle = `${clock} · ${t.title}`;
    setTitle();
  }
  function updateFocus() {
    const total = S.tasks.reduce((n, t) => n + elapsed(t), 0);
    $("#focusNote").textContent = total
      ? `⏱ ${fmtShort(total)} tracked in total`
      : "";
  }
  setInterval(() => {
    $$("[data-timer]").forEach((el) => {
      const t = find(S.tasks, el.dataset.timer),
        tt = el.querySelector(".tt");
      if (t && tt) tt.textContent = fmtClock(elapsed(t));
    });
    renderDock();
    updateFocus();
  }, 1000);

  async function timerStart(id) {
    const r = await api(`/tasks/${id}/start`, { method: "POST" });
    syncClock(r.serverTime);
    const all = await api("/tasks");
    S.tasks = all.tasks;
    syncClock(all.serverTime); // server stops any other running timer
    if (S.drawerId) refreshActs(S.drawerId);
    return find(S.tasks, id);
  }
  async function timerPause(id) {
    const r = await api(`/tasks/${id}/pause`, { method: "POST" });
    syncClock(r.serverTime);
    adopt(r.task);
    return r.task;
  }
  async function toggleTimer(t) {
    const running = !!t.timerStartedAt;
    try {
      if (running) {
        const nt = await timerPause(t._id);
        await refreshStats();
        render();
        toast(`Timer paused · ${fmtShort(elapsed(nt))} tracked`);
      } else {
        await timerStart(t._id);
        await refreshStats();
        render();
        toast("Task started — timer is running ⏱");
      }
      loadInsights();
    } catch (ex) {
      toast(ex.message, "error");
    }
  }

  /* ---------- Filters & search ---------- */
  $("#statusChips").addEventListener("click", (e) => {
    const c = e.target.closest(".chip");
    if (!c) return;
    $$("#statusChips .chip").forEach((x) =>
      x.classList.toggle("active", x === c),
    );
    S.status = c.dataset.status;
    render();
  });
  $("#prioFilter").addEventListener("change", (e) => {
    S.prio = e.target.value;
    render();
  });
  let st;
  $("#search").addEventListener("input", (e) => {
    clearTimeout(st);
    st = setTimeout(() => {
      S.q = e.target.value.trim();
      if (S.q && ["overview", "profile", "trash", "insights"].includes(S.view))
        go("tasks");
      else render();
    }, 180);
  });

  /* ---------- Modals ---------- */
  const modal = (id, open) => {
    const m = $("#" + id);
    m.classList.toggle("open", open);
    m.setAttribute("aria-hidden", String(!open));
  };
  $$(".modal").forEach((m) =>
    m.addEventListener("click", (e) => {
      if (e.target === m || e.target.closest("[data-close]"))
        modal(m.id, false);
    }),
  );

  /* ---------- Task form (create / edit) ---------- */
  const M = { subs: [], days: new Set() };
  function renderSubsEdit() {
    $("#subsEdit").innerHTML = M.subs
      .map(
        (s, i) =>
          `<div class="sub-row"><input type="checkbox" data-i="${i}" ${s.done ? "checked" : ""} aria-label="Done"><input class="input sel" type="text" data-i="${i}" maxlength="100" value="${esc(s.title)}"><button type="button" class="act del" data-rm="${i}" aria-label="Remove step">${icon("x")}</button></div>`,
      )
      .join("");
  }
  function renderDays() {
    const box = $("#tDays");
    box.hidden = $("#tRepeat").value !== "custom";
    box.innerHTML = DOW.map(
      (n, i) =>
        `<button type="button" data-rd="${i}" class="${M.days.has(i) ? "on" : ""}">${n}</button>`,
    ).join("");
  }
  $("#subsEdit").addEventListener("input", (e) => {
    if (e.target.type === "text")
      M.subs[+e.target.dataset.i].title = e.target.value;
  });
  $("#subsEdit").addEventListener("change", (e) => {
    if (e.target.type === "checkbox")
      M.subs[+e.target.dataset.i].done = e.target.checked;
  });
  $("#subsEdit").addEventListener("click", (e) => {
    const b = e.target.closest("[data-rm]");
    if (b) {
      M.subs.splice(+b.dataset.rm, 1);
      renderSubsEdit();
      renderIcons($("#subsEdit"));
    }
  });
  const addModalStep = () => {
    const v = $("#subNew").value.trim();
    if (!v) return;
    if (M.subs.length >= 30)
      return toast("A checklist can have up to 30 steps.", "error");
    M.subs.push({ title: v, done: false });
    $("#subNew").value = "";
    renderSubsEdit();
    renderIcons($("#subsEdit"));
    $("#subNew").focus();
  };
  $("#subAddBtn").addEventListener("click", addModalStep);
  $("#subNew").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addModalStep();
    }
  });
  $("#tRepeat").addEventListener("change", renderDays);
  $("#tDays").addEventListener("click", (e) => {
    const b = e.target.closest("[data-rd]");
    if (!b) return;
    const d = +b.dataset.rd;
    M.days.has(d) ? M.days.delete(d) : M.days.add(d);
    renderDays();
  });

  function openTask(t = null, preset = {}) {
    S.editing = t;
    $("#taskErr").classList.remove("show");
    $("#modalTitle").textContent = t ? "Edit task" : "New task";
    $("#tTitle").value = t?.title || "";
    $("#tDesc").value = t?.description || "";
    $("#tStatus").value = t?.status || preset.status || "todo";
    $("#tPrio").value = t?.priority || "medium";
    $("#tDue").value = t ? dueKey(t) : preset.due || "";
    $("#tTime").value = t?.dueTime || "";
    $("#tEst").value = t?.estimateMinutes || "";
    $("#tRemind").value = String(t ? (t.remindBefore ?? -1) : ST.defaultRemind);
    $("#tRepeat").value = t?.repeat || "none";
    M.days = new Set(t?.repeatDays || []);
    M.subs = plainSubs(t || {});
    $("#subNew").value = "";
    renderSubsEdit();
    renderDays();
    renderIcons($("#taskModal"));
    modal("taskModal", true);
    setTimeout(() => $("#tTitle").focus(), 300);
  }
  $("#newBtn").addEventListener("click", () => openTask());

  $("#taskForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#taskErr"),
      rep = $("#tRepeat").value,
      fail = (m) => {
        err.textContent = m;
        err.classList.add("show");
      };
    const title = $("#tTitle").value.trim();
    if (!title) return fail("Please enter a title.");
    if (rep === "custom" && !M.days.size)
      return fail("Pick at least one day for the custom repeat.");
    const pending = $("#subNew").value.trim();
    if (pending) {
      M.subs.push({ title: pending, done: false });
      $("#subNew").value = "";
    }
    const body = {
      title,
      description: $("#tDesc").value.trim(),
      status: $("#tStatus").value,
      priority: $("#tPrio").value,
      dueDate: $("#tDue").value || null,
      dueTime: $("#tDue").value ? $("#tTime").value : "",
      estimateMinutes: $("#tEst").value || 0,
      remindBefore: +$("#tRemind").value,
      repeat: rep,
      repeatDays: rep === "custom" ? [...M.days] : [],
      subtasks: M.subs
        .map((s) => ({ title: s.title.trim(), done: s.done }))
        .filter((s) => s.title),
    };
    const btn = $("#saveBtn");
    btn.classList.add("loading");
    try {
      if (S.editing) {
        const r = await api("/tasks/" + S.editing._id, { method: "PUT", body });
        syncClock(r.serverTime);
        adopt(r.task);
        toast("Task updated");
        if (r.spawned) {
          S.tasks.unshift(r.spawned);
          toast(`Next repeat scheduled for ${fmtKey(dueKey(r.spawned))} 🔁`);
        }
      } else {
        const { task } = await api("/tasks", { method: "POST", body });
        S.tasks.unshift(task);
        S.acts[task._id] = task.activity;
        toast("Task created");
      }
      modal("taskModal", false);
      await refreshStats();
      render();
      loadInsights();
    } catch (ex) {
      fail(ex.message);
    }
    btn.classList.remove("loading");
  });

  /* ---------- Checklist actions (rows + drawer) ---------- */
  async function saveSubs(t, subs) {
    const prev = t.subtasks;
    t.subtasks = subs;
    render();
    try {
      const r = await api("/tasks/" + t._id, {
        method: "PUT",
        body: { subtasks: subs },
      });
      adopt(r.task);
      render();
    } catch (ex) {
      t.subtasks = prev;
      render();
      toast(ex.message, "error");
    }
  }
  function toggleSub(id, i, checked) {
    const t = find(S.tasks, id);
    if (!t) return;
    const subs = plainSubs(t);
    subs[i].done = checked;
    saveSubs(t, subs);
    if (checked && subs.every((s) => s.done) && t.status !== "done")
      toast("All steps are done! 🎉", "info", {
        label: "Mark task done",
        fn: () => setStatus(find(S.tasks, id), "done"),
      });
  }
  function addStep(id, title) {
    const t = find(S.tasks, id);
    title = title.trim();
    if (!t || !title) return;
    const subs = plainSubs(t);
    if (subs.length >= 30)
      return toast("A checklist can have up to 30 steps.", "error");
    subs.push({ title, done: false });
    S.open.add(id);
    saveSubs(t, subs);
  }
  function delStep(id, i) {
    const t = find(S.tasks, id);
    if (!t) return;
    const subs = plainSubs(t);
    subs.splice(i, 1);
    saveSubs(t, subs);
  }
  document.addEventListener("change", (e) => {
    const el = e.target.closest?.("[data-sub]");
    if (!el) return;
    const [id, i] = el.dataset.sub.split(":");
    toggleSub(id, +i, el.checked);
  });

  /* ---------- Details drawer (notes, checklist, activity) ---------- */
  const drawer = $("#drawer"),
    dOverlay = $("#drawerOverlay");
  async function openDrawer(id) {
    const t = find(S.tasks, id) || find(S.trash, id);
    if (!t) return;
    S.drawerId = id;
    $("#dNotes").value = t.notes || "";
    $("#dNotesState").textContent = "";
    $("#dSubNew").value = "";
    drawer.classList.add("open");
    dOverlay.classList.add("show");
    drawer.setAttribute("aria-hidden", "false");
    renderDrawer();
    refreshActs(id);
  }
  async function closeDrawer() {
    if (!S.drawerId) return;
    await saveNotes(true);
    S.drawerId = null;
    drawer.classList.remove("open");
    dOverlay.classList.remove("show");
    drawer.setAttribute("aria-hidden", "true");
  }
  function renderDrawer() {
    const t = find(S.tasks, S.drawerId) || find(S.trash, S.drawerId);
    if (!t) {
      drawer.classList.remove("open");
      dOverlay.classList.remove("show");
      S.drawerId = null;
      return;
    }
    const id = t._id,
      sp = subProg(t),
      inTrash = !!t.deletedAt;
    $("#dTitle").textContent = t.title;
    $("#dMeta").innerHTML =
      `<div class="meta">${tags(t)}</div>${t.description ? `<p class="d-desc">${esc(t.description)}</p>` : ""}
      ${inTrash
        ? ""
        : `<div class="d-actions">${timerBtn(t)}
        <button class="btn btn-ghost btn-sm" data-focus="${id}">${icon("target")} Focus</button>
        <button class="btn btn-ghost btn-sm" data-toggle="${id}">${icon("check")} ${t.status === "done" ? "Reopen" : "Mark done"}</button>
        <button class="btn btn-ghost btn-sm" data-edit="${id}">${icon("edit")} Edit</button>
        <button class="btn btn-danger btn-sm" data-del="${id}">${icon("trash")} Delete</button></div>`
      }
      <div class="d-stats"><div class="d-stat"><b data-timer="${id}"><span class="tt">${fmtClock(elapsed(t))}</span></b><small>Tracked</small></div>
        <div class="d-stat"><b>${t.estimateMinutes ? t.estimateMinutes + "m" : "—"}</b><small>Estimate</small></div>
        <div class="d-stat"><b>${t.pomodoros || 0}</b><small>Focus sessions</small></div></div>`;
    $("#dSubs").innerHTML = sp.total
      ? `<div class="gl" style="display:flex;justify-content:space-between;font-size:.85rem"><span class="muted" style="margin:0">${sp.done} of ${sp.total} done</span><b>${Math.round((sp.done / sp.total) * 100)}%</b></div>
         <div class="meter green"><i style="width:${(sp.done / sp.total) * 100}%"></i></div><div class="checklist">${subRows(t, true)}</div>`
      : '<p class="muted small" style="margin:0 0 .4rem">No steps yet — break this task into smaller steps.</p>';
    const acts = S.acts[id];
    $("#dAct").innerHTML = !acts
      ? '<small class="muted">Loading…</small>'
      : acts.length
        ? acts
          .slice()
          .reverse()
          .map(
            (a, i) =>
              `<div class="tl-item ${esc(a.type)}" style="--i:${Math.min(i, 10)}">${esc(a.text)}<small>${ago(a.at)} · ${new Date(a.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</small></div>`,
          )
          .join("")
        : '<small class="muted">No activity yet.</small>';
    renderIcons(drawer);
  }
  async function saveNotes(silent) {
    const t = find(S.tasks, S.drawerId);
    if (!t) return;
    const v = $("#dNotes").value;
    if (v === (t.notes || "")) {
      if (!silent) $("#dNotesState").textContent = "Nothing to save";
      return;
    }
    $("#dNotesState").textContent = "Saving…";
    try {
      const r = await api("/tasks/" + t._id, {
        method: "PUT",
        body: { notes: v },
      });
      adopt(r.task);
      $("#dNotesState").textContent = "Saved ✓";
      if (S.drawerId) renderDrawer();
    } catch (ex) {
      $("#dNotesState").textContent = "";
      toast(ex.message, "error");
    }
  }
  $("#drawerClose").addEventListener("click", closeDrawer);
  dOverlay.addEventListener("click", closeDrawer);
  $("#dNotesSave").addEventListener("click", () => saveNotes(false));
  $("#dNotes").addEventListener("blur", () => saveNotes(true));
  $("#dSubAdd").addEventListener("click", () => {
    addStep(S.drawerId, $("#dSubNew").value);
    $("#dSubNew").value = "";
  });
  $("#dSubNew").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addStep(S.drawerId, $("#dSubNew").value);
      $("#dSubNew").value = "";
    }
  });

  /* ---------- Task actions (delegated clicks) ---------- */
  document.addEventListener("click", (e) => {
    const q = (sel) => e.target.closest(sel);
    let el;
    if (q("[data-new]")) return openTask();
    if ((el = q("[data-new-day]")))
      return openTask(null, { due: el.dataset.newDay });
    if ((el = q("[data-timer-toggle]"))) {
      const t = find(S.tasks, el.dataset.timerToggle);
      if (t) toggleTimer(t);
    } else if ((el = q("[data-toggle]"))) {
      const t = find(S.tasks, el.dataset.toggle);
      if (t) setStatus(t, t.status === "done" ? "todo" : "done");
    } else if ((el = q("[data-edit]")))
      openTask(find(S.tasks, el.dataset.edit));
    else if ((el = q("[data-del]")))
      askConfirm("soft", find(S.tasks, el.dataset.del));
    else if ((el = q("[data-restore]"))) restore(el.dataset.restore);
    else if ((el = q("[data-purge]")))
      askConfirm("hard", find(S.trash, el.dataset.purge));
    else if ((el = q("[data-expand]"))) {
      const id = el.dataset.expand;
      S.open.has(id) ? S.open.delete(id) : S.open.add(id);
      render();
    } else if ((el = q("[data-subdel]"))) {
      const [id, i] = el.dataset.subdel.split(":");
      delStep(id, +i);
    } else if ((el = q("[data-focus]"))) openFocus(el.dataset.focus);
    else if ((el = q("[data-open]"))) openDrawer(el.dataset.open);
  });

  async function setStatus(t, status) {
    const snap = { ...t };
    t.status = status;
    t.completedAt = status === "done" ? new Date().toISOString() : null;
    if (status !== "progress" && t.timerStartedAt && status !== snap.status) {
      t.timeSpent = elapsed(snap);
      t.timerStartedAt = null;
    } // mirrors server
    render();
    try {
      const r = await api("/tasks/" + t._id, {
        method: "PUT",
        body: { status },
      });
      syncClock(r.serverTime);
      adopt(r.task);
      if (r.spawned) S.tasks.unshift(r.spawned);
      await refreshStats();
      render();
      loadInsights();
      if (status === "done" && snap.status !== "done")
        toast(
          r.spawned
            ? `Done! Next “${r.task.title}” is set for ${fmtKey(dueKey(r.spawned))} 🔁`
            : `Nice work! Task completed 🎉${r.task.timeSpent ? " · " + fmtShort(r.task.timeSpent) : ""}`,
        );
    } catch (ex) {
      Object.assign(t, snap);
      render();
      toast(ex.message, "error");
    }
  }

  /* ---------- Trash: delete, restore, delete forever ---------- */
  function askConfirm(mode, task, payload) {
    if (["soft", "hard"].includes(mode) && !task) return;
    S.confirm = { mode, task, payload };
    const cfg = {
      soft: [
        "Move to trash?",
        `“${task?.title}” will be moved to Trash. You can restore it within 30 days.`,
        "Move to trash",
      ],
      hard: [
        "Delete forever?",
        `“${task?.title}” will be permanently deleted. This can’t be undone.`,
        "Delete forever",
      ],
      empty: [
        "Empty trash?",
        `All ${S.trash.length} task${S.trash.length === 1 ? "" : "s"} in Trash will be permanently deleted.`,
        "Empty trash",
      ],
      import: [
        "Replace all data?",
        "All your current tasks will be replaced by the tasks in this backup. This can’t be undone.",
        "Replace & import",
      ],
    }[mode];
    $("#confirmTitle").textContent = cfg[0];
    $("#confirmText").textContent = cfg[1];
    $("#confirmYes").textContent = cfg[2];
    modal("confirmModal", true);
  }
  $("#emptyTrashBtn").addEventListener("click", () => askConfirm("empty"));

  $("#confirmYes").addEventListener("click", async () => {
    const { mode, task, payload } = S.confirm || {};
    if (!mode) return;
    const b = $("#confirmYes");
    b.classList.add("loading");
    try {
      if (mode === "soft") {
        const r = await api("/tasks/" + task._id, { method: "DELETE" });
        S.tasks = S.tasks.filter((x) => x._id !== task._id);
        S.trash.unshift(r.task);
        if (S.drawerId === task._id) closeDrawer();
        toast("Moved to trash", "info", {
          label: "Undo",
          fn: () => restore(task._id),
        });
      } else if (mode === "hard") {
        await api(`/tasks/${task._id}/permanent`, { method: "DELETE" });
        S.trash = S.trash.filter((x) => x._id !== task._id);
        toast("Deleted forever");
      } else if (mode === "empty") {
        await api("/tasks/trash", { method: "DELETE" });
        S.trash = [];
        toast("Trash emptied");
      } else if (mode === "import") {
        modal("confirmModal", false);
        await runImport(payload);
        b.classList.remove("loading");
        return;
      }
      modal("confirmModal", false);
      await refreshStats();
      render();
      loadInsights();
    } catch (ex) {
      toast(ex.message, "error");
    }
    b.classList.remove("loading");
  });

  async function restore(id) {
    try {
      const r = await api(`/tasks/${id}/restore`, { method: "POST" });
      S.trash = S.trash.filter((x) => x._id !== id);
      S.tasks = [r.task, ...S.tasks.filter((x) => x._id !== id)].sort(
        (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
      );
      await refreshStats();
      render();
      toast("Task restored ✨");
    } catch (ex) {
      toast(ex.message, "error");
    }
  }

  /* ---------- Drag & drop (board) ---------- */
  let dragId = null;
  document.addEventListener("dragstart", (e) => {
    const c = e.target.closest?.(".card");
    if (!c) return;
    dragId = c.dataset.id;
    c.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", dragId);
  });
  document.addEventListener("dragend", () => {
    $$(".card.dragging").forEach((c) => c.classList.remove("dragging"));
    $$(".lane.over").forEach((l) => l.classList.remove("over"));
  });
  document.addEventListener("dragover", (e) => {
    const l = e.target.closest?.(".lane");
    if (!l) return;
    e.preventDefault();
    $$(".lane").forEach((x) => x.classList.toggle("over", x === l));
  });
  document.addEventListener("drop", (e) => {
    const l = e.target.closest?.(".lane");
    if (!l || !dragId) return;
    e.preventDefault();
    const t = find(S.tasks, dragId);
    dragId = null;
    if (t && t.status !== l.dataset.lane) setStatus(t, l.dataset.lane);
  });

  /* =========================================================
     Notifications: in-app bell + browser notifications
     ========================================================= */
  let bell = lsGet("tf_bell", []);
  function renderBell() {
    const unread = bell.filter((b) => !b.read).length,
      dot = $("#bellDot");
    dot.textContent = unread > 9 ? "9+" : unread;
    dot.classList.toggle("show", unread > 0);
    $("#bellList").innerHTML = bell.length
      ? bell
        .map(
          (b) =>
            `<div class="bell-item ${b.read ? "" : "unread"}">${icon("bell")}<div><b>${esc(b.title)}</b>${b.body ? `<small>${esc(b.body)}</small>` : ""}<small>${ago(b.at)}</small></div></div>`,
        )
        .join("")
      : '<div class="bell-empty">No notifications yet 🔔</div>';
  }
  function closeBell() {
    const m = $("#bellMenu");
    if (!m.classList.contains("open")) return;
    m.classList.remove("open");
    bell.forEach((b) => (b.read = true));
    lsSet("tf_bell", bell);
    renderBell();
  }
  $("#bellBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    const m = $("#bellMenu");
    if (m.classList.contains("open")) closeBell();
    else {
      renderBell();
      m.classList.add("open");
    }
  });
  $("#bellClear").addEventListener("click", () => {
    bell = [];
    lsSet("tf_bell", bell);
    renderBell();
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".bell-wrap")) closeBell();
  });

  function notify(title, body = "", opts = {}) {
    toast(body ? `${title} — ${body}` : title);
    bell.unshift({ title, body, at: Date.now(), read: false });
    bell = bell.slice(0, 20);
    lsSet("tf_bell", bell);
    renderBell();
    if ("Notification" in window && Notification.permission === "granted") {
      try {
        new Notification(title, { body, tag: opts.tag });
      } catch { }
    }
  }
  function beep() {
    try {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return;
      const ctx = new C();
      [0, 0.25, 0.5].forEach((d, i) => {
        const o = ctx.createOscillator(),
          g = ctx.createGain(),
          t = ctx.currentTime + d;
        o.frequency.value = i === 2 ? 880 : 660;
        o.connect(g);
        g.connect(ctx.destination);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.2, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
        o.start(t);
        o.stop(t + 0.25);
      });
      setTimeout(() => ctx.close(), 1200);
    } catch { }
  }

  /* ---------- Smart reminders (runs while the app is open) ---------- */
  function checkReminders() {
    const now = Date.now(),
      seen = lsGet("tf_seen", {}),
      msgs = [];
    let changed = false;
    for (const t of S.tasks) {
      if (t.status === "done" || !t.dueDate) continue;
      const dk = dueKey(t),
        due = new Date(`${dk}T${t.dueTime || "09:00"}:00`).getTime(),
        endDay = new Date(`${dk}T23:59:59`).getTime();
      if (t.remindBefore >= 0) {
        const key = `r:${t._id}:${dk}:${t.dueTime}:${t.remindBefore}`;
        if (
          !seen[key] &&
          now >= due - t.remindBefore * 60000 &&
          now <= endDay
        ) {
          seen[key] = now;
          changed = true;
          msgs.push({
            title: `Due ${dk === todayKey() ? "today" : fmtKey(dk)}: ${t.title}`,
            body: t.dueTime ? `At ${t.dueTime}` : "",
          });
        }
      }
      if (ST.overdueAlerts && now > endDay) {
        const key = `o:${t._id}:${todayKey()}`;
        if (!seen[key]) {
          seen[key] = now;
          changed = true;
          msgs.push({
            title: `Overdue: ${t.title}`,
            body: `Was due ${fmtKey(dk)}`,
          });
        }
      }
    }
    if (changed) {
      // forget old keys, then save
      Object.keys(seen).forEach((k) => {
        if (now - seen[k] > 14 * 864e5) delete seen[k];
      });
      lsSet("tf_seen", seen);
    }
    if (msgs.length > 3)
      notify(
        `${msgs.length} tasks need your attention`,
        msgs
          .slice(0, 3)
          .map((m) => m.title.replace(/^(Due [^:]+|Overdue): /, ""))
          .join(", ") + "…",
        { tag: "summary" },
      );
    else msgs.forEach((m) => notify(m.title, m.body, { tag: m.title }));
  }

  /* =========================================================
     Focus mode (pomodoro)
     ========================================================= */
  const focusEl = $("#focus");
  const F = Object.assign(
    {
      mode: "focus",
      remaining: null,
      running: false,
      endAt: 0,
      taskId: "",
      cycles: 0,
    },
    lsGet("tf_focus", {}),
  );
  F.completing = false;
  const durFor = (m) =>
    (m === "focus" ? ST.focusMin : m === "break" ? ST.breakMin : ST.longMin) *
    60;
  if (F.remaining == null) F.remaining = durFor(F.mode);
  const saveF = () =>
    lsSet("tf_focus", {
      mode: F.mode,
      remaining: F.remaining,
      running: F.running,
      endAt: F.endAt,
      taskId: F.taskId,
      cycles: F.cycles,
    });
  const fRemaining = () =>
    F.running
      ? Math.max(0, Math.round((F.endAt - Date.now()) / 1000))
      : F.remaining;

  function fillFocusTasks() {
    const open = S.tasks.filter((t) => t.status !== "done");
    if (F.taskId && !open.some((t) => t._id === F.taskId)) F.taskId = "";
    $("#fTask").innerHTML =
      '<option value="">Free focus (no task)</option>' +
      open
        .map(
          (t) =>
            `<option value="${t._id}" ${t._id === F.taskId ? "selected" : ""}>${esc(t.title)}</option>`,
        )
        .join("");
  }
  function renderFocus() {
    const rem = fRemaining(),
      total = durFor(F.mode);
    $("#fTime").textContent = fmtMS(rem);
    $("#fRing").style.strokeDashoffset = 628.3 * (1 - Math.min(1, rem / total));
    $("#fMode").textContent =
      F.mode === "focus"
        ? "Focus"
        : F.mode === "break"
          ? "Short break"
          : "Long break";
    focusEl.classList.toggle("break", F.mode !== "focus");
    focusEl.classList.toggle("run", F.running);
    $("#fStart").textContent = F.running
      ? "Pause"
      : rem < total
        ? "Resume"
        : "Start";
    const filled =
      F.cycles > 0 && F.cycles % 4 === 0 && F.mode !== "focus"
        ? 4
        : F.cycles % 4;
    $("#fDots").innerHTML = [0, 1, 2, 3]
      .map((i) => `<i class="${i < filled ? "on" : ""}"></i>`)
      .join("");
    $("#fTask").disabled = F.running && F.mode === "focus";
    const t = find(S.tasks, F.taskId);
    $("#fHint").textContent =
      F.mode !== "focus"
        ? "Stretch, breathe and drink some water 💧"
        : t
          ? `Time on “${t.title}” is tracked automatically.`
          : "Free focus — time is not linked to a task.";
  }
  function openFocus(id) {
    closeDrawer();
    if (id && !F.running) {
      F.taskId = id;
      saveF();
    }
    fillFocusTasks();
    focusEl.classList.add("open");
    focusEl.setAttribute("aria-hidden", "false");
    renderFocus();
  }
  function closeFocus() {
    focusEl.classList.remove("open");
    focusEl.setAttribute("aria-hidden", "true");
  }

  async function fToggle() {
    try {
      if (F.running) {
        F.remaining = fRemaining();
        F.running = false;
        saveF();
        renderFocus();
        if (F.mode === "focus" && F.taskId) {
          await timerPause(F.taskId);
          await refreshStats();
          render();
        }
      } else {
        F.running = true;
        F.endAt = Date.now() + F.remaining * 1000;
        saveF();
        renderFocus();
        if ("Notification" in window && Notification.permission === "default")
          Notification.requestPermission().then(updateNotifStatus);
        if (F.mode === "focus" && F.taskId) {
          await timerStart(F.taskId);
          await refreshStats();
          render();
        }
      }
    } catch (ex) {
      F.running = false;
      F.remaining = durFor(F.mode);
      saveF();
      renderFocus();
      toast(ex.message, "error");
    }
  }
  async function fComplete() {
    if (F.completing) return;
    F.completing = true;
    try {
      const wasFocus = F.mode === "focus";
      F.running = false;
      if (wasFocus) {
        F.cycles++;
        if (F.taskId) {
          try {
            await timerPause(F.taskId);
            const r = await api(`/tasks/${F.taskId}/pomodoro`, {
              method: "POST",
            });
            adopt(r.task);
          } catch { }
          await refreshStats();
        }
        const long = F.cycles % 4 === 0;
        F.mode = long ? "long" : "break";
        F.remaining = durFor(F.mode);
        F.running = true;
        F.endAt = Date.now() + F.remaining * 1000; // breaks start automatically
        notify(
          "Focus session complete 🍅",
          long
            ? "Great work — enjoy a long break."
            : "Nice! Take a short break.",
          { tag: "focus" },
        );
      } else {
        F.mode = "focus";
        F.remaining = durFor("focus");
        notify("Break is over", "Ready for the next focus session?", {
          tag: "focus",
        });
      }
      beep();
      saveF();
      render();
      renderFocus();
      loadInsights();
    } finally {
      F.completing = false;
    }
  }
  async function fSkip() {
    if (F.mode === "focus" && F.taskId && F.running) {
      try {
        await timerPause(F.taskId);
        await refreshStats();
      } catch { }
    }
    F.mode = F.mode === "focus" ? "break" : "focus";
    F.remaining = durFor(F.mode);
    F.running = false;
    saveF();
    render();
    renderFocus();
  }
  async function fReset() {
    if (F.mode === "focus" && F.taskId && F.running) {
      try {
        await timerPause(F.taskId);
        await refreshStats();
      } catch { }
    }
    F.remaining = durFor(F.mode);
    F.running = false;
    saveF();
    render();
    renderFocus();
  }
  $("#focusBtn").addEventListener("click", () => openFocus(""));
  $("#focusClose").addEventListener("click", closeFocus);
  $("#fStart").addEventListener("click", fToggle);
  $("#fSkip").addEventListener("click", fSkip);
  $("#fReset").addEventListener("click", fReset);
  $("#fTask").addEventListener("change", (e) => {
    F.taskId = e.target.value;
    saveF();
    renderFocus();
  });
  setInterval(() => {
    if (!F.running) return;
    if (fRemaining() <= 0) fComplete();
    else {
      if (focusEl.classList.contains("open")) renderFocus();
      setTitle();
    }
  }, 500);

  /* =========================================================
     Settings, export / import, profile
     ========================================================= */
  function updateNotifStatus() {
    const el = $("#notifStatus"),
      b = $("#btnNotif");
    if (!("Notification" in window)) {
      el.textContent = "Not supported in this browser";
      b.style.display = "none";
      return;
    }
    const p = Notification.permission;
    el.textContent =
      p === "granted"
        ? "On — you will get desktop alerts"
        : p === "denied"
          ? "Blocked — allow notifications in your browser’s site settings"
          : "Off — in-app reminders only";
    b.style.display = p === "granted" ? "none" : "";
    b.disabled = p === "denied";
  }
  function paintSettings() {
    $("#stRemind").value = String(ST.defaultRemind);
    $("#stOverdue").checked = ST.overdueAlerts;
    $("#stFocus").value = ST.focusMin;
    $("#stBreak").value = ST.breakMin;
    $("#stLong").value = ST.longMin;
    updateNotifStatus();
  }
  $("#btnNotif").addEventListener("click", async () => {
    const p = await Notification.requestPermission();
    updateNotifStatus();
    if (p === "granted")
      notify(
        "Notifications enabled 🔔",
        "You will be reminded about due tasks.",
      );
  });
  $("#stRemind").addEventListener("change", (e) => {
    ST.defaultRemind = +e.target.value;
    saveST();
    toast("Default reminder saved");
  });
  $("#stOverdue").addEventListener("change", (e) => {
    ST.overdueAlerts = e.target.checked;
    saveST();
  });
  [
    ["stFocus", "focusMin", 5, 120],
    ["stBreak", "breakMin", 1, 60],
    ["stLong", "longMin", 5, 90],
  ].forEach(([id, key, min, max]) =>
    $("#" + id).addEventListener("change", (e) => {
      ST[key] = Math.min(
        max,
        Math.max(min, Math.round(+e.target.value) || ST[key]),
      );
      e.target.value = ST[key];
      saveST();
      if (!F.running) {
        F.remaining = durFor(F.mode);
        saveF();
        renderFocus();
      }
    }),
  );

  async function download(path, fallback) {
    const res = await fetch(API + path, {
      headers: { Authorization: "Bearer " + Auth.token },
    });
    if (!res.ok) throw new Error("Export failed. Please try again.");
    const blob = await res.blob(),
      cd = res.headers.get("Content-Disposition") || "";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (cd.match(/filename="([^"]+)"/) || [])[1] || fallback;
    a.addEventListener("click", (ev) => ev.stopPropagation()); // keep the page-transition handler out of this
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  }
  $("#expJson").addEventListener("click", () =>
    download("/data/export?format=json", "taskflow-backup.json")
      .then(() => toast("Backup downloaded ✅"))
      .catch((e) => toast(e.message, "error")),
  );
  $("#expCsv").addEventListener("click", () =>
    download("/data/export?format=csv", "taskflow-tasks.csv")
      .then(() => toast("CSV downloaded ✅"))
      .catch((e) => toast(e.message, "error")),
  );

  async function runImport(payload) {
    try {
      const r = await api("/data/import", { method: "POST", body: payload });
      toast(
        `Imported ${r.imported} task${r.imported === 1 ? "" : "s"}${r.skipped ? ` · ${r.skipped} skipped` : ""}`,
      );
      $("#impFile").value = "";
      $("#impReplace").checked = false;
      await load();
      loadInsights();
    } catch (ex) {
      toast(ex.message, "error");
    }
  }
  $("#impBtn").addEventListener("click", async () => {
    const f = $("#impFile").files[0];
    if (!f) return toast("Choose a backup file first.", "error");
    if (f.size > 8 * 1024 * 1024)
      return toast("That file is too large.", "error");
    let data;
    try {
      data = JSON.parse(await f.text());
    } catch {
      return toast("That file is not valid JSON.", "error");
    }
    if (!data || !Array.isArray(data.tasks))
      return toast("This is not a TaskFlow backup file.", "error");
    const payload = {
      tasks: data.tasks,
      timeLogs: data.timeLogs || [],
      mode: $("#impReplace").checked ? "replace" : "merge",
    };
    if (payload.mode === "replace") askConfirm("import", null, payload);
    else runImport(payload);
  });

  $("#profileForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const r = await api("/auth/profile", {
        method: "PUT",
        body: { name: $("#pName").value.trim() },
      });
      user = r.user;
      Auth.setUser(user);
      paintUser();
      toast("Profile saved");
    } catch (ex) {
      toast(ex.message, "error");
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const openModals = $$(".modal.open");
    if (openModals.length) return openModals.forEach((m) => modal(m.id, false));
    if ($("#bellMenu").classList.contains("open")) return closeBell();
    if (S.drawerId) return closeDrawer();
    if (focusEl.classList.contains("open")) closeFocus();
  });

  /* ---------- Boot ---------- */
  $("#taskList").innerHTML = '<div class="skeleton"></div>'.repeat(3);
  setTimeout(moveGlow, 60);
  renderBell();
  await load();
  loadInsights();
  fillFocusTasks();
  renderFocus();
  updateNotifStatus();
  checkReminders();
  setInterval(checkReminders, 30000);
})();
