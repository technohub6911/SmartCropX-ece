// agriconnect-app/models/SoilData.js
const mongoose = require('mongoose');

const soilDataSchema = new mongoose.Schema({
  deviceId: {
    type: String,
    required: true
  },
  soilMoisture: {
    type: Number,
    required: true,
    min: 0,
    max: 100
  },
  temperature: {
    type: Number,
    default: 25
  },
  humidity: {
    type: Number,
    default: 50
  },
  autoIrrigation: {
    type: Boolean,
    default: false
  },
  sensorSlot: {
    type: Number,
    default: 1
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
});

// Index for faster queries
soilDataSchema.index({ deviceId: 1, timestamp: -1 });

module.exports = mongoose.model('SoilData', soilDataSchema);