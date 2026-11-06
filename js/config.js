/*
 * js/config.js
 * ------------------------------------------------------------------
 * The public address of the FCS backend. There is no secret key here:
 * everything in this file is served to every visitor.
 *
 * js/api.js is the only module that talks to the backend. Public reads
 * fall back to the seed data in data.js when the API is unreachable.
 * ------------------------------------------------------------------
 */
window.FCS_CONFIG = {
  apiBaseUrl: "https://fcs-api.akos-archives.in",

  communityName: "The Free Code Subculture",

  // Weekday select order. Matches JavaScript Date.getDay(), which is
  // also what the class_sessions.weekday column stores.
  weekdays: [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ],

  defaultTimezone: "Asia/Kolkata",
};
