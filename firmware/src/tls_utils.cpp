#include "tls_utils.h"

#define FS_NO_GLOBALS
#include <FS.h>
#ifdef FILE_READ
#undef FILE_READ
#endif
#ifdef FILE_WRITE
#undef FILE_WRITE
#endif

#include <LittleFS.h>

#include "definitions.h"
#include "logger.h"
#include "psram_allocator.h"

namespace {
String gCACertPath = CA_CERT_FILE_PATH;
bool gAllowInsecure = false;
} // namespace

bool TLSLoadCACert(const JsonVariant &config) {
  gCACertPath = CA_CERT_FILE_PATH;
  gAllowInsecure = false;

  if (config.is<JsonObject>()) {
    const char *path = config["security"]["caCertPath"] | CA_CERT_FILE_PATH;
    gAllowInsecure = config["security"]["allowInsecure"] | false;
    if (path && strlen(path) > 0)
      gCACertPath = path;
  }

  if (!LittleFS.exists(gCACertPath)) {
    Logger::logf(Logger::LOG_WARNING, "TLS CA file missing: %s. %s",
                 gCACertPath.c_str(),
                 gAllowInsecure ? "Insecure fallback enabled."
                                : "HTTPS/TLS will fail closed.");
    return false;
  }
  return true;
}

bool TLSConfigureClient(WiFiClientSecure &client) {
  fs::File certFile = LittleFS.open(gCACertPath.c_str(), "r");

  if (!certFile || certFile.size() == 0) {
    if (certFile)
      certFile.close();
    if (gAllowInsecure) {
      client.setInsecure();
      Logger::log(Logger::LOG_WARNING,
                  "TLS CA missing/empty. Using insecure mode.");
      return true;
    } else {
      Logger::log(Logger::LOG_ERROR,
                  "TLS CA bundle missing/empty. Refusing insecure connection.");
      return false;
    }
  }

  size_t fileSize = certFile.size();

  // File size limit to 50KB to support Cloudflare bundles (approx 35KB)
  if (fileSize > 50 * 1024) {
    Logger::logf(Logger::LOG_ERROR,
                 "CRITICAL: CA Cert file too large (%d bytes)!", fileSize);
    Logger::log(Logger::LOG_ERROR,
                "Please use the Cloudflare profile in tools/update_root_cas.mjs");
    certFile.close();
    return false;
  }

  // Use PSRAM for the temporary buffer to prevent Stack/Heap crash
  // (StoreProhibited) We allocate 1 byte extra for null terminator
  char *buf = (char *)ps_malloc(fileSize + 1);
  if (!buf) {
    // Fallback to standard malloc if PSRAM isn't available
    buf = (char *)malloc(fileSize + 1);
  }

  if (!buf) {
    Logger::log(Logger::LOG_ERROR, "TLS CA Load failed: Out of Memory");
    certFile.close();
    return false;
  }

  // Read file directly into buffer
  certFile.readBytes(buf, fileSize);
  buf[fileSize] = '\0'; // Null terminate
  certFile.close();

  // Validate PEM start
  if (strstr(buf, "BEGIN CERTIFICATE") == nullptr) {
    Logger::logf(Logger::LOG_ERROR, "TLS CA file is not valid PEM: %s",
                 gCACertPath.c_str());
    free(buf);
    return false;
  }

  // Configure Client
  client.setCACert(buf);

  // Free memory immediately
  free(buf);

  return true;
}

const char *TLSGetCACertPath() { return gCACertPath.c_str(); }

bool TLSHasCACert() { return LittleFS.exists(gCACertPath); }
