const CachedRequest = require("../");
const request = require("request");
const nock = require("nock");
const temp = require('temp').track();
const { Readable } = require("stream");
const zlib = require("zlib");

class MockedResponseStream extends Readable {
  constructor(options, response) {
    super(options);
    this.response = response;
  }
  
  _read() {
    this.push(this.response);
    this.push(null);
  }
}

describe("CachedRequest", () => {
  function mock(method, times, response, headers) {
    method = method.toLowerCase();
    times = times || 1;
    nock("http://ping.com")
      .filteringPath(/.+/, "/")
      [method]("/")
      .times(times)
      .reply(200, response, headers);
  };

  before(() => {
    nock.disableNetConnect();
  });

  beforeEach(function () {
    const cacheDir = temp.mkdirSync("cache");
    this.cachedRequest = CachedRequest(request);
    this.cachedRequest.setCacheDirectory(cacheDir);
    nock.cleanAll();
  });

  afterEach((done) => {
    temp.cleanup(done);
  })

  describe("caching", () => {
    it("makes the request when the response isn't cached", function (done) {
      mock("GET", 1, () => {
        return new MockedResponseStream({}, "pong");
      });
      this.cachedRequest({uri: "http://ping.com/", ttl: 0}, (error, response, body) => {
        if (error) return done(error);
        expect(response.statusCode).to.equal(200);
        expect(response.headers["x-from-cache"]).to.not.exist;
        expect(body).to.equal("pong");
        done();
      });
    });

    it("makes the request when the response isn't cached using the get extension method", function (done) {
      mock("GET", 1, () => {
        return new MockedResponseStream({}, "pong");
      });
      this.cachedRequest.get({uri: "http://ping.com/", ttl: 0, method: 'GET'}, (error, response, body) => {
        if (error) return done(error);
        expect(response.statusCode).to.equal(200);
        expect(response.headers["x-from-cache"]).to.not.exist;
        expect(body).to.equal("pong");
        done();
      });
    });

    it("responds from the cache", function (done) {
      const responseBody = {"a": 1, "b": {"c": 2}};
      const options = {
        uri: "http://ping.com/",
        method: "POST",
        json: {
          a: 1
        },
        ttl: 5000
      };

      mock(options.method, 1, () => {
        return new MockedResponseStream({}, JSON.stringify(responseBody));
      });

      this.cachedRequest(options, (error, response, body) => {
        if (error) return done(error);
        expect(response.statusCode).to.equal(200);
        expect(response.headers["x-from-cache"]).to.not.exist;
        expect(body).to.deep.equal(responseBody);

        this.cachedRequest(options, (error, response, body) => {
          if (error) return done(error);
          expect(response.statusCode).to.equal(200);
          expect(response.headers["x-from-cache"]).to.equal(1);
          expect(body).to.deep.equal(responseBody);
          done();
        });
      });
    });

    it("responds from the cache using get extension method", function (done) {
      const responseBody = {"a": 1, "b": {"c": 2}};
      const options = {
        uri: "http://ping.com/",
        method: "GET",
        json: {
          a: 1
        },
        ttl: 5000
      };

      mock(options.method, 1, () => {
        return new MockedResponseStream({}, JSON.stringify(responseBody));
      });

      this.cachedRequest.get(options, (error, response, body) => {
        if (error) return done(error);
        expect(response.statusCode).to.equal(200);
        expect(response.headers["x-from-cache"]).to.not.exist;
        expect(body).to.deep.equal(responseBody);

        this.cachedRequest.get(options, (error, response, body) => {
          if (error) return done(error);
          expect(response.statusCode).to.equal(200);
          expect(response.headers["x-from-cache"]).to.equal(1);
          expect(body).to.deep.equal(responseBody);
          done();
        });
      });
    });

    it("responds the same from the cache if gzipped", function (done) {
      const responseBody = 'foo';
      const options = {
        url: "http://ping.com/",
        ttl: 5000,
        encoding: null // avoids messing with gzip responses so we can handle them
      };

      //Return gzip compressed response with valid content encoding header
      mock("GET", 1, () => {
        return new MockedResponseStream({}, responseBody).pipe(zlib.createGzip());
      },
      {
        "Content-Encoding": "gzip"
      });

      this.cachedRequest(options, (error, response, body) => {
        if (error) return done(error);
        expect(response.statusCode).to.equal(200);
        expect(response.headers["x-from-cache"]).to.not.exist;

        zlib.gunzip(body, (error, buffer) => {
          if (error) return done(error);
          expect(buffer.toString()).to.deep.equal(responseBody);

          this.cachedRequest(options, (error, response, body) => {
            if (error) return done(error);
            expect(response.statusCode).to.equal(200);
            expect(response.headers["x-from-cache"]).to.equal(1);
            zlib.gunzip(body, (error, buffer) => {
              if (error) done(error);
              expect(buffer.toString()).to.deep.equal(responseBody);
              done();
            });
          });
        });
      });
    });

    describe('when cannot parse the cached response headers', () => {
      after(function () {
        if (this._parseHeaders) {
          this.cachedRequest.setValue('parseHeaders', this._parseHeaders);
        }
      });

      it("makes the request", function (done) {
        const options = {uri: "http://ping.com/", ttl: 5000};

        mock("GET", 2, () => {
          return new MockedResponseStream({}, "pong");
        }, {foo: 'bar'});

        this.cachedRequest(options, (error, response, body) => {
          if (error) return done(error);
          expect(response.statusCode).to.equal(200);
          expect(response.headers["x-from-cache"]).to.not.exist;
          expect(body).to.equal("pong");

          this._parseHeaders = this.cachedRequest.getValue('parseHeaders');
          this.cachedRequest.setValue('parseHeaders', () => {
            throw new Error('Cannot parse headers');
          });

          this.cachedRequest(options, (error, response, body) => {
            if (error) return done(error);
            expect(response.statusCode).to.equal(200);
            expect(response.headers["x-from-cache"]).to.not.exist;
            expect(body).to.equal("pong");
            done();
          });
        });
      });
    });
  });

  describe("streaming", () => {
    it("allows to use request as a stream", function (done) {
      let responseBody = "";

      for (let i = 0; i < 1000; i++) {
        responseBody += "this is a long response body";
      };

      mock("GET", 1, () => {
        return new MockedResponseStream({}, responseBody);
      });

      const options = {url: "http://ping.com/", ttl: 5000};
      let body = "";

      //Make fresh request
      this.cachedRequest(options)
        .on("data", (data) => {
            body += data;
        })
        .on("end", () => {
          expect(body).to.equal(responseBody);
          body = "";
          //Make cached request
          this.cachedRequest(options)
          .on("response", (response) => {
            expect(response.statusCode).to.equal(200);
            expect(response.headers["x-from-cache"]).to.equal(1);
            response.on("data", (data) => {
              body += data;
            })
            .on("end", () => {
              expect(body).to.equal(responseBody);
              done();
            });
          });
        });
    });

    it("allows to use request with get extension method as a stream", function (done) {
      let responseBody = "";

      for (let i = 0; i < 1000; i++) {
        responseBody += "this is a long response body";
      };

      mock("GET", 1, () => {
        return new MockedResponseStream({}, responseBody);
      });

      const options = {url: "http://ping.com/", ttl: 5000};
      let body = "";

      //Make fresh request
      this.cachedRequest.get(options)
        .on("data", (data) => {
            body += data;
        })
        .on("end", () => {
          expect(body).to.equal(responseBody);
          body = "";
          //Make cached request
          this.cachedRequest(options)
            .on("response", (response) => {
              expect(response.statusCode).to.equal(200);
              expect(response.headers["x-from-cache"]).to.equal(1);
              response.on("data", (data) => {
                body += data;
              })
              .on("end", () => {
                expect(body).to.equal(responseBody);
                done();
              });
            });
        });
    });

    it("handles gzip response", function (done) {
      let responseBody = "";

      for (let i = 0; i < 1000; i++) {
        responseBody += "this is a long response body";
      };

      //Return gzip compressed response with valid content encoding header
      mock("GET", 1, () => {
        return new MockedResponseStream({}, responseBody).pipe(zlib.createGzip());
      }, 
      {
        "Content-Encoding": "gzip"
      });

      const options = {url: "http://ping.com/", ttl: 5000};
      let body = "";

      //Make fresh request
      this.cachedRequest(options)
        .on("data", (data) => {
          //Ignore first reply
        })
        .on("end", () => {
          //Make cached request
          this.cachedRequest(options)
            .on("response", (response) => {
              expect(response.statusCode).to.equal(200);
              expect(response.headers["x-from-cache"]).to.equal(1);
              expect(response.headers["content-encoding"]).to.equal("gzip");

              const gunzip = zlib.createGunzip();
              gunzip.on("data", (data) => {
                body += data.toString();
              });

              gunzip.on("end", () => {
                expect(body).to.equal(responseBody);
                done();
              });

              gunzip.on('error', (error) => {
                done(error);
              });

              response.pipe(gunzip);
            });

        });
    });
  });
});