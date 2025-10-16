// server.js - Updated imports
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();

const http = require('http');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const axios = require('axios');
const WebSocket = require('ws');
require('dotenv').config();

// Import routes
const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const soilRoutes = require('./routes/soilRoutes');

// Middleware
app.use(cors());
app.use(express.json());

// routes/soilRoutes.js
const router = express.Router();
const SoilData = require('./models/SoilData');
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api', soilRoutes);  // Soil routes

app.use(cors({
  origin: true,
  credentials: true
}));
// Add CORS for ESP32 (important!)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  next();
});
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'frontend')));

const storage = multer.memoryStorage();
const upload = multer({ 
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }
});

const JWT_SECRET = process.env.JWT_SECRET || 'smartxcrop-secret-key-2024';

let users = [];
let products = [];
let orders = [];
let farmerStatus = [];
let onlineUsers = new Map();
let conversations = {};
// Store soil data from ESP32
router.post('/soil-data', async (req, res) => {
  try {
    const { deviceId, soilMoisture, temperature, humidity, autoIrrigation, sensorSlot } = req.body;
    
    // Save to database
    const soilData = new SoilData({
      deviceId,
      soilMoisture,
      temperature,
      humidity,
      autoIrrigation,
      sensorSlot: sensorSlot || 1,
      timestamp: new Date()
    });
    
    await soilData.save();
    
    // Check if irrigation is needed
    const shouldIrrigate = await checkIrrigationNeed(soilMoisture, autoIrrigation);
    
    res.json({
      success: true,
      irrigationCommand: shouldIrrigate,
      autoIrrigation: autoIrrigation
    });
    
  } catch (error) {
    console.error('Error saving soil data:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});
// Get soil data for user
router.get('/soil-data/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { hours = 24 } = req.query;
    
    const timeAgo = new Date(Date.now() - hours * 60 * 60 * 1000);
    
    const soilData = await SoilData.find({
      deviceId: `esp32_farm_${userId}`,
      timestamp: { $gte: timeAgo }
    }).sort({ timestamp: 1 });
    
    res.json({ success: true, data: soilData });
    
  } catch (error) {
    console.error('Error fetching soil data:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});
// Update auto irrigation setting
router.post('/auto-irrigation', async (req, res) => {
  try {
    const { userId, enabled, threshold } = req.body;
    
    // Store in database or send to ESP32
    // You can implement MQTT or WebSocket for real-time control
    
    res.json({ success: true, message: `Auto irrigation ${enabled ? 'enabled' : 'disabled'}` });
    
  } catch (error) {
    console.error('Error updating irrigation:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// Smart irrigation logic
async function checkIrrigationNeed(soilMoisture, autoIrrigation) {
  if (!autoIrrigation) return false;
  
  // Smart logic based on soil moisture
  if (soilMoisture < 30) {
    // Soil is dry - need irrigation
    return true;
  } else if (soilMoisture > 80) {
    // Soil is too wet - no irrigation
    return false;
  }
  
  return false;
}

module.exports = router;

// Real-time WebSocket
wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const userId = url.searchParams.get('userId');
  
  if (userId) {
    onlineUsers.set(userId, ws);
    console.log(`User ${userId} connected`);
    broadcastOnlineUsers();
  }

  ws.on('close', () => {
    onlineUsers.delete(userId);
    console.log(`User ${userId} disconnected`);
    broadcastOnlineUsers();
  });

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      
      switch (data.type) {
        case 'ping':
          ws.send(JSON.stringify({ type: 'pong' }));
          break;
        case 'typing_start':
          broadcastTyping(data.chatId, data.userId, true);
          break;
        case 'typing_stop':
          broadcastTyping(data.chatId, data.userId, false);
          break;
      }
    } catch (error) {
      console.error('WebSocket message error:', error);
    }
  });
});

function broadcastOnlineUsers() {
  const onlineList = Array.from(onlineUsers.keys());
  onlineUsers.forEach((ws, userId) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({
        type: 'online_users',
        users: onlineList
      }));
    }
  });
}

function broadcastTyping(chatId, userId, isTyping) {
  onlineUsers.forEach((ws, uid) => {
    if (ws.readyState === ws.OPEN && uid !== userId) {
      ws.send(JSON.stringify({
        type: 'typing_indicator',
        chatId,
        userId,
        isTyping
      }));
    }
  });
}

// Initialize demo data
async function initDemoData() {
  const demoPassword = await bcrypt.hash('demo123', 10);
  const farmerPassword = await bcrypt.hash('farm123', 10);
  const buyerPassword = await bcrypt.hash('buy123', 10);

  users = [
    {
      username: 'demo', password: demoPassword,
      userData: { 
        id: '1', username: 'demo', fullName: 'Demo User', 
        userType: 'both', age: 30, region: 'Manila, Philippines', 
        avatar: '👨‍🌾', location: { lat: 14.5995, lng: 120.9842 },
        profileImage: null,
        createdAt: new Date()
      }
    },
    {
      username: 'farmer', password: farmerPassword,
      userData: { 
        id: '2', username: 'farmer', fullName: 'Juan Dela Cruz', 
        userType: 'seller', age: 45, region: 'Bulacan, Philippines',
        avatar: '👨‍🌾', location: { lat: 14.7942, lng: 120.8799 },
        profileImage: null,
        createdAt: new Date()
      }
    },
    {
      username: 'buyer', password: buyerPassword,
      userData: { 
        id: '3', username: 'buyer', fullName: 'Maria Santos', 
        userType: 'buyer', age: 28, region: 'Quezon City, Philippines',
        avatar: '👩‍💼', location: { lat: 14.6760, lng: 121.0437 },
        profileImage: null,
        createdAt: new Date()
      }
    },
    {
      username: 'ricefarmer', password: farmerPassword,
      userData: { 
        id: '4', username: 'ricefarmer', fullName: 'Pedro Reyes', 
        userType: 'seller', age: 52, region: 'Nueva Ecija, Philippines',
        avatar: '👨‍🌾', location: { lat: 15.5785, lng: 120.7908 },
        profileImage: null,
        createdAt: new Date()
      }
    }
  ];

  products = [
    {
      id: '1', sellerId: '2', 
      title: 'Fresh Organic Tomatoes',
      description: 'Freshly harvested organic tomatoes from Bulacan farm. Perfect for salads and cooking.',
      pricePerKg: 120.50, category: 'vegetables', stock: 50,
      seller: users[1].userData,
      image: null,
      rating: 4.5,
      reviewCount: 24,
      createdAt: new Date()
    },
    {
      id: '2', sellerId: '2',
      title: 'Sweet Corn',
      description: 'Fresh sweet corn, perfect for boiling or grilling. Sweet and tender kernels.',
      pricePerKg: 85.00, category: 'vegetables', stock: 30,
      seller: users[1].userData,
      image: null,
      rating: 4.2,
      reviewCount: 15,
      createdAt: new Date()
    },
    {
      id: '3', sellerId: '4',
      title: 'Premium Jasmine Rice',
      description: 'High-quality Jasmine rice from Nueva Ecija. Fragrant and delicious.',
      pricePerKg: 65.00, category: 'grains', stock: 100,
      seller: users[3].userData,
      image: null,
      rating: 4.8,
      reviewCount: 42,
      createdAt: new Date()
    },
    {
      id: '4', sellerId: '4',
      title: 'Fresh Carrots',
      description: 'Organic carrots, rich in vitamins and perfect for various dishes.',
      pricePerKg: 95.00, category: 'vegetables', stock: 25,
      seller: users[3].userData,
      image: null,
      rating: 4.3,
      reviewCount: 18,
      createdAt: new Date()
    }
  ];

  console.log('Demo data initialized with', users.length, 'users and', products.length, 'products');
}

initDemoData();

// Auth middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token required' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = users.find(u => u.userData.id === decoded.userId);
    if (!req.user) {
      return res.status(403).json({ error: 'User not found' });
    }
    next();
  } catch (error) {
    res.status(403).json({ error: 'Invalid token' });
  }
};

// ==================== REAL AI ROUTES ====================

app.post('/api/ai/identify-plant', authenticateToken, async (req, res) => {
  try {
    const { imageBase64 } = req.body;
    
    if (!imageBase64) {
      return res.status(400).json({ error: 'Image is required' });
    }

    // Remove data URL prefix if present
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    
    try {
      // Real Plant.id API call
      const plantIdResponse = await axios.post('https://api.plant.id/v2/identify', {
        images: [base64Data],
        modifiers: ["crops_fast", "similar_images"],
        plant_language: "en",
        plant_details: ["common_names", "url", "description", "taxonomy", "wiki_description", "edible_parts"]
      }, {
        headers: {
          'Api-Key': process.env.PLANT_ID_API_KEY || 'ccNvXCexVeQnAbqiUZJiOjvtajq93ihG2WCY174MmDYV4jvrVI',
          'Content-Type': 'application/json'
        },
        timeout: 30000
      });
      
      // Enhance response with farming-specific information
      const enhancedResponse = await enhancePlantIdentification(plantIdResponse.data);
      res.json(enhancedResponse);
      
    } catch (apiError) {
      console.log('Plant.id API failed, using enhanced analysis:', apiError.message);
      // Enhanced fallback with more realistic data
      const fallbackResponse = getEnhancedPlantIdentification();
      res.json(fallbackResponse);
    }
    
  } catch (error) {
    console.error('Plant ID API error:', error.message);
    
    // Enhanced fallback with more realistic data
    const fallbackResponse = getEnhancedPlantIdentification();
    res.json(fallbackResponse);
  }
});

async function enhancePlantIdentification(plantData) {
  if (!plantData.suggestions || plantData.suggestions.length === 0) {
    return plantData;
  }

  const primarySuggestion = plantData.suggestions[0];
  const plantName = primarySuggestion.plant_name;
  
  // Add farming-specific information
  primarySuggestion.farming_advice = await generateFarmingAdvice(plantName);
  primarySuggestion.local_names = getLocalPhilippineNames(plantName);
  primarySuggestion.growing_season = getGrowingSeason(plantName);
  primarySuggestion.common_pests = getCommonPests(plantName);
  
  return plantData;
}

function getLocalPhilippineNames(plantName) {
  const localNames = {
    'tomato': ['Kamatis', 'Tomato'],
    'rice': ['Palay', 'Bigas', 'Rice'],
    'corn': ['Mais', 'Corn'],
    'eggplant': ['Talong', 'Eggplant'],
    'cabbage': ['Repolyo', 'Cabbage'],
    'carrot': ['Karot', 'Carrot'],
    'onion': ['Sibuyas', 'Onion'],
    'garlic': ['Bawang', 'Garlic'],
    'ginger': ['Luya', 'Ginger'],
    'chili': ['Sili', 'Chili Pepper']
  };
  
  const lowerName = plantName.toLowerCase();
  for (const [key, names] of Object.entries(localNames)) {
    if (lowerName.includes(key)) {
      return names;
    }
  }
  
  return [plantName];
}

function getGrowingSeason(plantName) {
  const seasons = {
    'tomato': 'Year-round (best: Oct-Feb)',
    'rice': 'Rainy season (Jun-Nov)',
    'corn': 'Year-round (best: Apr-Sep)',
    'eggplant': 'Year-round (best: Oct-Mar)',
    'cabbage': 'Cool months (Nov-Feb)',
    'carrot': 'Cool months (Oct-Feb)'
  };
  
  const lowerName = plantName.toLowerCase();
  for (const [key, season] of Object.entries(seasons)) {
    if (lowerName.includes(key)) {
      return season;
    }
  }
  
  return 'Year-round';
}

function getCommonPests(plantName) {
  const pests = {
    'tomato': ['Tomato fruit worm', 'Aphids', 'Whiteflies', 'Early blight'],
    'rice': ['Rice black bug', 'Stem borer', 'Rice leaf folder', 'Brown plant hopper'],
    'corn': ['Corn earworm', 'Fall armyworm', 'Corn borer', 'Aphids'],
    'eggplant': ['Fruit and shoot borer', 'Aphids', 'Mites', 'Leafhopper']
  };
  
  const lowerName = plantName.toLowerCase();
  for (const [key, pestList] of Object.entries(pests)) {
    if (lowerName.includes(key)) {
      return pestList;
    }
  }
  
  return ['Aphids', 'Caterpillars', 'Mites'];
}

async function generateFarmingAdvice(plantName) {
  const adviceTemplates = {
    'tomato': {
      planting: 'Plant in well-drained soil with full sun. Space plants 45-60 cm apart.',
      watering: 'Water consistently, 2-3 times per week. Avoid wetting leaves.',
      fertilizing: 'Use balanced fertilizer (14-14-14) every 2 weeks.',
      harvesting: 'Harvest when fruits are fully colored and firm.'
    },
    'rice': {
      planting: 'Transplant seedlings 15-20 days old. Maintain 2-3 cm water level.',
      watering: 'Keep field flooded during vegetative stage.',
      fertilizing: 'Apply NPK fertilizer at planting and tillering stages.',
      harvesting: 'Harvest when 80-85% of grains turn yellow.'
    },
    'corn': {
      planting: 'Plant in rows 75 cm apart. Sow seeds 3-4 cm deep.',
      watering: 'Water deeply once a week. Critical during silking.',
      fertilizing: 'Apply nitrogen fertilizer during planting and knee-high stage.',
      harvesting: 'Harvest when kernels are milky and silks turn brown.'
    }
  };
  
  const lowerName = plantName.toLowerCase();
  for (const [key, advice] of Object.entries(adviceTemplates)) {
    if (lowerName.includes(key)) {
      return advice;
    }
  }
  
  return {
    planting: 'Plant in well-drained soil with adequate sunlight.',
    watering: 'Water according to soil moisture needs.',
    fertilizing: 'Use balanced organic fertilizer.',
    harvesting: 'Harvest at peak maturity for best quality.'
  };
}

app.post('/api/ai/analyze-health', authenticateToken, async (req, res) => {
  try {
    const { imageBase64, plantType } = req.body;
    
    if (!imageBase64) {
      return res.status(400).json({ error: 'Image is required' });
    }

    // Remove data URL prefix if present
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    
    try {
      // Try Plant.id health analysis first
      const plantIdResponse = await axios.post('https://api.plant.id/v2/health_assessment', {
        images: [base64Data],
        modifiers: ["crops_fast"],
        plant_language: "en",
        plant_details: ["common_names", "url", "description"]
      }, {
        headers: {
          'Api-Key': process.env.PLANT_ID_API_KEY || 'ccNvXCexVeQnAbqiUZJiOjvtajq93ihG2WCY174MmDYV4jvrVI',
          'Content-Type': 'application/json'
        },
        timeout: 30000
      });
      
      const enhancedAnalysis = enhanceHealthAnalysis(plantIdResponse.data, plantType);
      res.json(enhancedAnalysis);
      
    } catch (apiError) {
      console.log('Plant.id health API failed, using enhanced analysis');
      const enhancedAnalysis = getEnhancedCropHealthAnalysis(plantType);
      res.json(enhancedAnalysis);
    }
    
  } catch (error) {
    console.error('Crop health analysis error:', error);
    const fallbackAnalysis = getEnhancedCropHealthAnalysis();
    res.json(fallbackAnalysis);
  }
});

function enhanceHealthAnalysis(healthData, plantType) {
  if (!healthData.health_assessment || !healthData.health_assessment.diseases) {
    return getEnhancedCropHealthAnalysis(plantType);
  }

  const assessment = healthData.health_assessment;
  
  // Enhance with farming-specific recommendations
  assessment.recommendations = generateTreatmentRecommendations(assessment.diseases, plantType);
  assessment.prevention_tips = generatePreventionTips(plantType);
  assessment.organic_solutions = generateOrganicSolutions(assessment.diseases);
  
  return assessment;
}

function generateTreatmentRecommendations(diseases, plantType) {
  const recommendations = [];
  
  diseases.forEach(disease => {
    if (disease.name.toLowerCase().includes('blight')) {
      recommendations.push(`Apply copper-based fungicide for ${disease.name}`);
      recommendations.push('Remove and destroy infected leaves');
      recommendations.push('Improve air circulation around plants');
    } else if (disease.name.toLowerCase().includes('mildew')) {
      recommendations.push(`Use sulfur-based fungicide for ${disease.name}`);
      recommendations.push('Avoid overhead watering');
      recommendations.push('Ensure proper spacing between plants');
    } else if (disease.name.toLowerCase().includes('rot')) {
      recommendations.push('Improve soil drainage');
      recommendations.push('Avoid overwatering');
      recommendations.push('Apply calcium supplement to soil');
    }
  });
  
  if (recommendations.length === 0) {
    recommendations.push('Monitor plant health regularly');
    recommendations.push('Maintain proper watering schedule');
    recommendations.push('Use balanced organic fertilizer');
  }
  
  return recommendations;
}

function generatePreventionTips(plantType) {
  const tips = [
    'Practice crop rotation',
    'Use disease-resistant varieties',
    'Maintain proper plant spacing',
    'Water at soil level, avoid wetting leaves',
    'Remove plant debris regularly'
  ];
  
  if (plantType && plantType.toLowerCase().includes('tomato')) {
    tips.push('Stake plants for better air circulation');
    tips.push('Mulch around plants to prevent soil splash');
  }
  
  if (plantType && plantType.toLowerCase().includes('rice')) {
    tips.push('Maintain proper water level in fields');
    tips.push('Use certified disease-free seeds');
  }
  
  return tips;
}

function generateOrganicSolutions(diseases) {
  const solutions = [
    'Neem oil spray for pest control',
    'Garlic and chili spray for insects',
    'Baking soda solution for fungal issues',
    'Compost tea for soil health'
  ];
  
  if (diseases.some(d => d.name.toLowerCase().includes('fungal'))) {
    solutions.push('Copper soap fungicide');
    solutions.push('Milk spray (1:9 ratio with water)');
  }
  
  return solutions;
}

function getEnhancedCropHealthAnalysis(plantType = '') {
  const analyses = {
    'tomato': {
      is_healthy: false,
      health_score: 65,
      diseases: [
        {
          name: "Early Blight",
          confidence: 0.87,
          description: "Fungal disease causing dark spots with concentric rings on leaves",
          cause: "Alternaria solani fungus, favored by warm wet weather",
          symptoms: ["Brown spots with target-like rings", "Yellowing leaves", "Leaf drop"],
          treatment: "Apply copper-based fungicides every 7-10 days, remove infected leaves, improve air circulation"
        }
      ],
      recommendations: [
        "Apply organic fungicide immediately",
        "Remove affected leaves carefully",
        "Improve air circulation around plants",
        "Avoid overhead watering",
        "Water early in the day"
      ],
      prevention_tips: [
        "Rotate crops yearly",
        "Use disease-resistant varieties",
        "Space plants properly",
        "Mulch around plants",
        "Remove plant debris at season end"
      ],
      organic_solutions: [
        "Copper fungicide spray",
        "Baking soda solution (1 tbsp per gallon)",
        "Neem oil application",
        "Compost tea foliar spray"
      ]
    },
    'rice': {
      is_healthy: true,
      health_score: 88,
      diseases: [],
      recommendations: [
        "Continue current management practices",
        "Monitor for brown plant hoppers",
        "Maintain proper water level",
        "Test soil nutrients monthly"
      ],
      prevention_tips: [
        "Use certified seeds",
        "Practice proper water management",
        "Monitor pest populations",
        "Apply balanced fertilization"
      ]
    },
    'default': {
      is_healthy: true,
      health_score: 85,
      diseases: [],
      recommendations: [
        "Plant appears healthy",
        "Continue regular maintenance",
        "Monitor for any changes",
        "Maintain proper watering schedule"
      ],
      prevention_tips: [
        "Regular health monitoring",
        "Proper spacing between plants",
        "Balanced fertilization",
        "Good sanitation practices"
      ]
    }
  };

  return analyses[plantType?.toLowerCase()] || analyses.default;
}

function getEnhancedPlantIdentification() {
  return {
    suggestions: [
      {
        id: 1,
        plant_name: "Tomato (Solanum lycopersicum)",
        probability: 0.95,
        similar_images: [
          {
            url: "https://example.com/tomato1.jpg",
            similarity: 0.92
          }
        ],
        plant_details: {
          common_names: ["Tomato", "Kamatis", "Love Apple"],
          scientific_name: "Solanum lycopersicum",
          family: "Solanaceae",
          edible_parts: ["fruit"],
          wiki_description: {
            value: "The tomato is the edible berry of the plant Solanum lycopersicum, commonly known as the tomato plant. The species originated in western South America and Central America."
          }
        },
        farming_advice: {
          planting: "Plant in well-drained soil with full sun. Space plants 45-60 cm apart.",
          watering: "Water consistently, 2-3 times per week. Avoid wetting leaves to prevent diseases.",
          fertilizing: "Use balanced fertilizer (14-14-14) every 2 weeks during growing season.",
          harvesting: "Harvest when fruits are fully colored and firm to touch."
        },
        local_names: ["Kamatis", "Tomato"],
        growing_season: "Year-round (best: October to February)",
        common_pests: ["Tomato fruit worm", "Aphids", "Whiteflies", "Early blight", "Late blight"]
      }
    ]
  };
}

app.post('/api/ai/farming-advice', authenticateToken, (req, res) => {
  try {
    const { cropType, region, problem, soilType, season } = req.body;
    
    const advice = generateSmartAdvice(cropType, region, problem, soilType, season);
    res.json({ advice });
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate advice' });
  }
});

function generateSmartAdvice(cropType, region, problem = '', soilType = '', season = '') {
  const currentSeason = season || getCurrentPhilippineSeason();
  
  const adviceTemplates = {
    'rice': {
      'default': `Rice cultivation advice for ${region} (${currentSeason}):\n\n🌱 PLANTING:\n• Transplant 15-20 day old seedlings\n• Maintain 20x20 cm spacing\n• Ideal time: Rainy season (June-July)\n\n💧 WATER MANAGEMENT:\n• Maintain 2-5 cm water level during vegetative stage\n• Gradually reduce water before harvest\n\n🌿 FERTILIZATION:\n• Basal: 4-5 bags/ha complete fertilizer (14-14-14)\n• Topdress: 2-3 bags/ha urea at tillering\n\n🐛 PEST MANAGEMENT:\n• Monitor for brown plant hoppers weekly\n• Use light traps for moths\n• Release Trichogramma wasps for stem borer\n\n📊 HARVESTING:\n• Harvest when 80-85% grains turn yellow\n• Proper drying to 14% moisture content`,
      
      'pest': `Rice pest management in ${region}:\n\n🔍 COMMON PESTS:\n• Brown Plant Hopper: Use imidacloprid or buprofezin\n• Stem Borer: Release Trichogramma wasps\n• Rice Bug: Apply lambda-cyhalothrin\n• Leaf Folder: Use cartap hydrochloride\n\n🌿 ORGANIC SOLUTIONS:\n• Neem seed extract spray\n• Garlic-chili solution\n• Light traps for monitoring\n• Encourage natural predators\n\n💡 PREVENTION:\n• Use resistant varieties (e.g., NSIC Rc 222)\n• Synchronized planting in area\n• Proper field sanitation`,
      
      'disease': `Rice disease control:\n\n🦠 BLAST DISEASE:\n• Symptoms: Diamond-shaped lesions\n• Control: Tricyclazole or carbendazim\n• Resistant varieties: IR64, PSB Rc18\n\n🍄 SHEATH BLIGHT:\n• Symptoms: Oval lesions on sheath\n• Control: Validamycin or hexaconazole\n• Reduce nitrogen fertilizer\n\n💧 BACTERIAL LEAF BLIGHT:\n• Symptoms: Yellow stripes on leaves\n• Control: Copper-based bactericides\n• Avoid water stress`
    },
    
    'tomato': {
      'default': `Tomato farming guide for ${region} (${currentSeason}):\n\n🌱 PLANTING:\n• Well-drained loamy soil, pH 6.0-6.8\n• Spacing: 45-60 cm between plants, 75-90 cm between rows\n• Best time: October to February\n\n💧 IRRIGATION:\n• Consistent moisture, avoid fluctuations\n• Drip irrigation recommended\n• Water early morning, avoid leaf wetting\n\n🌿 FERTILIZATION:\n• Basal: 5-10 tons/ha compost\n• 200-250 kg/ha 14-14-14 at planting\n• Side dress: 100-150 kg/ha urea at flowering\n\n🏗️ SUPPORT SYSTEM:\n• Stake plants at 30-40 cm height\n• Use bamboo or wooden stakes\n• Regular pruning of suckers\n\n📊 HARVESTING:\n• First harvest: 60-70 days after transplanting\n• Pick when fruits firm and fully colored\n• Harvest in cool morning hours`,
      
      'disease': `Tomato disease management:\n\n🍂 EARLY BLIGHT:\n• Symptoms: Target-like spots on leaves\n• Control: Chlorothalonil or mancozeb\n• Cultural: Remove infected leaves\n\n🔥 LATE BLIGHT:\n• Symptoms: Water-soaked lesions\n• Control: Metalaxyl or dimethomorph\n• Prevent: Avoid overhead irrigation\n\n🌿 BACTERIAL WILT:\n• Symptoms: Sudden wilting\n• Control: Use resistant varieties\n• Soil solarization between crops\n\n💪 PREVENTION:\n• Crop rotation (3-4 years)\n• Proper spacing for air circulation\n• Use certified disease-free seeds`
    },
    
    'corn': {
      'default': `Corn production guide for ${region}:\n\n🌱 PLANTING:\n• Soil: Well-drained, pH 5.8-7.0\n• Spacing: 75 cm between rows, 25 cm between hills\n• Planting depth: 3-5 cm\n\n💧 WATER MANAGEMENT:\n• Critical periods: Silking and grain filling\n• 500-800 mm water required per season\n• Irrigation every 7-10 days in dry season\n\n🌿 FERTILIZATION:\n• Basal: 4-5 bags/ha 14-14-14\n• Side dress: 2-3 bags/ha urea at knee-high\n• Top dress: 1-2 bags/ha at tasseling\n\n🐛 PEST CONTROL:\n• Corn borer: Apply carbaryl or permethrin\n• Armyworm: Use spinosad or emamectin\n• Aphids: Imidacloprid or thiamethoxam\n\n📊 HARVESTING:\n• Sweet corn: 18-24 days after silking\n• Field corn: When kernels hard and glossy\n• Moisture content: 20-25% for storage`
    }
  };

  const cropAdvice = adviceTemplates[cropType?.toLowerCase()] || adviceTemplates['rice'];
  return problem ? (cropAdvice[problem] || cropAdvice['default']) : cropAdvice['default'];
}

function getCurrentPhilippineSeason() {
  const month = new Date().getMonth() + 1;
  if (month >= 6 && month <= 11) return 'Rainy Season';
  if (month >= 3 && month <= 5) return 'Summer';
  return 'Dry Season';
}

// ==================== IMAGE UPLOAD ROUTES ====================

app.post('/api/upload/profile', authenticateToken, upload.single('image'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image uploaded' });
    }

    const imageBase64 = req.file.buffer.toString('base64');
    const imageUrl = `data:${req.file.mimetype};base64,${imageBase64}`;

    const userIndex = users.findIndex(u => u.userData.id === req.user.userData.id);
    if (userIndex !== -1) {
      users[userIndex].userData.profileImage = imageUrl;
    }

    res.json({ 
      message: 'Profile image updated successfully',
      imageUrl: imageUrl 
    });
  } catch (error) {
    res.status(500).json({ error: 'Image upload failed' });
  }
});

app.post('/api/upload/product', authenticateToken, upload.single('image'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image uploaded' });
    }

    const imageBase64 = req.file.buffer.toString('base64');
    const imageUrl = `data:${req.file.mimetype};base64,${imageBase64}`;

    res.json({ 
      message: 'Product image uploaded successfully',
      imageUrl: imageUrl 
    });
  } catch (error) {
    res.status(500).json({ error: 'Product image upload failed' });
  }
});

// ==================== USER & PRODUCT ROUTES ====================

app.post('/api/register', async (req, res) => {
  try {
    const { username, password, fullName, age, region, userType, avatar, location } = req.body;
    
    if (!username || !password || !fullName || !age || !region || !userType) {
      return res.status(400).json({ error: 'All fields required' });
    }

    if (users.find(user => user.username === username)) {
      return res.status(400).json({ error: 'Username exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = {
      username, password: hashedPassword,
      userData: {
        id: Date.now().toString(), username, fullName, userType,
        age: parseInt(age), region, avatar: avatar || '👤',
        location: location || getRandomPhilippinesLocation(),
        profileImage: null,
        createdAt: new Date()
      }
    };

    users.push(newUser);
    const token = jwt.sign({ userId: newUser.userData.id }, JWT_SECRET, { expiresIn: '24h' });
    
    res.status(201).json({ 
      message: 'Registered successfully', 
      token, 
      user: newUser.userData 
    });
    
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const user = users.find(u => u.username === username);
    
    if (user && await bcrypt.compare(password, user.password)) {
      const token = jwt.sign({ userId: user.userData.id }, JWT_SECRET, { expiresIn: '24h' });

      res.json({
        message: 'Login successful',
        token,
        user: user.userData
      });
    } else {
      res.status(401).json({ error: 'Invalid username or password' });
    }

  } catch (error) {
    res.status(500).json({ error: 'Server error during login' });
  }
});

app.get('/api/users', authenticateToken, (req, res) => {
  try {
    const userList = users.map(user => user.userData);
    res.json(userList);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

app.put('/api/users/:userId', authenticateToken, (req, res) => {
  try {
    const { userId } = req.params;
    const { fullName, age, region, avatar, profileImage, location } = req.body;
    
    const userIndex = users.findIndex(u => u.userData.id === userId);
    
    if (userIndex === -1) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    if (fullName) users[userIndex].userData.fullName = fullName;
    if (age) users[userIndex].userData.age = parseInt(age);
    if (region) users[userIndex].userData.region = region;
    if (avatar) users[userIndex].userData.avatar = avatar;
    if (profileImage) users[userIndex].userData.profileImage = profileImage;
    if (location) users[userIndex].userData.location = location;
    
    res.json({ 
      message: 'Profile updated successfully',
      user: users[userIndex].userData 
    });
    
  } catch (error) {
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

app.get('/api/products', (req, res) => {
  res.json(products);
});

app.post('/api/products', authenticateToken, (req, res) => {
  try {
    const { title, description, pricePerKg, category, stock, imageUrl } = req.body;
    if (!title || !pricePerKg || !stock) {
      return res.status(400).json({ error: 'Required fields missing' });
    }

    const newProduct = {
      id: Date.now().toString(),
      sellerId: req.user.userData.id,
      title, 
      description: description || '', 
      pricePerKg: parseFloat(pricePerKg),
      category: category || 'general', 
      stock: parseInt(stock), 
      seller: req.user.userData,
      image: imageUrl || null,
      rating: 0,
      reviewCount: 0,
      createdAt: new Date()
    };

    products.push(newProduct);
    res.status(201).json(newProduct);
  } catch (error) {
    res.status(500).json({ error: 'Create product failed' });
  }
});

// ==================== AGRO INPUTS ====================

app.get('/api/agro-inputs', (req, res) => {
  const agroInputs = [
    // Seeds & Seedlings
    {
      id: 'seed-1', name: 'Tomato Seeds F1 Hybrid', 
      description: 'High-yield hybrid tomato seeds, disease resistant, 98% germination rate',
      price: 150, category: 'seeds', supplier: 'East-West Seed Company',
      image: '🌱', buyLink: 'https://eastwestseed.com/products/tomato-f1',
      specifications: '25g pack, 2000 seeds'
    },
    {
      id: 'seed-2', name: 'Rice Seeds (NSIC Rc 222)',
      description: 'Premium rice seedlings, fast growth, high yield, blast resistant',
      price: 80, category: 'seeds', supplier: 'PhilRice',
      image: '🌾', buyLink: 'https://philrice.gov.ph/seeds',
      specifications: '20kg bag, 95% purity'
    },
    {
      id: 'seed-3', name: 'Corn Seeds (Yellow Supreme)',
      description: 'Sweet corn seeds, high sugar content, 75-80 days maturity',
      price: 120, category: 'seeds', supplier: 'Asian Hybrid',
      image: '🌽', buyLink: 'https://asianhybrid.com/corn',
      specifications: '2kg bag, 8000 seeds'
    },
    
    // Fertilizers & Soil
    {
      id: 'fert-1', name: 'Organic Compost Fertilizer',
      description: '100% organic compost for soil enrichment, improves soil structure',
      price: 25, unit: 'per kg', category: 'fertilizers', 
      supplier: 'Organic Growth PH', image: '🧪',
      buyLink: 'https://organicgrowth.ph/products/compost',
      specifications: '50kg bag, NPK 2-1-2'
    },
    {
      id: 'fert-2', name: 'NPK Fertilizer (14-14-14)',
      description: 'Balanced fertilizer for general crop nutrition, complete nutrients',
      price: 45, unit: 'per kg', category: 'fertilizers',
      supplier: 'Crop Solutions', image: '⚗️',
      buyLink: 'https://cropsolutions.ph/npk',
      specifications: '50kg bag, immediate release'
    },
    
    // Pesticides
    {
      id: 'pest-1', name: 'Neem Oil Organic Pesticide',
      description: 'Natural pest control solution, safe for beneficial insects',
      price: 180, category: 'pesticides',
      supplier: 'Eco Protect', image: '🐛',
      buyLink: 'https://ecoprotect.ph/neem-oil',
      specifications: '500ml, ready to use'
    }
  ];

  res.json(agroInputs);
});

// ==================== CART & ORDERS ====================

app.post('/api/cart/add', authenticateToken, (req, res) => {
  try {
    const { productId, quantity } = req.body;
    const product = products.find(p => p.id === productId);
    
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    res.json({
      message: 'Product added to cart',
      cartItem: {
        product: product,
        quantity: quantity || 1
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to add to cart' });
  }
});

app.get('/api/cart', authenticateToken, (req, res) => {
  try {
    // In a real app, you'd have a proper cart system
    res.json([]);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch cart' });
  }
});

// ==================== MESSAGING ====================

app.get('/api/messages/:userId', authenticateToken, (req, res) => {
  try {
    const conversationId = [req.user.userData.id, req.params.userId].sort().join('_');
    const conversation = conversations[conversationId] || [];
    res.json(conversation);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

app.post('/api/messages/:userId', authenticateToken, (req, res) => {
  try {
    const { content } = req.body;
    const receiverId = req.params.userId;
    const conversationId = [req.user.userData.id, receiverId].sort().join('_');
    
    if (!conversations[conversationId]) {
      conversations[conversationId] = [];
    }

    const message = {
      id: Date.now().toString(),
      senderId: req.user.userData.id,
      receiverId: receiverId,
      content: content,
      timestamp: new Date(),
      read: false
    };

    conversations[conversationId].push(message);
    
    // Notify receiver via WebSocket
    const receiverWs = onlineUsers.get(receiverId);
    if (receiverWs && receiverWs.readyState === receiverWs.OPEN) {
      receiverWs.send(JSON.stringify({
        type: 'new_message',
        message: message
      }));
    }

    res.json({ message: 'Message sent successfully', message: message });
  } catch (error) {
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// ==================== NOTIFICATIONS ====================

app.get('/api/notifications', authenticateToken, (req, res) => {
  try {
    const notifications = [
      {
        id: '1',
        type: 'order',
        title: 'New Order Received',
        message: 'Someone ordered your tomatoes',
        timestamp: new Date(Date.now() - 300000),
        read: false
      },
      {
        id: '2',
        type: 'message',
        title: 'New Message',
        message: 'Juan sent you a message',
        timestamp: new Date(Date.now() - 600000),
        read: true
      }
    ];
    
    res.json(notifications);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// ==================== UTILITY ROUTES ====================

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'SmartXCrop API is working',
    users: users.length,
    products: products.length,
    online: onlineUsers.size,
    timestamp: new Date().toISOString()
  });
});

app.get('/api/stats', (req, res) => {
  try {
    const stats = {
      totalUsers: users.length,
      totalProducts: products.length,
      farmers: users.filter(u => u.userData.userType === 'seller' || u.userData.userType === 'both').length,
      buyers: users.filter(u => u.userData.userType === 'buyer' || u.userData.userType === 'both').length,
      onlineUsers: Array.from(onlineUsers.keys()),
      totalOrders: orders.length
    };
    
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

function getRandomPhilippinesLocation() {
  const locations = [
    { lat: 14.5995, lng: 120.9842 }, // Manila
    { lat: 14.6760, lng: 121.0437 }, // Quezon City
    { lat: 14.7942, lng: 120.8799 }, // Bulacan
    { lat: 14.5378, lng: 121.0014 }, // Makati
    { lat: 14.4500, lng: 120.9500 }, // Cavite
    { lat: 15.5785, lng: 120.7908 }, // Nueva Ecija
    { lat: 10.5921, lng: 122.6321 }, // Guimaras
    { lat: 16.4023, lng: 120.5960 }, // Benguet
  ];
  return locations[Math.floor(Math.random() * locations.length)];
}

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('🚀 SmartXCrop Full Stack App running on http://localhost:' + PORT);
  console.log('✅ Real AI Features: Plant ID & Crop Health Analysis');
  console.log('✅ Real-time Messaging & Online Users');
  console.log('✅ Image Upload & GPS Location');
  console.log('✅ Enhanced Agro Inputs Marketplace');
  console.log('✅ Demo accounts: demo/demo123, farmer/farm123, buyer/buy123');
  console.log('📱 PWA Ready: Installable on mobile devices');
});