const express = require("express");
const path = require("path");
const os = require("os");
const fs = require("fs");
const { Pool } = require("pg");

const PORT = Number(process.env.PORT) || 3000;

// ---------------------------------------------------------------------------
// Database (PostgreSQL: local container or Amazon RDS)
//
// Settings come from environment variables only - never hard-code passwords.
//   DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD
//   DB_SSL = disable      local Docker Compose (no TLS)
//            require      encrypted, server certificate NOT checked
//            verify-full  encrypted + certificate checked against DB_SSL_CA (use on RDS)
//   DB_SSL_CA  path of the CA bundle (the Docker image contains the Amazon RDS bundle)
// ---------------------------------------------------------------------------
function sslOptions() {
  const mode = (process.env.DB_SSL || "disable").toLowerCase();
  if (mode === "disable") return false;
  if (mode === "require") return { rejectUnauthorized: false };
  if (mode === "verify-full") {
    const caFile = process.env.DB_SSL_CA || path.join(__dirname, "certs", "rds-global-bundle.pem");
    return { rejectUnauthorized: true, ca: fs.readFileSync(caFile, "utf8") };
  }
  throw new Error(`DB_SSL must be disable, require or verify-full (got "${mode}")`);
}

for (const name of ["DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME"]) {
  if (!process.env[name]) {
    console.error(`Missing environment variable ${name}`);
    process.exit(1);
  }
}

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: sslOptions(),
  max: Number(process.env.DB_POOL_MAX) || 5, // connections per task
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
});
// A broken idle connection (DB restart, failover) must not crash the app.
pool.on("error", (err) => console.error("Idle database connection error:", err.message));

// Creates the table on first start (idempotent). Fine for a small app; bigger apps
// use a migration tool instead.
async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS todos (
      id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      task       TEXT        NOT NULL CHECK (char_length(task) BETWEEN 1 AND 500),
      completed  BOOLEAN     NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
}

// The database may still be starting (docker compose, RDS reboot): retry a few times.
async function waitForDatabase(attempts = 10) {
  for (let i = 1; i <= attempts; i++) {
    try {
      const { rows } = await pool.query("SELECT current_database() AS db, version() AS version");
      console.log(`Connected to PostgreSQL database "${rows[0].db}" (${rows[0].version.split(",")[0]})`);
      return;
    } catch (err) {
      if (i === attempts) throw err;
      console.warn(`Database not reachable (attempt ${i}/${attempts}): ${err.message} - retrying in 3s`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

// ---------------------------------------------------------------------------
// Web app
// ---------------------------------------------------------------------------
const app = express();

// Middleware to parse form data
app.use(express.urlencoded({ extended: true }));

// Serve static files (CSS)
app.use(express.static(path.join(__dirname, "public")));

// Set EJS as the templating engine
app.set("view engine", "ejs");

// Express 4 does not catch errors of async handlers: pass them to the error handler.
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const parseId = (value) => (/^\d+$/.test(value) ? value : null);

// Health check for the load balancer / ECS: 200 only if the database answers.
app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", database: "up", host: os.hostname() });
  } catch (err) {
    res.status(503).json({ status: "error", database: "down" });
  }
});

// Render the main page with the todos
app.get("/", wrap(async (req, res) => {
  const { rows } = await pool.query("SELECT id, task, completed FROM todos ORDER BY id");
  res.render("index", { todos: rows, hostname: os.hostname() });
}));

// Add a new todo
app.post("/add", wrap(async (req, res) => {
  const task = (req.body.task || "").trim();
  if (task) {
    // $1 = parameter: the value is sent separately from the SQL (no SQL injection)
    await pool.query("INSERT INTO todos (task) VALUES ($1)", [task.slice(0, 500)]);
  }
  res.redirect("/");
}));

// Mark a todo as completed / not completed
app.post("/toggle/:id", wrap(async (req, res) => {
  const id = parseId(req.params.id);
  if (id) await pool.query("UPDATE todos SET completed = NOT completed WHERE id = $1", [id]);
  res.redirect("/");
}));

// Delete a todo
app.post("/delete/:id", wrap(async (req, res) => {
  const id = parseId(req.params.id);
  if (id) await pool.query("DELETE FROM todos WHERE id = $1", [id]);
  res.redirect("/");
}));

// Error handler: log the details, show the user a short message.
app.use((err, req, res, next) => {
  console.error(`${req.method} ${req.originalUrl} failed:`, err.message);
  res.status(500).send("Something went wrong. Please try again.");
});

// ---------------------------------------------------------------------------
// Start + graceful shutdown (ECS sends SIGTERM before stopping a task)
// ---------------------------------------------------------------------------
async function start() {
  await waitForDatabase();
  await initDatabase();
  const server = app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });

  const shutdown = (signal) => {
    console.log(`${signal} received: closing HTTP server and database pool`);
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref(); // never hang forever
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

start().catch((err) => {
  console.error("Startup failed:", err.message);
  process.exit(1);
});
