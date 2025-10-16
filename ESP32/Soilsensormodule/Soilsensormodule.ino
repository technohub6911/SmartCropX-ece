// ESP32 Soil Monitoring System
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// WiFi Credentials
const char* ssid = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";

// SmartXCrop Server Details
const char* serverURL = "https://your-smartxcrop-server.com/api/soil-data";
const char* deviceId = "ESP32_FARM_001"; // Unique device ID
const char* authToken = "YOUR_AUTH_TOKEN"; // From your web app

// Soil Moisture Sensor
const int soilMoisturePin = 34; // GPIO34 for analog read
const int relayPin = 2; // GPIO2 for relay control

// Calibration values (adjust based on your sensor)
const int dryValue = 4095; // Value in air
const int wetValue = 1500; // Value in water

void setup() {
  Serial.begin(115200);
  
  // Initialize pins
  pinMode(soilMoisturePin, INPUT);
  pinMode(relayPin, OUTPUT);
  digitalWrite(relayPin, LOW); // Start with irrigation OFF
  
  // Connect to WiFi
  connectToWiFi();
}

void loop() {
  if (WiFi.status() == WL_CONNECTED) {
    // Read soil moisture
    int soilMoistureRaw = analogRead(soilMoisturePin);
    int soilMoisturePercent = map(soilMoistureRaw, dryValue, wetValue, 0, 100);
    soilMoisturePercent = constrain(soilMoisturePercent, 0, 100);
    
    // Read temperature (if you have DHT22 sensor)
    float temperature = readTemperature(); // Implement if you have temp sensor
    
    // Send data to server
    sendSoilData(soilMoisturePercent, soilMoistureRaw, temperature);
    
    // Check for irrigation commands from server
    checkIrrigationCommands();
  } else {
    connectToWiFi();
  }
  
  delay(30000); // Send data every 30 seconds
}

void connectToWiFi() {
  Serial.print("Connecting to WiFi");
  WiFi.begin(ssid, password);
  
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(1000);
    Serial.print(".");
    attempts++;
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nConnected to WiFi!");
    Serial.print("IP Address: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\nFailed to connect to WiFi");
  }
}

void sendSoilData(int moisturePercent, int moistureRaw, float temperature) {
  HTTPClient http;
  http.begin(serverURL);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", authToken);
  
  // Create JSON payload
  DynamicJsonDocument doc(1024);
  doc["deviceId"] = deviceId;
  doc["moisturePercent"] = moisturePercent;
  doc["moistureRaw"] = moistureRaw;
  doc["temperature"] = temperature;
  doc["timestamp"] = millis();
  
  String jsonString;
  serializeJson(doc, jsonString);
  
  int httpResponseCode = http.POST(jsonString);
  
  if (httpResponseCode > 0) {
    String response = http.getString();
    Serial.println("Data sent successfully: " + response);
    
    // Parse response for irrigation commands
    DynamicJsonDocument responseDoc(512);
    deserializeJson(responseDoc, response);
    
    if (responseDoc.containsKey("irrigationCommand")) {
      bool shouldIrrigate = responseDoc["irrigationCommand"];
      digitalWrite(relayPin, shouldIrrigate ? HIGH : LOW);
      Serial.println("Irrigation: " + String(shouldIrrigate ? "ON" : "OFF"));
    }
  } else {
    Serial.println("Error sending data: " + String(httpResponseCode));
  }
  
  http.end();
}

void checkIrrigationCommands() {
  HTTPClient http;
  String commandURL = String(serverURL) + "/commands?deviceId=" + deviceId;
  http.begin(commandURL);
  http.addHeader("Authorization", authToken);
  
  int httpResponseCode = http.GET();
  
  if (httpResponseCode == 200) {
    String response = http.getString();
    DynamicJsonDocument doc(512);
    deserializeJson(doc, response);
    
    if (doc.containsKey("irrigation")) {
      bool irrigate = doc["irrigation"];
      digitalWrite(relayPin, irrigate ? HIGH : LOW);
      Serial.println("Manual Irrigation: " + String(irrigate ? "ON" : "OFF"));
    }
  }
  
  http.end();
}

float readTemperature() {
  // If you have DHT22 sensor, implement this
  // return dht.readTemperature();
  return 25.0; // Default temperature
}