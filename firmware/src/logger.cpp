#include "logger.h"
#include "definitions.h"
#include "psram_allocator.h"
#include "time_utils.h"

#include <Arduino.h>
#include <Inkplate.h>
#include <stdarg.h>

#ifdef ARDUINO_INKPLATE10V2
#include "images/logo.h"
#endif
#ifdef ARDUINO_INKPLATECOLOR
#include "images/logo_6color.h"
#endif

// Log level names for easier debugging
static const char *levelNames[] = {"CRITICAL", "ERROR", "WARNING",
                                   "NOTICE",   "INFO",  "DEBUG"};

namespace Logger {
// Pointers to stream, display, and MQTT client
static Stream *stream = nullptr;
static Inkplate *display = nullptr;
static PubSubClient *mqttClient = nullptr;
static String mqttTopic = "innky/logs";

// Queue to store log messages before sending to MQTT
// This guarantees zero heap fragmentation from the queue structure itself.
static const int MAX_LOG_QUEUE = 15;
static String logQueue[MAX_LOG_QUEUE];
static int queueHead = 0; // Write index
static int queueTail = 0; // Read index
static int queueCount = 0;

// Decompresses PackBits RLE data from PROGMEM to a RAM buffer
void decompressRLE(const uint8_t *in, size_t inLen, uint8_t *out,
                   size_t outLen) {
  size_t inPos = 0;
  size_t outPos = 0;
  while (inPos < inLen && outPos < outLen) {
    int8_t code = (int8_t)pgm_read_byte(&in[inPos++]);
    if (code == -128)
      continue; // No-op

    if (code >= 0) { // Literal run
      int count = code + 1;
      for (int i = 0; i < count && outPos < outLen; i++) {
        out[outPos++] = pgm_read_byte(&in[inPos++]);
      }
    } else { // Repeated run
      int count = 1 - code;
      uint8_t val = pgm_read_byte(&in[inPos++]);
      for (int i = 0; i < count && outPos < outLen; i++) {
        out[outPos++] = val;
      }
    }
  }
}

// Enqueues a log message to be sent via MQTT
void enqueueLog(const String &logMessage) {
  // Write to the head (current insertion point)
  logQueue[queueHead] = logMessage;
  queueHead = (queueHead + 1) % MAX_LOG_QUEUE;

  if (queueCount < MAX_LOG_QUEUE) {
    // Queue isn't full, just increment count
    queueCount++;
  } else {
    // Queue was full, we overwrote the oldest item (tail), so move tail forward
    queueTail = (queueTail + 1) % MAX_LOG_QUEUE;
  }
}

// Sends all queued log messages via MQTT
void flushMQTT() {
  if (!mqttClient || !mqttClient->connected())
    return;

  while (queueCount > 0) {
    const String &msg = logQueue[queueTail];

    if (!mqttClient->publish(mqttTopic.c_str(), msg.c_str())) {
      Serial.println("[WARN] MQTT publish failed; will retry later.");
      break; // Stop trying if connection is flaky
    }

    // Move tail forward and decrease count
    queueTail = (queueTail + 1) % MAX_LOG_QUEUE;
    queueCount--;
  }
}

// Waits until all log messages are sent or timeout occurs
void waitForFlush(unsigned long timeoutMs) {
  if (!mqttClient)
    return;

  unsigned long start = millis();
  while (queueCount > 0 && millis() - start < timeoutMs) {
    mqttClient->loop();
    flushMQTT();
    delay(5);
  }
}

// Cleans up the logger by flushing and disconnecting MQTT
void cleanup(unsigned long timeoutMs) {
  waitForFlush(timeoutMs);

  if (mqttClient)
    mqttClient->disconnect();

  delay(500);
}

// Sets the MQTT client and topic for logging
void setMQTTClient(PubSubClient &client, const char *topic) {
  mqttClient = &client;
  if (topic)
    mqttTopic = topic;
}

// Initializes the logger with a stream and an Inkplate display
void init(Stream &s, Inkplate &d) {
  stream = &s;
  display = &d;
}

// Logs a message to the stream and optionally MQTT
void log(LogLevel level, const char *message) {
  if (!stream)
    return;

  // Format log level name
  const char *levelName = (level <= LOG_DEBUG) ? levelNames[level] : "UNKNOWN";
  char formattedLevel[10];
  snprintf(formattedLevel, sizeof(formattedLevel), "%-8s", levelName);

  // Generate timestamped log message
  String timestamp =
      display->rtcIsSet() ? getLocalTimestamp(display->rtcGetEpoch()) : "";

  // Build log entry
  String logEntry;
  logEntry.reserve(45 + strlen(message));

  logEntry = "[";
  logEntry += formattedLevel;
  logEntry += "]";

  if (timestamp.length() > 0) {
    logEntry += " (";
    logEntry += timestamp;
    logEntry += ")";
  }

  logEntry += ": ";
  logEntry += message;

  // Print to stream
  if (level <= LOG_LEVEL && stream)
    Serial.println(logEntry);

  // Send to MQTT if enabled
  if (mqttClient) {
    enqueueLog(logEntry);
    flushMQTT();
  }
}

// Logs a formatted message to the stream and MQTT
void logf(LogLevel level, const char *format, ...) {
  if (!stream || level > LOG_LEVEL)
    return;

  char buffer[256];
  va_list args;
  va_start(args, format);
  vsnprintf(buffer, sizeof(buffer), format, args);
  va_end(args);

  log(level, buffer);
}

// Displays a log message on the Inkplate screen
void onScreen(LogLevel level, bool clear, int pos, int rotation,
              const char *format, ...) {
  if (!display)
    return;

  char buffer[256];
  va_list args;
  va_start(args, format);
  vsnprintf(buffer, sizeof(buffer), format, args);
  va_end(args);

  if (level > LOG_LEVEL)
    log(level, buffer);

  // Determine portrait or landscape mode
  const bool isPortrait = (rotation % 2 == 0);
  int w = isPortrait ? E_INK_WIDTH : E_INK_HEIGHT;
  int h = MSG_BOX_HEIGHT; // Height of the text box

  // Determine Y position based on pos value
  int y = (pos == 0)   ? 0
          : (pos == 1) ? (isPortrait ? E_INK_HEIGHT / 2 - h / 2
                                     : E_INK_WIDTH / 2 - h / 2)
                       : (isPortrait ? E_INK_HEIGHT - h : E_INK_WIDTH - h);

  // Clear the display and draw a logo if requested
  if (clear) {
    display->clearDisplay();

    // Calculate uncompressed size: ceil(w/8) * h
    size_t rawSize = ((logo_w + 7) / 8) * logo_h;

    // Allocate buffer (Try PSRAM first, then standard RAM)
    uint8_t *rawBuffer = (uint8_t *)ps_malloc(rawSize);
    if (!rawBuffer)
      rawBuffer = (uint8_t *)malloc(rawSize);

    if (rawBuffer) {
      // Decompress
      decompressRLE(logo_img, logo_len, rawBuffer, rawSize);

      // Draw
      display->drawBitmap(
          ((isPortrait ? E_INK_WIDTH : E_INK_HEIGHT) - logo_w) / 2,
          ((isPortrait ? E_INK_HEIGHT : E_INK_WIDTH) - logo_h) / 2, rawBuffer,
          logo_w, logo_h, 0);

      // Free
      free(rawBuffer);
    } else {
      Serial.println("OOM: Could not allocate buffer for logo");
    }
  }

  // For Inkplate Color, adjust Y if needed so text is properly centered
  int textY = y + 5;
#ifdef ARDUINO_INKPLATECOLOR
  textY = y + static_cast<int>(MSG_BOX_HEIGHT / 2.5);
#endif

  // Set text properties
  display->setTextColor(0, 7);
  display->setTextSize(TEXT_SIZE);
  display->setCursor(8, textY);
  display->print(buffer);
}
} // namespace Logger
