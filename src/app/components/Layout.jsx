import { useEffect, useState } from "react";
import { Outlet, Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { Menu, X } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { BrandMark } from "./BrandMark.jsx";
import { AskLlamaAI } from "./AskLlamaAI.jsx";
import { useAuth } from "../context/AuthContext.jsx";

const landingNavItems = [
  { id: "home", label: "Home" },
  { id: "services", label: "Services" },
  { id: "book-appointment", label: "Book Appointment" },
];

export function Layout() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const customerAccountPath =
    currentUser?.role === "customer" ? "/customer/dashboard" : "/customer/signup";
  const routeNavItems = [
    { to: customerAccountPath, label: currentUser?.role === "customer" ? "Dashboard" : "Create Account" },
    { to: "/login", label: "Log In" },
  ];

  const closeMobileMenu = () => setMobileMenuOpen(false);

  const scrollToSection = (sectionId) => {
    const section = document.getElementById(sectionId);
    if (!section) {
      return;
    }

    section.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  useEffect(() => {
    if (location.pathname !== "/") {
      return;
    }

    const targetSection =
      typeof location.state?.scrollTo === "string" && location.state.scrollTo.trim()
        ? location.state.scrollTo.trim()
        : location.hash
          ? location.hash.slice(1)
          : "home";
    const frameId = window.requestAnimationFrame(() => {
      scrollToSection(targetSection);
      if (location.hash) {
        navigate({ pathname: "/", search: location.search }, { replace: true });
      }
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [location.hash, location.pathname, location.search, location.state, navigate]);

  const handleLandingNavClick = (sectionId) => {
    closeMobileMenu();

    if (location.pathname === "/") {
      scrollToSection(sectionId);
      return;
    }

    navigate("/", { state: { scrollTo: sectionId } });
  };

  const desktopScrollButtonClassName =
    "rounded-lg px-3 py-2 text-sm font-semibold text-white transition-all duration-200 hover:bg-white/10";
  const desktopRouteLinkClassName = ({ isActive }) =>
    `rounded-lg px-3 py-2 text-sm font-semibold text-white transition-all duration-200 ${
      isActive ? "bg-white/16 shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]" : "hover:bg-white/10"
    }`;
  const mobileLinkClassName = ({ isActive }) =>
    `block rounded-xl px-4 py-3 text-base font-semibold text-white transition-all duration-200 ${
      isActive ? "bg-white/16 shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]" : "hover:bg-white/10"
    }`;

  return (
    <div className="min-h-screen bg-[#F6F0E7]">
      <nav className="fixed top-0 left-0 right-0 z-50 bg-[#2D9B9B] shadow-[0_2px_16px_rgba(34,65,71,0.15)]">
        <div className="mx-auto flex max-w-[1260px] items-center justify-between px-4 py-2 md:px-7">
          <Link to="/" className="flex items-center gap-3 hover:opacity-90 transition-opacity">
            <BrandMark className="h-10 w-10 flex-shrink-0" />
            <span className="text-base font-semibold text-white md:text-[1.15rem]">
              Charming Fur-fection Pet Care Services
            </span>
          </Link>

          <div className="flex items-center gap-3 md:gap-5">
            <div className="hidden items-center gap-3 md:flex">
              {landingNavItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleLandingNavClick(item.id)}
                  className={desktopScrollButtonClassName}
                >
                  {item.label}
                </button>
              ))}
              {routeNavItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={desktopRouteLinkClassName}
                >
                  {item.label}
                </NavLink>
              ))}
            </div>

            <button
              type="button"
              className="md:hidden text-white p-2"
              onClick={() => setMobileMenuOpen((open) => !open)}
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? <X size={28} /> : <Menu size={28} />}
            </button>
          </div>
        </div>

        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="overflow-hidden bg-[#248080] md:hidden"
            >
              <div className="px-6 py-4 space-y-2">
                {landingNavItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleLandingNavClick(item.id)}
                    className="block w-full rounded-xl px-4 py-3 text-left text-base font-semibold text-white transition-all duration-200 hover:bg-white/10"
                  >
                    {item.label}
                  </button>
                ))}
                {routeNavItems.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={closeMobileMenu}
                    className={mobileLinkClassName}
                  >
                    {item.label}
                  </NavLink>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </nav>

      <main className="pt-16">
        <Outlet />
      </main>
      <AskLlamaAI />
    </div>
  );
}
