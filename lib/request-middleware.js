/*
RequestMiddleware class
*/

var util = require('util')
,   Duplex = require('stream').Duplex
,   EventEmitter = require('events').EventEmitter;

util.inherits(RequestMiddleware, Duplex);

function RequestMiddleware (options) {
  Duplex.call(this, options);

  this.writeBuffer = [];
  this.mustEndRequest = false;
  this.request = null;

  this.on('finish', function () {
    if (this.request) this.request.end();
    else this.mustEndRequest = true;
  });
}

RequestMiddleware.prototype.setRequest = function (request) {
  var self = this;
  var events = ['error', 'socket', 'connect', 'continue', 'response'];

  events.forEach(function (event) {
    if (EventEmitter.listenerCount(self, event)) {
      request.on(event, self.emit(self, event));
    }
  });

  this.request = request;

  this.request.on('response', function (response) {
    response.on('data', self.push.bind(self));
    response.on('end', self.push.bind(self, null));
  });

  var chunk;

  while (chunk = this.writeBuffer.shift()) this.request.write(chunk);

  if (this.mustEndRequest) this.request.end();
};

RequestMiddleware.prototype._write = function (chunk, encoding, callback) {
  if (this.request) this.request.write(chunk.toString());
  else this.writeBuffer.push(chunk.toString());

  process.nextTick(callback);
};

//No operational
RequestMiddleware.prototype._read = function () {};

module.exports = RequestMiddleware;