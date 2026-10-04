let pendingRegistration = null;

export function beginCustomerRegistration() {
  if (pendingRegistration) throw new Error("Customer registration is already in progress.");
  let release;
  pendingRegistration = new Promise((resolve) => { release = resolve; });
  let finished = false;
  return () => {
    if (finished) return;
    finished = true;
    pendingRegistration = null;
    release();
  };
}

export async function waitForCustomerRegistration() {
  while (pendingRegistration) await pendingRegistration;
}
