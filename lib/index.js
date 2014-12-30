/*
CachedRequest module.

Usage
====================================
var request = require("request"); //https://github.com/request/request
request.defaults(options);

//Instantiate a new `cachedRequest`.
//Pass along a `request` instance to be used
var cachedRequest = require("./cached-request")(request);

//Set cache directory
cachedRequest.setCacheDirectory(pathToCacheDirectory);

//Now you can use `cachedRequest` just as you use https://github.com/request/request
//Using callback
cachedRequest(options, function (error, response, body) {
  //...
});
//Or as a stream
cachedRequest(options).pipe(someWriteStream);
*/
'use strict';

var CachedRequest = require("./cached-request");

module.exports = function (request) {
  if (!request) throw new Error("A request (https://github.com/request/request) instance must be provided");
  return new CachedRequest(request);
};