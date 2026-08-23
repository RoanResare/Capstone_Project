import logoUrl from "../../assets/charming-furfection-logo.svg";

export function BrandMark({ className = "", iconClassName = "" }) {
  return (
    <div className={`inline-flex items-center justify-center ${className}`} aria-hidden="true">
      <img
        src={logoUrl}
        alt=""
        className={iconClassName || "h-full w-full object-contain"}
        draggable="false"
      />
    </div>
  );
}
