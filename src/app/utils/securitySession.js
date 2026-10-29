let activeUid = "";
let activeSessionKey = "";
let epoch = 0;

export function setSecuritySession(uid = "", sessionKey = "") {
  if (activeUid !== uid || activeSessionKey !== sessionKey) {
    activeUid = uid;
    activeSessionKey = sessionKey;
    epoch++;
  }
}

export function getSecurityEpoch() { return epoch; }

export function isCurrentSecurityResponse(requestEpoch) {
  return Boolean(activeUid) && requestEpoch === epoch;
}
