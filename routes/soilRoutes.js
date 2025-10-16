// routes/soilRoutes.js
const express = require('express');
const router = express.Router();

// Use in-memory storage if MongoDB is not set up
let soilDataStorage = [];
let irrigationSettings = {};

// Store soil data from ESP32
router.post('/soil-data', async (req, res) => {
  try {
    const { deviceId, userId, soilMoisture, temperature, humidity, autoIrrigation, sensorSlot } = req.body;
    
    console.log('📡 Received soil data:', {
      deviceId, userId, soilMoisture, temperature, humidity, autoIrrigation, sensorSlot
    });

    // Create soil data object
    const soilData = {
      id: Date.now().toString(),
      deviceId: deviceId || 'esp32_farm_001',
      userId: userId || 'user_001',
      soilMoisture: soilMoisture || 0,
      temperature: temperature || 25,
      humidity: humidity || 50,
      autoIrrigation: autoIrrigation || false,
      sensorSlot: sensorSlot || 1,
      timestamp: new Date()
    };

    // Store in memory
    soilDataStorage.push(soilData);
    
    // Keep only last 100 records
    if (soilDataStorage.length > 100) {
      soilDataStorage = soilDataStorage.slice(-100);
    }

    console.log('✅ Soil data saved. Total records:', soilDataStorage.length);

    // Check if irrigation is needed
    const shouldIrrigate = checkIrrigationNeed(soilData.soilMoisture, soilData.autoIrrigation);
    
    if (shouldIrrigate) {
      console.log('🚰 Irrigation command sent to ESP32');
    }

    res.json({
      success: true,
      irrigationCommand: shouldIrrigate,
      autoIrrigation: soilData.autoIrrigation,
      message: 'Data received successfully'
    });

  } catch (error) {
    console.error('❌ Error saving soil data:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// Get soil data for user
router.get('/soil-data/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { hours = 24 } = req.query;
    
    console.log(`📡 Fetching soil data for user: ${userId}, hours: ${hours}`);

    const timeAgo = new Date(Date.now() - hours * 60 * 60 * 1000);
    
    // Filter data for this user and time range
    const userData = soilDataStorage.filter(data => 
      data.userId === userId && 
      new Date(data.timestamp) >= timeAgo
    ).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    console.log(`✅ Found ${userData.length} records for user ${userId}`);

    res.json({ 
      success: true, 
      data: userData,
      message: `Retrieved ${userData.length} records`
    });

  } catch (error) {
    console.error('❌ Error fetching soil data:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch soil data' });
  }
});

// Update auto irrigation setting
router.post('/auto-irrigation', async (req, res) => {
  try {
    const { userId, enabled, threshold } = req.body;
    
    console.log('💧 Updating irrigation settings:', { userId, enabled, threshold });

    // Store settings
    irrigationSettings[userId] = {
      autoIrrigation: enabled,
      threshold: threshold || 30,
      lastUpdated: new Date()
    };

    res.json({ 
      success: true, 
      message: `Auto irrigation ${enabled ? 'enabled' : 'disabled'}`,
      settings: irrigationSettings[userId]
    });

  } catch (error) {
    console.error('❌ Error updating irrigation:', error);
    res.status(500).json({ success: false, error: 'Failed to update irrigation settings' });
  }
});

// Get irrigation settings
router.get('/irrigation-settings/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    const settings = irrigationSettings[userId] || {
      autoIrrigation: false,
      threshold: 30,
      lastUpdated: new Date()
    };

    res.json({ success: true, settings });

  } catch (error) {
    console.error('❌ Error fetching irrigation settings:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch settings' });
  }
});

// Smart irrigation logic
function checkIrrigationNeed(soilMoisture, autoIrrigation) {
  if (!autoIrrigation) {
    console.log('💧 Auto irrigation disabled');
    return false;
  }
  
  const threshold = irrigationSettings.threshold || 30;
  
  if (soilMoisture < threshold) {
    console.log(`🚰 Irrigation needed! Soil moisture: ${soilMoisture}% < threshold: ${threshold}%`);
    return true;
  }
  
  console.log(`💧 Soil moisture OK: ${soilMoisture}% >= threshold: ${threshold}%`);
  return false;
}

// Get latest soil data
router.get('/soil-data/latest/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    const userData = soilDataStorage.filter(data => data.userId === userId);
    const latestData = userData[userData.length - 1] || null;

    res.json({ success: true, data: latestData });

  } catch (error) {
    console.error('❌ Error fetching latest soil data:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch latest data' });
  }
});

// Clear soil data (for testing)
router.delete('/soil-data/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    const initialCount = soilDataStorage.length;
    soilDataStorage = soilDataStorage.filter(data => data.userId !== userId);
    const finalCount = soilDataStorage.length;
    
    res.json({ 
      success: true, 
      message: `Cleared ${initialCount - finalCount} records for user ${userId}`,
      remaining: finalCount
    });

  } catch (error) {
    console.error('❌ Error clearing soil data:', error);
    res.status(500).json({ success: false, error: 'Failed to clear data' });
  }
});

module.exports = router;