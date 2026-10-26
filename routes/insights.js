const express = require("express");
const Task = require("../models/Task");
const TimeLog = require("../models/TimeLog");
const protect = require("../middleware/auth");

const router = express.Router();
router.use(protect);

const pad = (n) => String(n).padStart(2, "0");
const lk = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const RANGE = 84; // 12 weeks for the heatmap

// GET /api/insights  → focus stats, goals progress, streaks, heatmap
router.get("/", async (req, res, next) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const since = new Date(today);
    since.setDate(since.getDate() - (RANGE - 1));

    const [tasks, logs] = await Promise.all([
      Task.find({ user: req.user._id, deletedAt: null })
        .select("-activity -notes")
        .lean(),
      TimeLog.find({ user: req.user._id, start: { $gte: since } }).lean(),
    ]);

    const map = new Map();
    const days = [];
    for (let i = 0; i < RANGE; i++) {
      const d = new Date(since);
      d.setDate(since.getDate() + i);
      const o = { date: lk(d), dow: d.getDay(), tasks: 0, minutes: 0 };
      map.set(o.date, o);
      days.push(o);
    }
    tasks.forEach((t) => {
      if (t.completedAt) {
        const o = map.get(lk(new Date(t.completedAt)));
        if (o) o.tasks++;
      }
    });
    logs.forEach((l) => {
      const o = map.get(lk(new Date(l.start)));
      if (o) o.minutes += l.seconds / 60;
    });
    days.forEach((o) => {
      o.minutes = Math.round(o.minutes);
    });

    const week = days
      .slice(-7)
      .map((o) => ({ ...o, label: DAYS[o.dow].slice(0, 3) }));
    const weekMinutes = week.reduce((n, d) => n + d.minutes, 0);
    const weekTasks = week.reduce((n, d) => n + d.tasks, 0);

    // averages
    const timed = tasks.filter((t) => t.timeSpent > 0);
    const avgSeconds = timed.length
      ? Math.round(timed.reduce((n, t) => n + t.timeSpent, 0) / timed.length)
      : 0;

    // most productive weekday
    const byDow = Array.from({ length: 7 }, () => ({ minutes: 0, tasks: 0 }));
    days.forEach((o) => {
      byDow[o.dow].minutes += o.minutes;
      byDow[o.dow].tasks += o.tasks;
    });
    let best = -1,
      bestVal = 0;
    byDow.forEach((v, i) => {
      const score = v.minutes || 0;
      if (score > bestVal) {
        bestVal = score;
        best = i;
      }
    });
    if (best < 0)
      byDow.forEach((v, i) => {
        if (v.tasks > bestVal) {
          bestVal = v.tasks;
          best = i;
        }
      });
    const mostProductiveDay = best >= 0 ? DAYS[best] : null;

    // estimated vs actual
    const est = tasks
      .filter((t) => t.estimateMinutes > 0 && t.timeSpent > 0)
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
      .slice(0, 6)
      .map((t) => ({
        id: t._id,
        title: t.title,
        estimate: t.estimateMinutes,
        actual: Math.round(t.timeSpent / 60),
      }));
    const sumEst = est.reduce((n, t) => n + t.estimate, 0),
      sumAct = est.reduce((n, t) => n + t.actual, 0);
    const accuracy = sumEst ? Math.round((sumAct / sumEst) * 100) : null;

    // streaks (a day counts if a task was completed or time was tracked)
    const active = (o) => o.tasks > 0 || o.minutes > 0;
    let current = 0,
      i = days.length - 1;
    if (!active(days[i])) i--;
    while (i >= 0 && active(days[i])) {
      current++;
      i--;
    }
    let longest = 0,
      run = 0;
    days.forEach((o) => {
      run = active(o) ? run + 1 : 0;
      if (run > longest) longest = run;
    });

    const goals = {
      weeklyTasks: (req.user.goals && req.user.goals.weeklyTasks) || 10,
      weeklyFocusMinutes:
        (req.user.goals && req.user.goals.weeklyFocusMinutes) || 300,
    };

    res.json({
      week,
      days,
      goals,
      totals: {
        weekMinutes,
        weekTasks,
        avgSeconds,
        mostProductiveDay,
        accuracy,
        pomodoros: tasks.reduce((n, t) => n + (t.pomodoros || 0), 0),
      },
      estVsActual: est,
      streak: { current, longest },
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/insights/goals { weeklyTasks, weeklyFocusMinutes }
router.put("/goals", async (req, res, next) => {
  try {
    const t = Number(req.body.weeklyTasks),
      m = Number(req.body.weeklyFocusMinutes);
    if (!Number.isInteger(t) || t < 1 || t > 1000)
      return res
        .status(400)
        .json({ message: "Weekly task goal must be 1–1000." });
    if (!Number.isInteger(m) || m < 10 || m > 10000)
      return res
        .status(400)
        .json({ message: "Weekly focus goal must be 10–10000 minutes." });
    req.user.goals = { weeklyTasks: t, weeklyFocusMinutes: m };
    await req.user.save();
    res.json({ goals: req.user.goals });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
