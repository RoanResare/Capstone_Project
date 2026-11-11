export function reachedPolicyBottom(element) {
  return element.scrollTop + element.clientHeight >= element.scrollHeight - 4;
}

export function canAcceptPolicyAgreement({ termsRead, privacyRead, accepted }) {
  return Boolean(termsRead && privacyRead && accepted);
}
