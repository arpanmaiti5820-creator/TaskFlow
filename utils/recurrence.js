// Works out the next due date (stored as UTC midnight) for a recurring task.
function nextDue(task, now = new Date()) {
  const todayUTC = new Date(
    Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()),
  );
  let d = task.dueDate ? new Date(task.dueDate) : new Date(todayUTC);
  if (d < todayUTC) d = new Date(todayUTC); // completed late → count from today
  d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

  switch (task.repeat) {
    case "daily":
      d.setUTCDate(d.getUTCDate() + 1);
      break;
    case "weekdays":
      do {
        d.setUTCDate(d.getUTCDate() + 1);
      } while ([0, 6].includes(d.getUTCDay()));
      break;
    case "weekly":
      d.setUTCDate(d.getUTCDate() + 7);
      break;
    case "monthly": {
      const day = d.getUTCDate();
      d.setUTCDate(1);
      d.setUTCMonth(d.getUTCMonth() + 1);
      const last = new Date(
        Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
      ).getUTCDate();
      d.setUTCDate(Math.min(day, last));
      break;
    }
    case "custom": {
      const days =
        task.repeatDays && task.repeatDays.length
          ? task.repeatDays
          : [d.getUTCDay()];
      for (let i = 0; i < 8; i++) {
        d.setUTCDate(d.getUTCDate() + 1);
        if (days.includes(d.getUTCDay())) break;
      }
      break;
    }
    default:
      return null;
  }
  return d;
}

module.exports = { nextDue };
