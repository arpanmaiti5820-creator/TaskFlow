const express = require("express");
const Task = require("../models/Task");
const TimeLog = require("../models/TimeLog");
const protect = require("../middleware/auth");

const router = express.Router();
router.use(protect);

const STATUS = ["todo", "progress", "done"];
const PRIORITY = ["low", "medium", "high"];
const REPEAT = ["none", "daily", "weekdays", "weekly", "monthly", "custom"];
const clampInt = (v, min, max, dflt = 0) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
};
const validDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d) ? null : d;
};

const pick = (t) => ({
  oldId: String(t._id),
  title: t.title,
  description: t.description || "",
  notes: t.notes || "",
  status: t.status,
  priority: t.priority,
  dueDate: t.dueDate || null,
  dueTime: t.dueTime || "",
  estimateMinutes: t.estimateMinutes || 0,
  timeSpent: t.timeSpent || 0,
  pomodoros: t.pomodoros || 0,
  remindBefore: t.remindBefore ?? -1,
  repeat: t.repeat || "none",
  repeatDays: t.repeatDays || [],
  subtasks: (t.subtasks || []).map((s) => ({ title: s.title, done: !!s.done })),
  completedAt: t.completedAt || null,
  createdAt: t.createdAt,
});

// CSV cells starting with = + - @ can run as formulas in Excel – neutralise them.
const csvCell = (v) => {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

// GET /api/data/export?format=json|csv
router.get("/export", async (req, res, next) => {
  try {
    const tasks = await Task.find({ user: req.user._id, deletedAt: null })
      .select("-activity")
      .sort({ createdAt: 1 })
      .lean();
    const stamp = new Date().toISOString().slice(0, 10);

    if (req.query.format === "csv") {
      const head = [
        "Title",
        "Status",
        "Priority",
        "Due date",
        "Due time",
        "Estimate (min)",
        "Tracked (min)",
        "Focus sessions",
        "Repeat",
        "Checklist done",
        "Checklist total",
        "Description",
        "Notes",
        "Completed at",
        "Created at",
      ];
      const rows = tasks.map((t) => [
        t.title,
        t.status,
        t.priority,
        t.dueDate ? new Date(t.dueDate).toISOString().slice(0, 10) : "",
        t.dueTime || "",
        t.estimateMinutes || 0,
        Math.round((t.timeSpent || 0) / 60),
        t.pomodoros || 0,
        t.repeat || "none",
        (t.subtasks || []).filter((s) => s.done).length,
        (t.subtasks || []).length,
        t.description || "",
        t.notes || "",
        t.completedAt ? new Date(t.completedAt).toISOString() : "",
        new Date(t.createdAt).toISOString(),
      ]);
      const csv =
        "\uFEFF" +
        [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="taskflow-${stamp}.csv"`,
      );
      return res.send(csv);
    }

    const logs = await TimeLog.find({ user: req.user._id }).lean();
    const payload = {
      app: "taskflow",
      version: 2,
      exportedAt: new Date().toISOString(),
      user: { name: req.user.name, email: req.user.email },
      tasks: tasks.map(pick),
      timeLogs: logs.map((l) => ({
        task: l.task ? String(l.task) : null,
        start: l.start,
        seconds: l.seconds,
      })),
    };
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="taskflow-backup-${stamp}.json"`,
    );
    res.send(JSON.stringify(payload, null, 2));
  } catch (err) {
    next(err);
  }
});

function sanitizeTask(r, userId) {
  if (!r || typeof r !== "object") return null;
  const title = String(r.title || "")
    .trim()
    .slice(0, 120);
  if (!title) return null;
  const status = STATUS.includes(r.status) ? r.status : "todo";
  const due = validDate(r.dueDate);
  const created = validDate(r.createdAt);
  const doc = {
    user: userId,
    title,
    description: String(r.description || "").slice(0, 600),
    notes: String(r.notes || "").slice(0, 5000),
    status,
    priority: PRIORITY.includes(r.priority) ? r.priority : "medium",
    dueDate: due,
    dueTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(r.dueTime || "") ? r.dueTime : "",
    estimateMinutes: clampInt(r.estimateMinutes, 0, 6000),
    timeSpent: clampInt(r.timeSpent, 0, 1e8),
    pomodoros: clampInt(r.pomodoros, 0, 100000),
    remindBefore: clampInt(r.remindBefore, -1, 10080, -1),
    repeat: REPEAT.includes(r.repeat) ? r.repeat : "none",
    repeatDays: Array.isArray(r.repeatDays)
      ? [
          ...new Set(
            r.repeatDays
              .map(Number)
              .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6),
          ),
        ]
      : [],
    subtasks: (Array.isArray(r.subtasks) ? r.subtasks : [])
      .slice(0, 30)
      .map((s) => ({
        title: String((s && s.title) || "")
          .trim()
          .slice(0, 100),
        done: !!(s && s.done),
      }))
      .filter((s) => s.title),
    completedAt:
      status === "done" ? validDate(r.completedAt) || new Date() : null,
    repeatSpawned: status === "done", // never re-spawn repeats for imported finished tasks
    activity: [
      { type: "created", text: "Imported from backup", at: new Date() },
    ],
  };
  if (doc.repeat === "custom" && !doc.repeatDays.length) doc.repeat = "none";
  if (created) doc.createdAt = created;
  return doc;
}

// POST /api/data/import { tasks, timeLogs, mode: 'merge' | 'replace' }
router.post("/import", async (req, res, next) => {
  try {
    const { tasks, timeLogs, mode } = req.body || {};
    if (!Array.isArray(tasks))
      return res
        .status(400)
        .json({ message: "This file is not a valid TaskFlow backup." });
    if (tasks.length > 2000)
      return res
        .status(400)
        .json({ message: "A backup can contain up to 2000 tasks." });

    const docs = [],
      oldIds = [];
    tasks.forEach((r) => {
      const d = sanitizeTask(r, req.user._id);
      if (d) {
        docs.push(d);
        oldIds.push(r.oldId ? String(r.oldId) : null);
      }
    });
    if (!docs.length)
      return res
        .status(400)
        .json({ message: "No valid tasks found in this file." });

    if (mode === "replace") {
      await Task.deleteMany({ user: req.user._id });
      await TimeLog.deleteMany({ user: req.user._id });
    }
    const created = await Task.insertMany(docs);

    const idMap = new Map();
    created.forEach((t, i) => {
      if (oldIds[i]) idMap.set(oldIds[i], t._id);
    });
    let logCount = 0;
    if (Array.isArray(timeLogs)) {
      const logDocs = timeLogs
        .slice(0, 20000)
        .map((l) => {
          const start = validDate(l && l.start);
          const seconds = clampInt(l && l.seconds, 0, 86400);
          if (!start || !seconds) return null;
          return {
            user: req.user._id,
            task: (l.task && idMap.get(String(l.task))) || null,
            start,
            seconds,
          };
        })
        .filter(Boolean);
      if (logDocs.length) {
        await TimeLog.insertMany(logDocs);
        logCount = logDocs.length;
      }
    }
    res.json({
      imported: created.length,
      skipped: tasks.length - created.length,
      timeLogs: logCount,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
