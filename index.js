require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");
const store = require("./store");

const app = express();
app.use(cors());
app.use(express.json());

// Сам сайт (index.html, каталог, корзина и т.д.) лежит в папке public/
// и отдаётся с того же адреса, что и API — так у магазина одна ссылка.
app.use(express.static(path.join(__dirname, "public")));

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
