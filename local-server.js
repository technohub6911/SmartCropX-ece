// local-server.js - No database required
const express = require('express');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Simple in-memory storage (no database needed)
let soilData = [];
let irrigationSettings = {};

// Serve static files (your web app)
app.use(express.static('.'));

// Root endpoint
app.get('/', (req, res) => {
    res.json({ 
        message: '🌱 SmartXCrop Farm Server is running!',
        endpoints: {
            soilData: 'POST /api/soil-data',
            getData: 'GET /api/soil-data/:userId',
            irrigation: 'POST /api/auto-irrigation'
        }
    });
});

// ESP32 data endpoint
app.post('/api/soil-data', (req, res) => {
    console.log('📡 Received soil data:', req.body);
    
    const data = {
        ...req.body,
        id: Date.now(),
        timestamp: new Date().toISOString()
    };
    
    soilData.push(data);
    
    // Keep only last 100 records
    if (soilData.length > 100) {
        soilData = soilData.slice(-100);
    }
    
    // Check if irrigation is needed
    const shouldIrrigate = checkIrrigationNeed(data.soilMoisture, irrigationSettings.autoIrrigation);
    
    res.json({
        success: true,
        irrigationCommand: shouldIrrigate,
        autoIrrigation: irrigationSettings.autoIrrigation || false,
        message: 'Data received successfully'
    });
});

// Get soil data for user
app.get('/api/soil-data/:userId', (req, res) => {
    const { userId } = req.params;
    const { hours = 24 } = req.query;
    
    const timeAgo = new Date(Date.now() - hours * 60 * 60 * 1000);
    
    const userData = soilData.filter(data => 
        data.deviceId && data.deviceId.includes(userId) &&
        new Date(data.timestamp) >= timeAgo
    ).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    
    res.json({ 
        success: true, 
        data: userData,
        count: userData.length
    });
});

// Update irrigation settings
app.post('/api/auto-irrigation', (req, res) => {
    const { userId, enabled, threshold } = req.body;
    
    irrigationSettings = {
        userId,
        autoIrrigation: enabled,
        threshold: threshold || 30,
        lastUpdated: new Date().toISOString()
    };
    
    console.log('💧 Irrigation settings updated:', irrigationSettings);
    res.json({ success: true, settings: irrigationSettings });
});

// Get irrigation settings
app.get('/api/irrigation-settings/:userId', (req, res) => {
    res.json({ success: true, settings: irrigationSettings });
});

// Health check endpoint for Render
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        dataCount: soilData.length,
        activeSettings: irrigationSettings
    });
});

// Check irrigation need
function checkIrrigationNeed(soilMoisture, autoIrrigation) {
    if (!autoIrrigation) return false;
    
    const threshold = irrigationSettings.threshold || 30;
    
    if (soilMoisture < threshold) {
        console.log('🚰 Irrigation needed! Soil moisture:', soilMoisture, 'Threshold:', threshold);
        return true;
    }
    
    return false;
}

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌱 SmartXCrop Farm Server running on port ${PORT}`);
    console.log(`📡 ESP32 can send data to this server`);
    console.log(`🌐 Web app: http://localhost:${PORT}`);
});