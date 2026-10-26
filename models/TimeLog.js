const mongoose = require("mongoose");

// One row per finished timer session – powers the insights, goals and streaks.
const timeLogSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    task: { type: mongoose.Schema.Types.ObjectId, ref: "Task", default: null },
    start: { type: Date, required: true },
    seconds: { type: Number, required: true, min: 0 },
  },
  { timestamps: false },
);
timeLogSchema.index({ user: 1, start: -1 });

module.exports = mongoose.model("TimeLog", timeLogSchema);
