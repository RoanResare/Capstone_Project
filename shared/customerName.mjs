const text = (value) => typeof value === "string" ? value.trim() : "";

export function resolveCustomerFullName({ fullName, full_name, username, email } = {}) {
  return text(fullName) || text(full_name) || text(username) || text(email).split("@")[0];
}
