import { ArrowUpRight } from "lucide-react";
import { BrandMark } from "./BrandMark.jsx";

import { isKaponPromoAvailable } from "../../../shared/lowCostKaponPromo.mjs";

export function KaponPromoBanner({ promo }) {
  const available = isKaponPromoAvailable(promo);
  return (
    <section aria-label="Low-Cost Kapon promotion" className="flex flex-col gap-4 border-y border-[#BFE1E1] bg-[#EAF6F6] px-5 py-5 text-[#20343B] sm:flex-row sm:items-center sm:justify-between md:px-6">
      <div className="flex min-w-0 items-center gap-4">
        <BrandMark className="h-16 w-16 shrink-0" />
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#2D6B73]">{available ? "Active" : "Upcoming Low-Cost Kapon"}</p>
          {promo.startsAt && <p className="mt-2 text-sm">{new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" }).format(new Date(promo.startsAt))} (Philippine time)</p>}
          <h2 className="mt-1 break-words text-2xl font-semibold">{promo.title || "Low-Cost Kapon"}</h2>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm text-[#607277]">
            {promo.description || (available ? "Low-cost kapon is currently available. Limited slots may be available." : "Prepare for our upcoming Low-Cost Kapon promotion.")}
          </p>
        </div>
      </div>
      {available ? <a href={promo.formLink} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-[#173E44] px-5 py-3 text-sm font-semibold text-white hover:bg-[#235A61]">
        REGISTER NOW <ArrowUpRight size={16} />
      </a> : <p className="text-sm text-[#607277]">Registration opens when the promotion becomes active.</p>}
    </section>
  );
}
