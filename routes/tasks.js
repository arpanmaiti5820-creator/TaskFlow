const express = require("express");
const mongoose = require("mongoose");
const Task = require("../models/Task");
const TimeLog = require("../models/TimeLog");
const protect = require("../middleware/auth");
const { nextDue } = require("../utils/recurrence");

const router = express.Router();
router.use(protect);

const STATUS = ["todo", "progress", "done"];
const PRIORITY = ["low", "medium", "high"];
const REPEAT = ["none", "daily", "weekdays", "weekly", "monthly", "custom"];
const LABEL = { todo: "To do", progress: "In progress", done: "Done" };
const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
const fmtDur = (s) => {
  const h = Math.floor(s / 3600),
    m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : m ? `${m}m` : `${s}s`;
};
const dayKey = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "");

/* ---------- helpers ---------- */
function addLog(task, type, text) {
  task.activity.push({ type, text, at: new Date() });
  if (task.activity.length > 60) task.activity = task.activity.slice(-60);
}

// Stops a running timer, adds the time to the task and records a TimeLog row for insights.
async function stopTimer(task) {
  if (!task.timerStartedAt) return 0;
  const start = new Date(task.timerStartedAt);
  const secs = Math.max(0, Math.round((Date.now() - start.getTime()) / 1000));
  task.timeSpent = (task.timeSpent || 0) + secs;
  task.timerStartedAt = null;
  if (secs > 0)
    await TimeLog.create({
      user: task.user,
      task: task._id,
      start,
      seconds: secs,
    });
  if (secs >= 60) addLog(task, "timer", `Tracked ${fmtDur(secs)}`);
  return secs;
}

const int = (v, min, max, msg) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(msg);
  return n;
};

function checkRepeat(repeat, days) {
  if (repeat === "custom" && !(days && days.length))
    throw bad("Pick at least one day for a custom repeat.");
}

function clean(body, partial = false) {
  const out = {};
  if (body.title !== undefined || !partial) {
    const t = (body.title || "").trim();
    if (!t) throw bad("Title is required.");
    out.title = t.slice(0, 120);
  }
  if (body.description !== undefined)
    out.description = String(body.description).trim().slice(0, 600);
  if (body.notes !== undefined) out.notes = String(body.notes).slice(0, 5000);
  if (body.status !== undefined) {
    if (!STATUS.includes(body.status)) throw bad("Invalid status.");
    out.status = body.status;
  }
  if (body.priority !== undefined) {
    if (!PRIORITY.includes(body.priority)) throw bad("Invalid priority.");
    out.priority = body.priority;
  }
  if (body.dueDate !== undefined) {
    if (!body.dueDate) out.dueDate = null;
    else {
      const d = new Date(body.dueDate);
      if (isNaN(d)) throw bad("Invalid due date.");
      out.dueDate = d;
    }
  }
  if (body.dueTime !== undefined) {
    const v = String(body.dueTime || "");
    if (v && !/^([01]\d|2[0-3]):[0-5]\d$/.test(v))
      throw bad("Invalid due time.");
    out.dueTime = v;
  }
  if (body.estimateMinutes !== undefined)
    out.estimateMinutes =
      body.estimateMinutes === "" || body.estimateMinutes === null
        ? 0
        : int(
            body.estimateMinutes,
            0,
            6000,
            "Estimate must be between 0 and 6000 minutes.",
          );
  if (body.remindBefore !== undefined)
    out.remindBefore = int(body.remindBefore, -1, 10080, "Invalid reminder.");
  if (body.repeat !== undefined) {
    if (!REPEAT.includes(body.repeat)) throw bad("Invalid repeat option.");
    out.repeat = body.repeat;
  }
  if (body.repeatDays !== undefined) {
    if (!Array.isArray(body.repeatDays)) throw bad("Invalid repeat days.");
    out.repeatDays = [
      ...new Set(
        body.repeatDays
          .map(Number)
          .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6),
      ),
    ];
  }
  if (body.subtasks !== undefined) {
    if (!Array.isArray(body.subtasks) || body.subtasks.length > 30)
      throw bad("A checklist can have up to 30 steps.");
    out.subtasks = body.subtasks
      .map((s) => ({
        title: String((s && s.title) || "")
          .trim()
          .slice(0, 100),
        done: !!(s && s.done),
      }))
      .filter((s) => s.title);
  }
  return out;
}

const validId = (req, res, next) =>
  mongoose.isValidObjectId(req.params.id)
    ? next()
    : res.status(400).json({ message: "Invalid task id." });
const mine = (req, extra = {}) => ({
  _id: req.params.id,
  user: req.user._id,
  ...extra,
});

// When a recurring task is completed, create the next occurrence once.
async function spawnNext(task) {
  const due = nextDue(task);
  if (!due) return null;
  const copy = await Task.create({
    user: task.user,
    title: task.title,
    description: task.description,
    priority: task.priority,
    status: "todo",
    dueDate: due,
    dueTime: task.dueTime,
    remindBefore: task.remindBefore,
    estimateMinutes: task.estimateMinutes,
    repeat: task.repeat,
    repeatDays: task.repeatDays,
    subtasks: (task.subtasks || []).map((s) => ({
      title: s.title,
      done: false,
    })),
    activity: [
      { type: "created", text: "Created by repeat schedule", at: new Date() },
    ],
  });
  task.repeatSpawned = true;
  addLog(task, "repeat", `Next repeat scheduled for ${dayKey(due)}`);
  await task.save();
  return copy;
}

/* ---------- stats ---------- */
router.get("/stats", async (req, res, next) => {
  try {
    const tasks = await Task.find({ user: req.user._id, deletedAt: null })
      .select("-activity -notes")
      .lean();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const stats = {
      total: tasks.length,
      todo: 0,
      progress: 0,
      done: 0,
      overdue: 0,
      high: 0,
    };
    tasks.forEach((t) => {
      stats[t.status]++;
      if (t.status !== "done" && t.dueDate && new Date(t.dueDate) < today)
        stats.overdue++;
      if (t.status !== "done" && t.priority === "high") stats.high++;
    });
    stats.completion = stats.total
      ? Math.round((stats.done / stats.total) * 100)
      : 0;

    const week = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const next = new Date(d);
      next.setDate(next.getDate() + 1);
      week.push({
        label: d.toLocaleDateString("en-US", { weekday: "short" }),
        completed: tasks.filter(
          (t) =>
            t.completedAt &&
            new Date(t.completedAt) >= d &&
            new Date(t.completedAt) < next,
        ).length,
        created: tasks.filter(
          (t) => new Date(t.createdAt) >= d && new Date(t.createdAt) < next,
        ).length,
      });
    }
    res.json({ stats, week });
  } catch (err) {
    next(err);
  }
});

/* ---------- trash ---------- */
router.get("/trash", async (req, res, next) => {
  try {
    const tasks = await Task.find({
      user: req.user._id,
      deletedAt: { $ne: null },
    })
      .select("-activity")
      .sort({ deletedAt: -1 });
    res.json({ tasks });
  } catch (err) {
    next(err);
  }
});

router.delete("/trash", async (req, res, next) => {
  try {
    const r = await Task.deleteMany({
      user: req.user._id,
      deletedAt: { $ne: null },
    });
    res.json({ message: "Trash emptied.", count: r.deletedCount });
  } catch (err) {
    next(err);
  }
});

/* ---------- list / create / read one ---------- */
router.get("/", async (req, res, next) => {
  try {
    const f = { user: req.user._id, deletedAt: null };
    if (STATUS.includes(req.query.status)) f.status = req.query.status;
    if (PRIORITY.includes(req.query.priority)) f.priority = req.query.priority;
    if (req.query.q)
      f.title = new RegExp(escapeRx(String(req.query.q).slice(0, 60)), "i");
    const tasks = await Task.find(f)
      .select("-activity")
      .sort({ createdAt: -1 });
    res.json({ tasks, serverTime: new Date() });
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const data = clean(req.body);
    checkRepeat(data.repeat, data.repeatDays);
    if (data.status === "done") data.completedAt = new Date();
    const task = new Task({ ...data, user: req.user._id });
    addLog(task, "created", "Task created");
    await task.save();
    res.status(201).json({ task });
  } catch (err) {
    next(err);
  }
});

router.get("/:id", validId, async (req, res, next) => {
  try {
    const task = await Task.findOne(mine(req));
    if (!task) return res.status(404).json({ message: "Task not found." });
    res.json({ task, serverTime: new Date() });
  } catch (err) {
    next(err);
  }
});

/* ---------- timer & focus ---------- */
router.post("/:id/start", validId, async (req, res, next) => {
  try {
    const task = await Task.findOne(mine(req, { deletedAt: null }));
    if (!task) return res.status(404).json({ message: "Task not found." });

    if (!task.timerStartedAt) {
      const others = await Task.find({
        user: req.user._id,
        timerStartedAt: { $ne: null },
        _id: { $ne: task._id },
      });
      for (const o of others) {
        await stopTimer(o);
        await o.save();
      }
      task.timerStartedAt = new Date();
      addLog(task, "timer", "Started working");
    }
    if (task.status !== "progress") {
      task.status = "progress";
      task.completedAt = null;
    }
    await task.save();
    res.json({ task, serverTime: new Date() });
  } catch (err) {
    next(err);
  }
});

router.post("/:id/pause", validId, async (req, res, next) => {
  try {
    const task = await Task.findOne(mine(req, { deletedAt: null }));
    if (!task) return res.status(404).json({ message: "Task not found." });
    await stopTimer(task);
    await task.save();
    res.json({ task, serverTime: new Date() });
  } catch (err) {
    next(err);
  }
});

router.post("/:id/reset-timer", validId, async (req, res, next) => {
  try {
    const task = await Task.findOne(mine(req, { deletedAt: null }));
    if (!task) return res.status(404).json({ message: "Task not found." });
    task.timeSpent = 0;
    task.timerStartedAt = null;
    addLog(task, "timer", "Timer reset");
    await task.save();
    res.json({ task, serverTime: new Date() });
  } catch (err) {
    next(err);
  }
});

// A finished focus (pomodoro) session
router.post("/:id/pomodoro", validId, async (req, res, next) => {
  try {
    const task = await Task.findOne(mine(req, { deletedAt: null }));
    if (!task) return res.status(404).json({ message: "Task not found." });
    task.pomodoros = (task.pomodoros || 0) + 1;
    addLog(task, "focus", `Finished focus session #${task.pomodoros} 🍅`);
    await task.save();
    res.json({ task, serverTime: new Date() });
  } catch (err) {
    next(err);
  }
});

/* ---------- update ---------- */
router.put("/:id", validId, async (req, res, next) => {
  try {
    const task = await Task.findOne(mine(req, { deletedAt: null }));
    if (!task) return res.status(404).json({ message: "Task not found." });
    const data = clean(req.body, true);
    checkRepeat(
      data.repeat !== undefined ? data.repeat : task.repeat,
      data.repeatDays !== undefined ? data.repeatDays : task.repeatDays,
    );

    const changed = [];
    if (data.title !== undefined && data.title !== task.title)
      changed.push("title");
    if (data.priority !== undefined && data.priority !== task.priority)
      changed.push(`priority → ${data.priority}`);
    if (
      data.dueDate !== undefined &&
      dayKey(data.dueDate) !== dayKey(task.dueDate)
    )
      changed.push("due date");
    if (data.description !== undefined && data.description !== task.description)
      changed.push("description");
    if (data.notes !== undefined && data.notes !== task.notes)
      changed.push("notes");
    if (
      data.estimateMinutes !== undefined &&
      data.estimateMinutes !== task.estimateMinutes
    )
      changed.push("estimate");
    if (data.repeat !== undefined && data.repeat !== task.repeat)
      changed.push("repeat");

    if (data.status && data.status !== task.status) {
      data.completedAt = data.status === "done" ? new Date() : null;
      if (data.status === "done" || data.status === "todo")
        await stopTimer(task);
      addLog(
        task,
        data.status === "done" ? "done" : "status",
        data.status === "done"
          ? "Completed this task"
          : `Moved to ${LABEL[data.status]}`,
      );
    }
    if (changed.length) addLog(task, "edit", `Updated ${changed.join(", ")}`);

    Object.assign(task, data);
    await task.save();

    let spawned = null;
    if (task.status === "done" && task.repeat !== "none" && !task.repeatSpawned)
      spawned = await spawnNext(task);
    res.json({ task, spawned, serverTime: new Date() });
  } catch (err) {
    next(err);
  }
});

/* ---------- delete / restore ---------- */
router.delete("/:id", validId, async (req, res, next) => {
  try {
    const task = await Task.findOne(mine(req, { deletedAt: null }));
    if (!task) return res.status(404).json({ message: "Task not found." });
    await stopTimer(task);
    addLog(task, "trash", "Moved to trash");
    task.deletedAt = new Date();
    await task.save();
    res.json({ message: "Moved to trash.", task });
  } catch (err) {
    next(err);
  }
});

router.post("/:id/restore", validId, async (req, res, next) => {
  try {
    const task = await Task.findOne(mine(req, { deletedAt: { $ne: null } }));
    if (!task)
      return res.status(404).json({ message: "Task not found in trash." });
    task.deletedAt = null;
    addLog(task, "restore", "Restored from trash");
    await task.save();
    res.json({ task, serverTime: new Date() });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id/permanent", validId, async (req, res, next) => {
  try {
    const task = await Task.findOneAndDelete(
      mine(req, { deletedAt: { $ne: null } }),
    );
    if (!task)
      return res.status(404).json({ message: "Task not found in trash." });
    res.json({ message: "Deleted forever." });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
