var CachedRequest = require("../")
,   request = require("request")
,   nock = require("nock")
,   temp = require('temp').track()
,   Readable = require("stream").Readable
,   util = require("util")
,   zlib = require("zlib")
,   mmm = require('mmmagic')
,   Magic = mmm.Magic
,   path = require('path')
,   fs = require('fs');

util.inherits(MockedResponseStream, Readable);

function MockedResponseStream (options, response) {
  Readable.call(this, options);
  this.response = response;
}

MockedResponseStream.prototype._read = function (size) {
  this.push(this.response);
  this.push(null);
};

describe("CachedRequest", function () {
  var cacheDir;

  function mock (method, times, response, headers) {
    method = method.toLowerCase();
    times = times || 1;
    nock("http://ping.com")
      .filteringPath(/.+/, "/")
      [method]("/")
      .times(times)
      .reply(200, response, headers);
  };

  before(function () {
    nock.disableNetConnect();
  });

  beforeEach(function () {
    cacheDir = temp.mkdirSync("cache");
    this.cachedRequest = CachedRequest(request);
    this.cachedRequest.setCacheDirectory(cacheDir);
  });

  describe("caching", function () {
    it("makes the request when the response isn't cached", function (done) {
      mock("GET", 1, function () {
        return new MockedResponseStream({}, "pong");
      });
      this.cachedRequest({uri: "http://ping.com/", ttl: 0}, function (error, response, body) {
        if (error) return done(error);
        expect(response.statusCode).to.equal(200);
        expect(response.headers["x-from-cache"]).to.not.exist;
        expect(body).to.equal("pong");
        done();
      });
    });

    it("makes the request when the response isn't cached using the get extension method", function (done) {
      mock("GET", 1, function () {
        return new MockedResponseStream({}, "pong");
      });
      this.cachedRequest.get({uri: "http://ping.com/", ttl: 0, method: 'GET'}, function (error, response, body) {
        if (error) return done(error);
        expect(response.statusCode).to.equal(200);
        expect(response.headers["x-from-cache"]).to.not.exist;
        expect(body).to.equal("pong");
        done();
      });
    });

    it("responds from the cache", function (done) {
      var self = this;
      var responseBody = {"a": 1, "b": {"c": 2}};
      var options = {
        uri: "http://ping.com/",
        method: "POST",
        json: {
          a: 1
        },
        ttl: 5000
      };

      mock(options.method, 1, function () {
        return new MockedResponseStream({}, JSON.stringify(responseBody));
      });

      this.cachedRequest(options, function (error, response, body) {
        if (error) return done(error);
        expect(response.statusCode).to.equal(200);
        expect(response.headers["x-from-cache"]).to.not.exist;
        expect(body).to.deep.equal(responseBody);

        self.cachedRequest(options, function (error, response, body) {
          if (error) return done(error);
          expect(response.statusCode).to.equal(200);
          expect(response.headers["x-from-cache"]).to.equal(1);
          expect(body).to.deep.equal(responseBody);
          done();
        });
      });
    });

    it("responds from the cache using get extension method", function (done) {
      var self = this;
      var responseBody = {"a": 1, "b": {"c": 2}};
      var options = {
        uri: "http://ping.com/",
        method: "POST",
        json: {
          a: 1
        },
        ttl: 5000
      };

      mock(options.method, 1, function () {
        return new MockedResponseStream({}, JSON.stringify(responseBody));
      });

      this.cachedRequest(options, function (error, response, body) {
        if (error) return done(error);
        expect(response.statusCode).to.equal(200);
        expect(response.headers["x-from-cache"]).to.not.exist;
        expect(body).to.deep.equal(responseBody);

        self.cachedRequest(options, function (error, response, body) {
          if (error) return done(error);
          expect(response.statusCode).to.equal(200);
          expect(response.headers["x-from-cache"]).to.equal(1);
          expect(body).to.deep.equal(responseBody);
          done();
        });
      });
    });

    it("responds the same from the cache if gzipped", function (done) {
      var self = this;
      var responseBody = 'foo';
      var options = {
        url: "http://ping.com/",
        ttl: 5000,
        encoding: null // avoids messing with gzip responses so we can handle them
      };

      //Return gzip compressed response with valid content encoding header
      mock("GET", 1, function () {
        return new MockedResponseStream({}, responseBody).pipe(zlib.createGzip());
      },
      {
        "Content-Encoding": "gzip"
      });

      this.cachedRequest(options, function (error, response, body) {
        if (error) return done(error);
        expect(response.statusCode).to.equal(200);
        expect(response.headers["x-from-cache"]).to.not.exist;

        zlib.gunzip(body, function (error, buffer) {
          if (error) return done(error);
          expect(buffer.toString()).to.deep.equal(responseBody);

          self.cachedRequest(options, function (error, response, body) {
            if (error) return done(error);
            expect(response.statusCode).to.equal(200);
            expect(response.headers["x-from-cache"]).to.equal(1);
            zlib.gunzip(body, function (error, buffer) {
              if (error) done(error);
              expect(buffer.toString()).to.deep.equal(responseBody);
              done();
            });
          });
        });
      });
    });

    it("stores response un-gzip'd when gzipResponse option is disabled", function (done) {
      var self = this;
      var responseBody = {"a": 1, "b": {"c": 2}};
      var options = {
        uri: "http://ping.com/",
        method: "POST",
        json: {
          a: 1
        },
        ttl: 5000,
        gzipResponse: false
      };

      mock(options.method, 1, function () {
        return new MockedResponseStream({}, JSON.stringify(responseBody));
      });

      this.cachedRequest(options, function (error, response, body) {
        if (error) return done(error);
        expect(response.statusCode).to.equal(200);
        expect(response.headers["x-from-cache"]).to.not.exist;
        expect(body).to.deep.equal(responseBody);
        var magic = new Magic(mmm.MAGIC_MIME_TYPE)
        ,   cacheDir = self.cachedRequest.getValue('cacheDirectory')
        ,   basename = self.cachedRequest.getValue('hashKey')(JSON.stringify(self.cachedRequest.getValue('normalizeOptions')(options)))
        ,   filepath = cacheDir + basename
        ,   metaFilepath = filepath + '.json';

        // wait for JSON file to written + flushed
        setTimeout(function(){
            var meta = JSON.parse(fs.readFileSync(metaFilepath));

            expect(meta._gzipResponse).to.equal(false);

            magic.detectFile(filepath, function(err, result) {
                if (err) throw err;
                expect(result).to.equal('text/plain');
                done();
            });
         }, 25);
      });
    });

    it("stores response gzip'd when gzipResponse option is omitted", function (done) {
      var self = this;
      var responseBody = {"a": 1, "b": {"c": 2}};
      var options = {
        uri: "http://ping.com/",
        method: "POST",
        json: {
          a: 1
        },
        ttl: 5000
      };

      mock(options.method, 1, function () {
        return new MockedResponseStream({}, JSON.stringify(responseBody));
      });

      this.cachedRequest(options, function (error, response, body) {
        if (error) return done(error);
        expect(response.statusCode).to.equal(200);
        expect(response.headers["x-from-cache"]).to.not.exist;
        expect(body).to.deep.equal(responseBody);
        var magic = new Magic(mmm.MAGIC_MIME_TYPE)
        ,   cacheDir = self.cachedRequest.getValue('cacheDirectory')
        ,   basename = self.cachedRequest.getValue('hashKey')(JSON.stringify(self.cachedRequest.getValue('normalizeOptions')(options)))
        ,   filepath = cacheDir + basename
        ,   metaFilepath = filepath + '.json';

        // wait for JSON file to written + flushed
        setTimeout(function(){ 
            var meta = JSON.parse(fs.readFileSync(metaFilepath));

            expect(meta._gzipResponse).to.equal(true);

            magic.detectFile(filepath, function(err, result) {
                if (err) throw err;
                expect(result).to.equal('application/x-gzip'); 
                done();
            });
         }, 25);
      });
    });

    it("responds the same from the cache if gzipResponse option is enabled", function (done) {
      var self = this;
      var responseBody = 'foo';
      var options = {
        url: "http://ping.com/",
        ttl: 5000,
        encoding: null, // avoids messing with gzip responses so we can handle them
        gzipResponse: true 
      };

      //Return gzip compressed response with valid content encoding header
      mock("GET", 1, function () {
        return new MockedResponseStream({}, responseBody).pipe(zlib.createGzip());
      },
      {
        "Content-Encoding": "gzip"
      });

      this.cachedRequest(options, function (error, response, body) {
        if (error) return done(error);
        expect(response.statusCode).to.equal(200);
        expect(response.headers["x-from-cache"]).to.not.exist;

        zlib.gunzip(body, function (error, buffer) {
          if (error) return done(error);
          expect(buffer.toString()).to.deep.equal(responseBody);

          self.cachedRequest(options, function (error, response, body) {
            if (error) return done(error);
            expect(response.statusCode).to.equal(200);
            expect(response.headers["x-from-cache"]).to.equal(1);
            zlib.gunzip(body, function (error, buffer) {
              if (error) done(error);
              expect(buffer.toString()).to.deep.equal(responseBody);
              done();
            });
          });
        });
      });
    });
  });

  describe("streaming", function () {
    it("allows to use request as a stream", function (done) {
      var self = this;
      var responseBody = "";

      for (var i = 0; i < 1000; i++) {
        responseBody += "this is a long response body";
      };

      mock("GET", 1, function () {
        return new MockedResponseStream({}, responseBody);
      });

      var options = {url: "http://ping.com/", ttl: 5000};
      var body = "";

      //Make fresh request
      this.cachedRequest(options)
      .on("data", function (data) {
          body += data;
      })
      .on("end", function () {
        expect(body).to.equal(responseBody);
        body = "";
        //Make cached request
        self.cachedRequest(options)
        .on("response", function (response) {
          expect(response.statusCode).to.equal(200);
          expect(response.headers["x-from-cache"]).to.equal(1);
          response.on("data", function (data) {
            body += data;
          })
          .on("end", function () {
            expect(body).to.equal(responseBody);
            done();
          });
        });
      });
    });

    it("allows to use request as a stream when gzipResponse option is disabled", function (done) {
      var self = this;
      var responseBody = "";

      for (var i = 0; i < 1000; i++) {
        responseBody += "this is a long response body";
      };

      mock("GET", 1, function () {
        return new MockedResponseStream({}, responseBody);
      });

      var options = {url: "http://ping.com/", ttl: 5000, gzipResponse: false};
      var body = "";

      //Make fresh request
      this.cachedRequest(options)
      .on("data", function (data) {
          body += data;
      })
      .on("end", function () {
        expect(body).to.equal(responseBody);
        body = "";
        //Make cached request
        self.cachedRequest(options)
        .on("response", function (response) {
          expect(response.statusCode).to.equal(200);
          expect(response.headers["x-from-cache"]).to.equal(1);
          response.on("data", function (data) {
            body += data;
          })
          .on("end", function () {
            expect(body).to.equal(responseBody);
            done();
          });
        });
      });
    });

    it("allows to use request with get extension method as a stream", function (done) {
      var self = this;
      var responseBody = "";

      for (var i = 0; i < 1000; i++) {
        responseBody += "this is a long response body";
      };

      mock("GET", 1, function () {
        return new MockedResponseStream({}, responseBody);
      });

      var options = {url: "http://ping.com/", ttl: 5000};
      var body = "";

      //Make fresh request
      this.cachedRequest.get(options)
      .on("data", function (data) {
          body += data;
      })
      .on("end", function () {
        expect(body).to.equal(responseBody);
        body = "";
        //Make cached request
        self.cachedRequest(options)
        .on("response", function (response) {
          expect(response.statusCode).to.equal(200);
          expect(response.headers["x-from-cache"]).to.equal(1);
          response.on("data", function (data) {
            body += data;
          })
          .on("end", function () {
            expect(body).to.equal(responseBody);
            done();
          });
        });
      });
    });

    it("handles gzip response", function (done) {
      var self = this;
      var responseBody = "";

      for (var i = 0; i < 1000; i++) {
        responseBody += "this is a long response body";
      };

      //Return gzip compressed response with valid content encoding header
      mock("GET", 1, function () {
        return new MockedResponseStream({}, responseBody).pipe(zlib.createGzip());
      }, 
      {
        "Content-Encoding": "gzip"
      });

      var options = {url: "http://ping.com/", ttl: 5000};
      var body = "";

      //Make fresh request
      this.cachedRequest(options)
        .on("data", function (data) {
          //Ignore first reply
        })
        .on("end", function () {
          body = "";
          //Make cached request
          self.cachedRequest(options)
            .on("response", function (response) {
              expect(response.statusCode).to.equal(200);
              expect(response.headers["x-from-cache"]).to.equal(1);
              expect(response.headers["content-encoding"]).to.equal("gzip");

              var gunzip = zlib.createGunzip();
              gunzip.on("data", function (data) {
                body += data.toString();
              });

              gunzip.on("end", function () {
                expect(body).to.equal(responseBody);
                done();
              });

              gunzip.on('error', function (error) {
                done(error);
              });

              response.pipe(gunzip);
            });

        });
    });
  });

  after(function () {
    temp.cleanupSync();
  });
});
