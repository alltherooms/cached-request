"use strict";

var fs = require('graceful-fs');

function FileSystemStore (directory) {
  this.directory = directory || '/tpm';
}

FileSystemStore.prototype.getHeadersFilePath = function (key) {
  return this.directory + '/' + key + '.json';
};

FileSystemStore.prototype.setHeaders = function (key, headers, callback) {
  fs.writeFile(this.getHeadersFilePath(key), JSON.stringify(headers), callback);
};

FileSystemStore.prototype.getHeaders = function (key, callback) {
  fs.readFile(this.getHeadersFilePath(key), function (error, data) {
    if (error) {
      if (error.code == 'ENOENT') return callback();
      return callback(error);
    }

    try {
      callback(null, JSON.parse(data));
    } catch (error) {
      callback(error);
    }
  });
};

FileSystemStore.prototype.setResponseStream = function (key, responseStream, callback) {
  var writeStream = fs.createWriteStream(this.directory + '/' + key);

  writeStream.on('error', callback);
  writeStream.on('finish', callback);

  responseStream.on('error', function () {
    writeStream.end();
  });

  responseStream.pipe(writeStream);
};

FileSystemStore.prototype.getResponseStream = function (key, callback) {
  var readStream = fs.createReadStream(this.directory + '/' + key);

  readStream.on('error', function (error) {
    if (error.code == 'ENOENT') return callback();
    callback(error);
  });

  readStream.on('open', callback.bind(null, null, readStream));
};
