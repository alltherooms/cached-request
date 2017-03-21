/*
CachedRequest class
*/
'use strict';

var fs = require("graceful-fs")
,   querystring =  require("querystring")
,   RequestMiddleware = require("./request-middleware")
,   util = require("util")
,   zlib = require("zlib")
,   Transform = require("stream").Transform
,   EventEmitter = require("events").EventEmitter
,   mkdirp = require('mkdirp');

util.inherits(Response, Transform);

function Response (options) {
  Transform.call(this, options);
};

Response.prototype._transform = function (chunk, enconding, callback) {
  this.push(chunk);
  callback();
};

util.inherits(CachedRequest, EventEmitter);

function CachedRequest (request) {
  EventEmitter.call(this);

  var self = this;

  this.request = request;
  this.cacheDirectory = "/tmp/";
  this.ttl = 0;

  function _request () {
    return self.cachedRequest.apply(self, arguments);
  }

  _request.get = function () {
  	arguments[0].method = 'GET';

    return self.cachedRequest.apply(self, arguments);
  }

  _request.setCacheDirectory = function (cacheDirectory) {
    self.setCacheDirectory(cacheDirectory);
  }

  _request.setValue = function (key, value) {
    self[key] = value;
  }

  _request.getValue = function (key) {
    return self[key];
  }

  _request.on = function (event, handler) {
    self.on(event, function () {
      handler.apply(_request, arguments);
    });
  }

  return _request;
};

CachedRequest.prototype.setCacheDirectory = function (cacheDirectory) {
  cacheDirectory ? this.cacheDirectory = cacheDirectory : void 0;
  if (this.cacheDirectory.lastIndexOf("/") < this.cacheDirectory.length - 1) {
    this.cacheDirectory += "/";
  };
  // Create directory path if it doesn't exist
  mkdirp(this.cacheDirectory);
};

CachedRequest.prototype.handleError = function (error) {
  if (this.logger) {
    this.logger.error({err: error});
  } else {
    console.error(error.stack);
  };
};

CachedRequest.prototype.normalizeOptions = function (options) {
  var _options = {};

  _options.method = options.method || "GET";
  _options.url = options.url || options.uri;
  _options.headers = options.headers || {};
  _options.payload = options.body || options.form || options.formData || options.json || "";

  if (options.qs) {
    _options.url += querystring.stringify(options.qs);
  };

  return _options;
};

CachedRequest.prototype.hashKey = function (key) {
  var hash = 0, i, chr, len;
  if (key.length == 0) return hash;
  for (i = 0, len = key.length; i < len; i++) {
    chr   = key.charCodeAt(i);
    hash  = ((hash << 5) - hash) + chr;
    hash |= 0;
  };
  return hash;
};

CachedRequest.prototype.parseHeaders = function (headers) {
  return JSON.parse(headers);
};

CachedRequest.prototype.cachedRequest = function () {
  var self = this
  ,   requestMiddleware = new RequestMiddleware()
  ,   args = arguments
  ,   options = args[0]
  ,   ttl = options.ttl || this.ttl
  ,   mustParseJSON = false
  ,   callback
  ,   headersReader
  ,   responseReader
  ,   responseWriter
  ,   gunzip
  ,   request
  ,   response
  ,   responseBody
  ,   key;

  if (typeof options != "object") {
    throw new Error("An options object must provided. e.g: request(options)")
  }

  if (typeof args[args.length - 1] == "function") {
    callback = args[args.length - 1];
  };

  if (options.json) {
    mustParseJSON = true;
  };

  key = JSON.stringify(this.normalizeOptions(options));
  key = this.hashKey(key);

  //Open headers file
  headersReader = fs.createReadStream(this.cacheDirectory + key + ".json");

  //If the file doesn't exist, then make the actual request
  headersReader.on("error", function (error) {
    if (error.code != "ENOENT") self.handleError(error);
    makeRequest();
  });

  headersReader.on("open", function (fd) {
    //Check the headers file's mtime
    fs.fstat(fd, function (error, stats) {
      if (error) {
        self.handleError(error);
        return makeRequest();
      }

      //If it's stale, then make the actual request
      if (stats.mtime.getTime() + ttl < Date.now()) {
        headersReader.close();
        return makeRequest();
      }

      //Open the response file
      responseReader = fs.createReadStream(self.cacheDirectory + key);

      //If it doesn't exist, then make the actual request
      responseReader.on("error", function (error) {
        if (error.code != "ENOENT") {
          self.handleError(error);
          return response.emit('error', error);
        }
        makeRequest();
      });

      responseReader.on("open", function (error) {
        //Create a fake response object
        response = new Response();
        response.statusCode = 200;
        response.headers = "";

        //Read the haders from the file and set them to the response
        headersReader.on("data", function (data) {
          response.headers += data.toString();
        });
        headersReader.on("end", function () {
          try {
            response.headers = self.parseHeaders(response.headers);
          } catch (e) {
            self.handleError(e);
            headersReader.close();
            return makeRequest();
          }

          //Notify the response comes from the cache.
          response.headers["x-from-cache"] = 1;
          //Emit the "response" event to the client sending the fake response
          requestMiddleware.emit("response", response);

          var stream;
          if (response.headers['content-encoding'] === 'gzip') {
            stream = responseReader;
          } else {
            // Gunzip the response file
            stream = zlib.createGunzip();
            responseReader.on('error', function (error) {
              stream.end();
            });
            stream.on('error', function (error) {
              responseReader.close();
            });
            responseReader.pipe(stream);
          }

          //Read the response file
          var responseBody;
          stream.on("data", function (data) {
            //Write to the response
            response.write(data);
            //If a callback was provided, then buffer the response to send it later
            if (callback) {
              responseBody = responseBody ? Buffer.concat([responseBody, data]) : data;
            }
            //Push data to the client's request
            requestMiddleware.push(data);
          });
          stream.on("end", function () {
            //End response
            response.end();
            //If a callback was provided
            if (callback) {
              //Se the response.body
              response.body = responseBody;
              //Parse the response body (it needed)
              if (mustParseJSON) {
                try {
                  responseBody = JSON.parse(responseBody.toString());
                } catch (e) {
                  return callback(e);
                };
              };
              //callback with the response and body
              callback(null, response, responseBody);
            };
            requestMiddleware.push(null);
          });
        });
      });
    });
  });

  //Makes the actual request and caches the response
  function makeRequest () {
    request = self.request.apply(null, args);
    requestMiddleware.use(request);
    request.on("response", function (response) {
      var contentEncoding, gzipper;

      //Only cache successful responses
      if (response.statusCode >= 200 && response.statusCode < 300) {
        response.on('error', function (error) {
          self.handleError(error);
        });
        fs.writeFile(self.cacheDirectory + key + ".json", JSON.stringify(response.headers), function (error) {
          if (error) self.handleError(error);
        });

        responseWriter = fs.createWriteStream(self.cacheDirectory + key);

        responseWriter.on('error', function (error) {
          self.handleError(error);
        });

        contentEncoding = response.headers['content-encoding'] || '';
        contentEncoding = contentEncoding.trim().toLowerCase();

        if (contentEncoding === 'gzip') {
          response.on('error', function (error) {
            responseWriter.end();
          });
          response.pipe(responseWriter);
        } else {
          gzipper = zlib.createGzip();
          response.on('error', function (error) {
            gzipper.end();
          });
          gzipper.on('error', function (error) {
            self.handleError(error);
            responseWriter.end();
          });
          responseWriter.on('error', function (error) {
            response.unpipe(gzipper);
            gzipper.end();
          });
          response.pipe(gzipper).pipe(responseWriter);
        }
      }
    });
    self.emit("request", args[0]);
  };

  return requestMiddleware;
};

module.exports = CachedRequest;
