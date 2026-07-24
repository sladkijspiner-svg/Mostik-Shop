require("dotenv").config();
const express = require("express");
const cors = require("cors");
const store = require("./store");

const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("MINIFIG STORE API работает. Список товаров: /api/products");
});

app.get("/api/products", (req, res) => {
  res.json(store.loadProducts());
});

app.get("/api/products/:id", (req, res) => {
  const product = store.findProduct(req.params.id);
  if (!product) return res.status(404).json({ error: "not_found" });
  res.json(product);
});

app.get("/api/categories", (req, res) => {
  res.json(store.getCategories());
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("API запущено на порту " + PORT);
});

// Бот запускается в этом же процессе, чтобы не поднимать второй сервис.
require("./bot");
