#ifndef TLS_UTILS_H
#define TLS_UTILS_H

#include <ArduinoJson.h>
#include <WiFiClientSecure.h>

// Holding the CA bundle (which can be 200KB+) in a global variable permanently
// reduces the heap available for image processing
// Instead, we store the *path* and load it temporarily only when needed
bool TLSLoadCACert(const JsonVariant &config);

// Applies the loaded CA bundle to a WiFiClientSecure instance.
// Returns false if no CA cert has been loaded yet.
bool TLSConfigureClient(WiFiClientSecure &client);

// Returns the currently configured CA certificate file path.
const char *TLSGetCACertPath();

// Returns true if a CA bundle is loaded and ready to use.
bool TLSHasCACert();

#endif
