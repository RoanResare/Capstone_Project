import heroImage from "../../assets/login-pets-hero.png";

export function AuthPageBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-[#F6F0E7]">
      <img
        src={heroImage}
        alt=""
        className="absolute inset-0 h-full w-full object-cover object-[42%_center] opacity-45"
      />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(246,240,231,0.22)_0%,rgba(246,240,231,0.52)_46%,rgba(246,240,231,0.84)_100%)]" />
    </div>
  );
}
