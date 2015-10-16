/*
CachedRequest module.

Usage
====================================
var request = require("request"); //https://github.com/request/request
request.defaults(options);

var CachedRequest = require("./cached-request");

//Instantiate a new `cachedRequest`.
//Pass along a `request` instance to be used
//and an options object

var fsCachedRequest = CachedRequest(request, {
  ttl: 1000,
  store: new CachedRequest.Stores.FileSystemStore(pathToCacheDirectory)
});

var s3CachedRequest = CachedRequest(request, {
  ttl: 2000,
  store: new CachedRequest.Stores.AmazonS3Store(configOptions)
});

//Now you can use `fsCachedRequest` and `s3Request` just as you use https://github.com/request/request
//Using callback
fsCachedRequest(options, function (error, response, body) {
  //...
});

//Or as a stream
s3CachedRequest(options).pipe(someWriteStream);


//You can also override the default `ttl` and `store` options
fsCachedRequest({
  url: '....',
  ttl: 2000,
  store: new CachedRequest.Stores.AmazonS3Store(configOptions)
}, callback);
*/
'use strict';

var CachedRequest = require('./cached-request');
var stores        = require('./stores');

function _CachedRequest (request, options) {
  if (!request) throw new Error('A request (https://github.com/request/request) instance must be provided');
  return new CachedRequest(request, options);
}

_CachedRequest.Stores = stores;

module.exports = _CachedRequest;