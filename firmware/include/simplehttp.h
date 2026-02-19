#pragma once

#include <Arduino.h>
#include <Client.h>
#include <WiFiClient.h>
#include <base64.h>
#include <map>

// Default settings
#define SIMPLEHTTP_MAX_REDIRECTS 5
#define SIMPLEHTTP_DEFAULT_TIMEOUT 5000

class SimpleHTTP {
public:
  inline SimpleHTTP();
  inline ~SimpleHTTP();

  // Initialize with a network client (WiFiClient or WiFiClientSecure) and URL
  // Note: For HTTPS, configure CA certs on client before passing it here
  inline bool begin(Client &client, const String &url);

  // Close the connection
  inline void end();

  // Add a custom header to the request
  inline void addHeader(const String &name, const String &value);

  // Set the User-Agent header
  inline void setUserAgent(const String &agent);

  // Set the read timeout (milliseconds)
  inline void setTimeout(unsigned long timeout);

  // Define which response headers to collect
  inline void collectHeaders(const char *headerKeys[],
                             const size_t headerCount);

  // Execute the HTTP GET request
  // Returns status code (e.g. 200) or negative error (-1: Connect, -2: Timeout)
  inline int GET();

  // Read response body into a String (handles chunked encoding)
  inline String getString();

  // Get raw WiFiClient pointer (for external stream readers)
  inline WiFiClient *getStreamPtr();

  // Get reference to the stream
  inline Stream &getStream();

  // Get Content-Length (-1 if unknown)
  inline int getSize();

  // Check if a header was collected
  inline bool hasHeader(const String &name);

  // Get value of a collected header
  inline String header(const String &name);

private:
  Client *_client;
  String _url;
  String _userAgent;
  String _customHeaders;
  unsigned long _timeout;

  // Header collection
  const char **_headerKeys;
  size_t _headerCount;
  std::map<String, String> _collectedHeaders;

  // Response state
  int _httpCode;
  int _contentLength;
  bool _isChunked;

  // Helpers
  inline int parseResponse();
  inline void cleanState();
};

inline SimpleHTTP::SimpleHTTP()
    : _client(nullptr), _timeout(SIMPLEHTTP_DEFAULT_TIMEOUT),
      _headerKeys(nullptr), _headerCount(0), _httpCode(0), _contentLength(-1),
      _isChunked(false) {
  _userAgent = "ESP32-SimpleHTTP/1.0";
}

inline SimpleHTTP::~SimpleHTTP() { end(); }

inline bool SimpleHTTP::begin(Client &client, const String &url) {
  _client = &client;
  _url = url;
  cleanState();
  return true;
}

inline void SimpleHTTP::end() {
  if (_client && _client->connected()) {
    _client->stop();
  }
}

inline void SimpleHTTP::addHeader(const String &name, const String &value) {
  _customHeaders += name + ": " + value + "\r\n";
}

inline void SimpleHTTP::setUserAgent(const String &agent) {
  _userAgent = agent;
}

inline void SimpleHTTP::setTimeout(unsigned long timeout) {
  _timeout = timeout;
}

inline void SimpleHTTP::collectHeaders(const char *headerKeys[],
                                       const size_t headerCount) {
  _headerKeys = headerKeys;
  _headerCount = headerCount;
}

inline void SimpleHTTP::cleanState() {
  _httpCode = 0;
  _contentLength = -1;
  _isChunked = false;
  _collectedHeaders.clear();
}

inline int SimpleHTTP::GET() {
  if (!_client)
    return -1;

  int redirects = 0;
  String currentUrl = _url;

  while (redirects <= SIMPLEHTTP_MAX_REDIRECTS) {
    cleanState();

    // Manual URL Parsing
    String protocol = "http";
    String host = "";
    int port = 80;
    String path = "/";
    String authUser = "";
    String authPass = "";

    int protocolEnd = currentUrl.indexOf("://");
    if (protocolEnd != -1) {
      protocol = currentUrl.substring(0, protocolEnd);

      // Find start of path
      int pathStart = currentUrl.indexOf('/', protocolEnd + 3);
      String authority;

      if (pathStart == -1) {
        authority = currentUrl.substring(protocolEnd + 3);
      } else {
        authority = currentUrl.substring(protocolEnd + 3, pathStart);
        path = currentUrl.substring(pathStart);
      }

      // Extract user:pass@ if present
      int atSymbol = authority.indexOf('@');
      if (atSymbol != -1) {
        String credentials = authority.substring(0, atSymbol);
        host = authority.substring(atSymbol + 1);

        int colon = credentials.indexOf(':');
        if (colon != -1) {
          authUser = credentials.substring(0, colon);
          authPass = credentials.substring(colon + 1);
        } else {
          authUser = credentials;
        }
      } else {
        host = authority;
      }
    }

    // Set port based on protocol
    if (protocol == "https")
      port = 443;

    // Handle explicit port in host string
    int colon = host.indexOf(':');
    if (colon != -1) {
      port = host.substring(colon + 1).toInt();
      host = host.substring(0, colon);
    }

    // Connect
    if (!_client->connected())
      if (!_client->connect(host.c_str(), port))
        return -1; // Connection failed

    // Send Request
    _client->print("GET ");
    _client->print(path);
    _client->print(" HTTP/1.1\r\n");
    _client->print("Host: ");
    _client->print(host);
    _client->print("\r\n");
    _client->print("User-Agent: ");
    _client->print(_userAgent);
    _client->print("\r\n");
    _client->print("Connection: close\r\n");

    // Handle Basic Auth (from URL or manually added)
    if (authUser.length() > 0) {
      String auth = authUser + ":" + authPass;
      _client->print("Authorization: Basic ");
      _client->print(base64::encode(auth));
      _client->print("\r\n");
    }

    if (_customHeaders.length() > 0)
      _client->print(_customHeaders);
    _client->print("\r\n");

    // Wait for Response
    unsigned long start = millis();
    while (_client->available() == 0) {
      if (millis() - start > _timeout) {
        end();
        return -2; // Timeout
      }
      delay(10);
    }

    // Parse Headers
    int code = parseResponse();

    // Handle Redirects
    if (code == 301 || code == 302 || code == 307) {
      if (_collectedHeaders.count("Location")) {
        String newLoc = _collectedHeaders["Location"];

        // Handle relative vs absolute redirect
        if (newLoc.startsWith("/")) {
          String protoPrefix = (port == 443) ? "https://" : "http://";
          currentUrl = protoPrefix + host + newLoc;
        } else {
          currentUrl = newLoc;
        }

        end(); // Close before redirecting
        redirects++;
        continue;
      }
    }

    _httpCode = code;
    return code;
  }

  return -3; // Too many redirects
}

inline int SimpleHTTP::parseResponse() {
  // Read status line
  String statusLine = _client->readStringUntil('\n');
  statusLine.trim();

  int firstSpace = statusLine.indexOf(' ');
  int secondSpace = statusLine.indexOf(' ', firstSpace + 1);
  if (firstSpace == -1)
    return -1;

  int code = statusLine.substring(firstSpace + 1, secondSpace).toInt();

  // Read headers
  while (true) {
    String line = _client->readStringUntil('\n');
    line.trim();
    if (line.length() == 0)
      break; // End of headers

    int colon = line.indexOf(':');
    if (colon != -1) {
      String key = line.substring(0, colon);
      String val = line.substring(colon + 1);
      val.trim();

      // Store internal headers
      if (key.equalsIgnoreCase("Content-Length")) {
        _contentLength = val.toInt();
      } else if (key.equalsIgnoreCase("Transfer-Encoding")) {
        if (val.equalsIgnoreCase("chunked"))
          _isChunked = true;
      } else if (key.equalsIgnoreCase("Location")) {
        _collectedHeaders["Location"] = val;
      }

      // Store user collected headers
      if (_headerKeys) {
        for (size_t i = 0; i < _headerCount; i++) {
          if (key.equalsIgnoreCase(_headerKeys[i])) {
            _collectedHeaders[_headerKeys[i]] = val;
            break;
          }
        }
      }
    }
  }
  return code;
}

inline String SimpleHTTP::getString() {
  if (!_client)
    return "";

  if (_isChunked) {
    String result = "";
    while (_client->connected()) {
      String line = _client->readStringUntil('\n'); // Chunk size
      line.trim();
      long chunkSize = strtol(line.c_str(), NULL, 16);
      if (chunkSize <= 0)
        break;

      // Read chunk data
      long remaining = chunkSize;
      while (remaining > 0 && _client->connected()) {
        if (_client->available()) {
          char c = _client->read();
          result += c;
          remaining--;
        }
      }
      _client->readStringUntil('\n'); // Skip chunk CRLF
    }
    return result;
  } else {
    return _client->readString();
  }
}

inline WiFiClient *SimpleHTTP::getStreamPtr() { return (WiFiClient *)_client; }

inline Stream &SimpleHTTP::getStream() { return *_client; }

inline int SimpleHTTP::getSize() { return _contentLength; }

inline bool SimpleHTTP::hasHeader(const String &name) {
  return _collectedHeaders.count(name) > 0;
}

inline String SimpleHTTP::header(const String &name) {
  if (_collectedHeaders.count(name))
    return _collectedHeaders[name];
  return "";
}