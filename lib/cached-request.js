const fs = require("graceful-fs");
const querystring =  require("querystring");
const RequestMiddleware = require("./request-middleware");
const util = require("util");
const zlib = require("zlib");
const { Transform } = require("stream");
const { EventEmitter } = require("events");
const mkdirp = require('mkdirp');

class Response extends Transform {
  constructor(options) {
    super(options);
  }

  _transform(chunk, enconding, callback) {
    this.push(chunk);
    callback();
  }
}

util.inherits(CachedRequest, EventEmitter);

/*
* Cannot go ES6 here because `constructor` will
* always return an instance of CachedRequest and
* we want to return _request instead.
*/
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
  const _options = {};

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
  let hash = 0, i, chr, len;
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

CachedRequest.prototype.cachedRequest = function (...args) {
  const requestMiddleware = new RequestMiddleware();
  const options = args[0];
  const ttl = options.ttl || this.ttl;
  let mustParseJSON = false;

  if (typeof options != "object") {
    throw new Error("An options object must provided. e.g: request(options)")
  }

  let callback;
  if (typeof args[args.length - 1] == "function") {
    callback = args[args.length - 1];
  };

  if (options.json) {
    mustParseJSON = true;
  };

  let key = JSON.stringify(this.normalizeOptions(options));
  key = this.hashKey(key);

  const dataFilepath = `${this.cacheDirectory}${key}`;
  const headersFilepath = `${this.cacheDirectory}${key}.json`;
  const makeRequest = this.makeRequest.bind(this, {
    requestMiddleware,
    headersFilepath,
    dataFilepath
  }, ...args);

  //Open headers file
  const headersReader = fs.createReadStream(headersFilepath);

  //If the file doesn't exist, then make the actual request
  headersReader.on("error", (error) => {
    if (error.code != "ENOENT") this.handleError(error);
    makeRequest();
  });

  headersReader.on("open", (fd) => {
    //Check the headers file's mtime
    fs.fstat(fd, (error, stats) => {
      if (error) {
        this.handleError(error);
        return makeRequest();
      }

      //If it's stale, then make the actual request
      if (stats.mtime.getTime() + ttl < Date.now()) {
        headersReader.close();
        return makeRequest();
      }

      //Open the response file
      const responseReader = fs.createReadStream(this.cacheDirectory + key);

      //If it doesn't exist, then make the actual request
      responseReader.on("error", (error) => {
        if (error.code != "ENOENT") {
          this.handleError(error);
          return response.emit('error', error);
        }
        makeRequest();
      });

      responseReader.on("open", (error) => {
        //Create a fake response object
        const response = new Response();
        response.statusCode = 200;
        response.headers = "";

        //Read the haders from the file and set them to the response
        headersReader.on("data", (data) => {
          response.headers += data.toString();
        });
        headersReader.on("end", () => {
          try {
            response.headers = this.parseHeaders(response.headers);
          } catch (e) {
            this.handleError(e);
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
            responseReader.on('error', (error) => {
              stream.end();
            });
            stream.on('error', (error) => {
              responseReader.close();
            });
            responseReader.pipe(stream);
          }

          //Read the response file
          var responseBody;
          stream.on("data", (data) => {
            //Write to the response
            response.write(data);
            //If a callback was provided, then buffer the response to send it later
            if (callback) {
              responseBody = responseBody ? Buffer.concat([responseBody, data]) : data;
            }
            //Push data to the client's request
            requestMiddleware.push(data);
          });
          stream.on("end", () => {
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

  return requestMiddleware;
};

/*
* Makes the actual request and caches the response
*/
CachedRequest.prototype.makeRequest = function (options, ...args) {
  const { requestMiddleware, headersFilepath, dataFilepath } = options;
  const request = this.request.apply(null, args);
  requestMiddleware.use(request);
  request.on("response", (response) => {
    //Only cache successful responses
    if (response.statusCode >= 200 && response.statusCode < 300) {
      response.on('error', (error) => {
        this.handleError(error);
      });
      fs.writeFile(headersFilepath, JSON.stringify(response.headers), (error) => {
        if (error) this.handleError(error);
      });

      const responseWriter = fs.createWriteStream(dataFilepath);
      responseWriter.on('error', (error) => {
        this.handleError(error);
      });

      const contentEncoding = (response.headers['content-encoding'] || '').trim().toLowerCase();
      if (contentEncoding === 'gzip') {
        response.on('error', (error) => {
          responseWriter.end();
        });
        response.pipe(responseWriter);
      } else {
        const gzipper = zlib.createGzip();
        response.on('error', (error) => {
          gzipper.end();
        });
        gzipper.on('error', (error) => {
          this.handleError(error);
          responseWriter.end();
        });
        responseWriter.on('error', (error) => {
          response.unpipe(gzipper);
          gzipper.end();
        });
        response.pipe(gzipper).pipe(responseWriter);
      }
    }
  });
  this.emit("request", args[0]);
};

module.exports = CachedRequest;
