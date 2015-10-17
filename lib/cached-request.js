"use strict";

var async             = require('async');
var zlib              = require('zlib');
var Stores            = require('./stores');
var MockedResponse    = require('./mocked-response');
var RequestMiddleware = require('./request-middleware');

function CachedRequest (request, options) {
  var self = this;

  options = options || {};

  this.request = request;
  this.ttl     = options.ttl != null ? options.ttl : 0;
  this.store   = options.store;

  function _request () {
    return self.handleRequest.apply(self, arguments);
  }

  _request.setStore = function (store) {
    self.store = store;
  };

  _request.setTTL = function (ttl) {
    self.ttl = ttl;
  };

  return _request;
}

CachedRequest.Stores = Stores;

CachedRequest.prototype.handleRequest = function (options, callback) {
  if (!this.store) {
    throw new Error('A valid store must be provided');
  }

  if (typeof options != 'object') {
    throw new Error('An `options` object must provided. cachedRequest(options[, callback])');
  }

  if (callback && typeof callback != 'function') {
    throw new Error('`callback` must be a valid function');
  }

  var self  = this;
  var ttl   = options.ttl != null ? options.ttl : this.ttl;
  var key   = JSON.stringify(this.normalizeOptions(options));
      key   = this.hashKey(key);

  var requestMiddleware = new RequestMiddleware();

  this.store.stat(key, function (error, stats) {
    if (error) requestMiddleware.emit('cache-error', error);

    if (stats && stats.mtime.getTime() + ttl > Date.now()) {
      self.requestCache(key, requestMiddleware, options, callback);
    } else {
      self.requestEndpoint(key, requestMiddleware, options, callback);
    }
  });

  return requestMiddleware;
};

CachedRequest.prototype.handleError = function (error, requestMiddleware, callback) {
  if (callback) callback(error);
  else requestMiddleware.emit('error', error);
};

CachedRequest.prototype.requestCache = function (key, store, requestMiddleware, options, callback) {
  var self = this;

  async.parallel([
    store.getHeaders.bind(store, key),
    store.getResponseStream.bind(store, key)
  ], function (error, results) {
    if (error) {
      requestMiddleware.emit('cache-error', error);
      return self.requestEndpoint(key, requestMiddleware, options, callback);
    }

    var mockedResponse = new MockedResponse();
    var headers        = results[0];
    var cachedResponse = results[1];
    var response;
    var responseBody;

    if (!headers || !cachedResponse) {
      return self.requestEndpoint(key, store, requestMiddleware, options, callback);
    }

    mockedResponse.statusCode = 200;
    mockedResponse.headers = headers;

    //Notify the response comes from the cache
    mockedResponse.headers["x-from-cache"] = true;

    //Emit the 'response' event to the client sending the mocked response
    requestMiddleware.emit('response', mockedResponse);

    if (mockedResponse.headers['content-encoding'] == 'gzip') {
      response = cachedResponse;
    } else {
      response = zlib.createGunzip();

      cachedResponse.on('error', function (error) {
        self.handleError(error, requestMiddleware, callback);

        response.removeEventListener('end', onResponseEnd);
        response.end();
      });

      response.on('error', function () {
        cachedResponse.end();
      });

      cachedResponse.pipe(response);
    }

    response.on('error', function (error) {
      self.handleError(error, requestMiddleware, callback);
    });
    
    response.on('data', function (data) {
      //Write to mocked response
      mockedResponse.write(data);

      //If a callback was provided, then buffer the response to send it later
      if (callback) {
        responseBody = responseBody ? Buffer.concat([responseBody, data]) : data;
      }

      //Push data to the client's request
      requestMiddleware.push(data);
    });
    
    response.on('end', onResponseEnd);

    function onResponseEnd () {
      //End mocked response
      mockedResponse.end();

      if (callback) {
        //Se the response.body
        mockedResponse.body = responseBody;

        if (options.json) {
          try {
            responseBody = JSON.parse(responseBody.toString());
          } catch (error) {
            return callback(error);
          }
        }

        //callback with the response and body
        callback(null, mockedResponse, responseBody);
      }

      requestMiddleware.push(null);
    }
  });
};

CachedRequest.prototype.requestEndpoint = function (key, store, requestMiddleware, options, callback) {
  var self    = this;
  var request = this.request(options, callback);

  requestMiddleware.setRequest(request);

  request.on('response', function (response) {
    var contentEncoding;
    var gzipper;

    //Only cache successful responses
    if (response.statusCode >= 200 && response.statusCode < 300) {
      contentEncoding = response.headers['content-encoding'] || '';
      contentEncoding = contentEncoding.trim().toLowerCase();

      if (contentEncoding === 'gzip') {
        gzipper = response;
      } else {
        gzipper = zlib.createGzip();

        response.on('error', function (error) {
          self.handleError(error, requestMiddleware);
          gzipper.end();
        });

        gzipper.on('error', function (error) {
          self.handleError(error, requestMiddleware);
        });

        response.pipe(gzipper);
      }

      async.parallel([
        store.setHeaders.bind(store, key, response.headers),
        store.setResponseStream.bind(store, key, gzipper)
      ], function (error) {
        if (error) requestMiddleware.emit('cache-error', error);
      });
    }
  });
};

CachedRequest.prototype.normalizeOptions = function (options) {
  var normalizedOptions = {};

  normalizedOptions.method = options.method || "GET";
  normalizedOptions.url = options.url || options.uri;
  normalizedOptions.headers = options.headers || {};
  normalizedOptions.payload = options.body || options.form || options.formData || options.json || "";

  if (options.qs) normalizedOptions.url += querystring.stringify(options.qs);

  return normalizedOptions;
};

CachedRequest.prototype.hashKey = function (key) {
  var hash = 0, i, chr, len;

  if (key.length == 0) return hash;

  for (i = 0, len = key.length; i < len; i++) {
    chr   = key.charCodeAt(i);
    hash  = ((hash << 5) - hash) + chr;
    hash |= 0;
  }

  return hash;
};

module.exports = CachedRequest;