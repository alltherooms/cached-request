[![Build Status](https://travis-ci.org/alltherooms/cached-request.svg?branch=master)](https://travis-ci.org/alltherooms/cached-request)

# cached-request
Node.js module to perform HTTP requests with caching support.

## Why?
At [alltherooms](http://alltherooms.com/) we make lots of requests to external APIs, and caching is crucial to provide a good experience to our users. We also love streams! however, we had a hard time finding a good tool for caching HTTP responses and streaming them at the same time, so we wrote **cached-request**. We hope to help others, and feedback is always welcome. :)

## How it works
This tool was made to work with the popular [request](https://github.com/request/request) module, which simplifies the HTTP requests in Node.js. Therefore, this must be considered a wrapper around **request**.

First, you instantiate a **cachedRequest** instance by passing a **request** function, which is going to act as the requester for the uncached requests - you still need to `$npm install request` independently. - Then, you can use **cachedRequest** to perform your HTTP requests.

The caching takes place in the filesystem, storing the responses as compressed gzipped files.

Please note this will cache *everything*, so don't use it for making things like POST or PUT requests that you don't want to be cached.

## Installation
Install it using [npm](https://www.npmjs.com/)
```
$ npm install cached-request
```

## Usage
First, you must set it up:
```javascript
var request = require('request')
,   cachedRequest = require('cached-request')(request)
,   cacheDirectory = "/tmp/cache";

cachedRequest.setCacheDirectory(cacheDirectory);
```
_Note_: You have to ensure the user that launches the process has read+write permissions over `cacheDirectory`, otherwise the program will fail.

Then you can use `cachedRequest` just as you use [request](https://github.com/request/request): passing a callback, or as a stream.

### Passing a callback
```javascript
cachedRequest(options, function (error, response, body) {
  if (error) {
    //Handle request error
  }
  //Do what you need with `response` and `body`
});
```

### As a stream
```
cachedRequest(options).pipe(someWriteStream);
```

## request options
When making a request, you must pass an `options` object as you can observe in the examples above. This object can contain any of the [options supported by **request**](https://github.com/request/request#requestoptions-callback) with the addition of a required `ttl` option.

- `ttl`: Number of milliseconds for the cached response to be considered stale.

    ```javascript
      var options = {
        url: "https://www.google.com",
        ttl: 3000 //3 seconds
      };
      cachedRequest(options, callback);
    ```

    You can also set a global ttl option for all requests:

    ```javascript
    cachedRequest.setValue('ttl', 1000);
    cachedRequest({url: 'https://www.google.com'}, callback); // should benefit from the cache if previously cached
    ```

## Can I use everything that comes with **request**?
No, there's some things you can't use. For example, the shortcut functions `.get`, `.post`, `.put`, etc. are not available in **cached-request**. If you'd like to have them, this is a great opportunity to contribute!

## Running tests
Run the tests with npm
```
$ npm test
```

## License (MIT)
