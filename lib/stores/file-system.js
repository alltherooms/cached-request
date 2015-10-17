"use strict";

var fs = require('graceful-fs');

function FileSystemStore (options) {
  this.directory = options.directory;

  if (!this.directory) throw new Error('A directory must be provided');
}

FileSystemStore.prototype.stat = function (key, callback) {
  fs.stat(this.directory + '/' + key, function (error, stats) {
    if (error) return callback(error.code == 'ENOENT' ? null : error);

    callback(null, stats);
  });
};

FileSystemStore.prototype.getHeadersFilePath = function (key) {
  return this.directory + '/' + key + '.json';
};

FileSystemStore.prototype.setHeaders = function (key, headers, callback) {
  fs.writeFile(this.getHeadersFilePath(key), JSON.stringify(headers), callback);
};

FileSystemStore.prototype.getHeaders = function (key, callback) {
  fs.readFile(this.getHeadersFilePath(key), function (error, data) {
    if (error) return callback(error.code == 'ENOENT' ? null : error);

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
    callback(error.code == 'ENOENT' ? null : error);
  });

  readStream.on('open', callback.bind(null, null, readStream));
};
