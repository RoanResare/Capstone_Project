const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("implicit TLS waits for secureConnect and hands off without a second handshake or stale timer", async () => {
  let options;
  let connectionOptions;
  const socket = new EventEmitter();
  socket.setTimeout = (ms, callback) => {socket.timeout = ms; if (callback) socket.on("timeout", callback);};
  socket.destroy = error => {if (error) socket.emit("error", error);};
  const context = {
    module: {exports: {}},
    require(id) {
      if (id === "./env") return {env: {
        mail: {smtp: {host: "smtp.gmail.com", port: 465, secure: true, user: "test@gmail.com", pass: "test"}},
        runtime: {mailDeliveryMode: "smtp", mailDeliveryReady: true},
      }};
      if (id === "nodemailer") return {createTransport(value) {options = value; return {verify: async () => true};}};
      if (id === "node:tls") return {connect(value) {connectionOptions = value; return socket;}};
      throw new Error(`Unexpected dependency ${id}`);
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../src/config/mailer.js"), "utf8"), context);
  await context.module.exports.verifyMailerConnection();
  let result;
  let callbacks = 0;
  options.getSocket(options, (error, value) => {assert.ifError(error); callbacks++; result = value;});
  assert.equal(connectionOptions.port, 465);
  assert.equal(connectionOptions.servername, "smtp.gmail.com");
  assert.equal(connectionOptions.rejectUnauthorized, true);
  assert.equal(connectionOptions.autoSelectFamily, true);
  assert.equal(socket.timeout, 30000);
  socket.emit("connect");
  assert.equal(callbacks, 0);
  socket.emit("secureConnect");
  assert.equal(callbacks, 1);
  assert.equal(result.secured, true);
  assert.equal(result.connection, socket);
  assert.equal(socket.timeout, 0);
  assert.equal(socket.listenerCount("timeout"), 0);
  socket.emit("timeout");
  assert.equal(callbacks, 1);
});
