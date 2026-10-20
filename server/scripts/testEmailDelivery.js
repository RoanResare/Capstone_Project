// Sends four clearly marked test messages to the configured sender's inbox.
const { env } = require('../src/config/env');
const { verifyMailerConnection } = require('../src/config/mailer');
const { sendOtpEmail, sendEmailVerificationLink, sendPasswordResetEmail } = require('../src/services/mail.service');
const { sendAppointmentReminder } = require('../src/services/reminderMail.service');

async function main() {
  const timeout = setTimeout(() => {
    console.error('Live email test timed out after 90 seconds.');
    process.exit(1);
  }, 90000);
  try {
    if (!env.runtime.mailDeliveryReady) throw new Error('Email delivery is not configured.');
    await verifyMailerConnection();
    console.log('Live transport authentication passed.');
    const to = env.mail.smtp.user;
    const fullName = 'EMAIL DELIVERY TEST — no action required';
    const tests = [
      ['OTP', () => sendOtpEmail({ to, fullName, otpCode: '000000', role: 'test', expiresInMinutes: 5 })],
      ['Activation', () => sendEmailVerificationLink({ to, fullName, verificationLink: 'https://example.invalid/activate-account?test=true' })],
      ['Password reset', () => sendPasswordResetEmail({ to, fullName, resetLink: 'https://example.invalid/reset-password?test=true' })],
      ['Reminder', () => sendAppointmentReminder({ customerEmail: to, customerName: fullName, petName: 'Test pet (no real booking)', scheduleDate: '2099-01-01', scheduleTime: '09:00' }, `delivery-test-${Date.now()}`)],
    ];
    for (const [name, send] of tests) {
      const result = await send();
      console.log(`${name}: provider accepted message ${result.messageId}`);
    }
    console.log('All four live email utilities passed. Inbox placement must be checked in the recipient mailbox.');
  } finally {
    clearTimeout(timeout);
  }
}

main().catch(error => {
  console.error('Live email test failed.', { code: error.code, message: error.message });
  process.exitCode = 1;
});
