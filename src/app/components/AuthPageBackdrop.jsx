import heroImage from "../../assets/login-pets-hero.png";

export function AuthPageBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-[#F6F0E7]">
      <img
        src={heroImage}
        alt=""
        className="absolute inset-0 h-full w-full object-cover object-center opacity-25"
      />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(246,240,231,0.48)_0%,rgba(246,240,231,0.78)_48%,rgba(246,240,231,0.88)_100%)]" />
    </div>
  );
}
