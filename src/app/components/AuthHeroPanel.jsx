import { Heart, House, PawPrint } from "lucide-react";
import { BrandMark } from "./BrandMark.jsx";
import heroImage from "../../assets/login-pets-hero.png";

const highlights = [
  { icon: Heart, label: "Trusted Pet Care" },
  { icon: PawPrint, label: "Safe & Comfortable" },
  { icon: House, label: "A Home Away from Home" },
];

export function AuthHeroPanel() {
  return (
    <section className="relative isolate flex min-h-[470px] flex-col overflow-hidden rounded-[30px] bg-[#F2EBDD] shadow-[0_24px_56px_rgba(20,43,46,0.16)] sm:min-h-[540px] lg:min-h-[650px]">
      <img
        src={heroImage}
        alt="A golden retriever and a fluffy cat resting together at home"
        className="absolute inset-0 -z-20 h-full w-full object-cover object-[58%_center]"
      />
      <div className="absolute inset-0 -z-10 bg-gradient-to-br from-[#FBF7EE] via-[#FBF7EE]/95 via-[35%] to-[#FBF7EE]/5" />
      <div className="absolute inset-x-0 bottom-0 -z-10 h-36 bg-gradient-to-t from-[#158B88]/95 via-[#188F8C]/75 to-transparent" />

      <div className="flex h-full flex-1 flex-col p-6 sm:p-8 lg:p-10">
        <div className="flex items-center gap-3">
          <BrandMark className="h-[68px] w-[68px] shrink-0 rounded-full bg-white/70 p-1" />
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.19em] text-[#55777A]">Charming Fur-fection</p>
            <h1 className="mt-1 max-w-[370px] text-xl font-extrabold leading-tight text-[#17464B] sm:text-2xl">
              Pet Care Services – Las Piñas City
            </h1>
          </div>
        </div>

        <div className="mt-7 max-w-[390px]">
          <p className="text-3xl font-extrabold leading-tight text-[#07545A] sm:text-4xl">
            Loving care for happier, healthier pets — always.
          </p>
          <p className="mt-3 max-w-sm text-sm leading-6 text-[#385D61] sm:text-base">
            Friendly care and simple booking, all in one place.
          </p>
        </div>

        <div className="mt-auto grid max-w-[430px] grid-cols-3 gap-2 pt-10">
          {highlights.map(({ icon: Icon, label }) => (
            <div key={label} className="rounded-2xl border border-white/70 bg-white/85 px-2 py-3 text-center shadow-sm backdrop-blur-sm">
              <span className="mx-auto flex h-9 w-9 items-center justify-center rounded-full bg-[#E8F5F2] text-[#168985]">
                <Icon size={18} />
              </span>
              <p className="mt-2 text-[11px] font-bold leading-tight text-[#28575A] sm:text-xs">{label}</p>
            </div>
          ))}
        </div>

        <p className="mt-5 inline-flex w-fit items-center gap-2 rounded-full bg-[#087C79]/85 px-4 py-2 text-sm font-semibold text-white shadow-sm">
          <PawPrint size={16} /> Happy Pets, Brighter Days
        </p>
      </div>
    </section>
  );
}
