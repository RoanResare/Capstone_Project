const { test } = require('node:test');
const assert = require('node:assert/strict');
const { env } = require('../src/config/env');
const mailer = require('../src/config/mailer');

test('all email flows use Resend HTTPS, preserve IDs and handle provider failures', async () => {
  const originalFetch = global.fetch;
  const originalRuntime = {...env.runtime};
  const originalMail = {...env.mail};
  let request;
  let failure;
  try {
    Object.assign(env.mail, {apiKey: 're_test_only', fromEmail: 'notifications@verified.example', fromName: 'Clinic'});
    Object.assign(env.runtime, {mailDeliveryMode: 'resend', mailDeliveryReady: true});
    global.fetch = async (url, options) => {
      assert.equal(String(url), 'https://api.resend.com/emails');
      const headers = new Headers(options.headers);
      assert.equal(headers.get('authorization'), 'Bearer re_test_only');
      assert.ok(options.signal);
      request = {payload: JSON.parse(options.body), headers};
      return new Response(JSON.stringify(failure || {id: 'resend-email-id'}), {
        status: failure?.statusCode || 200, headers: {'Content-Type': 'application/json'},
      });
    };
    const {sendOtpEmail, sendPasswordResetEmail, sendEmailVerificationLink} = require('../src/services/mail.service');
    for (const role of ['admin', 'staff']) {
      const result = await sendOtpEmail({to: 'test@example.com', fullName: 'Test', otpCode: '123456', role, expiresInMinutes: 5});
      assert.equal(result.messageId, 'resend-email-id');
      assert.equal(result.deliveryMode, 'resend');
      assert.equal(request.payload.from, 'Clinic <notifications@verified.example>');
      assert.match(request.payload.html, new RegExp(role));
      assert.match(request.payload.text, /123456/);
      assert.equal(request.headers.get('idempotency-key'), null);
    }
    await sendPasswordResetEmail({to: 'test@example.com', resetLink: 'https://example.com/reset?code=test'});
    assert.match(request.payload.text, /code=test/);
    await sendEmailVerificationLink({to: 'test@example.com', verificationLink: 'https://example.com/activate?code=test'});
    assert.match(request.payload.html, /Activate account/);
    const {sendAppointmentReminder} = require('../src/services/reminderMail.service');
    const appointment = {customerEmail: 'test@example.com', scheduleDate: '2026-10-22', scheduleTime: '09:00'};
    await sendAppointmentReminder(appointment, 'appointment-1');
    assert.match(request.payload.text, /09:00 AM/);
    const id = request.headers.get('idempotency-key');
    assert.ok(id);
    assert.equal(id, request.payload.headers['Message-ID']);
    await sendAppointmentReminder(appointment, 'appointment-1');
    assert.equal(request.headers.get('idempotency-key'), id);
    for (const [name, statusCode, expected] of [
      ['invalid_api_key', 401, /API key/], ['validation_error', 403, /verified Resend domain/],
      ['rate_limit_exceeded', 429, /rate limited/], ['application_error', 500, /Resend/],
    ]) {
      failure = {name, statusCode, message: 'Provider test error'};
      await assert.rejects(sendEmailVerificationLink({to: 'test@example.com', verificationLink: 'https://example.com'}), error => {
        assert.equal(error.statusCode, 503);
        assert.match(error.message, expected);
        assert.equal(error.details.provider, 'resend');
        assert.equal(error.details.providerCode, name);
        assert.equal(error.details.stage, 'email-verification');
        return true;
      });
    }
    failure = {};
    await assert.rejects(mailer.sendMail({to: 'test@example.com'}), /delivery ID/);
    global.fetch = async () => {throw new Error('fetch failed');};
    await assert.rejects(sendPasswordResetEmail({to: 'test@example.com', resetLink: 'https://example.com'}), /Resend/);
    env.runtime.mailDeliveryReady = false;
    await assert.rejects(mailer.sendMail({to: 'test@example.com'}), /RESEND_API_KEY/);
    await assert.rejects(sendEmailVerificationLink({to: 'test@example.com'}), /RESEND_API_KEY/);
  } finally {
    global.fetch = originalFetch;
    Object.assign(env.mail, originalMail);
    Object.assign(env.runtime, originalRuntime);
  }
});

test('Resend env ignores legacy SMTP credentials and mode, but honors explicit disable', () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const path = require('node:path');
  function load(values) {
    const context = {process: {env: values}, module: {exports: {}}, require(id) {
      if(id === 'fs') return {existsSync: () => false};
      if(id === 'path') return path;
      if(id === './loadEnv') return {loadEnvFiles: () => ({projectRoot: __dirname, serverRoot: __dirname, files: []})};
      throw new Error(id);
    }};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/config/env.js'), 'utf8'), context);
    return context.module.exports;
  }
  const configured = load({RESEND_API_KEY: 're_test', RESEND_FROM_EMAIL: 'mail@verified.example', EMAIL_FROM: 'old@gmail.com', MAIL_DELIVERY_MODE: 'smtp'});
  assert.equal(configured.env.runtime.mailDeliveryMode, 'resend');
  assert.equal(configured.env.mail.fromEmail, 'mail@verified.example');
  assert.equal(configured.env.mail.smtp, undefined);
  assert.equal(load({EMAIL_USER: 'old@gmail.com', EMAIL_PASS: 'old'}).env.runtime.mailDeliveryReady, false);
  assert.equal(load({RESEND_API_KEY: 're_test'}).env.runtime.mailDeliveryReady, false);
  assert.equal(load({RESEND_API_KEY: 're_test', EMAIL_FROM: 'mail@verified.example'}).env.runtime.mailDeliveryReady, true);
  assert.equal(load({RESEND_API_KEY: 're_test', EMAIL_FROM: 'mail@verified.example', MAIL_DELIVERY_MODE: 'disabled'}).env.runtime.mailDeliveryReady, false);
  assert.equal(configured.getStartupDiagnostics().mail.apiKeyConfigured, true);
  assert.equal(JSON.stringify(configured.getStartupDiagnostics()).includes('re_test'), false);
});
