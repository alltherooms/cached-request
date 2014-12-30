/*
RequestMiddleware class
*/

var util = require("util")
,   Duplex = require("stream").Duplex
,   EventEmitter = require("events").EventEmitter;

util.inherits(RequestMiddleware, Duplex);

function RequestMiddleware (options) {
  Duplex.call(this, options);

  this.writeBuffer = [];
  this.mustEndRequest = false;
  this.request = null;

  this.on("finish", function () {
    if (this.request) {
      this.request.end();
    } else {
      this.mustEndRequest = true;
    };
  });
};

RequestMiddleware.prototype.use = function (request) {
  var self = this
  ,   chunk;

  this.request = request;

  if (EventEmitter.listenerCount(this, "error")) {
    this.request.on("error", function (error) {
      self.emit("error", error);
    });
  };
  if (EventEmitter.listenerCount(this, "socket")) {
    this.request.on("socket", function (socket) {
      self.emit("socket", socket);
    });
  };
  if (EventEmitter.listenerCount(this, "connect")) {
    this.request.on("connect", function (response, socket, head) {
      self.emit("connect", response, socket, head);
    });
  };
  if (EventEmitter.listenerCount(this, "continue")) {
    this.request.on("continue", function (response, socket, head) {
      self.emit("continue", response, socket, head);
    });
  };

  this.request.on("response", function (response) {
    if (EventEmitter.listenerCount(self, "response")) {
      self.emit("response", response);
    };
    response.on("data", function (data) {
      self.push(data);
    });
    response.on("end", function () {
      self.push(null);
    });
  });

  while (chunk = this.writeBuffer.shift()) {
    this.request.write(chunk)
  };

  if (this.mustEndRequest) {
    this.request.end();
  };
};

RequestMiddleware.prototype._write = function (chunk, encoding, callback) {
  if (this.request) {
    this.request.write(chunk.toString());
  } else {
    this.writeBuffer.push(chunk.toString());
  };

  callback();
};

//No operational
RequestMiddleware.prototype._read = function () {};

module.exports = RequestMiddleware;