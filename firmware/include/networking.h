#ifndef NETWORK_H
#define NETWORK_H

#include <ArduinoJson.h>
#include <Inkplate.h>
#include <PubSubClient.h>
#include <esp_err.h>
#include "psram_allocator.h"

// Global network clients
extern WiFiClient wifiClient;
extern WiFiClientSecure wifiClientSecure;
extern PubSubClient mqttClient;

// Connects to WiFi or launches the captive portal if connection fails
esp_err_t WifiConnect(Inkplate &display, int timeoutSeconds,
                      bool forceConfig = false);

// Connects to the MQTT broker using the provided configuration
esp_err_t MqttConnect(const JsonVariant &mqttConfig);

// Fetches a JPEG image from a URL and renders it to the Inkplate
esp_err_t DisplayImage(Inkplate &display, int rotation, const char *api,
                       const JsonVariant &imageConfig,
                       const char *renderEndpoint);

// Reads data from a WiFi stream into a byte vector (PSRAM friendly)
PsramVector readStream(WiFiClient &stream, unsigned long timeoutMillis,
                                bool isChunked, size_t contentLength);

// Starts the OTA web server and blocks execution until timeout or reboot
void StartOTAServer(Inkplate &display, int rotation);

#endif
