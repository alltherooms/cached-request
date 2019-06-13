const { Duplex } = require("stream");
const { EventEmitter } = require("events");

class RequestMiddleware extends Duplex {
  constructor(options) {
    super(options);
    this.writeBuffer = [];
    this.mustEndRequest = false;
    this.request = null;

    this.on("finish", () => {
      if (this.request) {
        this.request.end();
      } else {
        this.mustEndRequest = true;
      }
    });
  }

  use(request) {
    this.request = request;
  
    if (EventEmitter.listenerCount(this, "error")) {
      this.request.on("error", (error) => {
        this.emit("error", error);
      });
    };
    if (EventEmitter.listenerCount(this, "socket")) {
      this.request.on("socket", (socket) => {
        this.emit("socket", socket);
      });
    };
    if (EventEmitter.listenerCount(this, "connect")) {
      this.request.on("connect", (response, socket, head) => {
        this.emit("connect", response, socket, head);
      });
    };
    if (EventEmitter.listenerCount(this, "continue")) {
      this.request.on("continue", (response, socket, head) => {
        this.emit("continue", response, socket, head);
      });
    };
  
    this.request.on("response", (response) => {
      if (EventEmitter.listenerCount(this, "response")) {
        this.emit("response", response);
      };
      response.on("data", (data) => {
        this.push(data);
      });
      response.on("end", () => {
        this.push(null);
      });
    });
  
    let chunk;
    while (chunk = this.writeBuffer.shift()) {
      this.request.write(chunk)
    };
  
    if (this.mustEndRequest) {
      this.request.end();
    };
  }

  _write(chunk, encoding, callback) {
    if (this.request) {
      this.request.write(chunk.toString());
    } else {
      this.writeBuffer.push(chunk.toString());
    };
  
    callback();
  }

  //No operational
  _read() {}
}

module.exports = RequestMiddleware;
