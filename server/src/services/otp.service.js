const { admin, db } = require("../config/firebaseAdmin");
const { env } = require("../config/env");
const { OTP_COLLECTION } = require("../constants/auth");
const { ApiError } = require("../utils/ApiError");
const { generateOtpCode, hashOtpCode } = require("../utils/otp");

function isExpired(expiresAt) {
  const value = expiresAt?.toDate ? expiresAt.toDate() : expiresAt;
  return !(value instanceof Date) || value.getTime() <= Date.now();
}

function toDate(value) {
  if (value?.toDate) {
    return value.toDate();
  }

  return value instanceof Date ? value : null;
}

function getResendAvailableAt(createdAt) {
  return new Date(createdAt.getTime() + env.otp.resendCooldownSeconds * 1000);
}

function isFirestoreIndexError(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "");

  return code === "9" || code === "failed-precondition" || message.includes("FAILED_PRECONDITION");
}

async function getLatestOtpRecordForUser(userId) {
  try {
    const snapshot = await db
      .collection(OTP_COLLECTION)
      .where("userId", "==", userId)
      .orderBy("createdAt", "desc")
      .limit(1)
      .get();

    return snapshot.empty ? null : snapshot.docs[0].data();
  } catch (error) {
    if (!isFirestoreIndexError(error)) {
      throw error;
    }

    console.warn("[otp] Firestore OTP index missing; falling back to in-memory cooldown sort.", {
      userId,
      code: error?.code || "",
      message: error instanceof Error ? error.message : String(error || "Unknown error"),
    });

    const snapshot = await db.collection(OTP_COLLECTION).where("userId", "==", userId).get();
    const records = snapshot.docs
      .map((doc) => doc.data())
      .sort((left, right) => {
        const leftCreatedAt = toDate(left.createdAt)?.getTime() || 0;
        const rightCreatedAt = toDate(right.createdAt)?.getTime() || 0;
        return rightCreatedAt - leftCreatedAt;
      });

    return records[0] || null;
  }
}

async function getOpenOtpDocumentsForUser(userId) {
  try {
    const snapshot = await db
      .collection(OTP_COLLECTION)
      .where("userId", "==", userId)
      .where("isUsed", "==", false)
      .get();

    return snapshot.docs;
  } catch (error) {
    if (!isFirestoreIndexError(error)) {
      throw error;
    }

    console.warn("[otp] Firestore OTP index missing; falling back to in-memory open-code filter.", {
      userId,
      code: error?.code || "",
      message: error instanceof Error ? error.message : String(error || "Unknown error"),
    });

    const snapshot = await db.collection(OTP_COLLECTION).where("userId", "==", userId).get();
    return snapshot.docs.filter((doc) => doc.data()?.isUsed === false);
  }
}

async function assertOtpResendAllowed(userId) {
  if (!env.otp.resendCooldownSeconds) {
    return;
  }

  const latestRecord = await getLatestOtpRecordForUser(userId);

  if (!latestRecord) {
    return;
  }

  const createdAt = toDate(latestRecord.createdAt);

  if (!(createdAt instanceof Date)) {
    return;
  }

  const resendAvailableAt = getResendAvailableAt(createdAt);
  const remainingSeconds = Math.ceil((resendAvailableAt.getTime() - Date.now()) / 1000);

  if (remainingSeconds > 0) {
    throw new ApiError(
      429,
      `Wait ${remainingSeconds} seconds before requesting a new one-time password.`,
      {
        retryAfterSeconds: remainingSeconds,
        resendAvailableAt: resendAvailableAt.toISOString(),
      },
    );
  }
}

async function invalidateOpenOtpsForUser(userId) {
  const openOtpDocuments = await getOpenOtpDocumentsForUser(userId);

  if (openOtpDocuments.length === 0) {
    return;
  }

  const batch = db.batch();
  openOtpDocuments.forEach((doc) => {
    batch.update(doc.ref, {
      isUsed: true,
      invalidatedAt: admin.firestore.Timestamp.now(),
      invalidatedReason: "superseded",
    });
  });
  await batch.commit();
}

async function createOtpVerification(user, options = {}) {
  if (options.enforceCooldown) {
    await assertOtpResendAllowed(user.uid);
  }

  await invalidateOpenOtpsForUser(user.uid);

  const otpCode = generateOtpCode();
  const now = admin.firestore.Timestamp.now();
  const createdAt = now.toDate();
  const expiresAt = admin.firestore.Timestamp.fromDate(
    new Date(Date.now() + env.otp.ttlMinutes * 60 * 1000),
  );
  const docRef = db.collection(OTP_COLLECTION).doc();

  await docRef.set({
    otpId: docRef.id,
    userId: user.uid,
    email: user.email,
    role: user.role,
    otpCode: hashOtpCode(otpCode),
    attemptCount: 0,
    createdAt: now,
    expiresAt,
    isUsed: false,
  });

  console.info("[otp] OTP challenge created.", {
    otpId: docRef.id,
    uid: user.uid,
    role: user.role,
    expiresAt: expiresAt.toDate().toISOString(),
    resendAvailableAt: getResendAvailableAt(createdAt).toISOString(),
  });

  return {
    otpId: docRef.id,
    otpCode,
    createdAt,
    expiresAt: expiresAt.toDate(),
    resendAvailableAt: getResendAvailableAt(createdAt),
  };
}

async function verifyOtpCode({ otpId, otpCode, user }) {
  const docRef = db.collection(OTP_COLLECTION).doc(otpId);
  const now = admin.firestore.Timestamp.now();
  const outcome = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(docRef);

    if (!snapshot.exists) {
      return {
        status: "missing",
      };
    }

    const record = snapshot.data();

    if (record.userId !== user.uid || record.email !== user.email || record.role !== user.role) {
      throw new ApiError(403, "The verification request does not match the authenticated user.");
    }

    if (record.isUsed) {
      return {
        status: "used",
      };
    }

    if (isExpired(record.expiresAt)) {
      transaction.update(docRef, {
        isUsed: true,
        invalidatedAt: now,
        invalidatedReason: "expired",
      });

      return {
        status: "expired",
      };
    }

    const nextAttemptCount = Number(record.attemptCount || 0) + 1;

    if (hashOtpCode(otpCode) !== record.otpCode) {
      const attemptsRemaining = Math.max(0, env.otp.maxAttempts - nextAttemptCount);

      if (attemptsRemaining === 0) {
        transaction.update(docRef, {
          attemptCount: nextAttemptCount,
          invalidatedAt: now,
          invalidatedReason: "max-attempts",
          isUsed: true,
          lastAttemptAt: now,
        });

        return {
          status: "locked",
          attemptsRemaining,
        };
      }

      transaction.update(docRef, {
        attemptCount: nextAttemptCount,
        lastAttemptAt: now,
      });

      return {
        status: "invalid",
        attemptsRemaining,
      };
    }

    transaction.update(docRef, {
      attemptCount: nextAttemptCount,
      isUsed: true,
      invalidatedAt: now,
      invalidatedReason: "verified",
      lastAttemptAt: now,
      verifiedAt: now,
    });

    return {
      status: "verified",
    };
  });

  if (outcome.status === "verified") {
    console.info("[otp] OTP verified successfully.", {
      otpId,
      uid: user.uid,
      role: user.role,
    });
    return outcome;
  }

  if (outcome.status === "missing") {
    console.warn("[otp] OTP verification failed because the ticket was not found.", {
      otpId,
      uid: user.uid,
      role: user.role,
    });
    throw new ApiError(404, "The verification request could not be found.");
  }

  if (outcome.status === "used") {
    console.warn("[otp] OTP verification attempted with a used code.", {
      otpId,
      uid: user.uid,
      role: user.role,
    });
    throw new ApiError(409, "This one-time password has already been used.");
  }

  if (outcome.status === "expired") {
    console.warn("[otp] OTP verification attempted with an expired code.", {
      otpId,
      uid: user.uid,
      role: user.role,
    });
    throw new ApiError(400, "This one-time password has expired. Please request a new code.");
  }

  if (outcome.status === "locked") {
    console.warn("[otp] OTP verification locked after too many invalid attempts.", {
      otpId,
      uid: user.uid,
      role: user.role,
    });
    throw new ApiError(
      429,
      "Too many invalid one-time password attempts. Request a new code to continue.",
      {
        attemptsRemaining: 0,
      },
    );
  }

  if (outcome.status === "invalid") {
    console.warn("[otp] OTP verification failed because the code was invalid.", {
      otpId,
      uid: user.uid,
      role: user.role,
      attemptsRemaining: outcome.attemptsRemaining,
    });
    throw new ApiError(
      400,
      `The one-time password is invalid. ${outcome.attemptsRemaining} attempt${outcome.attemptsRemaining === 1 ? "" : "s"} remaining.`,
      {
        attemptsRemaining: outcome.attemptsRemaining,
      },
    );
  }

  throw new ApiError(500, "Unable to verify the one-time password right now.");
}

module.exports = {
  createOtpVerification,
  invalidateOpenOtpsForUser,
  verifyOtpCode,
};
