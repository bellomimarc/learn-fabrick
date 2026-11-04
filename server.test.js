import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

// Import without opening a TCP port: the user runs the server in their terminal.
process.env.NODE_ENV = 'test';
const { server } = await import('./server.js');

test('S2S notification receives HTTP 200 with no response body', () => {
  const request = {
    method: 'GET',
    url: '/notification?paymentID=123456&Status=OK',
  };
  const response = new EventEmitter();
  response.writeHead = (status, headers) => {
    response.statusCode = status;
    response.headers = headers;
  };
  response.end = body => {
    response.body = body;
    response.emit('finish');
  };

  server.emit('request', request, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body, '');
  assert.equal(response.headers['Cache-Control'], 'no-store');
  assert.equal(server.listening, false);
});
