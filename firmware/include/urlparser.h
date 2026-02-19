#pragma once

#include <Arduino.h>
#include <base64.h>

namespace URLParser {

// Structure to hold a username and password for basic authentication
struct BasicAuth {
  String username;
  String password;

  // Check if basic auth is set
  bool exists() const;

  // Encode the basic auth as a base64 string
  String encode() const;
};

// Internal Linked List Node for Query Parameters (Replaces std::map)
struct QueryParamNode {
  String key;
  String value;
  QueryParamNode *next = nullptr;
};

// Class to parse a URL and provide convenience methods to manipulate its
// components
class Parser {
public:
  // Construct a parser from a URL string
  Parser(const String &url);

  // Destructor to clean up linked list
  ~Parser();

  // Reconstruct the full URL
  String getURL(const bool mask = false) const;

  // Set a parameter in the query string
  bool setParam(const String &key, const String &value);

  // Get the value of a parameter in the query string
  String getParam(const String &key) const;

  // Check if a parameter exists in the query string
  bool hasParam(const String &key) const;

  // Remove a parameter from the query string
  bool removeParam(const String &key);

  // Set the basic auth
  void setBasicAuth(const String &username, const String &password);

  // Clear the basic auth
  void clearBasicAuth();

  // Check if basic auth is set
  bool hasBasicAuth() const;

  // Get the basic auth
  BasicAuth getBasicAuth() const;

  // Get the path
  String getPath() const;

  // Set the path
  void setPath(const String &newPath);

  // Expand the path/query string recursively
  template <typename... Args>
  void expandPath(const String &segment, const Args &...rest) {
    expandPathSingle(segment);
    expandPath(rest...); // Recursively handle remaining arguments
  }

  // Overload of expandPath with no arguments
  void expandPath() {}

private:
  // Handle a single path/query string
  void expandPathSingle(const String &segment);

  // Parse the URL
  void parseUrl(const String &url);

  // Internal helper to parse query string directly into the linked list
  void parseQueryToParams(const String &query);

  // Helper to clear all params
  void clearParams();

  String protocol;     // e.g. "http"
  String domain;       // e.g. "example.com"
  String path;         // e.g. "/path/to/resource"
  BasicAuth basicAuth; // e.g. "username:password"

  // Head of the custom linked list
  QueryParamNode *paramsHead = nullptr;
};

// URL-encode a string
String urlEncode(const String &value);

// URL-decode a string
String urlDecode(const String &value);

} // namespace URLParser