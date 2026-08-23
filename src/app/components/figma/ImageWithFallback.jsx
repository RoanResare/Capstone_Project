import { useState } from "react";

export function ImageWithFallback({
  src,
  alt,
  className = "",
  onError,
  ...props
}) {
  const [hasError, setHasError] = useState(false);

  const handleError = (event) => {
    setHasError(true);
    onError?.(event);
  };

  if (hasError) {
    return (
      <div
        role="img"
        aria-label={alt}
        className={`${className} bg-gray-100 text-gray-500 flex items-center justify-center`}
      >
        Image unavailable
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onError={handleError}
      {...props}
    />
  );
}
