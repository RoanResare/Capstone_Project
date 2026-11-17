import { Heart, House, PawPrint } from "lucide-react";
import { BrandMark } from "./BrandMark.jsx";

const highlights = [
  { icon: Heart, label: "Trusted Pet Care" },
  { icon: PawPrint, label: "Safe & Comfortable" },
  { icon: House, label: "A Home Away from Home" },
];

export function AuthHeroPanel() {
  return (
    <section className="relative flex min-h-[360px] flex-col justify-center py-6 sm:min-h-[420px] sm:py-6 lg:min-h-[550px] lg:py-8">
      <div className="flex h-full flex-1 flex-col px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <BrandMark className="h-14 w-14 shrink-0 rounded-full bg-white/70 p-1" />
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.19em] text-[#55777A]">Charming Fur-fection</p>
            <h1 className="mt-1 max-w-[370px] text-xl font-extrabold leading-tight text-[#17464B] sm:text-2xl">
              Pet Care Services – Las Piñas City
            </h1>
          </div>
        </div>

        <div className="mt-5 max-w-[390px]">
          <p className="text-3xl font-extrabold leading-tight text-[#07545A] sm:text-4xl">
            Loving care for happier, healthier pets — always.
          </p>
          <p className="mt-3 max-w-sm text-sm leading-5 text-[#385D61] sm:text-base">
            Friendly care and simple booking, all in one place.
          </p>
        </div>

        <div className="mt-auto grid max-w-[430px] grid-cols-3 gap-2 pt-6">
          {highlights.map(({ icon: Icon, label }) => (
            <div key={label} className="rounded-2xl border border-white/70 bg-white/85 px-2 py-2.5 text-center shadow-sm backdrop-blur-sm">
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
