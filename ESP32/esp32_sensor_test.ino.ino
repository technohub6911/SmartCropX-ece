#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// ==================== CONFIGURATION ====================
// WiFi credentials - UPDATE THESE
const char* ssid = "NETGEAR74";
const char* password = "wittycomet958";

// Server URL - USE YOUR COMPUTER'S IP
const char* serverURL = "http://192.168.0.103:3001/api/soil-data";

// Sensor pin
const int soilMoisturePin = A0;
const int DRY_VALUE = 4095;
const int WET_VALUE = 1500;

void setup() {
  Serial.begin(115200);
  pinMode(soilMoisturePin, INPUT);
  
  // Connect to WiFi
  WiFi.begin(ssid, password);
  Serial.print("📡 Connecting to WiFi");
  
  while (WiFi.status() != WL_CONNECTED) {
    delay(1000);
    Serial.print(".");
  }
  
  Serial.println("\n✅ Connected to WiFi!");
  Serial.print("📶 IP: ");
  Serial.println(WiFi.localIP());
}

void loop() {
  if (WiFi.status() == WL_CONNECTED) {
    sendSoilData();
  } else {
    Serial.println("❌ WiFi disconnected");
    WiFi.begin(ssid, password);
  }
  
  delay(30000); // Wait 30 seconds
}

void sendSoilData() {
  HTTPClient http;
  
  // Read soil moisture
  int rawValue = analogRead(soilMoisturePin);
  int moisturePercent = map(rawValue, DRY_VALUE, WET_VALUE, 0, 100);
  moisturePercent = constrain(moisturePercent, 0, 100);
  
  Serial.print("💧 Soil Moisture - Raw: ");
  Serial.print(rawValue);
  Serial.print(" | Percent: ");
  Serial.print(moisturePercent);
  Serial.println("%");
  
  // Start HTTP connection
  Serial.println("📤 Sending to: " + String(serverURL));
  http.begin(serverURL);
  http.addHeader("Content-Type", "application/json");
  
  // Create JSON data
  String jsonData = "{";
  jsonData += "\"deviceId\":\"esp32_farm_001\",";
  jsonData += "\"userId\":\"user_001\",";
  jsonData += "\"soilMoisture\":" + String(moisturePercent) + ",";
  jsonData += "\"temperature\":25,";
  jsonData += "\"humidity\":50,";
  jsonData += "\"autoIrrigation\":false,";
  jsonData += "\"sensorSlot\":1";
  jsonData += "}";
  
  Serial.println("📦 Data: " + jsonData);
  
  // Send POST request
  int httpCode = http.POST(jsonData);
  
  if (httpCode > 0) {
    Serial.println("✅ SUCCESS! HTTP Code: " + String(httpCode));
    
    String response = http.getString();
    Serial.println("📥 Response: " + response);
    
  } else {
    Serial.println("❌ FAILED! Error: " + String(httpCode));
    Serial.println("💡 Check: Server running? IP correct? Port 3001 open?");
  }
  
  http.end();
}