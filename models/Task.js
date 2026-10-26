const mongoose = require("mongoose");
const { Schema } = mongoose;

const subSchema = new Schema({
  title: { type: String, required: true, trim: true, maxlength: 100 },
  done: { type: Boolean, default: false },
});

const actSchema = new Schema(
  {
    type: { type: String, default: "info" },
    text: { type: String, maxlength: 200 },
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

const taskSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 600, default: "" },
    notes: { type: String, maxlength: 5000, default: "" },
    status: {
      type: String,
      enum: ["todo", "progress", "done"],
      default: "todo",
    },
    priority: {
      type: String,
      enum: ["low", "medium", "high"],
      default: "medium",
    },

    // ---- Dates & reminders ----
    dueDate: { type: Date, default: null },
    dueTime: { type: String, default: "" }, // "HH:MM" (optional)
    remindBefore: { type: Number, default: -1 }, // minutes before due, -1 = no reminder
    completedAt: { type: Date, default: null },

    // ---- Recurring ----
    repeat: {
      type: String,
      enum: ["none", "daily", "weekdays", "weekly", "monthly", "custom"],
      default: "none",
    },
    repeatDays: { type: [Number], default: [] }, // 0=Sun … 6=Sat (for "custom")
    repeatSpawned: { type: Boolean, default: false },

    // ---- Checklist & history ----
    subtasks: { type: [subSchema], default: [] },
    activity: { type: [actSchema], default: [] },

    // ---- Timer / focus ----
    estimateMinutes: { type: Number, default: 0 },
    timeSpent: { type: Number, default: 0 }, // seconds
    timerStartedAt: { type: Date, default: null },
    pomodoros: { type: Number, default: 0 },

    // ---- Trash (soft delete) ----
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// Trashed tasks are removed automatically after 30 days
taskSchema.index({ deletedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

module.exports = mongoose.model("Task", taskSchema);
