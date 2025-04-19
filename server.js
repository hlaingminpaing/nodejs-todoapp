const express = require("express");
const path = require("path");

const app = express();
const PORT = 3000;

// Middleware to parse form data
app.use(express.urlencoded({ extended: true }));

// Serve static files (CSS)
app.use(express.static(path.join(__dirname, "public")));

// Set EJS as the templating engine
app.set("view engine", "ejs");

// In-memory todos list
let todos = [];

// Routes

// Render the main page with the todos
app.get("/", (req, res) => {
  res.render("index", { todos });
});

// Add a new todo
app.post("/add", (req, res) => {
  const { task } = req.body;

  if (task) {
    todos.push({ id: todos.length + 1, task, completed: false });
  }

  res.redirect("/");
});

// Mark a todo as completed
app.post("/toggle/:id", (req, res) => {
  const { id } = req.params;

  const todo = todos.find((t) => t.id === parseInt(id));
  if (todo) {
    todo.completed = !todo.completed;
  }

  res.redirect("/");
});

// Delete a todo
app.post("/delete/:id", (req, res) => {
  const { id } = req.params;

  todos = todos.filter((t) => t.id !== parseInt(id));

  res.redirect("/");
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
