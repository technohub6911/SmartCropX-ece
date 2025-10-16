// routes/products.js
const express = require('express');
const router = express.Router();

// Mock products data for now
let products = [];

// Get all products
router.get('/products', (req, res) => {
  res.json({ success: true, data: products });
});

// Add new product
router.post('/products', (req, res) => {
  const { title, description, pricePerKg, category, stock, seller } = req.body;
  
  const newProduct = {
    id: 'prod_' + Date.now(),
    title,
    description,
    pricePerKg,
    category,
    stock,
    seller,
    createdAt: new Date().toISOString()
  };
  
  products.push(newProduct);
  res.json({ success: true, data: newProduct });
});

module.exports = router;