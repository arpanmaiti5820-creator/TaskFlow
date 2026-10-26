require("dotenv").config();
const path = require("path");
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const connectDB = require("./config/db");

// ---- Validate environment ----
const missing = ["MONGODB_URI", "JWT_SECRET"].filter(
  (k) => !process.env[k] || process.env[k].startsWith("PASTE_"),
);
if (missing.length) {
  console.error(
    `\n❌ Missing values in .env: ${missing.join(", ")}\n   Open the .env file and fill them in, then restart.\n`,
  );
  process.exit(1);
}

const app = express();
app.set("trust proxy", 1);

app.use(
  helmet({
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" }, // needed for Google popup
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "https://accounts.google.com"],
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://fonts.googleapis.com",
          "https://accounts.google.com",
        ],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "https://accounts.google.com"],
        frameSrc: ["'self'", "https://accounts.google.com"],
      },
    },
  }),
);
app.use(cors({ origin: process.env.CLIENT_URL || true, credentials: true }));
app.use(express.json({ limit: "10mb" }));
if (process.env.NODE_ENV !== "production") app.use(morgan("dev"));

// ---- API ----
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many attempts. Please try again in a few minutes." },
});

app.get("/api/config", (req, res) => {
  const id = process.env.GOOGLE_CLIENT_ID;
  res.json({ googleClientId: id && !id.startsWith("PASTE_") ? id : "" });
});
app.get("/api/health", (req, res) =>
  res.json({ ok: true, time: new Date().toISOString() }),
);
app.use("/api/auth", authLimiter, require("./routes/auth"));
app.use("/api/tasks", require("./routes/tasks"));
app.use("/api/insights", require("./routes/insights"));
app.use("/api/data", require("./routes/data"));
app.use("/api", (req, res) =>
  res.status(404).json({ message: "API route not found." }),
);

// ---- Frontend ----
app.use(express.static(path.join(__dirname, "public")));
app.use((req, res) =>
  res.status(404).sendFile(path.join(__dirname, "public", "index.html")),
);

// ---- Errors ----
app.use((err, req, res, next) => {
  if (err.code === 11000)
    return res.status(409).json({ message: "Duplicate value." });
  if (err.name === "ValidationError")
    return res
      .status(400)
      .json({ message: Object.values(err.errors)[0].message });
  if (err.type === "entity.parse.failed")
    return res.status(400).json({ message: "Invalid JSON body." });
  const status = err.status || 500;
  if (status === 500) console.error(err);
  res
    .status(status)
    .json({
      message: status === 500 ? "Server error. Please try again." : err.message,
    });
});

const PORT = process.env.PORT || 5000;
connectDB()
  .then(() =>
    app.listen(PORT, () =>
      console.log(`🚀 TaskFlow running → http://localhost:${PORT}`),
    ),
  )
  .catch((err) => {
    console.error("❌ MongoDB connection failed:", err.message);
    process.exit(1);
  });
