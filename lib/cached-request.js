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

  if (typeof options != "object") {
    throw new Error("An options object must provided. e.g: request(options)")
  }

  let callback;
  if (typeof args[args.length - 1] == "function") {
    callback = args[args.length - 1];
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
      const responseReader = fs.createReadStream(dataFilepath);

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

          const stream = zlib.createGunzip();
          responseReader.on('error', (error) => {
            stream.end();
          });
          stream.on('error', (error) => {
            responseReader.close();
          });
          responseReader.pipe(stream);

          let bodyBuffer;
          stream.on("data", (data) => {
            if (callback) {
              bodyBuffer = bodyBuffer ? Buffer.concat([bodyBuffer, data]) : data;
            }
            response.write(data);
            requestMiddleware.push(data);
          });
          stream.on("end", () => {
            if (callback) {
              response.body = bodyBuffer;
              this.processBody(bodyBuffer, options, (err, body) => {
                if (err) return callback(err);
                callback(null, response, body);
              });
            };
            response.end();
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

      // gzip all responses to make it easier when reading
      // from the cache
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
  });
  this.emit("request", args[0]);
};

CachedRequest.prototype.processBody = function (bodyBuffer, options, callback) {
  const { encoding, gzip, json } = options;
  if (encoding === null) return callback(null, bodyBuffer);
  if (gzip === true) return this.gunzip(bodyBuffer, encoding, callback);
  if (json === true) return this.jsonParse(bodyBuffer.toString(encoding), callback);
  return callback(null, bodyBuffer.toString());
};

CachedRequest.prototype.gunzip = function (buffer, encoding, callback) {
  zlib.gunzip(buffer, (err, result) => {
    if (err) return callback(err);
    callback(null, result.toString(encoding));
  });
}

CachedRequest.prototype.jsonParse = function (json, callback) {
  try {
    return callback(null, JSON.parse(json));
  } catch (e) {
    return callback(e);
  }
};

module.exports = CachedRequest;
