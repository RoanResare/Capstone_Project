function getPasswordStrength(password = "") {
  const value = String(password);
  const hasLetters = /[A-Za-z]/.test(value);
  const hasNumbers = /\d/.test(value);
  const hasLower = /[a-z]/.test(value);
  const hasUpper = /[A-Z]/.test(value);
  const hasSpecial = /[^A-Za-z0-9]/.test(value);

  if (value.length >= 8 && hasLower && hasUpper && hasNumbers && hasSpecial) {
    return { level: 3, label: "Strong", labelClassName: "text-[#1D7C45]" };
  }

  if (value.length >= 6 && hasLetters && hasNumbers) {
    return { level: 2, label: "Medium", labelClassName: "text-[#A56A0F]" };
  }

  if (value.length > 0) {
    return { level: 1, label: "Weak", labelClassName: "text-[#B23949]" };
  }

  return { level: 0, label: "Weak", labelClassName: "text-[#8A9A9D]" };
}

const segmentClassNames = [
  "bg-[#D94A5C]",
  "bg-[#F4B740]",
  "bg-[#27A363]",
];

export function PasswordStrengthMeter({ password }) {
  const strength = getPasswordStrength(password);

  return (
    <div className="mt-2" aria-live="polite">
      <div className="grid grid-cols-3 gap-1.5">
        {segmentClassNames.map((className, index) => (
          <span
            key={className}
            className={`h-2 rounded-full transition-all duration-300 ${
              strength.level > index ? className : "bg-[#E8EEEE]"
            }`}
          />
        ))}
      </div>
      <p className={`mt-1.5 text-xs font-semibold ${strength.labelClassName}`}>
        {strength.label}
      </p>
    </div>
  );
}
