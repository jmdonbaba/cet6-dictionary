(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.StudyExport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  return {};
});
