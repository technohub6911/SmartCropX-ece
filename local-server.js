// local-server.js - UPDATED VERSION
const express = require('express');
const cors = require('cors');
const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

app.use(cors({
    origin: ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:5500'],
    credentials: true
}));
// In-memory storage
let soilData = [];
let irrigationSettings = {};
// Add a test endpoint to verify server is working
app.get('/api/test', (req, res) => {
    res.json({ 
        success: true, 
        message: 'Server is running!',
        timestamp: new Date().toISOString()
    });
});
// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: '🌱 SmartXCrop Farm Server is running!',
    endpoints: {
      'POST /api/soil-data': 'Receive ESP32 sensor data',
      'GET /api/soil-data/:userId': 'Get soil data for user',
      'POST /api/auto-irrigation': 'Update irrigation settings',
      'GET /api/soil-data-debug': 'Debug all data'
    }
  });
});

// ESP32 data endpoint
app.post('/api/soil-data', (req, res) => {
  console.log('📡 Received ESP32 data:', JSON.stringify(req.body));
  
  try {
    const { deviceId, soilMoisture, userId, autoIrrigation } = req.body;
    
    const data = {
      deviceId: deviceId || 'esp32_farm_001',
      soilMoisture: soilMoisture || 0,
      temperature: 25,
      humidity: 50,
      autoIrrigation: autoIrrigation || false,
      sensorSlot: 1,
      userId: userId || 'user_001',
      timestamp: new Date().toISOString(),
      id: Date.now()
    };
    
    soilData.unshift(data);
    
    // Keep only last 100 records
    if (soilData.length > 100) {
      soilData = soilData.slice(0, 100);
    }
    
    console.log('✅ Data saved. Total records:', soilData.length);
    
    // Check irrigation
    const shouldIrrigate = soilMoisture < (irrigationSettings.threshold || 30);
    
    res.json({
      success: true,
      irrigationCommand: shouldIrrigate && autoIrrigation,
      autoIrrigation: autoIrrigation || false,
      message: `Data received. Soil: ${soilMoisture}%`,
      serverTime: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error:', error);
    res.json({
      success: false,
      irrigationCommand: false,
      autoIrrigation: false,
      error: 'Server error'
    });
  }
});

// Get soil data
app.get('/api/soil-data/:userId', (req, res) => {
    const { userId } = req.params;
    const { hours = 24 } = req.query;
    
    console.log(`📊 Fetching soil data for user: ${userId}, hours: ${hours}`);
    
    const timeAgo = new Date(Date.now() - hours * 60 * 60 * 1000);
    
    const userData = soilData.filter(data => {
        const matchesUser = data.userId === userId || data.deviceId.includes(userId);
        const matchesTime = new Date(data.timestamp) >= timeAgo;
        return matchesUser && matchesTime;
    }).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    
    console.log(`📈 Found ${userData.length} records for user ${userId}`);
    
    res.json({ 
        success: true, 
        data: userData,
        count: userData.length
    });
});
// Update irrigation
app.post('/api/auto-irrigation', (req, res) => {
  irrigationSettings = { ...req.body, lastUpdated: new Date().toISOString() };
  console.log('💧 Irrigation settings:', irrigationSettings);
  
  res.json({ success: true, settings: irrigationSettings });
});

// Debug endpoint
app.get('/api/soil-data-debug', (req, res) => {
  res.json({
    soilData: soilData,
    irrigationSettings: irrigationSettings,
    totalRecords: soilData.length
  });
});

// Serve static files
app.use(express.static('.'));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🌱 SMARTXCROP FARM SERVER STARTED`);
  console.log(`📍 Local: http://localhost:${PORT}`);
  console.log(`📡 Network: http://YOUR_IP:${PORT}`);
  console.log(`\n📋 Available Endpoints:`);
  console.log(`   POST /api/soil-data     - ESP32 sensor data`);
  console.log(`   GET  /api/soil-data/:userId - Get user data`);
  console.log(`   POST /api/auto-irrigation - Control irrigation`);
  console.log(`   GET  /api/soil-data-debug - Debug info`);
  console.log(`\n🚀 Server is ready for ESP32 connections!\n`);
});