"use strict";

var util      = require('util');
var Transform = require('stream').Transform;

util.inherits(MockedResponse, Transform);

function MockedResponse (options) {
  Transform.call(this, options);
}

MockedResponse.prototype._transform = function (chunk, enconding, callback) {
  this.push(chunk);
  process.nextTick(callback);
};